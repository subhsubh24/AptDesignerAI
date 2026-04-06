// Color harmony scoring using CIEDE2000 Delta-E and HSL palette analysis

import { lookupColor, type HSL } from "./lookups";

export interface ColorHarmonyResult {
  palette_harmony: number; // 0-1
  cross_room_coherence: number; // 0-1
  per_item_color_fit: Map<string, number>; // category → 0-1 score for how well item's colors fit the palette
  pair_conflicts: Array<{
    color1: string;
    color2: string;
    deltaE: number;
    issue: string;
  }>;
}

// --- HSL → Lab conversion (via sRGB → XYZ → Lab) ---

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rl = linearize(r), gl = linearize(g), bl = linearize(b);
  return [
    0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl,
    0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl,
    0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl,
  ];
}

const D65_X = 0.95047, D65_Y = 1.0, D65_Z = 1.08883;

function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116;
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = f(x / D65_X), fy = f(y / D65_Y), fz = f(z / D65_Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function hslToLab(hsl: HSL): [number, number, number] {
  const [r, g, b] = hslToRgb(hsl.h, hsl.s, hsl.l);
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

// --- CIEDE2000 ---

function degrees(rad: number): number {
  return (rad * 180) / Math.PI;
}
function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function deltaE2000(
  lab1: [number, number, number],
  lab2: [number, number, number]
): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const Lbar = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const Cbarp = (C1p + C2p) / 2;

  let h1p = degrees(Math.atan2(b1, a1p));
  if (h1p < 0) h1p += 360;
  let h2p = degrees(Math.atan2(b2, a2p));
  if (h2p < 0) h2p += 360;

  let dhp: number;
  if (Math.abs(h1p - h2p) <= 180) dhp = h2p - h1p;
  else if (h2p <= h1p) dhp = h2p - h1p + 360;
  else dhp = h2p - h1p - 360;

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(radians(dhp / 2));
  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let Hbarp: number;
  if (C1p * C2p === 0) Hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) Hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) Hbarp = (h1p + h2p + 360) / 2;
  else Hbarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(radians(Hbarp - 30)) +
    0.24 * Math.cos(radians(2 * Hbarp)) +
    0.32 * Math.cos(radians(3 * Hbarp + 6)) -
    0.20 * Math.cos(radians(4 * Hbarp - 63));

  const Lbar50sq = (Lbar - 50) * (Lbar - 50);
  const SL = 1 + 0.015 * Lbar50sq / Math.sqrt(20 + Lbar50sq);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  const dTheta = 30 * Math.exp(-((Hbarp - 275) / 25) * ((Hbarp - 275) / 25));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const RT = -Math.sin(radians(2 * dTheta)) * RC;

  return Math.sqrt(
    (dLp / SL) ** 2 +
    (dCp / SC) ** 2 +
    (dHp / SH) ** 2 +
    RT * (dCp / SC) * (dHp / SH)
  );
}

// --- Color relationship classification ---

type ColorRelationship =
  | "monochromatic"
  | "analogous"
  | "complementary"
  | "split-complementary"
  | "triadic"
  | "neutral"
  | "unrelated";

function classifyPairRelationship(hsl1: HSL, hsl2: HSL): ColorRelationship {
  // If either is very low saturation, it's neutral pairing
  if (hsl1.s < 10 || hsl2.s < 10) return "neutral";

  const hueDiff = Math.abs(hsl1.h - hsl2.h);
  const hueAngle = Math.min(hueDiff, 360 - hueDiff);

  if (hueAngle < 10 && Math.abs(hsl1.s - hsl2.s) < 15) return "monochromatic";
  if (hueAngle < 30) return "analogous";
  if (hueAngle >= 150 && hueAngle <= 210) return "complementary";
  if (hueAngle >= 120 && hueAngle <= 150) return "split-complementary";
  if (hueAngle >= 100 && hueAngle <= 140) return "triadic";
  return "unrelated";
}

function classifyPaletteScheme(
  hsls: HSL[]
): { scheme: string; score: number } {
  const neutrals = hsls.filter((c) => c.s < 10);
  const lowSat = hsls.filter((c) => c.s >= 10 && c.s < 25);
  const chromatic = hsls.filter((c) => c.s >= 25);

  // All neutrals → great, very common in design
  if (chromatic.length === 0 && lowSat.length === 0) return { scheme: "neutral", score: 0.92 };

  // Neutral-dominant with muted tones (e.g., warm beige, greige, taupe) → very common
  if (chromatic.length === 0) return { scheme: "tonal", score: 0.93 };

  // Neutral-dominant with 1-2 accent colors — the most common interior design palette
  const neutralAndLowSat = neutrals.length + lowSat.length;
  if (chromatic.length <= 2 && neutralAndLowSat >= chromatic.length) {
    return { scheme: "neutral-accent", score: 0.94 };
  }

  // If only 1 chromatic color (rest are low-sat), that's a monochromatic accent
  if (chromatic.length === 1) return { scheme: "monochromatic-accent", score: 0.95 };

  // For chromatic-heavy palettes, analyze relationships
  const rels: Record<string, number> = {};
  for (let i = 0; i < chromatic.length; i++) {
    for (let j = i + 1; j < chromatic.length; j++) {
      const rel = classifyPairRelationship(chromatic[i], chromatic[j]);
      rels[rel] = (rels[rel] || 0) + 1;
    }
  }

  const totalPairs = (chromatic.length * (chromatic.length - 1)) / 2;
  const dominantRel = Object.entries(rels).sort((a, b) => b[1] - a[1])[0];

  if (!dominantRel) return { scheme: "mixed", score: 0.8 };

  const dominance = dominantRel[1] / totalPairs;

  // Interior-design-appropriate scoring: even "unrelated" chromatic colors
  // can work if the rest of the palette provides enough neutral grounding
  const neutralRatio = neutralAndLowSat / hsls.length;

  const schemeScores: Record<string, number> = {
    monochromatic: 0.95,
    analogous: 0.92,
    complementary: 0.88,
    "split-complementary": 0.85,
    triadic: 0.80,
    neutral: 0.90,
    // "unrelated" chromatic colors are okay if grounded by neutrals
    unrelated: 0.65 + neutralRatio * 0.2, // 0.65 to 0.85 depending on neutral grounding
  };

  const baseScore = schemeScores[dominantRel[0]] || 0.7;
  // Higher dominance = more coherent palette, but floor at 0.7 (not 0.5)
  const score = baseScore * (0.7 + 0.3 * dominance);

  return { scheme: dominantRel[0], score };
}

// --- Cross-room coherence ---

function computeCrossRoomCoherence(
  roomHsls: HSL[],
  otherRoomPalettes: HSL[][]
): number {
  if (otherRoomPalettes.length === 0) return 1.0; // No other rooms to compare

  const avgDistance = otherRoomPalettes.map((otherHsls) => {
    if (otherHsls.length === 0 || roomHsls.length === 0) return 0;
    // Average Delta-E between room palettes
    let totalDe = 0;
    let count = 0;
    for (const c1 of roomHsls) {
      for (const c2 of otherHsls) {
        totalDe += deltaE2000(hslToLab(c1), hslToLab(c2));
        count++;
      }
    }
    return totalDe / count;
  });

  const meanDist = avgDistance.reduce((a, b) => a + b, 0) / avgDistance.length;
  // Ideal cross-room distance: 15-40 Delta-E (related but not identical)
  // Too close (<10) = boring, too far (>60) = incoherent
  if (meanDist >= 15 && meanDist <= 40) return 1.0;
  if (meanDist < 15) return 0.7 + 0.3 * (meanDist / 15);
  if (meanDist <= 60) return 1.0 - 0.5 * ((meanDist - 40) / 20);
  return 0.5;
}

// --- Main export ---

export function computeColorHarmony(
  analysis: Record<string, unknown>,
  context: {
    otherRooms?: Array<{ palette?: string[]; materials?: string[] }>;
    // (l) Apartment-wide palette anchors derived from building finishes
    apartmentPaletteAnchors?: string[];
  }
): ColorHarmonyResult {
  // Extract palette from analysis
  const palette = (analysis.recommended_palette as string[]) || [];

  // Also extract color mentions from what_it_needs specs
  const whatItNeeds = (analysis.what_it_needs as Array<{ specs?: string; category?: string }>) || [];
  const specColors: string[] = [];
  for (const item of whatItNeeds) {
    if (item.specs) {
      // Try to find color names in specs
      const words = item.specs.toLowerCase().split(/[,;/\-\s]+/);
      for (let i = 0; i < words.length; i++) {
        // Try two-word combos first, then single
        if (i < words.length - 1) {
          const twoWord = `${words[i]} ${words[i + 1]}`;
          if (lookupColor(twoWord)) {
            specColors.push(twoWord);
            continue;
          }
        }
        if (lookupColor(words[i])) {
          specColors.push(words[i]);
        }
      }
    }
  }

  const allColors = [...new Set([...palette, ...specColors])];

  // Resolve to HSL
  const resolved: Array<{ name: string; hsl: HSL }> = [];
  for (const color of allColors) {
    const hsl = lookupColor(color);
    if (hsl) resolved.push({ name: color, hsl });
  }

  if (resolved.length === 0) {
    // Can't compute, return neutral
    return { palette_harmony: 0.5, cross_room_coherence: 1.0, per_item_color_fit: new Map(), pair_conflicts: [] };
  }

  // 1. Palette harmony score
  const { score: paletteScore } = classifyPaletteScheme(resolved.map((r) => r.hsl));

  // 2. Find pair conflicts (high Delta-E between adjacent colors)
  const pairConflicts: ColorHarmonyResult["pair_conflicts"] = [];
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const de = deltaE2000(hslToLab(resolved[i].hsl), hslToLab(resolved[j].hsl));
      const rel = classifyPairRelationship(resolved[i].hsl, resolved[j].hsl);
      // Flag high-contrast unrelated pairs
      if (rel === "unrelated" && de > 50) {
        pairConflicts.push({
          color1: resolved[i].name,
          color2: resolved[j].name,
          deltaE: Math.round(de * 10) / 10,
          issue: `Unrelated colors with high contrast (Delta-E=${Math.round(de)})`,
        });
      }
    }
  }

  // Penalize for conflicts
  const conflictPenalty = Math.min(pairConflicts.length * 0.1, 0.3);
  const finalPaletteHarmony = Math.max(0, paletteScore - conflictPenalty);

  // 3. Per-item color fit: measure how well each item's colors integrate with the palette
  const paletteHsls = resolved.map((r) => r.hsl);
  const perItemColorFit = new Map<string, number>();
  for (const item of whatItNeeds) {
    if (!item.specs || !item.category) continue;

    // Extract colors from this item's specs
    const itemColors: HSL[] = [];
    const words = item.specs.toLowerCase().split(/[,;/\-\s]+/);
    for (let i = 0; i < words.length; i++) {
      if (i < words.length - 1) {
        const twoWord = `${words[i]} ${words[i + 1]}`;
        const hsl = lookupColor(twoWord);
        if (hsl) { itemColors.push(hsl); continue; }
      }
      const hsl = lookupColor(words[i]);
      if (hsl) itemColors.push(hsl);
    }

    if (itemColors.length === 0) {
      // No colors detected in specs → can't penalize, assume it fits
      perItemColorFit.set(item.category, 0.95);
      continue;
    }

    // Measure average Delta-E between item colors and the palette
    let totalDe = 0;
    let count = 0;
    for (const itemHsl of itemColors) {
      const itemLab = hslToLab(itemHsl);
      // Find the closest palette color (min Delta-E)
      let minDe = Infinity;
      for (const palHsl of paletteHsls) {
        const de = deltaE2000(itemLab, hslToLab(palHsl));
        if (de < minDe) minDe = de;
      }
      totalDe += minDe;
      count++;
    }

    const avgMinDe = count > 0 ? totalDe / count : 0;
    // Delta-E interpretation for palette fit:
    // 0-5: excellent match (score 1.0)
    // 5-15: good match (0.85-1.0)
    // 15-30: acceptable accent (0.70-0.85)
    // 30-50: distant but may work (0.55-0.70)
    // 50+: clashing (0.40-0.55)
    let itemFit: number;
    if (avgMinDe <= 5) itemFit = 1.0;
    else if (avgMinDe <= 15) itemFit = 1.0 - 0.15 * ((avgMinDe - 5) / 10);
    else if (avgMinDe <= 30) itemFit = 0.85 - 0.15 * ((avgMinDe - 15) / 15);
    else if (avgMinDe <= 50) itemFit = 0.70 - 0.15 * ((avgMinDe - 30) / 20);
    else itemFit = Math.max(0.40, 0.55 - 0.01 * (avgMinDe - 50));

    perItemColorFit.set(item.category, Math.round(itemFit * 100) / 100);
  }

  // 3. Cross-room coherence
  // (l) Use apartment-wide palette anchors as baseline when available
  const otherRoomHsls: HSL[][] = [];

  // If apartment palette anchors exist (from building finishes), use them as the primary baseline
  if (context.apartmentPaletteAnchors?.length) {
    const anchorHsls: HSL[] = [];
    for (const c of context.apartmentPaletteAnchors) {
      const hsl = lookupColor(c);
      if (hsl) anchorHsls.push(hsl);
    }
    if (anchorHsls.length > 0) otherRoomHsls.push(anchorHsls);
  }

  if (context.otherRooms) {
    for (const room of context.otherRooms) {
      if (room.palette) {
        const roomResolved: HSL[] = [];
        for (const c of room.palette) {
          const hsl = lookupColor(c);
          if (hsl) roomResolved.push(hsl);
        }
        if (roomResolved.length > 0) otherRoomHsls.push(roomResolved);
      }
    }
  }

  const crossRoomCoherence = computeCrossRoomCoherence(
    resolved.map((r) => r.hsl),
    otherRoomHsls
  );

  return {
    palette_harmony: Math.round(finalPaletteHarmony * 100) / 100,
    cross_room_coherence: Math.round(crossRoomCoherence * 100) / 100,
    per_item_color_fit: perItemColorFit,
    pair_conflicts: pairConflicts,
  };
}
