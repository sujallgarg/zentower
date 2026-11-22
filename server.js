import http from 'http';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT) || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY || process.env.VITE_DODO_PAYMENTS_API_KEY;

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, webhook-id, webhook-timestamp, webhook-signature, x-client-info',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...corsHeaders,
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // 1. Health check (Render monitors this to verify service is up)
  if (req.method === 'GET' && (pathname === '/' || pathname === '/health' || pathname === '/api/health')) {
    sendJson(res, 200, {
      status: 'ok',
      service: 'zentower-backend',
      timestamp: new Date().toISOString(),
      supabaseConnected: !!supabase,
    });
    return;
  }

  // Helper to read incoming request body
  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk;
  });

  req.on('end', async () => {
    let body = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        // Raw text if not JSON
      }
    }

    // 2. Dodo Payments Webhook Endpoint
    if (req.method === 'POST' && (pathname === '/api/webhook' || pathname === '/webhook')) {
      try {
        const eventType = String(body.event_type || body.type || body.event || '');
        const data = (body.data && typeof body.data === 'object' ? body.data : body) || {};
        const metadata = (data.metadata || data.payment?.metadata || {}) || {};

        const paymentId = String(data.payment_id || data.id || data.payment?.id || `dodo_${Date.now()}`);
        const slot = String(metadata.slot || data.slot || 'sky');
        const brandName = String(metadata.brand_name || data.brand_name || 'Partner');
        const tagline = String(metadata.tagline || data.tagline || 'Official Partner');
        const websiteUrl = metadata.website_url ? String(metadata.website_url) : null;
        const accentColor = String(metadata.accent_color || '#0284c7');
        const logoUrl = metadata.logo_url ? String(metadata.logo_url) : null;
        const email = String(data.customer?.email || metadata.contact_email || 'partner@zentower.local');
        const durationDays = Number(metadata.duration_days) || 7;
        const amountCents = Number(data.total_amount || data.amount || 200);

        console.log(`[Webhook] Event: ${eventType}, Payment: ${paymentId}, Slot: ${slot}, Brand: ${brandName}`);

        if (eventType === 'payment.succeeded' || eventType === 'payment_succeeded' || eventType === 'checkout.session.completed' || !eventType) {
          if (supabase) {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

            // Insert/Update into dedicated slot table
            if (slot === 'sky') {
              await supabase.from('sky_billboard_sponsors').insert({
                brand_name: brandName,
                tagline,
                website_url: websiteUrl,
                accent_color: accentColor,
                logo_url: logoUrl,
                bid_amount_cents: amountCents,
                contact_email: email,
                status: 'active',
                dodo_payment_id: paymentId,
              });
            } else if (slot === 'water') {
              await supabase.from('water_sponsors').insert({
                brand_name: brandName,
                tagline,
                website_url: websiteUrl,
                accent_color: accentColor,
                logo_url: logoUrl,
                bid_amount_cents: amountCents,
                contact_email: email,
                duration_days: durationDays,
                expires_at: expiresAt,
                status: 'active',
                dodo_payment_id: paymentId,
              });
            } else {
              await supabase.from('block_sponsors').insert({
                brand_name: brandName,
                tagline,
                website_url: websiteUrl,
                accent_color: accentColor,
                logo_url: logoUrl,
                bid_amount_cents: amountCents,
                contact_email: email,
                duration_days: durationDays,
                expires_at: expiresAt,
                status: 'active',
                dodo_payment_id: paymentId,
              });
            }

            // Also populate sponsor_bids for backward compatibility
            await supabase.from('sponsor_bids').insert({
              slot,
              brand_name: brandName,
              tagline,
              website_url: websiteUrl,
              accent_color: accentColor,
              logo_url: logoUrl,
              bid_amount_cents: amountCents,
              contact_email: email,
              status: 'active',
              expires_at: slot === 'sky' ? null : expiresAt,
              dodo_payment_id: paymentId,
            });
          }
        }

        sendJson(res, 200, { received: true, paymentId, status: 'processed' });
      } catch (err) {
        console.error('[Webhook Error]', err);
        sendJson(res, 500, { error: String(err?.message || err) });
      }
      return;
    }

    // 3. Fallback: 404 for unknown routes
    sendJson(res, 404, { error: 'Route not found', path: pathname });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Zen Towers Render API server running on port ${PORT}`);
});
