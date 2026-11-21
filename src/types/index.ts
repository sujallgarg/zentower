export type GameMode = 'daily' | 'endless';

export type ThemeKey = 'oak' | 'kyoto' | 'obsidian';

export type MaterialType = 'wood' | 'stone' | 'ice';

export type PieceShape = 'rect' | 'compoundL' | 'trapezoid' | 'wedge' | 'circle';

export interface PieceBlueprint {
  shape: PieceShape;
  w?: number;
  h?: number;
  r?: number;
  slope?: number;
  material: MaterialType;
  paletteIdx: number;
  friction: number;
  density: number;
  restitution?: number;
  sponsorSlot: number;
}

export interface HoveringPiece {
  blueprint: PieceBlueprint;
  x: number;
  phase: number;
  angle: number;
  targetAngle: number;
}

export interface Sponsor {
  id: string;
  name: string;
  tagline: string;
  bid: number; // USD per day
  color: string;
  symbol: string;
  imageDataUrl: string | null;
  websiteUrl?: string | null;
}

export interface LeaderboardEntry {
  playerId: string;
  tag: string;
  xHandle: string;
  mode: GameMode;
  height: number;
  balanced: number;
}

export interface PlayerProfile {
  playerId: string;
  nickname: string;
  xHandle: string;
  bestDailyHeight: number;
  bestEndlessHeight: number;
  streak: number;
  lastCompletedDay: number;
  theme: ThemeKey;
}

export interface DailySeedInfo {
  dayNumber: number;
  dateStr: string;
  seed: number;
}

export interface ThemeColors {
  name: string;
  skyTop: string;
  skyBottom: string;
  sunColor: string;
  waterBack: string;
  waterFront: string;
  raftFill: string;
  raftStroke: string;
  guideLine: string;
  darkUi: boolean;
  palette: Array<{ fill: string; stroke: string }>;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  color: string;
}

export interface Raindrop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

export interface RunSummary {
  won: boolean;
  balancedCount: number;
  peakHeightMeters: number;
  maxTiltDegrees: number;
  isNewHighScore: boolean;
  mode: GameMode;
  dayNumber: number;
}
