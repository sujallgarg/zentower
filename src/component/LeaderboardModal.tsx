import React, { useState, useEffect, useCallback } from 'react';
import { GameMode, LeaderboardEntry } from '../types';
import { getRemoteLeaderboard, supabase } from '../lib/supabase';
import { db } from '../storage/database';

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  dayNumber: number;
  initialMode: GameMode;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  isOpen,
  onClose,
  dayNumber,
  initialMode,
}) => {
  const [activeTab, setActiveTab] = useState<GameMode>(initialMode);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const profile = db.getProfile();

  const loadEntries = useCallback(async () => {
    const list = await getRemoteLeaderboard(activeTab, activeTab === 'daily' ? dayNumber : undefined);
    setEntries(list.slice(0, 25));
  }, [activeTab, dayNumber]);

  useEffect(() => {
    if (isOpen) {
      loadEntries();
    }
  }, [isOpen, loadEntries]);

  // Real-time leaderboard updates
  useEffect(() => {
    const localHandler = () => loadEntries();
    window.addEventListener('zt_leaderboard_updated', localHandler);

    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    if (supabase) {
      channel = supabase
        .channel('public:leaderboard_entries')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard_entries' }, () => {
          loadEntries();
        })
        .subscribe();
    }

    return () => {
      window.removeEventListener('zt_leaderboard_updated', localHandler);
      if (channel) {
        supabase?.removeChannel(channel);
      }
    };
  }, [loadEntries]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-black/10 text-stone-900 my-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-stone-100 text-stone-800">
            No Login · Anonymous ID
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500 cursor-pointer"
            aria-label="Close Leaderboard"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold tracking-tight">Top Tower Architects</h2>
          <span className="font-mono text-[11px] text-stone-400">You: {profile.playerId}</span>
        </div>
        <p className="text-xs text-stone-600 mb-3.5">
          Set a new high score to claim a 3-letter tag and link your X profile on the public board.
        </p>

        {/* Leaderboard Mode Tabs */}
        <div className="flex items-center bg-stone-100 p-1 rounded-xl text-xs font-semibold mb-3">
          <button
            onClick={() => setActiveTab('daily')}
            className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === 'daily'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Daily #{dayNumber}
          </button>
          <button
            onClick={() => setActiveTab('endless')}
            className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === 'endless'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Endless Zenith
          </button>
        </div>

        {/* Ranked Players List */}
        <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
          {entries.length === 0 ? (
            <div className="py-8 text-center text-xs text-stone-400 border border-dashed border-stone-200 rounded-2xl">
              No scores recorded yet.<br />
              <span className="text-amber-700 font-medium">Build a tower to claim the #1 spot!</span>
            </div>
          ) : (
            entries.map((item, idx) => {
              const isMe = item.playerId === profile.playerId;
              const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
              const cleanHandle = item.xHandle?.replace(/^@/, '');

              return (
                <div
                  key={`${item.playerId}-${idx}`}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-2xl border ${
                    isMe ? 'bg-amber-50/90 border-amber-300' : 'bg-stone-50 border-stone-200/80'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono font-bold text-xs w-6 text-center shrink-0">{rankBadge}</span>
                    <span className="font-mono font-extrabold text-xs px-2 py-0.5 rounded-lg bg-stone-900 text-white tracking-wider shrink-0">
                      {item.tag || 'ZEN'}
                    </span>
                    <div className="truncate">
                      {cleanHandle ? (
                        <a
                          href={`https://x.com/${encodeURIComponent(cleanHandle)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:text-sky-900 hover:underline"
                        >
                          <span>@{cleanHandle}</span>
                          <span>↗</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-stone-400">Anonymous</span>
                      )}
                      {isMe && (
                        <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-700">(You)</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <div className="font-mono font-bold text-xs text-stone-900">{Number(item.height).toFixed(1)}m</div>
                    <div className="text-[10px] text-stone-500">{item.balanced} blocks</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
