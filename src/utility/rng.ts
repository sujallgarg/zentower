import { DailySeedInfo, PieceBlueprint } from '../types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDailySeedInfo(): DailySeedInfo {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const epochStart = Date.UTC(2025, 0, 1);
  const dayNumber = Math.max(1, Math.floor((utcMidnight - epochStart) / 86400000) + 1);
  const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  let hash = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    hash ^= dateStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return { dayNumber, dateStr, seed: hash >>> 0 };
}

/**
 * Genuine Skill-Based Onboarding & 3-Tier Escalating Tension Curve
 * Strict Newtonian Physics (No fake magnets, no invisible angular clamping, no fake gravity):
 * - Piece 0 (1st block): Extra-wide foundation plank (w: 132, h: 22, friction: 0.96, restitution: 0.0)
 * - Pieces 1–4 (2nd–5th blocks): Wide, low-center-of-gravity rectangular timber blocks (w: 90–116, h: 22–26, friction: 0.94, restitution: 0.01)
 * - Pieces 5–12 (6th–13th blocks): Tactical counter-balance (compound L-hooks, trapezoids, wedges)
 * - Pieces 13–19+ (14th–20th+ blocks): Climax & mastery (heavy river boulders density 0.0042, tall pillars, translucent ice slabs friction 0.14)
 */
export function generatePieceBlueprint(index: number, rng: () => number, sponsorCount: number = 3): PieceBlueprint {
  const r = rng();
  const sponsorSlot = index % Math.max(1, sponsorCount);

  if (index < 5) {
    // Pieces 1–5: Randomized varied early blocks (wide planks, low-CoG timbers, gentle trapezoids, wedges)
    const earlyPresets: Omit<PieceBlueprint, 'sponsorSlot'>[] = [
      { shape: 'rect', w: 132, h: 22, material: 'wood', paletteIdx: 0, friction: 0.96, restitution: 0.0, density: 0.0022 },
      { shape: 'rect', w: 116, h: 24, material: 'wood', paletteIdx: 1, friction: 0.94, restitution: 0.01, density: 0.002 },
      { shape: 'rect', w: 106, h: 26, material: 'wood', paletteIdx: 2, friction: 0.94, restitution: 0.01, density: 0.002 },
      { shape: 'rect', w: 98, h: 22, material: 'wood', paletteIdx: 0, friction: 0.94, restitution: 0.01, density: 0.0019 },
      { shape: 'rect', w: 90, h: 26, material: 'wood', paletteIdx: 3, friction: 0.94, restitution: 0.01, density: 0.0021 },
      { shape: 'trapezoid', w: 104, h: 24, slope: 0.2, material: 'wood', paletteIdx: 1, friction: 0.92, restitution: 0.01, density: 0.002 },
      { shape: 'wedge', w: 86, h: 26, material: 'wood', paletteIdx: 2, friction: 0.92, restitution: 0.01, density: 0.002 },
      { shape: 'rect', w: 124, h: 20, material: 'wood', paletteIdx: 0, friction: 0.95, restitution: 0.0, density: 0.0021 },
    ];
    const chosen = earlyPresets[Math.floor(r * earlyPresets.length)];
    return { ...chosen, sponsorSlot };
  } else if (index < 13) {
    // Pieces 6–13: Tactical Tension (Compound L-hooks, keystone trapezoids, wedges)
    const tacticalPresets: Omit<PieceBlueprint, 'sponsorSlot'>[] = [
      { shape: 'compoundL', w: 76, h: 64, material: 'wood', paletteIdx: 1, friction: 0.82, density: 0.0021 },
      { shape: 'trapezoid', w: 88, h: 28, slope: 0.28, material: 'wood', paletteIdx: 2, friction: 0.8, density: 0.002 },
      { shape: 'wedge', w: 68, h: 36, material: 'wood', paletteIdx: 0, friction: 0.78, density: 0.002 },
      { shape: 'rect', w: 124, h: 18, material: 'wood', paletteIdx: 3, friction: 0.84, density: 0.0018 },
      { shape: 'compoundL', w: 82, h: 58, material: 'wood', paletteIdx: 2, friction: 0.8, density: 0.0022 },
    ];
    const chosen = tacticalPresets[Math.floor(r * tacticalPresets.length)];
    return { ...chosen, sponsorSlot };
  } else {
    // Pieces 14–20+: Climax (Heavy granite boulders, tall narrow pillars, translucent ice slabs)
    const climaxPresets: Omit<PieceBlueprint, 'sponsorSlot'>[] = [
      { shape: 'circle', r: 24, material: 'stone', paletteIdx: 4, friction: 0.72, density: 0.0042 }, // heavy stone
      { shape: 'rect', w: 24, h: 84, material: 'wood', paletteIdx: 1, friction: 0.8, density: 0.0022 },   // tall narrow pillar
      { shape: 'rect', w: 94, h: 22, material: 'ice', paletteIdx: 5, friction: 0.14, density: 0.0026 },   // low-friction ice slab
      { shape: 'compoundL', w: 80, h: 68, material: 'stone', paletteIdx: 4, friction: 0.75, density: 0.0034 },
    ];
    const chosen = climaxPresets[Math.floor(r * climaxPresets.length)];
    return { ...chosen, sponsorSlot };
  }
}
