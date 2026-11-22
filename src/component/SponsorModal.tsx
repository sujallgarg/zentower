import React, { useState, useEffect, useCallback } from 'react';
import { Sponsor } from '../types';
import { getActiveSponsors, uploadBrandLogo, initiateSponsorCheckout } from '../lib/supabase';

interface SponsorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string) => void;
}

const OPENING_PRICES: Record<'block' | 'sky' | 'water', number> = {
  sky: 2,
  water: 2,
  block: 2,
};

export const SponsorModal: React.FC<SponsorModalProps> = ({ isOpen, onClose, onShowToast }) => {
  const [blockSponsors, setBlockSponsors] = useState<Sponsor[]>([]);
  const [skySponsors, setSkySponsors] = useState<Sponsor[]>([]);
  const [waterSponsors, setWaterSponsors] = useState<Sponsor[]>([]);

  const [slot, setSlot] = useState<'block' | 'sky' | 'water'>('block');
  const [bidAmount, setBidAmount] = useState<number>(OPENING_PRICES.block);
  const [durationDays, setDurationDays] = useState<number>(7);
  const [brandName, setBrandName] = useState<string>('');
  const [tagline, setTagline] = useState<string>('');
  const [websiteUrl, setWebsiteUrl] = useState<string>('');
  const [contactEmail, setContactEmail] = useState<string>('');
  const [color, setColor] = useState<string>('#0284c7');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const topSky = skySponsors[0];
  const topWater = waterSponsors[0];
  const topBlock = blockSponsors[0];

  const currentHighestBid =
    slot === 'sky'
      ? (topSky?.bid || 0)
      : slot === 'water'
      ? (topWater?.bid || 0)
      : (topBlock?.bid || 0);

  const minValidBid = currentHighestBid > 0 ? currentHighestBid + 1 : OPENING_PRICES[slot];

  // For Sky: One-time bid (permanent King-of-the-Hill rank).
  // For Block & Water: Base rate is for 7 days, scaling proportionally with selected duration.
  const totalCost =
    slot === 'sky'
      ? bidAmount
      : Math.max(bidAmount, Math.round((bidAmount / 7) * durationDays));

  const loadSponsors = useCallback(async () => {
    const { blockSponsors: blocks, skySponsors: skies, waterSponsors: waters } = await getActiveSponsors();
    setBlockSponsors(blocks);
    setSkySponsors(skies);
    setWaterSponsors(waters);

    const leaderBid =
      slot === 'sky'
        ? (skies[0]?.bid || 0)
        : slot === 'water'
        ? (waters[0]?.bid || 0)
        : (blocks[0]?.bid || 0);

    const floor = leaderBid > 0 ? leaderBid + 1 : OPENING_PRICES[slot];
    setBidAmount((prev) => Math.max(floor, prev));
  }, [slot]);

  const handleSlotChange = (newSlot: 'block' | 'sky' | 'water') => {
    setSlot(newSlot);
    const leaderBid =
      newSlot === 'sky'
        ? (skySponsors[0]?.bid || 0)
        : newSlot === 'water'
        ? (waterSponsors[0]?.bid || 0)
        : (blockSponsors[0]?.bid || 0);
    const floor = leaderBid > 0 ? leaderBid + 1 : OPENING_PRICES[newSlot];
    setBidAmount(floor);
  };

  useEffect(() => {
    if (isOpen) {
      loadSponsors();
      setIsSubmitting(false);

      const handleUpdate = () => loadSponsors();
      window.addEventListener('zt_sponsors_updated', handleUpdate);
      window.addEventListener('online', handleUpdate);

      return () => {
        window.removeEventListener('zt_sponsors_updated', handleUpdate);
        window.removeEventListener('online', handleUpdate);
      };
    }
  }, [isOpen, loadSponsors]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }
    if (file.size > 1048576) {
      alert('Logo file size must be under 1MB.');
      return;
    }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRedirect = (sp?: Sponsor | null) => {
    if (!sp) return;
    const raw = sp.websiteUrl || sp.tagline?.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/i)?.[0];
    if (raw) {
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanBrand = brandName.trim();
    if (!cleanBrand) {
      alert('Please enter your brand name.');
      return;
    }
    if (!contactEmail.trim() || !contactEmail.includes('@')) {
      alert('Please enter a valid business/contact email for your invoice.');
      return;
    }

    const cleanTag = tagline.trim() || 'Official Partner';
    const bid = Math.floor(Number(bidAmount) || 0);

    // Strictly increasing auction floor validation: never allow equal or lower bids
    if (bid < minValidBid) {
      alert(
        currentHighestBid > 0
          ? `Your bid must strictly exceed the current #1 bid of $${currentHighestBid}. Minimum valid bid is $${minValidBid}.`
          : `Minimum opening bid for this slot is $${OPENING_PRICES[slot]}.`
      );
      return;
    }

    const calculatedTotal =
      slot === 'sky'
        ? bid
        : Math.max(bid, Math.round((bid / 7) * durationDays));

    setIsSubmitting(true);

    try {
      // 1. Upload logo file to Supabase Storage if file selected
      let uploadedUrl: string | null = null;
      if (logoFile) {
        uploadedUrl = await uploadBrandLogo(logoFile);
      }

      // 2. Initiate Dodo Payments checkout session
      let cleanUrl: string | null = null;
      if (websiteUrl.trim()) {
        cleanUrl = websiteUrl.trim();
        if (!/^https?:\/\//i.test(cleanUrl)) {
          cleanUrl = `https://${cleanUrl}`;
        }
      }

      const res = await initiateSponsorCheckout({
        slot,
        brandName: cleanBrand,
        tagline: cleanTag,
        accentColor: color,
        logoUrl: uploadedUrl || logoPreview || null,
        websiteUrl: cleanUrl,
        bidAmountDollars: calculatedTotal,
        durationDays: slot === 'sky' ? null : durationDays,
        contactEmail: contactEmail.trim(),
        returnUrl: import.meta.env.VITE_APP_URL || (window.location.origin + window.location.pathname),
      });

      if (res.error) {
        throw new Error(res.error);
      }

      if (res.checkoutUrl) {
        onShowToast(`Redirecting to Dodo Payments for ${cleanBrand} ($${calculatedTotal})...`);
        window.location.href = res.checkoutUrl;
      } else {
        onClose();
        onShowToast(`★ Bid confirmed for ${cleanBrand}!`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Checkout error: ${msg}`);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-2.5 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl border border-black/10 text-stone-900 my-auto max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-100 text-amber-900">
            100% Free for Players · Brand Auction
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500 cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h2 className="text-xl font-bold tracking-tight mb-1">Live Sponsor Auction</h2>
        <p className="text-xs text-stone-600 mb-4">
          Players never pay. Brands bid via Dodo Payments for visibility—Sky Billboard holds permanent King-of-the-Hill rank, while Blocks and Water feature custom multi-day placements.
        </p>

        {/* Active Auction Leaderboards: Block, Sky, and Water */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
          {/* Top 3 Blocks */}
          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-2">
                Top 3 Blocks
              </div>
              <div className="space-y-1.5 text-xs">
                {blockSponsors.length === 0 ? (
                  <div className="py-3 text-stone-400 text-center text-[11px] border border-dashed border-stone-200 rounded-xl">
                    No active block bids yet.<br />
                    <span className="text-amber-700 font-medium">Open — Starts at $2 (7 days)</span>
                  </div>
                ) : (
                  blockSponsors.slice(0, 3).map((sp, i) => (
                    <div
                      key={sp.id}
                      onClick={() => handleRedirect(sp)}
                      className="flex items-center justify-between bg-white px-2 py-1 rounded-xl border border-stone-200/80 cursor-pointer hover:bg-amber-50/50 hover:border-amber-300 transition-all"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`font-mono font-bold text-[10px] ${i === 0 ? 'text-amber-600' : 'text-stone-400'}`}>
                          #{i + 1}
                        </span>
                        {sp.imageDataUrl ? (
                          <img src={sp.imageDataUrl} alt="" className="w-3.5 h-3.5 rounded object-contain shrink-0" />
                        ) : (
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sp.color }}></span>
                        )}
                        <span className="font-semibold text-stone-900 truncate text-[11px]">{sp.name}</span>
                        {(sp.websiteUrl || sp.tagline) && (
                          <span className="text-[10px] text-amber-600 font-bold ml-0.5 shrink-0" title={`Visit ${sp.name}`}>
                            ↗
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-stone-700 shrink-0 text-[11px]">${sp.bid}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="mt-2 pt-1.5 border-t border-stone-200/80 text-[10px] text-stone-500">
              Rotates across dropping blocks.
            </div>
          </div>

          {/* Sky Billboard Leaderboard Ranking */}
          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-2">
                Sky Billboard Ranking
              </div>
              <div className="space-y-1.5 text-xs">
                {skySponsors.length === 0 ? (
                  <div className="py-3 text-stone-400 text-center text-[11px] border border-dashed border-stone-200 rounded-xl">
                    No active sky bids yet.<br />
                    <span className="text-purple-700 font-medium">Open — Starts at $2 (Permanent)</span>
                  </div>
                ) : (
                  skySponsors.slice(0, 3).map((sp, i) => (
                    <div
                      key={sp.id}
                      onClick={() => handleRedirect(sp)}
                      className="flex items-center justify-between bg-white px-2 py-1 rounded-xl border border-stone-200/80 cursor-pointer hover:bg-purple-50/50 hover:border-purple-300 transition-all"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`font-mono font-bold text-[10px] ${i === 0 ? 'text-amber-600' : 'text-stone-400'}`}>
                          #{i + 1}
                        </span>
                        {sp.imageDataUrl ? (
                          <img src={sp.imageDataUrl} alt="" className="w-3.5 h-3.5 rounded object-contain shrink-0" />
                        ) : (
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sp.color }}></span>
                        )}
                        <span className="font-semibold text-stone-900 truncate text-[11px]">{sp.name}</span>
                        {(sp.websiteUrl || sp.tagline) && (
                          <span className="text-[10px] text-purple-600 font-bold ml-0.5 shrink-0" title={`Visit ${sp.name}`}>
                            ↗
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-purple-700 shrink-0 text-[11px]">${sp.bid}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="mt-2 pt-1.5 border-t border-stone-200/80 text-[10px] text-stone-500">
              #1 takes sky horizon until outbid.
            </div>
          </div>

          {/* #1 Water Layer */}
          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-2">
                #1 Water Sponsor
              </div>
              <div className="text-xs">
                {topWater ? (
                  <div
                    onClick={() => handleRedirect(topWater)}
                    className="flex items-center justify-between bg-white px-2 py-1.5 rounded-xl border border-stone-200/80 cursor-pointer hover:bg-cyan-50/50 hover:border-cyan-300 transition-all"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {topWater.imageDataUrl ? (
                        <img src={topWater.imageDataUrl} alt="" className="w-4 h-4 rounded object-contain shrink-0" />
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: topWater.color }}></span>
                      )}
                      <div className="truncate">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-stone-900 truncate text-[11px]">{topWater.name}</span>
                          {(topWater.websiteUrl || topWater.tagline) && (
                            <span className="text-[10px] text-cyan-600 font-bold shrink-0" title={`Visit ${topWater.name}`}>
                              ↗
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] text-stone-500 truncate">{topWater.tagline}</div>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-cyan-700 shrink-0 text-[11px]">${topWater.bid}</span>
                  </div>
                ) : (
                  <div className="py-3 text-stone-400 text-center text-[11px] border border-dashed border-stone-200 rounded-xl">
                    No active water sponsor.<br />
                    <span className="text-cyan-700 font-medium">Open — Starts at $2 (7 days)</span>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 pt-1.5 border-t border-stone-200/80 text-[10px] text-stone-500">
              Submerged under seesaw raft.
            </div>
          </div>
        </div>

        {/* Place Live Bid Form */}
        <form onSubmit={handleSubmit} className="bg-amber-50/60 border border-amber-200/80 rounded-2xl p-3.5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-xs font-bold text-stone-900">Bid via Dodo Payments</span>
            <span className="text-[11px] font-semibold text-amber-900">
              {currentHighestBid > 0
                ? `Current #1: $${currentHighestBid} — Next bid must be $${minValidBid}+`
                : `Opening Bid: $${OPENING_PRICES[slot]}`}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1">Ad Placement Slot</label>
              <select
                value={slot}
                onChange={(e) => handleSlotChange(e.target.value as 'block' | 'sky' | 'water')}
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-300 text-xs font-medium text-stone-900 focus:outline-hidden focus:border-amber-600"
              >
                <option value="sky">★ Sky Horizon Billboard (#1 King-of-the-Hill)</option>
                <option value="water">Water Layer Sponsor (#1 Only)</option>
                <option value="block">Falling &amp; Stacked Blocks (Top 3)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                {slot === 'sky' ? `Bid Amount ($ — strictly ≥ $${minValidBid})` : `Base Rate ($ / 7 days — strictly ≥ $${minValidBid})`}
              </label>
              <input
                type="number"
                min={minValidBid}
                step={1}
                value={bidAmount}
                onChange={(e) => setBidAmount(Number(e.target.value))}
                required
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-300 text-xs font-mono font-bold text-stone-900 focus:outline-hidden focus:border-amber-600"
              />
            </div>
          </div>

          {/* Slot-specific Duration Selector or Permanent Ranking Note */}
          {slot === 'sky' ? (
            <div className="bg-purple-50 border border-purple-200/80 rounded-xl p-2.5 text-[11px] text-purple-900">
              <span className="font-bold">👑 Permanent King-of-the-Hill:</span> Holds #1 on the sky horizon banner until someone outbids you. When outbid, your brand automatically moves to #2 on the Leaderboard!
            </div>
          ) : (
            <div className="bg-cyan-50/80 border border-cyan-200/80 rounded-xl p-2.5 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-stone-700">Choose Placement Duration:</span>
                <span className="font-mono font-bold text-cyan-900">{durationDays} Days · Total: ${totalCost}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDurationDays(d)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      durationDays === d
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
                    }`}
                  >
                    {d === 7 ? '7 Days (Default)' : d === 14 ? '14 Days (2x)' : '30 Days (1 Month)'}
                  </button>
                ))}
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[10px] text-stone-500">Custom:</span>
                  <input
                    type="number"
                    min={7}
                    max={90}
                    value={durationDays}
                    onChange={(e) => setDurationDays(Math.max(7, Number(e.target.value) || 7))}
                    className="w-14 px-1.5 py-0.5 rounded border border-stone-300 text-xs font-mono text-center bg-white"
                  />
                  <span className="text-[10px] text-stone-500">days</span>
                </div>
              </div>
              <div className="text-[10px] text-stone-500">
                After {durationDays} days, your slot expires and opens for re-sponsoring.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1">Brand Name</label>
              <input
                type="text"
                maxLength={24}
                placeholder="e.g. Acme Tech"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-300 text-xs font-medium text-stone-900 focus:outline-hidden focus:border-amber-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1">Tagline / Pitch</label>
              <input
                type="text"
                maxLength={36}
                placeholder="e.g. build faster • acme.com"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-300 text-xs font-medium text-stone-900 focus:outline-hidden focus:border-amber-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-stone-600 mb-1">
              Website Link (Redirect URL when players tap your brand)
            </label>
            <input
              type="text"
              placeholder="e.g. https://yourbrand.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white border border-stone-300 text-xs font-medium text-stone-900 focus:outline-hidden focus:border-amber-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1">Contact Email (for Dodo Payments receipt)</label>
              <input
                type="email"
                placeholder="partner@brand.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl bg-white border border-stone-300 text-xs font-medium text-stone-900 focus:outline-hidden focus:border-amber-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-stone-600 mb-1">Brand Accent Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-12 rounded-lg border border-stone-300 cursor-pointer bg-white p-0.5"
                />
                <span className="font-mono text-xs text-stone-700">{color}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-stone-600 mb-1">
              Upload Brand Logo (PNG/JPG/SVG/WEBP, max 1MB)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleFileChange}
                className="flex-1 text-[11px] text-stone-600 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-stone-900 file:text-white hover:file:bg-stone-700 cursor-pointer"
              />
              {logoPreview && (
                <img src={logoPreview} alt="Preview" className="w-8 h-8 rounded border border-black/10 object-contain bg-white shrink-0" />
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || bidAmount < minValidBid}
            className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-[0.99] disabled:opacity-50 text-white font-bold text-xs shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <span>Connecting to Dodo Payments...</span>
            ) : (
              <span>
                Proceed to Dodo Payments (${totalCost}{slot === 'sky' ? ' · Permanent Rank' : ` · ${durationDays} Days`}) →
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
