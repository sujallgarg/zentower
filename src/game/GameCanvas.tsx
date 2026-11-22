import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import Matter from 'matter-js';
import { GameMode, ThemeKey, PieceBlueprint, HoveringPiece, Sponsor, Particle, Raindrop, RunSummary } from '../types';
import { THEMES } from '../style/themes';
import { audioEngine } from '../audio/ZenAudioEngine';
import { mulberry32, generatePieceBlueprint } from '../utility/rng';
import { createMatterBodyFromBlueprint, createFloatingRaft } from './physics';
import { getActiveSponsors, supabase } from '../lib/supabase';
import { db } from '../storage/database';

export interface GameCanvasHandle {
  dropPiece: () => void;
  rotatePiece: () => void;
  restartRun: () => void;
  getSilhouetteCanvas: () => HTMLCanvasElement | null;
}

interface GameCanvasProps {
  mode: GameMode;
  theme: ThemeKey;
  dayNumber: number;
  dailySeed: number;
  onStatsUpdate: (stats: { balancedCount: number; currentHeight: number; maxTilt: number }) => void;
  onNextPieceChange: (nextPiece: PieceBlueprint | null) => void;
  onRunEnd: (summary: RunSummary) => void;
  onFirstDrop: () => void;
}

interface FloatingLabel {
  text: string;
  x: number;
  y: number;
  vy: number;
  alpha: number;
  color: string;
}

const DAILY_TARGET = 20;
const WATER_LINE_OFFSET = 168;

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(({
  mode,
  theme,
  dayNumber,
  dailySeed,
  onStatsUpdate,
  onNextPieceChange,
  onRunEnd,
  onFirstDrop,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const silhouetteCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Callbacks and props in refs to prevent physics engine recreation
  const onStatsUpdateRef = useRef(onStatsUpdate);
  onStatsUpdateRef.current = onStatsUpdate;
  const onNextPieceChangeRef = useRef(onNextPieceChange);
  onNextPieceChangeRef.current = onNextPieceChange;
  const onRunEndRef = useRef(onRunEnd);
  onRunEndRef.current = onRunEnd;
  const onFirstDropRef = useRef(onFirstDrop);
  onFirstDropRef.current = onFirstDrop;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const lastReportedCount = useRef(-1);
  const lastReportedHeight = useRef(-1);

  // Responsive resize tracking
  const prevWidthRef = useRef<number>(typeof window !== 'undefined' ? window.innerWidth : 800);
  const prevWaterBaseYRef = useRef<number>(typeof window !== 'undefined' ? window.innerHeight - WATER_LINE_OFFSET : 600);

  // Settle detection timer for reliable 20/20 victory validation
  const settleDurationRef = useRef<number>(0);
  const settledPiecesRewardedRef = useRef<Set<number>>(new Set());

  // Helper for consistent logical canvas dimensions immune to DPR mismatch
  const getCanvasDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { w: 400, h: 600, wbY: 600 - WATER_LINE_OFFSET };
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = rect.width > 0 ? rect.width : canvas.width / dpr;
    const h = rect.height > 0 ? rect.height : canvas.height / dpr;
    return { w, h, wbY: h - WATER_LINE_OFFSET };
  }, []);

  // Engine & Bodies
  const engineRef = useRef<Matter.Engine | null>(null);
  const raftBodyRef = useRef<Matter.Body | null>(null);
  const raftConstraintRef = useRef<Matter.Constraint | null>(null);
  const stackedBodiesRef = useRef<Matter.Body[]>([]);

  // Pieces & Spawning
  const pieceQueueRef = useRef<PieceBlueprint[]>([]);
  const currentPieceIdxRef = useRef<number>(0);
  const hoveringPieceRef = useRef<HoveringPiece | null>(null);
  const pointerXRef = useRef<number | null>(null);
  const canDropRef = useRef<boolean>(true);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rngRef = useRef<() => number>(mulberry32(dailySeed));

  // Game Status
  const gameEndedRef = useRef<boolean>(false);
  const gameWonRef = useRef<boolean>(false);
  const hasFirstDroppedRef = useRef<boolean>(false);
  const peakHeightMetersRef = useRef<number>(0);
  const maxTiltRecoveredDegRef = useRef<number>(0);

  // Camera & Visuals
  const cameraYRef = useRef<number>(0);
  const targetCameraYRef = useRef<number>(0);
  const animTimeRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const raindropsRef = useRef<Raindrop[]>([]);
  const floatingLabelsRef = useRef<FloatingLabel[]>([]);
  const animFrameRef = useRef<number | null>(null);

  // Sponsors & Cached Logos
  const blockSponsorsRef = useRef<Sponsor[]>([]);
  const skySponsorRef = useRef<Sponsor | null>(null);
  const allSkySponsorsRef = useRef<Sponsor[]>([]);
  const waterSponsorRef = useRef<Sponsor | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const sponsorClickBoundsRef = useRef<{
    skyBanner?: { x: number; y: number; w: number; h: number; url?: string | null };
    skyLeaderboard?: { x: number; y: number; w: number; h: number; items: { y: number; h: number; url?: string | null }[] };
    waterBanner?: { x: number; y: number; w: number; h: number; url?: string | null };
  }>({});

  const getSponsorImage = useCallback((url: string | null): HTMLImageElement | null => {
    if (!url) return null;
    let img = imageCacheRef.current.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      imageCacheRef.current.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }, []);

  const refreshSponsors = useCallback(async () => {
    const { blockSponsors, skySponsors, waterSponsors } = await getActiveSponsors();
    blockSponsorsRef.current = blockSponsors;
    allSkySponsorsRef.current = skySponsors;
    skySponsorRef.current = skySponsors[0] || null;
    waterSponsorRef.current = waterSponsors[0] || null;
  }, []);

  // Real-time sponsor updates via Supabase or LocalStorage event
  useEffect(() => {
    refreshSponsors();

    const localHandler = () => refreshSponsors();
    window.addEventListener('zt_sponsors_updated', localHandler);
    window.addEventListener('online', localHandler);

    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    if (supabase) {
      channel = supabase
        .channel('public:sponsor_bids')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_bids' }, () => {
          refreshSponsors();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            refreshSponsors();
          }
        });
    }

    return () => {
      window.removeEventListener('zt_sponsors_updated', localHandler);
      window.removeEventListener('online', localHandler);
      if (channel) {
        supabase?.removeChannel(channel);
      }
    };
  }, [refreshSponsors]);

  // Offscreen canvas silhouette card generator (High-DPI crisp PNG)
  const renderTowerSilhouette = useCallback((): HTMLCanvasElement => {
    let card = silhouetteCanvasRef.current;
    if (!card) {
      card = document.createElement('canvas');
      silhouetteCanvasRef.current = card;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    card.width = 260 * dpr;
    card.height = 320 * dpr;
    const silCtx = card.getContext('2d');
    if (!silCtx) return card;

    silCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const currentTheme = THEMES[themeRef.current] || THEMES.oak;
    const { w, h } = getCanvasDimensions();
    const wbY = h - 125;
    const raftW = Math.min(240, Math.max(175, w * 0.42));

    silCtx.clearRect(0, 0, 260, 320);
    const grad = silCtx.createLinearGradient(0, 0, 0, 320);
    grad.addColorStop(0, currentTheme.skyTop);
    grad.addColorStop(1, currentTheme.skyBottom);
    silCtx.fillStyle = grad;
    silCtx.fillRect(0, 0, 260, 320);

    const scale = 0.55;
    const cx = 130;
    const baseScreenY = 320 - 48;

    // Water strip
    silCtx.fillStyle = currentTheme.waterFront;
    silCtx.fillRect(0, baseScreenY + 12, 260, 48);

    // Raft
    const raft = raftBodyRef.current;
    if (raft) {
      silCtx.save();
      silCtx.translate(cx, baseScreenY);
      silCtx.rotate(raft.angle);
      silCtx.fillStyle = currentTheme.raftFill;
      silCtx.strokeStyle = currentTheme.raftStroke;
      silCtx.lineWidth = 2;
      silCtx.beginPath();
      silCtx.roundRect((-raftW * scale) / 2, -6, raftW * scale, 12, 4);
      silCtx.fill();
      silCtx.stroke();
      silCtx.restore();

      // Triangular Fulcrum Pivot beneath the balance beam
      const silPivotX = cx;
      const silPivotTopY = baseScreenY + 6;
      const silWedgeHalfW = 16 * scale;
      const silWedgeH = 22 * scale;

      silCtx.save();
      silCtx.fillStyle = '#f59e0b';
      silCtx.strokeStyle = '#000000';
      silCtx.lineWidth = 2;
      silCtx.lineJoin = 'round';
      silCtx.beginPath();
      silCtx.moveTo(silPivotX, silPivotTopY);
      silCtx.lineTo(silPivotX + silWedgeHalfW, silPivotTopY + silWedgeH);
      silCtx.lineTo(silPivotX - silWedgeHalfW, silPivotTopY + silWedgeH);
      silCtx.closePath();
      silCtx.fill();
      silCtx.stroke();
      silCtx.restore();
    }

    // Stacked blocks with exact compound & multi-part vertex rendering
    stackedBodiesRef.current.forEach((b) => {
      if (b.position.y > wbY + 20) return;
      const bp = (b as unknown as { plugin?: { blueprint?: PieceBlueprint } }).plugin?.blueprint;
      const pal = currentTheme.palette[bp?.paletteIdx || 0] || currentTheme.palette[0];
      const relX = (b.position.x - w / 2) * scale;
      const relY = (b.position.y - (wbY - 18)) * scale;

      silCtx.save();
      silCtx.translate(cx + relX, baseScreenY + relY);
      silCtx.rotate(b.angle);
      silCtx.fillStyle = pal.fill;
      silCtx.strokeStyle = pal.stroke;
      silCtx.lineWidth = 1.5;

      if (bp?.shape === 'circle') {
        silCtx.beginPath();
        silCtx.arc(0, 0, (bp.r || 24) * scale, 0, Math.PI * 2);
        silCtx.fill();
        silCtx.stroke();
      } else {
        // Multi-part vertices rendering for compoundL and wedges (never fallback to plain rectangle)
        const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
        parts.forEach((part) => {
          silCtx.beginPath();
          part.vertices.forEach((v, idx) => {
            const lx = (v.x - b.position.x) * scale;
            const ly = (v.y - b.position.y) * scale;
            if (idx === 0) silCtx.moveTo(lx, ly);
            else silCtx.lineTo(lx, ly);
          });
          silCtx.closePath();
          silCtx.fill();
          silCtx.stroke();
        });
      }
      silCtx.restore();
    });

    // Card footer label
    silCtx.fillStyle = 'rgba(255,255,255,0.88)';
    silCtx.fillRect(0, 320 - 26, 260, 26);
    silCtx.fillStyle = '#1c1917';
    silCtx.font = '700 10px "JetBrains Mono", monospace';
    silCtx.textAlign = 'center';
    silCtx.fillText(
      `ZEN TOWERS #${dayNumber} • ${peakHeightMetersRef.current.toFixed(1)}m`,
      130,
      320 - 9
    );

    return card;
  }, [dayNumber]);

  // Finish run handler
  const triggerRunEnd = useCallback((won: boolean) => {
    if (gameEndedRef.current) return;
    gameEndedRef.current = true;
    gameWonRef.current = won;
    canDropRef.current = false;

    if (won) {
      audioEngine.playVictoryChime();
    } else {
      audioEngine.playSplash();
    }

    renderTowerSilhouette();

    const profile = db.getProfile();
    const prevBest = modeRef.current === 'daily' ? profile.bestDailyHeight : profile.bestEndlessHeight;
    const isNewHighScore = peakHeightMetersRef.current > prevBest && peakHeightMetersRef.current > 0;

    const summary: RunSummary = {
      won,
      balancedCount: won ? DAILY_TARGET : Math.max(0, currentPieceIdxRef.current - 1),
      peakHeightMeters: peakHeightMetersRef.current,
      maxTiltDegrees: maxTiltRecoveredDegRef.current,
      isNewHighScore,
      mode: modeRef.current,
      dayNumber,
    };

    onRunEndRef.current(summary);
  }, [dayNumber, renderTowerSilhouette]);

  // Spawning next hovering piece
  const spawnNextHoveringPiece = useCallback(() => {
    if (gameEndedRef.current) return;
    if (modeRef.current === 'daily' && currentPieceIdxRef.current >= DAILY_TARGET) {
      // Victory will be validated by the 1.2s settle detector in tick loop
      return;
    }

    const { w } = getCanvasDimensions();

    while (pieceQueueRef.current.length <= currentPieceIdxRef.current + 2) {
      pieceQueueRef.current.push(
        generatePieceBlueprint(pieceQueueRef.current.length, rngRef.current, blockSponsorsRef.current.length)
      );
    }

    hoveringPieceRef.current = {
      blueprint: pieceQueueRef.current[currentPieceIdxRef.current],
      x: w / 2,
      phase: 0,
      angle: 0,
      targetAngle: 0,
    };
    canDropRef.current = true;

    const nextBp = pieceQueueRef.current[currentPieceIdxRef.current + 1] || null;
    onNextPieceChangeRef.current(nextBp);
  }, [getCanvasDimensions]);

  // Drop Active Piece
  const dropPiece = useCallback((targetX?: number) => {
    if (!hoveringPieceRef.current || !canDropRef.current || gameEndedRef.current || !engineRef.current || !canvasRef.current) return;
    audioEngine.ensureContext();
    canDropRef.current = false;

    if (!hasFirstDroppedRef.current) {
      hasFirstDroppedRef.current = true;
      onFirstDropRef.current();
    }

    const { w, wbY } = getCanvasDimensions();
    const dropY = Math.min(wbY - 340, wbY - 120 - cameraYRef.current);

    const finalX = typeof targetX === 'number'
      ? Math.max(32, Math.min(w - 32, targetX))
      : hoveringPieceRef.current.x;

    const body = createMatterBodyFromBlueprint(
      hoveringPieceRef.current.blueprint,
      finalX,
      dropY,
      hoveringPieceRef.current.targetAngle
    );

    Matter.World.add(engineRef.current.world, body);
    stackedBodiesRef.current.push(body);

    const currentCount = stackedBodiesRef.current.length;

    hoveringPieceRef.current = null;
    currentPieceIdxRef.current += 1;

    lastReportedCount.current = currentCount;
    onStatsUpdateRef.current({
      balancedCount: currentCount,
      currentHeight: peakHeightMetersRef.current,
      maxTilt: maxTiltRecoveredDegRef.current,
    });

    if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    dropTimerRef.current = setTimeout(() => {
      spawnNextHoveringPiece();
    }, 1050);
  }, [spawnNextHoveringPiece]);

  // Rotate Active Piece (45° step)
  const rotatePiece = useCallback(() => {
    if (!hoveringPieceRef.current || gameEndedRef.current) return;
    audioEngine.ensureContext();
    audioEngine.playRotateTick();
    hoveringPieceRef.current.targetAngle += Math.PI / 4;
  }, []);

  // Restart Run (Clean physics lifecycle)
  const restartRun = useCallback(() => {
    if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    gameEndedRef.current = false;
    gameWonRef.current = false;
    hasFirstDroppedRef.current = false;
    stackedBodiesRef.current = [];
    currentPieceIdxRef.current = 0;
    hoveringPieceRef.current = null;
    canDropRef.current = true;
    peakHeightMetersRef.current = 0;
    maxTiltRecoveredDegRef.current = 0;
    cameraYRef.current = 0;
    targetCameraYRef.current = 0;
    particlesRef.current = [];
    floatingLabelsRef.current = [];
    settleDurationRef.current = 0;
    settledPiecesRewardedRef.current.clear();

    const seedVal = modeRef.current === 'daily' ? dailySeed : (Date.now() >>> 0);
    rngRef.current = mulberry32(seedVal);

    pieceQueueRef.current = [];
    for (let i = 0; i < 24; i++) {
      pieceQueueRef.current.push(
        generatePieceBlueprint(i, rngRef.current, blockSponsorsRef.current.length)
      );
    }

    if (engineRef.current && canvasRef.current) {
      Matter.World.clear(engineRef.current.world, false);
      const { w, wbY } = getCanvasDimensions();
      const raftW = Math.min(240, Math.max(175, w * 0.42));

      prevWidthRef.current = w;
      prevWaterBaseYRef.current = wbY;

      const { raftBody, raftConstraint } = createFloatingRaft(w, wbY, raftW);
      raftBodyRef.current = raftBody;
      raftConstraintRef.current = raftConstraint;
      Matter.World.add(engineRef.current.world, [raftBody, raftConstraint]);
    }

    onStatsUpdateRef.current({
      balancedCount: 0,
      currentHeight: 0,
      maxTilt: 0,
    });

    spawnNextHoveringPiece();
  }, [dailySeed, spawnNextHoveringPiece, getCanvasDimensions]);

  useImperativeHandle(ref, () => ({
    dropPiece,
    rotatePiece,
    restartRun,
    getSilhouetteCanvas: () => silhouetteCanvasRef.current,
  }));

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.code === 'Space' || e.code === 'ArrowDown') {
        e.preventDefault();
        dropPiece();
      } else if (e.code === 'KeyR' || e.code === 'ArrowUp') {
        e.preventDefault();
        rotatePiece();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dropPiece, rotatePiece]);

  // Main Canvas & Simulation Setup (Mount once)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.05 },
    });
    engineRef.current = engine;

    // Responsive resize handler that preserves tower stability
    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);

      const oldW = prevWidthRef.current;
      const oldWbY = prevWaterBaseYRef.current;
      const newW = rect.width;
      const newWbY = rect.height - WATER_LINE_OFFSET;
      const deltaX = (newW - oldW) / 2;
      const deltaY = newWbY - oldWbY;
      prevWidthRef.current = newW;
      prevWaterBaseYRef.current = newWbY;

      // Proportionally reposition raft & stacked blocks without toppling
      if (raftBodyRef.current && raftConstraintRef.current && (deltaX !== 0 || deltaY !== 0)) {
        Matter.Body.setPosition(raftBodyRef.current, {
          x: raftBodyRef.current.position.x + deltaX,
          y: raftBodyRef.current.position.y + deltaY,
        });
        raftConstraintRef.current.pointA = { x: newW / 2, y: newWbY - 12 };

        stackedBodiesRef.current.forEach((b) => {
          Matter.Body.setPosition(b, {
            x: b.position.x + deltaX,
            y: b.position.y + deltaY,
          });
        });
      }

      // Re-init raindrops
      raindropsRef.current = Array.from({ length: 75 }, () => ({
        x: Math.random() * (rect.width + 40),
        y: Math.random() * rect.height,
        len: 10 + Math.random() * 14,
        speed: 7 + Math.random() * 6,
      }));
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const wbY = h - WATER_LINE_OFFSET;
    const raftW = Math.min(240, Math.max(175, w * 0.42));

    const { raftBody, raftConstraint } = createFloatingRaft(w, wbY, raftW);
    raftBodyRef.current = raftBody;
    raftConstraintRef.current = raftConstraint;
    Matter.World.add(engine.world, [raftBody, raftConstraint]);

    // Adaptive rotational buoyancy torque: balanced smooth tilting through Pieces 1–10
    Matter.Events.on(engine, 'beforeUpdate', () => {
      if (!raftBodyRef.current) return;
      const raft = raftBodyRef.current;
      const isEarly = stackedBodiesRef.current.length < 10;
      if (isEarly) {
        // Balanced smooth tilt speed (not sluggish, not twitchy)
        Matter.Body.setAngularVelocity(raft, raft.angularVelocity * 0.95);
      }
      const damping = isEarly ? 0.45 : 0.28;
      const restoringTorque = -raft.angle * 0.42 - raft.angularVelocity * damping;
      raft.torque += restoringTorque;
    });

    // Velocity-scaled procedural collision foley
    Matter.Events.on(engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const speedA = pair.bodyA.speed || 0;
        const speedB = pair.bodyB.speed || 0;
        const impact = Math.max(speedA, speedB) * 0.18;
        const bpA = (pair.bodyA as unknown as { plugin?: { blueprint?: PieceBlueprint } }).plugin?.blueprint;
        const bpB = (pair.bodyB as unknown as { plugin?: { blueprint?: PieceBlueprint } }).plugin?.blueprint;
        const mat = bpA?.material || bpB?.material || 'wood';
        audioEngine.playCollision(impact, themeRef.current, mat);
      });
    });

    restartRun();

    let lastFrameTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(32, now - lastFrameTime);
      lastFrameTime = now;
      animTimeRef.current += dt * 0.001;

      const currentDpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.width / currentDpr;
      const ch = canvas.height / currentDpr;
      const currentWbY = ch - WATER_LINE_OFFSET;
      const curTheme = THEMES[themeRef.current] || THEMES.oak;

      // Physics update
      if (!gameEndedRef.current) {
        Matter.Engine.update(engine, 1000 / 60);

        const raft = raftBodyRef.current;
        if (raft) {
          const deg = Math.abs((raft.angle * 180) / Math.PI);
          if (deg > maxTiltRecoveredDegRef.current) {
            maxTiltRecoveredDegRef.current = deg;
          }
        }

        let highestY = currentWbY - 18;
        const bodies = stackedBodiesRef.current;
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];
          if (b.bounds.min.y < highestY && b.position.y < currentWbY) {
            highestY = b.bounds.min.y;
          }
          if (b.position.y > currentWbY + 8) {
            // Spawn 24 splash particles
            for (let p = 0; p < 24; p++) {
              const angle = -Math.PI * Math.random();
              const speed = 2.5 + Math.random() * 5.5;
              particlesRef.current.push({
                x: b.position.x + (Math.random() - 0.5) * 30,
                y: currentWbY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.5,
                r: 2.5 + Math.random() * 3.5,
                life: 1,
                color: themeRef.current === 'obsidian' ? '#fbbf24' : '#38bdf8',
              });
            }
            triggerRunEnd(false);
            break;
          }
        }

        // Rigorous 20/20 settle detection: all 20 blocks must remain calm (speed < 0.15) for 1.2s
        if (modeRef.current === 'daily' && bodies.length >= DAILY_TARGET && !gameEndedRef.current) {
          const allSettled = bodies.every(
            (b) => b.speed < 0.15 && b.angularSpeed < 0.05 && b.position.y < currentWbY
          );

          if (allSettled) {
            settleDurationRef.current += dt * 0.001;
            if (settleDurationRef.current >= 1.2) {
              triggerRunEnd(true);
            }
          } else {
            settleDurationRef.current = 0;
          }
        }

        // Positive Competence Micro-Feedback when each of the first 5 blocks comes to rest (speed < 0.15)
        for (let i = 0; i < Math.min(5, bodies.length); i++) {
          if (!settledPiecesRewardedRef.current.has(i)) {
            const b = bodies[i];
            if (b.speed < 0.15 && b.angularSpeed < 0.05 && b.position.y < currentWbY) {
              settledPiecesRewardedRef.current.add(i);
              audioEngine.playCompetenceChime(i + 1);

              const competenceLabels = ["Solid Base", "Balanced", "Countered", "Steady", "Rock Solid"];
              const labelText = competenceLabels[i] || "Balanced";

              floatingLabelsRef.current.push({
                text: labelText,
                x: b.position.x,
                y: b.bounds.min.y - 14,
                vy: -1.1,
                alpha: 1.0,
                color: '#f59e0b',
              });
            }
          }
        }

        const currentMeters = Math.max(0, (currentWbY - 18 - highestY) / 16);
        if (currentMeters > peakHeightMetersRef.current) {
          peakHeightMetersRef.current = currentMeters;
        }

        const desiredY = Math.max(0, (currentWbY - 260) - highestY);
        targetCameraYRef.current = desiredY;
        cameraYRef.current += (targetCameraYRef.current - cameraYRef.current) * 0.06;

        const roundedHeight = Number(peakHeightMetersRef.current.toFixed(1));
        if (bodies.length !== lastReportedCount.current || roundedHeight !== lastReportedHeight.current) {
          lastReportedCount.current = bodies.length;
          lastReportedHeight.current = roundedHeight;
          onStatsUpdateRef.current({
            balancedCount: bodies.length,
            currentHeight: peakHeightMetersRef.current,
            maxTilt: maxTiltRecoveredDegRef.current,
          });
        }
      }

      // Hovering piece: track pointer if active, else natural pendulum swing
      if (hoveringPieceRef.current && !gameEndedRef.current) {
        const hover = hoveringPieceRef.current;
        if (pointerXRef.current !== null) {
          hover.x = pointerXRef.current;
        } else {
          const isEarly = stackedBodiesRef.current.length < 5;
          const swingSpeed = isEarly ? 1.45 : (1.75 + Math.min(1.1, currentPieceIdxRef.current * 0.045));
          hover.phase += dt * 0.001 * swingSpeed;
          const swingAmp = isEarly ? (raftW * 0.44) : Math.min(raftW * 0.56, cw * 0.34);
          hover.x = cw / 2 + Math.sin(hover.phase) * swingAmp;
        }
        hover.angle += (hover.targetAngle - hover.angle) * 0.25;
      }

      // Update particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18;
        p.life -= 0.028;
        if (p.life <= 0) particlesRef.current.splice(i, 1);
      }

      // Update floating micro-feedback labels
      for (let i = floatingLabelsRef.current.length - 1; i >= 0; i--) {
        const fl = floatingLabelsRef.current[i];
        fl.y += fl.vy;
        fl.alpha -= dt * 0.001 * 1.1;
        if (fl.alpha <= 0) floatingLabelsRef.current.splice(i, 1);
      }

      // Update rain
      if (themeRef.current === 'kyoto') {
        raindropsRef.current.forEach((r) => {
          r.x -= 1.6;
          r.y += r.speed;
          if (r.y > ch) {
            r.y = -15;
            r.x = Math.random() * (cw + 40);
          }
        });
      }

      // ============================================
      // RENDER CANVAS
      // ============================================
      ctx.save();
      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

      // Sky Background
      const skyGrad = ctx.createLinearGradient(0, 0, 0, ch);
      skyGrad.addColorStop(0, curTheme.skyTop);
      skyGrad.addColorStop(1, curTheme.skyBottom);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, cw, ch);

      // Ambient Sun/Moon
      const isMobile = cw < 640;
      ctx.fillStyle = curTheme.sunColor;
      ctx.beginPath();
      ctx.arc(isMobile ? cw * 0.5 : cw * 0.76, isMobile ? Math.min(ch * 0.32, 210) : ch * 0.24, Math.min(cw, ch) * 0.13, 0, Math.PI * 2);
      ctx.fill();

      // 1. Sky Billboard #1 Banner on Top (Floating suspended banner showing #1 leader)
      const topSky = skySponsorRef.current;
      const bannerFloatY = Math.sin(animTimeRef.current * 1.1) * 3;
      const topBy = isMobile ? 84 + bannerFloatY : Math.max(115, ch * 0.15) + bannerFloatY;

      let bannerW = 260;
      let lbW = Math.min(210, Math.max(165, cw * 0.44));
      let topBx = 16;
      let bx = cw - lbW - 14;

      if (isMobile) {
        bannerW = Math.floor((cw - 22) * 0.53);
        lbW = Math.floor((cw - 22) * 0.45);
        topBx = 7;
        bx = cw - lbW - 7;
      } else {
        const lbEstimateW = Math.min(210, Math.max(165, cw * 0.44));
        bannerW = Math.min(260, cw * 0.64);
        topBx = Math.max(10, Math.min(cw / 2 - bannerW / 2, cw - lbEstimateW - bannerW - 16));
      }

      if (topSky) {
        const bannerH = isMobile ? 38 : 42;

        sponsorClickBoundsRef.current.skyBanner = {
          x: topBx,
          y: topBy,
          w: bannerW,
          h: bannerH,
          url: topSky.websiteUrl || (topSky.tagline?.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/i)?.[0]) || null,
        };

        ctx.save();
        ctx.fillStyle = curTheme.darkUi ? 'rgba(24, 26, 34, 0.76)' : 'rgba(255, 255, 255, 0.82)';
        ctx.strokeStyle = topSky.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(topBx, topBy, bannerW, bannerH, 12);
        ctx.fill();
        ctx.stroke();

        const img = getSponsorImage(topSky.imageDataUrl);
        const iconR = isMobile ? 11 : 13;
        const iconCx = topBx + (isMobile ? 18 : 22);
        const iconCy = topBy + bannerH / 2;
        const textX = topBx + (isMobile ? 34 : 42);

        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(iconCx - iconR, iconCy - iconR, iconR * 2, iconR * 2);
          ctx.drawImage(img, iconCx - iconR, iconCy - iconR, iconR * 2, iconR * 2);
          ctx.restore();
        } else {
          ctx.fillStyle = topSky.color;
          ctx.beginPath();
          ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = isMobile ? 'bold 11px "Inter", sans-serif' : 'bold 13px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(topSky.symbol || topSky.name[0], iconCx, iconCy + 0.5);
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = curTheme.darkUi ? '#fafaf9' : '#1c1917';
        ctx.font = isMobile ? '700 10px "Inter", sans-serif' : '700 11px "Inter", sans-serif';
        const maxTitleLen = isMobile ? 8 : (bannerW < 210 ? 8 : 13);
        const dispTitle = topSky.name.length > maxTitleLen ? topSky.name.slice(0, maxTitleLen - 1) + '…' : topSky.name;
        ctx.fillText(dispTitle + (topSky.websiteUrl ? ' ↗' : ''), textX, topBy + (isMobile ? 16 : 18));

        ctx.fillStyle = curTheme.darkUi ? '#a8a29e' : '#57534e';
        ctx.font = isMobile ? '500 9px "Inter", sans-serif' : '500 10px "Inter", sans-serif';
        const maxTaglineLen = isMobile ? 9 : (bannerW < 210 ? 9 : 15);
        const dispTag = topSky.tagline.length > maxTaglineLen ? topSky.tagline.slice(0, maxTaglineLen - 1) + '…' : topSky.tagline;
        ctx.fillText(dispTag, textX, topBy + (isMobile ? 29 : 31));

        // Flashcard on the right of the Sky Billboard for the bid
        const fcW = isMobile ? 48 : Math.min(76, Math.max(58, bannerW * 0.32));
        const fcH = isMobile ? 24 : 26;
        const fcX = topBx + bannerW - fcW - (isMobile ? 6 : 8);
        const fcY = topBy + (bannerH - fcH) / 2;

        ctx.save();
        ctx.fillStyle = curTheme.darkUi ? 'rgba(30, 41, 59, 0.88)' : 'rgba(255, 255, 255, 0.94)';
        ctx.strokeStyle = topSky.color;
        ctx.lineWidth = 1.2;
        ctx.shadowColor = topSky.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.roundRect(fcX, fcY, fcW, fcH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = topSky.color;
        ctx.font = isMobile ? '700 8.5px "JetBrains Mono", monospace' : '700 9px "JetBrains Mono", monospace';
        ctx.fillText(`$${topSky.bid}`, fcX + fcW / 2, fcY + (isMobile ? 8 : 9));

        ctx.fillStyle = curTheme.darkUi ? '#94a3b8' : '#64748b';
        ctx.font = isMobile ? '700 6.5px "Inter", sans-serif' : '700 7px "Inter", sans-serif';
        ctx.fillText('SKY #1', fcX + fcW / 2, fcY + (isMobile ? 17 : 19));
        ctx.restore();

        ctx.restore();
      }

      // 2. Sky Billboard Leaderboard on the right (Shows bids in ranking order)
      const skyList = allSkySponsorsRef.current.slice(0, 3);
      const rowH = isMobile ? 24 : 26;
      const headerH = isMobile ? 22 : 24;
      const totalH = skyList.length > 0 ? headerH + skyList.length * rowH + 6 : 56;
      const by = topBy;

      sponsorClickBoundsRef.current.skyLeaderboard = {
        x: bx,
        y: by,
        w: lbW,
        h: totalH,
        items: skyList.map((sp, idx) => ({
          y: by + headerH + 3 + idx * rowH,
          h: rowH,
          url: sp.websiteUrl || (sp.tagline?.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/i)?.[0]) || null,
        })),
      };

      ctx.save();
      // Glassmorphic Card Background
      if (themeRef.current === 'obsidian') {
        ctx.fillStyle = 'rgba(24, 26, 34, 0.85)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      } else if (themeRef.current === 'kyoto') {
        ctx.fillStyle = 'rgba(240, 253, 250, 0.88)';
        ctx.strokeStyle = 'rgba(13, 148, 136, 0.45)';
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
        ctx.strokeStyle = 'rgba(217, 119, 6, 0.40)';
      }
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.14)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.roundRect(bx, by, lbW, totalH, 12);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Leaderboard Header
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = themeRef.current === 'obsidian' ? '#f59e0b' : '#b45309';
      ctx.font = isMobile ? '700 8px "Inter", sans-serif' : '700 9.5px "Inter", sans-serif';
      ctx.fillText(isMobile ? '★ SKY BOARD' : '★ SKY BILLBOARD', bx + (isMobile ? 6 : 10), by + 12);

      ctx.textAlign = 'right';
      ctx.font = '700 8px "JetBrains Mono", monospace';
      ctx.fillStyle = themeRef.current === 'obsidian' ? '#94a3b8' : '#78716c';
      ctx.fillText(isMobile ? 'RANK' : 'RANKING', bx + lbW - (isMobile ? 6 : 10), by + 12);

      // Separator line under header
      ctx.strokeStyle = themeRef.current === 'obsidian' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + 6, by + headerH);
      ctx.lineTo(bx + lbW - 6, by + headerH);
      ctx.stroke();

      if (skyList.length > 0) {
        // Render each ranked sky bid
        skyList.forEach((sp, idx) => {
          const rowY = by + headerH + 3 + idx * rowH;

          // Rank Pill
          const rankColors = ['#f59e0b', '#94a3b8', '#d97706'];
          const rankColor = rankColors[idx] || '#a8a29e';

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '700 9px "JetBrains Mono", monospace';
          ctx.fillStyle = rankColor;
          ctx.fillText(isMobile ? `${idx + 1}` : `#${idx + 1}`, bx + (isMobile ? 8 : 15), rowY + rowH / 2);

          // Brand Logo / Emblem
          const iconR = isMobile ? 6.5 : 8;
          const iconCx = bx + (isMobile ? 22 : 32);
          const iconCy = rowY + rowH / 2;
          const img = getSponsorImage(sp.imageDataUrl);

          if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(iconCx - iconR, iconCy - iconR, iconR * 2, iconR * 2);
            ctx.drawImage(img, iconCx - iconR, iconCy - iconR, iconR * 2, iconR * 2);
            ctx.restore();
          } else {
            ctx.fillStyle = sp.color || rankColor;
            ctx.beginPath();
            ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = isMobile ? 'bold 7.5px "Inter", sans-serif' : 'bold 9px "Inter", sans-serif';
            ctx.fillText(sp.symbol || sp.name[0], iconCx, iconCy + 0.5);
          }

          // Brand Name
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = themeRef.current === 'obsidian' ? '#f8fafc' : '#0f172a';
          ctx.font = isMobile ? '700 8px "Inter", sans-serif' : '700 9.5px "Inter", sans-serif';
          const maxNameLen = isMobile ? 6 : (lbW < 185 ? 8 : 12);
          const displayName = sp.name.length > maxNameLen ? sp.name.slice(0, maxNameLen - 1) + '…' : sp.name;
          ctx.fillText(displayName + (sp.websiteUrl ? ' ↗' : ''), bx + (isMobile ? 32 : 45), rowY + rowH / 2);

          // Bid Badge
          ctx.textAlign = 'right';
          ctx.fillStyle = rankColor;
          ctx.font = isMobile ? '700 8px "JetBrains Mono", monospace' : '700 9px "JetBrains Mono", monospace';
          ctx.fillText(`$${sp.bid}`, bx + lbW - (isMobile ? 6 : 10), rowY + rowH / 2);
        });
      } else {
        // Clean empty state
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = themeRef.current === 'obsidian' ? '#94a3b8' : '#78716c';
        ctx.font = '500 9.5px "Inter", sans-serif';
        ctx.fillText('No active bids yet', bx + lbW / 2, by + 34);
        ctx.font = '700 8.5px "JetBrains Mono", monospace';
        ctx.fillStyle = themeRef.current === 'obsidian' ? '#f59e0b' : '#b45309';
        ctx.fillText('Min $2 to claim #1', bx + lbW / 2, by + 46);
      }

      ctx.restore();

      // Rain in Kyoto theme
      if (themeRef.current === 'kyoto') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        raindropsRef.current.forEach((r) => {
          r.x -= 1.6;
          r.y += r.speed;
          if (r.y > ch) {
            r.y = -15;
            r.x = Math.random() * (cw + 40);
          }
        });
        ctx.stroke();
      }

      // World Camera Space
      ctx.save();
      ctx.translate(0, cameraYRef.current);

      // Back water wave
      ctx.fillStyle = curTheme.waterBack;
      ctx.beginPath();
      ctx.moveTo(0, currentWbY + 1200);
      for (let x = 0; x <= cw + 30; x += 30) {
        const wy = currentWbY - 4 + Math.sin(x * 0.015 + animTimeRef.current * 1.8) * 5;
        ctx.lineTo(x, wy);
      }
      ctx.lineTo(cw, currentWbY + 1200);
      ctx.closePath();
      ctx.fill();

      // Floating Seesaw Raft
      const raft = raftBodyRef.current;
      if (raft) {
        ctx.save();
        ctx.translate(raft.position.x, raft.position.y);
        ctx.rotate(raft.angle);
        ctx.fillStyle = curTheme.raftFill;
        ctx.strokeStyle = curTheme.raftStroke;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-raftW / 2, -11, raftW, 22, 8);
        ctx.fill();
        ctx.stroke();

        // Subtle Golden Center-of-Gravity Alignment Notch on Raft Deck
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(-5, -11);
        ctx.lineTo(5, -11);
        ctx.lineTo(0, -6);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = curTheme.raftStroke;
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Crisp Amber/Orange Triangular Fulcrum Wedge Supporting the Beam
        const pivotX = raft.position.x;
        const pivotTopY = raft.position.y + 11;
        const wedgeHalfW = 16;
        const wedgeH = 22;

        ctx.save();
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotTopY);
        ctx.lineTo(pivotX + wedgeHalfW, pivotTopY + wedgeH);
        ctx.lineTo(pivotX - wedgeHalfW, pivotTopY + wedgeH);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Subtle Balance Horizon / Tilt Arc Indicator beneath the raft fulcrum
        if (raftConstraintRef.current) {
          const fulcrumX = raftConstraintRef.current.pointA.x;
          const fulcrumY = raftConstraintRef.current.pointA.y;
          const tiltDeg = (raft.angle * 180) / Math.PI;
          const absTilt = Math.abs(tiltDeg);

          // Dynamic color interpolation:
          // 0°–10°: calm emerald (#10b981) shifting toward amber (#f59e0b)
          // 10°–18°: warm amber (#f59e0b) shifting toward vivid orange (#f97316)
          // >18°: alert crimson (#ef4444)
          let arcColor = '#10b981';
          let glowColor = 'rgba(16, 185, 129, 0.28)';

          if (absTilt <= 10) {
            const t = absTilt / 10;
            const r = Math.round(16 + t * (245 - 16));
            const g = Math.round(185 + t * (158 - 185));
            const b = Math.round(129 + t * (11 - 129));
            arcColor = `rgb(${r}, ${g}, ${b})`;
            glowColor = `rgba(${r}, ${g}, ${b}, 0.25)`;
          } else if (absTilt <= 18) {
            const t = (absTilt - 10) / 8;
            const r = Math.round(245 + t * (249 - 245));
            const g = Math.round(158 + t * (115 - 158));
            const b = Math.round(11 + t * (22 - 11));
            arcColor = `rgb(${r}, ${g}, ${b})`;
            glowColor = `rgba(${r}, ${g}, ${b}, 0.35)`;
          } else {
            arcColor = '#ef4444';
            glowColor = 'rgba(239, 68, 68, 0.45)';
          }

          ctx.save();
          ctx.translate(fulcrumX, fulcrumY + 16);

          // Subdued background horizon guide arc (-25° to +25°)
          const arcRadius = 38;
          const maxAngleRad = (25 * Math.PI) / 180;
          ctx.beginPath();
          ctx.arc(0, 0, arcRadius, Math.PI / 2 - maxAngleRad, Math.PI / 2 + maxAngleRad);
          ctx.strokeStyle = curTheme.darkUi ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.12)';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.stroke();

          // 0° center balance notch
          ctx.strokeStyle = curTheme.darkUi ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.25)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, arcRadius - 4);
          ctx.lineTo(0, arcRadius + 4);
          ctx.stroke();

          // Active dynamic tilt arc sweep
          const currentAngleRad = raft.angle;
          const clampedAngleRad = Math.max(-maxAngleRad, Math.min(maxAngleRad, currentAngleRad));

          ctx.shadowColor = glowColor;
          ctx.shadowBlur = absTilt > 18 ? 8 : 4;
          ctx.strokeStyle = arcColor;
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          if (currentAngleRad >= 0) {
            ctx.arc(0, 0, arcRadius, Math.PI / 2, Math.PI / 2 + clampedAngleRad);
          } else {
            ctx.arc(0, 0, arcRadius, Math.PI / 2 + clampedAngleRad, Math.PI / 2);
          }
          ctx.stroke();

          // Needle indicator dot at the end of the tilt arc
          const dotAngle = Math.PI / 2 + clampedAngleRad;
          const dotX = Math.cos(dotAngle) * arcRadius;
          const dotY = Math.sin(dotAngle) * arcRadius;
          ctx.fillStyle = arcColor;
          ctx.beginPath();
          ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
          ctx.fill();

          // Micro-degree text readout beneath arc
          ctx.shadowBlur = 0;
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = arcColor;
          ctx.fillText(`${absTilt.toFixed(1)}°`, 0, arcRadius + 6);

          ctx.restore();
        }
      }

      // Draw Matter bodies helper with multi-part vertex accuracy and sponsor badges
      const drawBodyWithSponsor = (b: Matter.Body, bp: PieceBlueprint, alpha: number = 1) => {
        const pal = curTheme.palette[bp.paletteIdx] || curTheme.palette[0];
        ctx.save();
        ctx.globalAlpha = alpha;

        const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
        parts.forEach((part) => {
          ctx.beginPath();
          part.vertices.forEach((v, idx) => {
            if (idx === 0) ctx.moveTo(v.x, v.y);
            else ctx.lineTo(v.x, v.y);
          });
          ctx.closePath();

          ctx.fillStyle = pal.fill;
          ctx.fill();

          ctx.lineWidth = 2;
          ctx.strokeStyle = pal.stroke;
          ctx.stroke();

          ctx.save();
          ctx.clip();
          ctx.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        });

        // Sponsor badge on body (if active sponsors exist)
        const sponsors = blockSponsorsRef.current;
        if (sponsors.length > 0) {
          const sponsor = sponsors[bp.sponsorSlot % sponsors.length];
          if (sponsor) {
            ctx.save();
            ctx.translate(b.position.x, b.position.y);
            ctx.rotate(b.angle);

            const img = getSponsorImage(sponsor.imageDataUrl);
            const minDim = bp.shape === 'circle' ? (bp.r || 24) * 1.4 : Math.min(bp.w || 40, bp.h || 24);
            const maxDim = bp.shape === 'circle' ? (bp.r || 24) * 1.4 : Math.max(bp.w || 40, bp.h || 24);
            const logoSize = Math.max(14, Math.min(22, minDim * 0.72));

            const offsetX = bp.shape === 'compoundL' ? -(bp.w || 76) * 0.18 : 0;
            const offsetY = bp.shape === 'compoundL' ? (bp.h || 64) * 0.18 : 0;
            ctx.translate(offsetX, offsetY);

            if (img) {
              ctx.save();
              ctx.beginPath();
              ctx.arc(maxDim > 68 ? -maxDim * 0.24 : 0, 0, logoSize / 2, 0, Math.PI * 2);
              ctx.clip();
              ctx.fillStyle = '#ffffff';
              ctx.fillRect((maxDim > 68 ? -maxDim * 0.24 : 0) - logoSize / 2, -logoSize / 2, logoSize, logoSize);
              ctx.drawImage(img, (maxDim > 68 ? -maxDim * 0.24 : 0) - logoSize / 2, -logoSize / 2, logoSize, logoSize);
              ctx.restore();
            } else {
              const emblemX = maxDim > 68 ? -maxDim * 0.26 : 0;
              ctx.fillStyle = sponsor.color;
              ctx.beginPath();
              ctx.arc(emblemX, 0, logoSize / 2, 0, Math.PI * 2);
              ctx.fill();

              ctx.fillStyle = '#ffffff';
              ctx.font = `bold ${Math.floor(logoSize * 0.58)}px "Inter", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(sponsor.symbol || sponsor.name[0], emblemX, 0.5);
            }

            if (maxDim >= 72 && minDim >= 22) {
              ctx.fillStyle = curTheme.darkUi ? 'rgba(255,255,255,0.92)' : 'rgba(28,25,23,0.88)';
              ctx.font = '700 9px "Inter", sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(sponsor.name.toUpperCase(), -maxDim * 0.26 + logoSize * 0.72, 0.5);
            }

            ctx.restore();
          }
        }

        ctx.restore();
      };

      // Draw Stacked Physics Bodies
      stackedBodiesRef.current.forEach((b) => {
        const bp = (b as unknown as { plugin?: { blueprint?: PieceBlueprint } }).plugin?.blueprint;
        if (bp) {
          drawBodyWithSponsor(b, bp, 1);
        }
      });

      // Hovering Active Piece + Aim Guide
      if (hoveringPieceRef.current && !gameEndedRef.current) {
        const hover = hoveringPieceRef.current;
        const dropWorldY = Math.min(currentWbY - 340, currentWbY - 120 - cameraYRef.current);

        ctx.save();
        ctx.strokeStyle = curTheme.guideLine;
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hover.x, dropWorldY + 20);
        ctx.lineTo(hover.x, currentWbY - 10);
        ctx.stroke();
        ctx.restore();

        const ghostBody = createMatterBodyFromBlueprint(
          hover.blueprint,
          hover.x,
          dropWorldY,
          hover.angle
        );
        drawBodyWithSponsor(ghostBody, hover.blueprint, 0.94);
      }

      // #1 Water Sponsor (Submerged/floating inside the water wave layer beneath seesaw raft)
      const topWater = waterSponsorRef.current;
      if (topWater) {
        ctx.save();
        const bannerW = isMobile ? Math.min(240, cw * 0.88) : Math.min(270, cw * 0.68);
        const bannerH = isMobile ? 32 : 36;
        // Gentle horizontal wave-drift and bobbing motion
        const bobY = Math.sin(animTimeRef.current * 1.6) * 3;
        const driftX = Math.cos(animTimeRef.current * 0.95) * (isMobile ? 4 : 8);
        const wx = cw / 2 - bannerW / 2 + driftX;
        const wy = currentWbY + (isMobile ? 38 : 44) + bobY;

        sponsorClickBoundsRef.current.waterBanner = {
          x: wx,
          y: wy + cameraYRef.current,
          w: bannerW,
          h: bannerH,
          url: topWater.websiteUrl || (topWater.tagline?.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/i)?.[0]) || null,
        };

        // Submerged glassmorphic card adapting contrast for Oak, Kyoto, and Obsidian themes
        ctx.shadowColor = topWater.color;
        ctx.shadowBlur = 10;

        if (themeRef.current === 'obsidian') {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
          ctx.strokeStyle = topWater.color;
        } else if (themeRef.current === 'kyoto') {
          ctx.fillStyle = 'rgba(240, 253, 250, 0.78)';
          ctx.strokeStyle = topWater.color;
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
          ctx.strokeStyle = topWater.color;
        }
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(wx, wy, bannerW, bannerH, 14);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Circular Logo / Emblem
        const img = getSponsorImage(topWater.imageDataUrl);
        const iconR = isMobile ? 10 : 12;
        const iconCx = wx + (isMobile ? 16 : 20);
        const iconCy = wy + bannerH / 2;
        const textX = wx + (isMobile ? 32 : 38);

        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
          ctx.clip();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(iconCx - iconR, iconCy - iconR, iconR * 2, iconR * 2);
          ctx.drawImage(img, iconCx - iconR, iconCy - iconR, iconR * 2, iconR * 2);
          ctx.restore();
        } else {
          ctx.fillStyle = topWater.color;
          ctx.beginPath();
          ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = isMobile ? 'bold 10px "Inter", sans-serif' : 'bold 12px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(topWater.symbol || topWater.name[0], iconCx, iconCy + 0.5);
        }

        // Brand Name (Uppercase)
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = themeRef.current === 'obsidian' ? '#f8fafc' : '#0f172a';
        ctx.font = isMobile ? '700 9.5px "Inter", sans-serif' : '700 11px "Inter", sans-serif';
        const maxWaterName = isMobile ? 10 : 16;
        const waterName = topWater.name.length > maxWaterName ? topWater.name.slice(0, maxWaterName - 1) + '…' : topWater.name;
        ctx.fillText(waterName.toUpperCase() + (topWater.websiteUrl ? ' ↗' : ''), textX, wy + (isMobile ? 13 : 15));

        // Tagline
        ctx.fillStyle = themeRef.current === 'obsidian' ? '#94a3b8' : '#475569';
        ctx.font = isMobile ? '500 8.5px "Inter", sans-serif' : '500 10px "Inter", sans-serif';
        const maxTagline = isMobile ? 16 : 24;
        const displayTagline = topWater.tagline.length > maxTagline ? topWater.tagline.slice(0, maxTagline - 2) + '…' : topWater.tagline;
        ctx.fillText(displayTagline, textX, wy + (isMobile ? 24 : 27));

        // WATER #1 Badge
        ctx.textAlign = 'right';
        ctx.fillStyle = topWater.color;
        ctx.font = isMobile ? '700 8px "JetBrains Mono", monospace' : '700 9px "JetBrains Mono", monospace';
        ctx.fillText(isMobile ? `$${topWater.bid}` : `WATER #1 • $${topWater.bid}`, wx + bannerW - (isMobile ? 8 : 10), wy + (isMobile ? 19 : 21));

        ctx.restore();
      }

      // Front water wave
      ctx.fillStyle = curTheme.waterFront;
      ctx.beginPath();
      ctx.moveTo(0, currentWbY + 1200);
      for (let x = 0; x <= cw + 25; x += 25) {
        const wy = currentWbY + 3 + Math.cos(x * 0.02 - animTimeRef.current * 2.4) * 4;
        ctx.lineTo(x, wy);
      }
      ctx.lineTo(cw, currentWbY + 1200);
      ctx.closePath();
      ctx.fill();

      // Floating micro-feedback competence labels
      floatingLabelsRef.current.forEach((fl) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, fl.alpha);
        ctx.font = 'bold 12px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Glass pill background
        const txtWidth = ctx.measureText(fl.text).width + 16;
        ctx.fillStyle = 'rgba(23, 23, 23, 0.85)';
        ctx.beginPath();
        ctx.roundRect(fl.x - txtWidth / 2, fl.y - 12, txtWidth, 24, 12);
        ctx.fill();

        ctx.fillStyle = fl.color;
        ctx.fillText(fl.text, fl.x, fl.y);
        ctx.restore();
      });

      // Particles
      particlesRef.current.forEach((p) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      ctx.restore(); // camera restore
      ctx.restore(); // dpr restore

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
    };
  }, [restartRun, getSponsorImage]);

  useEffect(() => {
    restartRun();
  }, [mode, dailySeed, restartRun]);

  return (
    <canvas
      id="gameCanvas"
      ref={canvasRef}
      onPointerDown={(e) => {
        if (e.button === 0) {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const bounds = sponsorClickBoundsRef.current;

            const openUrl = (raw?: string | null) => {
              if (!raw) return false;
              let url = raw.trim();
              if (!url) return false;
              if (!/^https?:\/\//i.test(url)) {
                url = `https://${url}`;
              }
              try {
                window.open(url, '_blank', 'noopener,noreferrer');
                return true;
              } catch (err) {
                console.warn('Redirect failed', err);
                return false;
              }
            };

            // 1. Sky Banner Click
            if (
              bounds.skyBanner &&
              clickX >= bounds.skyBanner.x &&
              clickX <= bounds.skyBanner.x + bounds.skyBanner.w &&
              clickY >= bounds.skyBanner.y &&
              clickY <= bounds.skyBanner.y + bounds.skyBanner.h
            ) {
              if (!openUrl(bounds.skyBanner.url)) {
                window.dispatchEvent(new CustomEvent('zt_open_sponsor_modal'));
              }
              return;
            }

            // 2. Sky Leaderboard Click
            if (
              bounds.skyLeaderboard &&
              clickX >= bounds.skyLeaderboard.x &&
              clickX <= bounds.skyLeaderboard.x + bounds.skyLeaderboard.w &&
              clickY >= bounds.skyLeaderboard.y &&
              clickY <= bounds.skyLeaderboard.y + bounds.skyLeaderboard.h
            ) {
              const item = bounds.skyLeaderboard.items.find(
                (it) => clickY >= it.y && clickY <= it.y + it.h
              );
              if (!openUrl(item?.url)) {
                window.dispatchEvent(new CustomEvent('zt_open_sponsor_modal'));
              }
              return;
            }

            // 3. Water Banner Click
            if (
              bounds.waterBanner &&
              clickX >= bounds.waterBanner.x &&
              clickX <= bounds.waterBanner.x + bounds.waterBanner.w &&
              clickY >= bounds.waterBanner.y &&
              clickY <= bounds.waterBanner.y + bounds.waterBanner.h
            ) {
              if (!openUrl(bounds.waterBanner.url)) {
                window.dispatchEvent(new CustomEvent('zt_open_sponsor_modal'));
              }
              return;
            }

            // 4. Click on Stacked Block with Sponsor
            const worldY = clickY - cameraYRef.current;
            for (const b of stackedBodiesRef.current) {
              if (Matter.Bounds.contains(b.bounds, { x: clickX, y: worldY })) {
                const bp = (b as unknown as { plugin?: { blueprint?: PieceBlueprint } }).plugin?.blueprint;
                if (bp) {
                  const sponsors = blockSponsorsRef.current;
                  if (sponsors.length > 0) {
                    const sp = sponsors[bp.sponsorSlot % sponsors.length];
                    const spUrl = sp?.websiteUrl || (sp?.tagline?.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s]*)/i)?.[0]);
                    if (openUrl(spUrl)) {
                      return;
                    }
                  }
                }
              }
            }
            // Check that click is above the balance beam (worldY <= raftBody.position.y - 12)
            const raft = raftBodyRef.current;
            if (raft && worldY > raft.position.y - 12) {
              // Click is below the balance beam; ignore drop
              return;
            }

            const clampedX = Math.max(32, Math.min(rect.width - 32, clickX));
            if (hoveringPieceRef.current) {
              hoveringPieceRef.current.x = clampedX;
            }
            dropPiece(clampedX);
            return;
          }

          dropPiece();
        }
      }}
      onPointerMove={(e) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect && hoveringPieceRef.current && !gameEndedRef.current) {
          const clampedX = Math.max(32, Math.min(rect.width - 32, e.clientX - rect.left));
          pointerXRef.current = clampedX;
          hoveringPieceRef.current.x = clampedX;
        }
      }}
      onPointerLeave={() => {
        pointerXRef.current = null;
      }}
      className="block w-full h-full touch-manipulation cursor-pointer"
    />
  );
});

GameCanvas.displayName = 'GameCanvas';
