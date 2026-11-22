import React from 'react';
import { GameMode, ThemeKey } from '../types';

interface TopHUDProps {
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  theme: ThemeKey;
  onThemeChange: (theme: ThemeKey) => void;
  dayNumber: number;
  balancedCount: number;
  heightMeters: number;
  onOpenLeaderboard: () => void;
  onOpenSponsor: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export const TopHUD: React.FC<TopHUDProps> = ({
  mode,
  onModeChange,
  theme,
  onThemeChange,
  dayNumber,
  balancedCount,
  heightMeters,
  onOpenLeaderboard,
  onOpenSponsor,
  isMuted,
  onToggleMute,
}) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-20 pointer-events-none px-2 pt-2 sm:px-6 sm:pt-4">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
        {/* Top Row on Mobile: Logo/Mode on left, Action buttons on right */}
        <div className="flex items-center justify-between gap-1.5 w-full sm:w-auto">
          {/* Brand + Mode Switcher */}
          <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 backdrop-blur-md bg-white/80 border border-black/10 rounded-2xl px-2 py-1 sm:px-3 sm:py-1.5 shadow-xs">
            <div className="flex items-center gap-1.5 pr-1.5 sm:pr-2 border-r border-black/10">
              <span className="inline-block w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-amber-600"></span>
              <span className="font-bold text-[11px] sm:text-sm tracking-tight text-stone-900">ZEN TOWERS</span>
            </div>
            <div className="flex items-center bg-stone-200/70 p-0.5 rounded-xl text-[10px] sm:text-xs font-semibold">
              <button
                onClick={() => onModeChange('daily')}
                className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-lg transition-all cursor-pointer font-mono ${
                  mode === 'daily'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                #{dayNumber}
              </button>
              <button
                onClick={() => onModeChange('endless')}
                className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-lg transition-all cursor-pointer ${
                  mode === 'endless'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Endless
              </button>
            </div>
          </div>

          {/* Action Buttons on right */}
          <div className="pointer-events-auto flex items-center gap-1 sm:gap-1.5">
            {/* Theme Pills for Desktop */}
            <div className="hidden md:flex items-center backdrop-blur-md bg-white/75 border border-black/10 rounded-2xl p-1 shadow-xs text-xs font-medium">
              <button
                onClick={() => onThemeChange('oak')}
                className={`px-2.5 py-1 rounded-xl transition-all cursor-pointer ${
                  theme === 'oak' ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-black/5'
                }`}
              >
                Oak
              </button>
              <button
                onClick={() => onThemeChange('kyoto')}
                className={`px-2.5 py-1 rounded-xl transition-all cursor-pointer ${
                  theme === 'kyoto' ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-black/5'
                }`}
              >
                Kyoto
              </button>
              <button
                onClick={() => onThemeChange('obsidian')}
                className={`px-2.5 py-1 rounded-xl transition-all cursor-pointer ${
                  theme === 'obsidian' ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-black/5'
                }`}
              >
                Obsidian
              </button>
            </div>

            {/* Global Leaderboard Button */}
            <button
              onClick={onOpenLeaderboard}
              className="backdrop-blur-md bg-white/80 hover:bg-white border border-black/10 text-stone-900 text-xs font-semibold px-2 sm:px-3 py-1.5 sm:py-2 rounded-2xl shadow-xs transition-all cursor-pointer flex items-center gap-1"
            >
              <span>🏆</span>
              <span className="hidden sm:inline">Top</span>
            </button>

            {/* Live Brand Sponsor Auction Button */}
            <button
              onClick={onOpenSponsor}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-2xl shadow-xs transition-all cursor-pointer flex items-center gap-1"
            >
              <span>★</span>
              <span className="hidden xs:inline">Sponsor</span>
            </button>

            {/* Mute Toggle */}
            <button
              onClick={onToggleMute}
              aria-label="Toggle Sound"
              className="backdrop-blur-md bg-white/75 hover:bg-white border border-black/10 text-stone-800 p-1.5 sm:p-2 rounded-2xl shadow-xs transition-all cursor-pointer"
            >
              {isMuted ? (
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Second Row on Mobile: Telemetry Counters + Compact Mobile Theme Switcher */}
        <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
          {/* Live Telemetry Counters */}
          <div className="pointer-events-auto flex items-center gap-2.5 sm:gap-5 backdrop-blur-md bg-white/75 border border-black/10 rounded-2xl px-2.5 py-1 sm:px-3.5 sm:py-1.5 shadow-xs text-[11px] sm:text-sm">
            <div>
              <span className="text-stone-500 text-[9px] sm:text-[11px] uppercase tracking-wider block leading-none">Balanced</span>
              <span className="font-mono font-bold text-stone-900">
                {mode === 'daily' ? `${Math.min(balancedCount, 20)} / 20` : `${balancedCount}`}
              </span>
            </div>
            <div className="h-5 sm:h-6 w-px bg-black/10"></div>
            <div>
              <span className="text-stone-500 text-[9px] sm:text-[11px] uppercase tracking-wider block leading-none">Height</span>
              <span className="font-mono font-bold text-stone-900">{heightMeters.toFixed(1)}m</span>
            </div>
          </div>

          {/* Mobile Theme Switcher */}
          <div className="flex md:hidden items-center backdrop-blur-md bg-white/75 border border-black/10 rounded-2xl p-0.5 shadow-xs text-[10px] font-medium pointer-events-auto">
            <button
              onClick={() => onThemeChange('oak')}
              className={`px-2 py-0.5 rounded-xl transition-all cursor-pointer ${
                theme === 'oak' ? 'bg-stone-900 text-white' : 'text-stone-700'
              }`}
            >
              Oak
            </button>
            <button
              onClick={() => onThemeChange('kyoto')}
              className={`px-2 py-0.5 rounded-xl transition-all cursor-pointer ${
                theme === 'kyoto' ? 'bg-stone-900 text-white' : 'text-stone-700'
              }`}
            >
              Rain
            </button>
            <button
              onClick={() => onThemeChange('obsidian')}
              className={`px-2 py-0.5 rounded-xl transition-all cursor-pointer ${
                theme === 'obsidian' ? 'bg-stone-900 text-white' : 'text-stone-700'
              }`}
            >
              Dark
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
