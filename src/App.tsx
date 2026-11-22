import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { GameMode, ThemeKey, PieceBlueprint, RunSummary } from './types';
import { getDailySeedInfo } from './utility/rng';
import { audioEngine } from './audio/ZenAudioEngine';
import { db } from './storage/database';
import { GameCanvas, GameCanvasHandle } from './game/GameCanvas';
import { TopHUD } from './component/TopHUD';
import { BottomDock } from './component/BottomDock';
import { ChallengeBanner } from './component/ChallengeBanner';
import { OnboardingHint } from './component/OnboardingHint';
import { Toast } from './component/Toast';
import { ScoreDashboardModal } from './component/ScoreDashboardModal';
import { LeaderboardModal } from './component/LeaderboardModal';
import { SponsorModal } from './component/SponsorModal';
import { handlePaymentReturn } from './lib/supabase';

export const App: React.FC = () => {
  const gameRef = useRef<GameCanvasHandle | null>(null);

  // Daily seed calculations
  const [dailyInfo] = useState(() => getDailySeedInfo());

  // URL query params for challenge banner (?c=<day>&h=<height>)
  const [challengeParams, setChallengeParams] = useState<{ day: number; height: number } | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const c = params.get('c');
      const h = params.get('h');
      if (c && h) {
        return { day: parseInt(c, 10), height: parseFloat(h) };
      }
    } catch (e) {
      console.warn('URL parsing error', e);
    }
    return null;
  });

  // Player state from database
  const profile = db.getProfile();
  const [mode, setMode] = useState<GameMode>('daily');
  const [theme, setTheme] = useState<ThemeKey>(profile.theme || 'oak');
  const [isMuted, setIsMuted] = useState<boolean>(() => audioEngine.isMuted());

  // Telemetry
  const [balancedCount, setBalancedCount] = useState<number>(0);
  const [heightMeters, setHeightMeters] = useState<number>(0);
  const [nextPiece, setNextPiece] = useState<PieceBlueprint | null>(null);

  // UI state
  const [isHintVisible, setIsHintVisible] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modals state
  const [isScoreModalOpen, setIsScoreModalOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [isSponsorModalOpen, setIsSponsorModalOpen] = useState<boolean>(false);
  const [lastRunSummary, setLastRunSummary] = useState<RunSummary | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  }, []);

  const handleToggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    audioEngine.setMuted(next);
  }, [isMuted]);

  const handleThemeChange = useCallback((newTheme: ThemeKey) => {
    setTheme(newTheme);
    db.updateProfile({ theme: newTheme });
    audioEngine.toggleRainAmbience(newTheme === 'kyoto');
  }, []);

  const handleModeChange = useCallback((newMode: GameMode) => {
    setMode(newMode);
    setBalancedCount(0);
    setHeightMeters(0);
    gameRef.current?.restartRun();
  }, []);

  const handleStatsUpdate = useCallback((stats: { balancedCount: number; currentHeight: number }) => {
    setBalancedCount(stats.balancedCount);
    setHeightMeters(stats.currentHeight);
  }, []);

  const handleRunEnd = useCallback((summary: RunSummary) => {
    setLastRunSummary(summary);
    setIsScoreModalOpen(true);

    if (summary.won && summary.mode === 'daily') {
      const p = db.getProfile();
      if (p.lastCompletedDay !== dailyInfo.dayNumber) {
        const newStreak = p.lastCompletedDay === dailyInfo.dayNumber - 1 ? p.streak + 1 : 1;
        db.updateProfile({ streak: newStreak, lastCompletedDay: dailyInfo.dayNumber });
      }
    }
  }, [dailyInfo.dayNumber]);

  // Audio gesture unlock (including iOS Safari pointerdown and touchstart)
  useEffect(() => {
    const unlock = () => {
      audioEngine.ensureContext();
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });

    // Open sponsor modal event from canvas taps
    const openSponsorHandler = () => setIsSponsorModalOpen(true);
    window.addEventListener('zt_open_sponsor_modal', openSponsorHandler);

    // Check Stripe/Dodo checkout redirect return parameters
    handlePaymentReturn().then((res) => {
      if (res.status === 'success') {
        showToast(`🎉 Sponsorship confirmed! ${res.brandName} is now live!`);
        window.history.replaceState({}, '', window.location.pathname);
      } else if (res.status === 'canceled') {
        showToast('Sponsorship checkout was canceled.');
        window.history.replaceState({}, '', window.location.pathname);
      }
    });

    return () => {
      window.removeEventListener('zt_open_sponsor_modal', openSponsorHandler);
    };
  }, [showToast]);

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-stone-100 text-stone-900 select-none">
      {/* Top HUD */}
      <TopHUD
        mode={mode}
        onModeChange={handleModeChange}
        theme={theme}
        onThemeChange={handleThemeChange}
        dayNumber={dailyInfo.dayNumber}
        balancedCount={balancedCount}
        heightMeters={heightMeters}
        onOpenLeaderboard={() => setIsLeaderboardOpen(true)}
        onOpenSponsor={() => setIsSponsorModalOpen(true)}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
      />

      {/* Dismissible Challenge Banner */}
      {challengeParams && (
        <div className="fixed top-14 left-0 right-0 z-20 px-3">
          <ChallengeBanner
            day={challengeParams.day}
            height={challengeParams.height}
            onDismiss={() => setChallengeParams(null)}
          />
        </div>
      )}

      {/* Onboarding Hint */}
      <OnboardingHint visible={isHintVisible} />

      {/* Main Physics & Water Canvas */}
      <GameCanvas
        ref={gameRef}
        mode={mode}
        theme={theme}
        dayNumber={dailyInfo.dayNumber}
        dailySeed={dailyInfo.seed}
        onStatsUpdate={handleStatsUpdate}
        onNextPieceChange={setNextPiece}
        onRunEnd={handleRunEnd}
        onFirstDrop={() => setIsHintVisible(false)}
      />

      {/* Bottom Floating Controls */}
      <BottomDock
        nextPiece={nextPiece}
        theme={theme}
        onDrop={() => gameRef.current?.dropPiece()}
        onRotate={() => gameRef.current?.rotatePiece()}
        onRestart={() => gameRef.current?.restartRun()}
      />

      {/* Toast Notification */}
      <Toast message={toastMessage} />

      {/* Modals */}
      <ScoreDashboardModal
        isOpen={isScoreModalOpen}
        summary={lastRunSummary}
        silhouetteCanvas={gameRef.current?.getSilhouetteCanvas() || null}
        onPlayAgain={() => {
          setIsScoreModalOpen(false);
          gameRef.current?.restartRun();
        }}
        onOpenLeaderboard={() => {
          setIsScoreModalOpen(false);
          setIsLeaderboardOpen(true);
        }}
        onShowToast={showToast}
      />

      <LeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        dayNumber={dailyInfo.dayNumber}
        initialMode={mode}
      />

      <SponsorModal
        isOpen={isSponsorModalOpen}
        onClose={() => setIsSponsorModalOpen(false)}
        onShowToast={showToast}
      />

      {/* Vercel Web Analytics */}
      <Analytics />
    </div>
  );
};

export default App;
