// Supabase Edge Function: create-sponsor-checkout
// Creates a pending sponsor_bids record and generates a Dodo Payments Checkout Link

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENING_PRICES: Record<string, number> = {
  sky: 2,
  water: 2,
  block: 2,
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const dodoApiKey = Deno.env.get("DODO_PAYMENTS_API_KEY") || Deno.env.get("DODO_API_KEY");
    const dodoEnv = (
      Deno.env.get("DODO_PAYMENTS_ENV") ||
      Deno.env.get("DODO_PAYMENTS_ENVIRONMENT") ||
      (dodoApiKey?.startsWith("dodo_test_") ? "test_mode" : "live_mode")
    ).toLowerCase();

    const isTestMode = dodoEnv === "test" || dodoEnv === "test_mode";
    const dodoBaseUrl = isTestMode
      ? "https://test.dodopayments.com"
      : "https://live.dodopayments.com";

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing required server environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const {
      slot,
      brandName,
      tagline,
      accentColor,
      logoUrl,
      websiteUrl,
      bidAmountDollars,
      durationDays,
      contactEmail,
      returnUrl,
    } = body;

    // 1. Placement Slot Validation
    if (!slot || (slot !== "block" && slot !== "sky" && slot !== "water")) {
      return new Response(JSON.stringify({ error: "Invalid placement slot. Must be 'block', 'sky', or 'water'." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanBrand = (brandName || "").trim().slice(0, 24);
    if (!cleanBrand) {
      return new Response(JSON.stringify({ error: "Brand name is required (max 24 chars)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanTagline = (tagline || "").trim().slice(0, 36) || "Official Partner";
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#0284c7";
    const cleanEmail = (contactEmail || "").trim();

    if (!cleanEmail || !cleanEmail.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid contact email is required for invoice/receipt." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountDollars = Math.floor(Number(bidAmountDollars) || 0);
    const amountCents = amountDollars * 100;
    const slotOpeningPrice = OPENING_PRICES[slot] || 5;

    // 2. Server-side lookup of current highest active bid for requested slot
    const { data: currentActive, error: activeErr } = await supabase
      .from("active_sponsors_public")
      .select("bid_amount_cents")
      .eq("slot", slot)
      .order("bid_amount_cents", { ascending: false })
      .limit(1);

    if (activeErr) {
      console.warn("Error querying active_sponsors_public floor:", activeErr.message);
    }

    const currentLeaderBidCents = currentActive?.[0]?.bid_amount_cents || 0;
    const currentLeaderBidDollars = Math.floor(currentLeaderBidCents / 100);
    const minRequiredDollars = currentLeaderBidDollars > 0 ? currentLeaderBidDollars + 1 : slotOpeningPrice;

    if (amountDollars < minRequiredDollars) {
      return new Response(
        JSON.stringify({
          error: currentLeaderBidDollars > 0
            ? `Bid must strictly exceed current highest bid of $${currentLeaderBidDollars}/day. Minimum bid to claim this slot is $${minRequiredDollars}/day.`
            : `Minimum opening bid for ${slot} slot is $${slotOpeningPrice}.00/day.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 3. Insert pending sponsor bid into database
    const { data: bidRow, error: insertError } = await supabase
      .from("sponsor_bids")
      .insert({
        slot,
        brand_name: cleanBrand,
        tagline: cleanTagline,
        accent_color: cleanColor,
        logo_url: logoUrl || null,
        bid_amount_cents: amountCents,
        contact_email: cleanEmail,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !bidRow) {
      throw new Error(`Failed to create sponsor bid record: ${insertError?.message || "Unknown database error"}`);
    }

    const bidId = bidRow.id;

    // Determine canonical return redirect URL
    const canonicalAppUrl = Deno.env.get("VITE_APP_URL") || Deno.env.get("APP_URL");
    const appBase = canonicalAppUrl
      ? canonicalAppUrl.replace(/\/+$/, "")
      : (returnUrl ? returnUrl.replace(/[\?#].*$/, "").replace(/\/+$/, "") : "http://localhost:5173");
    const returnRedirectUrl = `${appBase}?sponsor_status=success&bid_id=${bidId}`;

    let checkoutUrl = returnRedirectUrl;
    let paymentId = `dodo_${bidId}`;

    // 4. Create Dodo Payments Checkout Link via official Payments API
    if (dodoApiKey) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

        // Fetch or create product ID required by Dodo Payments API
        let productId = "pdt_zen_towers_sponsor";
        try {
          const listRes = await fetch(`${dodoBaseUrl}/products?page_size=5`, {
            headers: { Authorization: `Bearer ${dodoApiKey}` },
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            const items = listData.items || listData.products || (Array.isArray(listData) ? listData : []);
            if (items.length > 0 && items[0].product_id) {
              productId = items[0].product_id;
            } else {
              const createRes = await fetch(`${dodoBaseUrl}/products`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${dodoApiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  name: "Zen Towers Sponsorship",
                  description: "24-hour daily brand placement in Zen Towers",
                  price: 200,
                  currency: "USD",
                  tax_category: "digital_products",
                }),
              });
              if (createRes.ok) {
                const created = await createRes.json();
                if (created.product_id) {
                  productId = created.product_id;
                }
              }
            }
          }
        } catch {
          // fallback to default productId
        }

        const dodoRes = await fetch(`${dodoBaseUrl}/payments`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Authorization": `Bearer ${dodoApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            billing: {
              country: "US",
            },
            customer: {
              email: cleanEmail,
              name: cleanBrand,
            },
            payment_link: true,
            product_cart: [
              {
                product_id: productId,
                amount: amountCents,
                quantity: 1,
              },
            ],
            return_url: returnRedirectUrl,
            metadata: {
              bid_id: bidId,
              slot,
              brand_name: cleanBrand,
              tagline: cleanTagline,
              ...(websiteUrl ? { website_url: String(websiteUrl) } : {}),
              ...(slot === "sky" || !durationDays ? {} : { duration_days: String(durationDays) }),
            },
          }),
        });

        clearTimeout(timeoutId);

        if (dodoRes.ok) {
          const dodoData = await dodoRes.json();
          checkoutUrl = dodoData.payment_link || dodoData.checkout_url || dodoData.url || checkoutUrl;
          paymentId = dodoData.payment_id || dodoData.id || paymentId;
        } else {
          const errText = await dodoRes.text();
          console.error("Dodo Payments API error:", dodoRes.status, errText);
          throw new Error(`Dodo Payments rejected payment link creation (${dodoRes.status}): ${errText}`);
        }
      } catch (dodoErr) {
        console.error("Dodo Payments API request failed:", dodoErr);
        throw dodoErr;
      }
    } else {
      console.warn("DODO_PAYMENTS_API_KEY not configured. Running in offline/simulation mode.");
      checkoutUrl = `${returnRedirectUrl}&simulated=1`;
    }

    // 5. Update bid record with payment ID
    await supabase
      .from("sponsor_bids")
      .update({
        dodo_payment_id: paymentId,
        stripe_session_id: paymentId, // backwards-compatible alias
      })
      .eq("id", bidId);

    return new Response(
      JSON.stringify({
        checkoutUrl,
        sessionId: paymentId,
        bidId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("create-sponsor-checkout error:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
