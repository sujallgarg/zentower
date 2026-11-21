import { GameMode, Sponsor } from '../types';

export function buildShareSummaryText(
  mode: GameMode,
  dayNumber: number,
  balancedCount: number,
  won: boolean,
  peakHeightMeters: number,
  maxTiltDegrees: number,
  topSponsor?: Sponsor | null
): string {
  const DAILY_TARGET = 20;
  const count = won ? DAILY_TARGET : balancedCount;
  const totalBlocks = mode === 'daily' ? DAILY_TARGET : Math.max(count, 10);
  const filledSquares = Math.round((count / totalBlocks) * 10);
  const bar = '🟫'.repeat(Math.min(10, filledSquares)) + '⬜'.repeat(Math.max(0, 10 - filledSquares));

  const header =
    mode === 'daily'
      ? `ZEN TOWERS #${dayNumber} — ${count}/${DAILY_TARGET} Balanced`
      : `ZEN TOWERS (Endless) — ${count} Blocks`;

  const canonicalOrigin = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'https://zentower.app');
  const cleanOrigin = canonicalOrigin.replace(/\/+$/, '');
  const shareUrl = `${cleanOrigin}?c=${dayNumber}&h=${peakHeightMeters.toFixed(1)}`;
  const sponsorLine = topSponsor ? `\n🏛️ Sponsored by ${topSponsor.name}` : '';

  return `${header}\n${bar}\n📏 Height: ${peakHeightMeters.toFixed(1)}m | ⚖️ Max Tilt: ${maxTiltDegrees.toFixed(1)}°${sponsorLine}\nPlay free & beat my tower: ${shareUrl}`;
}

export function openShareOnX(text: string): void {
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(intentUrl, '_blank', 'noopener,noreferrer');
}
