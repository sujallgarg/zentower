import React, { useState, useEffect } from 'react';
import { RunSummary, Sponsor, PlayerProfile } from '../types';
import { db } from '../storage/database';
import { buildShareSummaryText, openShareOnX } from '../utility/share';
import { submitScoreToDatabase, getActiveSponsors } from '../lib/supabase';

interface ScoreDashboardModalProps {
  isOpen: boolean;
  summary: RunSummary | null;
  silhouetteCanvas: HTMLCanvasElement | null;
  onPlayAgain: () => void;
  onOpenLeaderboard: () => void;
  onShowToast: (msg: string) => void;
}

export const ScoreDashboardModal: React.FC<ScoreDashboardModalProps> = ({
  isOpen,
  summary,
  silhouetteCanvas,
  onPlayAgain,
  onOpenLeaderboard,
  onShowToast,
}) => {
  const [profile, setProfile] = useState<PlayerProfile>(() => db.getProfile());
  const [nickname, setNickname] = useState('');
  const [xHandle, setXHandle] = useState('');
  const [hasPostedScore, setHasPostedScore] = useState(false);
  const [topSponsor, setTopSponsor] = useState<Sponsor | null>(null);

  useEffect(() => {
    if (isOpen) {
      const p = db.getProfile();
      setProfile(p);
      setNickname(p.nickname || '');
      setXHandle(p.xHandle || '');
      setHasPostedScore(false);

      getActiveSponsors().then(({ blockSponsors }) => {
        setTopSponsor(blockSponsors[0] || null);
      });
    }
  }, [isOpen]);

  if (!isOpen || !summary) return null;

  const won = summary.won;
  const balancedCount = summary.balancedCount;

  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawTag = nickname.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const tag = (rawTag || 'ZEN').padEnd(3, 'X').slice(0, 3);
    const cleanX = xHandle.trim().replace(/^@+/, '').replace(/[^a-zA-Z0-9_]/g, '');

    await db.updateProfile({ nickname: tag, xHandle: cleanX });
    await submitScoreToDatabase({
      playerId: profile.playerId,
      tag,
      xHandle: cleanX,
      mode: summary.mode,
      dayNumber: summary.mode === 'daily' ? summary.dayNumber : undefined,
      height: Number(summary.peakHeightMeters.toFixed(1)),
      balanced: balancedCount,
      maxTilt: Number(summary.maxTiltDegrees.toFixed(1)),
    });

    setHasPostedScore(true);
    setProfile(db.getProfile());
    onShowToast(`🏆 Posted ${tag} (${summary.peakHeightMeters.toFixed(1)}m) to Top Leaderboard!`);
  };

  const handleShareX = () => {
    const text = buildShareSummaryText(
      summary.mode,
      summary.dayNumber,
      balancedCount,
      won,
      summary.peakHeightMeters,
      summary.maxTiltDegrees,
      topSponsor
    );
    openShareOnX(text);
  };

  const handleDownloadCard = () => {
    if (!silhouetteCanvas) return;
    const link = document.createElement('a');
    link.download = `zen-towers-day-${summary.dayNumber}-${summary.peakHeightMeters.toFixed(1)}m.png`;
    link.href = silhouetteCanvas.toDataURL('image/png');
    link.click();
    onShowToast('Saved Tower Score Card PNG!');
  };

  const handleCopyLink = () => {
    const text = buildShareSummaryText(
      summary.mode,
      summary.dayNumber,
      balancedCount,
      won,
      summary.peakHeightMeters,
      summary.maxTiltDegrees,
      topSponsor
    );
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        onShowToast('Challenge score & link copied to clipboard!');
      }).catch(() => {
        onShowToast('Ready to share!');
      });
    } else {
      onShowToast('Ready to share!');
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-2.5 sm:p-4 bg-black/45 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full p-4 sm:p-6 shadow-2xl border border-black/10 text-stone-900 transform transition-all my-auto max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2.5">
          <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
            won ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
          }`}>
            {won ? '20/20 Mastered' : 'Tower Toppled'}
          </span>
          <span className="font-mono text-xs text-stone-500">
            {summary.mode === 'daily' ? `Daily #${summary.dayNumber}` : 'Endless Zenith'}
          </span>
        </div>

        <h2 className="text-2xl font-bold tracking-tight mb-1">
          {won ? 'Perfect Equilibrium!' : 'So Close to Serenity'}
        </h2>
        <p className="text-xs sm:text-sm text-stone-600 mb-3.5">
          {won
            ? `You balanced all 20 global pieces to ${summary.peakHeightMeters.toFixed(1)} meters.`
            : `A weight shift tipped the raft after ${balancedCount} piece${balancedCount === 1 ? '' : 's'}.`}
        </p>

        {/* Optional High Score Leaderboard Claim Box */}
        {summary.isNewHighScore && !hasPostedScore && (
          <div className="mb-3.5 rounded-2xl bg-amber-50 border border-amber-300/90 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                <span>🏆 New High Score!</span>
                <span className="font-normal text-amber-800">(Optional Leaderboard Entry)</span>
              </span>
              <span className="font-mono text-[10px] text-amber-700">
                ID: {profile.playerId}
              </span>
            </div>
            <form onSubmit={handleClaimSubmit} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input
                type="text"
                maxLength={3}
                placeholder="AAA"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.toUpperCase())}
                aria-label="3-Letter Nickname"
                className="w-16 px-2.5 py-1.5 rounded-xl bg-white border border-amber-300 text-xs font-mono font-bold uppercase text-center text-stone-900 focus:outline-hidden focus:border-amber-600"
                required
              />
              <div className="relative flex-1 min-w-[130px]">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400 font-semibold">@</span>
                <input
                  type="text"
                  maxLength={20}
                  placeholder="x_handle (optional)"
                  value={xHandle}
                  onChange={(e) => setXHandle(e.target.value)}
                  aria-label="Optional X Handle"
                  className="w-full pl-6 pr-2.5 py-1.5 rounded-xl bg-white border border-amber-300 text-xs font-medium text-stone-900 focus:outline-hidden focus:border-amber-600"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shrink-0 transition-all cursor-pointer"
              >
                Post Score
              </button>
            </form>
          </div>
        )}

        {hasPostedScore && (
          <div className="mb-3.5 p-2 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-medium flex items-center justify-between">
            <span>Score posted to public leaderboard!</span>
            <button
              onClick={onOpenLeaderboard}
              className="text-emerald-700 underline font-semibold"
            >
              View ↗
            </button>
          </div>
        )}

        {/* Rendered Tower Silhouette & Score Dashboard Card */}
        <div className="rounded-2xl overflow-hidden border border-stone-200 bg-stone-50 mb-4 p-3.5 flex flex-col sm:flex-row items-center gap-4">
          {silhouetteCanvas ? (
            <img
              src={silhouetteCanvas.toDataURL()}
              alt="Tower Silhouette"
              className="w-36 h-44 rounded-xl border border-black/10 shrink-0 shadow-xs object-cover"
            />
          ) : (
            <div className="w-36 h-44 rounded-xl bg-stone-200 shrink-0" />
          )}

          <div className="flex-1 w-full space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-white p-2.5 rounded-xl border border-stone-200/70">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Balanced</div>
                <div className="font-mono text-base sm:text-lg font-bold text-stone-900">
                  {summary.mode === 'daily' ? `${balancedCount} / 20` : `${balancedCount} pieces`}
                </div>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-stone-200/70">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Peak Height</div>
                <div className="font-mono text-base sm:text-lg font-bold text-stone-900">
                  {summary.peakHeightMeters.toFixed(1)}m
                </div>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-stone-200/70">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Max Tilt Saved</div>
                <div className="font-mono text-sm font-bold text-amber-700">
                  {summary.maxTiltDegrees.toFixed(1)}°
                </div>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-stone-200/70">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Daily Streak</div>
                <div className="font-mono text-sm font-bold text-emerald-700">
                  {profile.streak} Day{profile.streak === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="bg-stone-900 text-white px-3 py-2 rounded-xl flex items-center justify-between text-[11px]">
              <span className="text-stone-400">Top Block Sponsor</span>
              <span className="font-semibold text-amber-300 truncate max-w-[140px]">
                {topSponsor ? `${topSponsor.name} ($${topSponsor.bid}/d)` : 'Open Slot'}
              </span>
            </div>
          </div>
        </div>

        {/* Primary Share on X + Download Card + Replay Actions */}
        <div className="space-y-2">
          <button
            onClick={handleShareX}
            className="w-full py-3 px-4 rounded-2xl bg-black hover:bg-stone-800 active:scale-[0.99] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>Share Score Dashboard on X</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleDownloadCard}
              className="py-2.5 px-3 rounded-2xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span>↓ Save Card PNG</span>
            </button>
            <button
              onClick={handleCopyLink}
              className="py-2.5 px-3 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-900 font-semibold text-xs sm:text-sm transition-all cursor-pointer"
            >
              Copy Challenge Link
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <button
              onClick={onPlayAgain}
              className="py-2.5 px-3 rounded-2xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs sm:text-sm transition-all cursor-pointer"
            >
              Play Seed Again
            </button>
            <button
              onClick={onOpenLeaderboard}
              className="py-2.5 px-3 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-900 font-semibold text-xs sm:text-sm transition-all cursor-pointer"
            >
              🏆 View Top Players
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
