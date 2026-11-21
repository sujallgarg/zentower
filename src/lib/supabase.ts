import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Sponsor, LeaderboardEntry, GameMode } from '../types';
import { db } from '../storage/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== 'https://your-project-id.supabase.co' &&
    !supabaseUrl.includes('placeholder')
  );
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

/**
 * Fetch active paid sponsors from Supabase or fallback to LocalStorage
 */
export async function getActiveSponsors(): Promise<{ blockSponsors: Sponsor[]; skySponsors: Sponsor[]; waterSponsors: Sponsor[] }> {
  const localBlocks = db.getBlockSponsors();
  const localSkies = db.getSkySponsors();
  const localWaters = db.getWaterSponsors();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('active_sponsors_public')
        .select('*')
        .order('bid_amount_cents', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        const blockSponsors: Sponsor[] = [];
        const skySponsors: Sponsor[] = [];
        const waterSponsors: Sponsor[] = [];

        data.forEach((row) => {
          const s: Sponsor = {
            id: row.id,
            name: row.brand_name,
            tagline: row.tagline,
            bid: Math.round(row.bid_amount_cents / 100),
            color: row.accent_color,
            symbol: row.brand_name.charAt(0).toUpperCase(),
            imageDataUrl: row.logo_url,
            websiteUrl: row.website_url || null,
          };
          if (row.slot === 'sky') {
            skySponsors.push(s);
          } else if (row.slot === 'water') {
            waterSponsors.push(s);
          } else {
            blockSponsors.push(s);
          }
        });

        // Merge remote and any newly activated local sponsors seamlessly
        const mergeUnique = (remote: Sponsor[], local: Sponsor[]) => {
          const map = new Map<string, Sponsor>();
          remote.forEach((s) => map.set(s.name.toLowerCase(), s));
          local.forEach((s) => {
            if (!map.has(s.name.toLowerCase())) {
              map.set(s.name.toLowerCase(), s);
            }
          });
          return Array.from(map.values()).sort((a, b) => b.bid - a.bid);
        };

        return {
          blockSponsors: mergeUnique(blockSponsors, localBlocks),
          skySponsors: mergeUnique(skySponsors, localSkies),
          waterSponsors: mergeUnique(waterSponsors, localWaters),
        };
      }
    } catch (err) {
      console.warn('Supabase getActiveSponsors failed, falling back to local storage:', err);
    }
  }

  // Local storage fallback (starts genuinely empty [])
  return {
    blockSponsors: localBlocks,
    skySponsors: localSkies,
    waterSponsors: localWaters,
  };
}

/**
 * Fetch leaderboard rankings from Supabase or fallback to LocalStorage
 */
export async function getRemoteLeaderboard(mode: GameMode, dayNumber?: number): Promise<LeaderboardEntry[]> {
  if (supabase) {
    try {
      let query = supabase
        .from('leaderboard_entries')
        .select('*')
        .eq('mode', mode)
        .order('peak_height', { ascending: false })
        .order('balanced_count', { ascending: false })
        .limit(25);

      if (mode === 'daily' && dayNumber !== undefined) {
        query = query.eq('daily_day_number', dayNumber);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        return data.map((row) => ({
          playerId: row.player_id,
          tag: row.tag,
          xHandle: row.x_handle || '',
          mode: row.mode,
          height: Number(row.peak_height),
          balanced: Number(row.balanced_count),
        }));
      }
    } catch (err) {
      console.warn('Supabase getRemoteLeaderboard failed, falling back to local storage:', err);
    }
  }

  // Local storage fallback (starts genuinely empty [])
  return db.getLeaderboard(mode);
}

/**
 * Submit high score through RPC or fallback to LocalStorage
 */
export async function submitScoreToDatabase(entry: {
  playerId: string;
  tag: string;
  xHandle?: string;
  mode: GameMode;
  dayNumber?: number;
  height: number;
  balanced: number;
  maxTilt: number;
}): Promise<void> {
  // Always update local cache first for instant feedback
  await db.postLeaderboardScore({
    playerId: entry.playerId,
    tag: entry.tag,
    xHandle: entry.xHandle || '',
    mode: entry.mode,
    height: entry.height,
    balanced: entry.balanced,
  });

    if (supabase) {
      try {
        await supabase.from('high_score_leaderboard').insert({
          player_id: entry.playerId,
          tag: entry.tag,
          x_handle: entry.xHandle || null,
          mode: entry.mode,
          daily_day_number: entry.mode === 'daily' ? entry.dayNumber : null,
          peak_height: entry.height,
          balanced_count: entry.balanced,
          max_tilt_deg: entry.maxTilt,
        });
      } catch {
        // Handled via RPC below
      }

      try {
        const { error } = await supabase.rpc('submit_high_score', {
        p_player_id: entry.playerId,
        p_tag: entry.tag,
        p_x_handle: entry.xHandle || null,
        p_mode: entry.mode,
        p_daily_day_number: entry.mode === 'daily' ? entry.dayNumber : null,
        p_peak_height: entry.height,
        p_balanced_count: entry.balanced,
        p_max_tilt_deg: entry.maxTilt,
      });

      if (error) {
        console.warn('RPC submit_high_score failed:', error.message);
      }
    } catch (err) {
      console.warn('Failed to call submit_high_score RPC:', err);
    }
  }
}

/**
 * Upload brand logo file to Supabase Storage 'sponsor-logos' bucket
 */
export async function uploadBrandLogo(file: File): Promise<string | null> {
  if (supabase) {
    try {
      const fileExt = file.name.split('.').pop() || 'png';
      const fileName = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('sponsor-logos')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        console.warn('Storage upload error:', error.message);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('sponsor-logos')
        .getPublicUrl(data.path);

      return urlData.publicUrl;
    } catch (err) {
      console.warn('Failed to upload logo to Supabase Storage:', err);
    }
  }
  return null;
}

/**
 * Initiate Dodo Payments checkout session via Edge Function or simulate locally in demo mode
 */
export async function initiateSponsorCheckout(params: {
  slot: 'block' | 'sky' | 'water';
  brandName: string;
  tagline: string;
  accentColor: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  bidAmountDollars: number;
  durationDays?: number | null;
  contactEmail: string;
  returnUrl: string;
}): Promise<{ checkoutUrl?: string; error?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('create-sponsor-checkout', {
        body: params,
      });

      if (!error && data?.checkoutUrl && !data.checkoutUrl.includes('&simulated=1')) {
        return { checkoutUrl: data.checkoutUrl };
      }
      if (error) {
        console.warn('Edge function create-sponsor-checkout returned error:', error.message);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Edge function create-sponsor-checkout invocation failed:', msg);
    }
  }

  // Direct Dodo Payments API link generation (when Edge Function is not yet deployed or in local dev)
  const dodoApiKey = import.meta.env.VITE_DODO_PAYMENTS_API_KEY || '';

  if (dodoApiKey) {
    try {
      const isTest = dodoApiKey.startsWith('dodo_test_');
      const dodoBaseUrl = isTest ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';

      // Dodo Payments requires a valid product_id in product_cart. Fetch existing or create one.
      let productId = 'pdt_zen_towers_sponsor';
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
            // Create sponsor product on the fly if none exists in account
            const createRes = await fetch(`${dodoBaseUrl}/products`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${dodoApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: 'Zen Towers Sponsorship',
                description: '24-hour brand placement auction on Zen Towers',
                price: 200,
                currency: 'USD',
                tax_category: 'digital_products',
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
      } catch (prodErr) {
        console.warn('Could not list/create Dodo product, proceeding with default product ID:', prodErr);
      }

      const baseReturnUrl = params.returnUrl.split('?')[0].split('#')[0];

      const dodoRes = await fetch(`${dodoBaseUrl}/payments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dodoApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billing: {
            country: 'US',
          },
          customer: {
            email: params.contactEmail,
            name: params.brandName,
          },
          payment_link: true,
          product_cart: [
            {
              product_id: productId,
              amount: params.bidAmountDollars * 100,
              quantity: 1,
            },
          ],
          return_url: `${baseReturnUrl}?sponsor_status=success`,
          metadata: {
            slot: params.slot,
            brand_name: params.brandName,
            tagline: params.tagline,
            ...(params.websiteUrl ? { website_url: params.websiteUrl } : {}),
            ...(params.durationDays ? { duration_days: String(params.durationDays) } : {}),
          },
        }),
      });

      if (dodoRes.ok) {
        const dodoData = await dodoRes.json();
        const checkoutUrl = dodoData.payment_link || dodoData.checkout_url || dodoData.url;
        if (checkoutUrl) {
          try {
            localStorage.setItem(
              'zt_pending_bid',
              JSON.stringify({
                slot: params.slot,
                brandName: params.brandName,
                tagline: params.tagline,
                accentColor: params.accentColor,
                logoUrl: params.logoUrl || null,
                websiteUrl: params.websiteUrl || null,
                bidAmountDollars: params.bidAmountDollars,
                durationDays: params.durationDays,
                contactEmail: params.contactEmail,
                timestamp: Date.now(),
              })
            );
          } catch (e) {
            console.warn('Failed to save pending bid to localStorage:', e);
          }
          return { checkoutUrl };
        }
      } else {
        const errText = await dodoRes.text();
        console.error('Dodo Payments API error:', dodoRes.status, errText);
        return { error: `Dodo Payments API error (${dodoRes.status}): ${errText}` };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Failed to create Dodo Payments checkout directly:', msg);
      return { error: `Failed to connect to Dodo Payments: ${msg}` };
    }
  }

  // Offline / local simulation fallback (only if no Dodo key exists)
  await db.addSponsorBid(params.slot, {
    name: params.brandName,
    tagline: params.tagline,
    bid: params.bidAmountDollars,
    color: params.accentColor,
    symbol: params.brandName.charAt(0).toUpperCase(),
    imageDataUrl: params.logoUrl || null,
    websiteUrl: params.websiteUrl || null,
  });

  return { checkoutUrl: `${params.returnUrl}?sponsor_success=1&local=1` };
}

/**
 * Handle checkout return from payment gateway (Dodo Payments / Stripe)
 * Ensures sponsor immediately displays on canvas and syncs across caches.
 */
export async function handlePaymentReturn(): Promise<{
  status: 'success' | 'canceled' | 'none';
  brandName?: string;
  slot?: string;
}> {
  if (typeof window === 'undefined') return { status: 'none' };

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const isSuccess =
      urlParams.get('sponsor_status') === 'success' ||
      urlParams.get('sponsor_success') === '1' ||
      urlParams.get('status') === 'succeeded' ||
      (urlParams.has('payment_id') && urlParams.get('status') !== 'failed' && urlParams.get('status') !== 'cancelled');

    const isCanceled =
      urlParams.get('sponsor_canceled') === '1' ||
      urlParams.get('status') === 'failed' ||
      urlParams.get('status') === 'cancelled';

    if (isSuccess) {
      const pendingRaw = localStorage.getItem('zt_pending_bid');
      let brandName = 'Your brand';
      let slot: 'block' | 'sky' | 'water' = 'sky';

      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw);
          if (pending && pending.brandName && pending.slot) {
            brandName = pending.brandName;
            slot = pending.slot;

            // Immediately activate sponsor in local database & storage
            await db.addSponsorBid(slot, {
              name: pending.brandName,
              tagline: pending.tagline || '',
              bid: Number(pending.bidAmountDollars) || 2,
              color: pending.accentColor || '#38bdf8',
              symbol: pending.brandName.charAt(0).toUpperCase(),
              imageDataUrl: pending.logoUrl || null,
              websiteUrl: pending.websiteUrl || null,
            });

            // Direct cloud inserts into the 4 separate tables + legacy fallback
            if (supabase) {
              try {
                const amountCents = Math.round((Number(pending.bidAmountDollars) || 2) * 100);
                const paymentId = urlParams.get('payment_id') || `dodo_${Date.now()}`;
                const email = pending.contactEmail || 'user@zentower.local';
                const duration = pending.durationDays ? Number(pending.durationDays) : 7;
                const expiresAt = new Date(Date.now() + duration * 86400000).toISOString();

                if (slot === 'sky') {
                  await supabase.from('sky_billboard_sponsors').insert({
                    brand_name: pending.brandName,
                    tagline: pending.tagline || 'Official Partner',
                    accent_color: pending.accentColor || '#38bdf8',
                    logo_url: pending.logoUrl || null,
                    website_url: pending.websiteUrl || null,
                    bid_amount_cents: amountCents,
                    contact_email: email,
                    status: 'active',
                    dodo_payment_id: paymentId,
                  });
                } else if (slot === 'water') {
                  await supabase.from('water_sponsors').insert({
                    brand_name: pending.brandName,
                    tagline: pending.tagline || 'Official Partner',
                    accent_color: pending.accentColor || '#38bdf8',
                    logo_url: pending.logoUrl || null,
                    website_url: pending.websiteUrl || null,
                    bid_amount_cents: amountCents,
                    contact_email: email,
                    duration_days: duration,
                    expires_at: expiresAt,
                    status: 'active',
                    dodo_payment_id: paymentId,
                  });
                } else {
                  await supabase.from('block_sponsors').insert({
                    brand_name: pending.brandName,
                    tagline: pending.tagline || 'Official Partner',
                    accent_color: pending.accentColor || '#38bdf8',
                    logo_url: pending.logoUrl || null,
                    website_url: pending.websiteUrl || null,
                    bid_amount_cents: amountCents,
                    contact_email: email,
                    duration_days: duration,
                    expires_at: expiresAt,
                    status: 'active',
                    dodo_payment_id: paymentId,
                  });
                }

                // Also populate sponsor_bids for backward compatibility
                await supabase.from('sponsor_bids').insert({
                  slot,
                  brand_name: pending.brandName,
                  tagline: pending.tagline || '',
                  accent_color: pending.accentColor || '#38bdf8',
                  logo_url: pending.logoUrl || null,
                  website_url: pending.websiteUrl || null,
                  bid_amount_cents: amountCents,
                  contact_email: email,
                  status: 'active',
                  expires_at: slot === 'sky' ? null : expiresAt,
                  dodo_payment_id: paymentId,
                });
              } catch (cloudErr) {
                console.warn('Direct Supabase cloud sync notice (handled locally):', cloudErr);
              }
            }
          }
        } catch (e) {
          console.warn('Failed to parse pending sponsor bid:', e);
        } finally {
          localStorage.removeItem('zt_pending_bid');
        }
      }

      // Notify all game components & canvas to immediately re-render with new sponsor
      window.dispatchEvent(new CustomEvent('zt_sponsors_updated'));

      return {
        status: 'success',
        brandName,
        slot,
      };
    }

    if (isCanceled) {
      localStorage.removeItem('zt_pending_bid');
      return { status: 'canceled' };
    }
  } catch (err) {
    console.warn('Error handling payment return:', err);
  }

  return { status: 'none' };
}
