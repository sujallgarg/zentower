// Supabase Edge Function: dodo-webhook
// Securely verifies Standard Webhooks from Dodo Payments and idempotently activates paid sponsor bids

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Cryptographically verifies Dodo Payments / Standard Webhooks signature using Web Crypto HMAC-SHA256
 */
async function verifyStandardWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string
): Promise<{ valid: boolean; reason?: string }> {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { valid: false, reason: "Missing required webhook verification headers (webhook-id, webhook-timestamp, webhook-signature)" };
  }

  // 1. Verify timestamp skew (maximum 5 minutes / 300 seconds)
  const timestampNum = parseInt(webhookTimestamp, 10);
  if (isNaN(timestampNum)) {
    return { valid: false, reason: "Invalid webhook-timestamp header" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const skewSec = Math.abs(nowSec - timestampNum);
  if (skewSec > 300) {
    return { valid: false, reason: `Webhook timestamp skew too large (${skewSec}s > 300s tolerance limit)` };
  }

  // 2. Decode HMAC key (Standard Webhooks format: 'whsec_<base64>' or raw secret string)
  let keyBytes: Uint8Array;
  if (secret.startsWith("whsec_")) {
    try {
      const b64 = secret.slice(6);
      const binary = atob(b64);
      keyBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        keyBytes[i] = binary.charCodeAt(i);
      }
    } catch {
      keyBytes = new TextEncoder().encode(secret);
    }
  } else {
    keyBytes = new TextEncoder().encode(secret);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // 3. Construct signed payload: `${webhookId}.${webhookTimestamp}.${rawBody}`
  const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const signedBytes = new TextEncoder().encode(signedPayload);

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, signedBytes);
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const expectedSigB64 = btoa(String.fromCharCode(...signatureArray));

  // 4. Compare with signatures in webhook-signature header (format: "v1,<base64> v1,<base64_2>")
  const signatures = webhookSignature.split(" ");
  for (const sig of signatures) {
    const parts = sig.split(",");
    const sigValue = parts.length >= 2 ? parts[1] : parts[0];
    if (constantTimeCompare(sigValue.trim(), expectedSigB64.trim())) {
      return { valid: true };
    }
  }

  return { valid: false, reason: "Signature mismatch against computed HMAC-SHA256 digest" };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Must be POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret =
    Deno.env.get("DODO_PAYMENTS_WEBHOOK_SECRET") ||
    Deno.env.get("DODO_WEBHOOK_SECRET");
  const dodoEnv = (Deno.env.get("DODO_PAYMENTS_ENV") || Deno.env.get("DODO_PAYMENTS_ENVIRONMENT") || "live").toLowerCase();
  const isProduction = dodoEnv === "live" || dodoEnv === "live_mode";

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing required server environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const rawBodyText = await req.text();

  // Webhook cryptographic verification
  if (webhookSecret) {
    const { valid, reason } = await verifyStandardWebhookSignature(rawBodyText, req.headers, webhookSecret);
    if (!valid) {
      console.warn(`[dodo-webhook] Rejected unauthorized webhook: ${reason}`);
      return new Response(JSON.stringify({ error: `Unauthorized: ${reason}` }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else if (isProduction) {
    console.error("[dodo-webhook] DODO_PAYMENTS_WEBHOOK_SECRET is not configured in production mode!");
    return new Response(
      JSON.stringify({ error: "Server configuration error: DODO_PAYMENTS_WEBHOOK_SECRET required in production" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  } else {
    console.warn("[dodo-webhook] DODO_PAYMENTS_WEBHOOK_SECRET omitted in test mode. Skipping signature verification.");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBodyText);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Dodo Payments webhook payload schema: event_type / type
  const eventType = String(payload.event_type || payload.type || payload.event || "");
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const metadata = (data.metadata || (data.payment as Record<string, unknown>)?.metadata || {}) as Record<string, unknown>;
  
  const bidId = String(metadata.bid_id || data.bid_id || "");
  const paymentId = String(data.payment_id || data.id || (data.payment as Record<string, unknown>)?.id || "");

  console.log(`[dodo-webhook] Received event '${eventType}' for bid_id='${bidId}', payment_id='${paymentId}'`);

  if (eventType === "payment.succeeded" || eventType === "payment_succeeded" || eventType === "checkout.session.completed") {
    if (!bidId) {
      console.warn("[dodo-webhook] Payment succeeded event received without metadata.bid_id");
      return new Response(JSON.stringify({ received: true, warning: "Missing bid_id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Idempotency Check: Fetch current bid record
    const { data: existingBid, error: fetchErr } = await supabase
      .from("sponsor_bids")
      .select("id, slot, status, expires_at, dodo_payment_id")
      .eq("id", bidId)
      .maybeSingle();

    if (fetchErr || !existingBid) {
      console.error(`[dodo-webhook] Sponsor bid not found for id ${bidId}:`, fetchErr?.message);
      return new Response(JSON.stringify({ error: "Bid record not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Idempotent guard: if already marked paid, return 200 without modifying expiration
    if (existingBid.status === "paid") {
      console.log(`[dodo-webhook] Idempotent replay: Sponsor bid ${bidId} already marked as 'paid'. No-op.`);
      return new Response(JSON.stringify({ received: true, idempotent: true, status: "paid" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Set expiration:
    // - Sky Horizon Billboard: NULL (Permanent King-of-the-Hill! Holds #1 until outbid, then ranks on Leaderboard)
    // - Block & Water: 7 days default, or user-selected durationDays
    let expiresAt: string | null = null;
    if (existingBid.slot === "block" || existingBid.slot === "water") {
      const days = Number(metadata.duration_days) || 7;
      const now = new Date();
      expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    const { data: updatedBid, error: updateErr } = await supabase
      .from("sponsor_bids")
      .update({
        status: "paid",
        dodo_payment_id: paymentId || existingBid.dodo_payment_id || null,
        stripe_session_id: paymentId || existingBid.dodo_payment_id || null, // backwards compatibility
        expires_at: expiresAt,
      })
      .eq("id", bidId)
      .select()
      .single();

    if (updateErr) {
      console.error(`[dodo-webhook] Failed to activate sponsor bid ${bidId}:`, updateErr.message);
      return new Response(JSON.stringify({ error: "Database update error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[dodo-webhook] Successfully activated sponsor bid ${bidId} for slot '${updatedBid.slot}' ($${updatedBid.bid_amount_cents / 100}) - expires_at: ${expiresAt || 'PERMANENT (King of the Hill)'}`);
  } else {
    console.log(`[dodo-webhook] Safely acknowledged non-fulfillment event '${eventType}'`);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
