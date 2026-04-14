// Structured distance metrics between two `DesignDirection` objects.
//
// Today every agent that needs cross-room coherence builds a prose string of
// "other rooms" and lets the LLM compare directions in-token. That's expensive,
// non-deterministic, and doesn't surface as numeric evidence. This module
// computes:
//
//   - palette_distance:  mean Delta-E across mutually nearest palette colors
//   - material_distance: Euclidean distance over the MaterialProperties vector
//                        (warmth/roughness/sheen/weight), averaged
//   - style_distance:    1 - Jaccard of significant style tokens from style_notes
//                        + recommended_textures + recommended_furniture_types
//   - overall:           weighted blend, normalized to 0-1 (0 = identical, 1 = far)
//
// Plus a `compatibility_score` that inverts distance and clamps — usable as
// a direct cross-room harmony contribution.

import { lookupColor, lookupMaterial, type MaterialProperties } from "./lookups";
import { deltaE2000, hslToLab } from "./color-math";
import type { DesignDirection } from "@/lib/types/database";

export interface DirectionDistance {
  /** 0 = identical, 1 = maximally distant. */
  overall: number;
  /** Normalized 0-1 per axis. */
  palette_distance: number;
  material_distance: number;
  style_distance: number;
  /** Raw metric values for transparency. */
  raw: {
    palette_mean_deltaE: number;
    material_mean_euclidean: number;
    style_jaccard: number; // 0-1, higher = more overlap
  };
  /** 1 - overall, clipped to [0,1]. Plug directly into cross_room_fit. */
  compatibility_score: number;
  /** Surfaced issues — "palette is ~40 ΔE away from living room". */
  issues: string[];
}

// Weights — palette is the loudest visual signal, style notes the softest.
const WEIGHTS = {
  palette: 0.50,
  material: 0.35,
  style: 0.15,
};

// Normalize raw metrics to 0-1 "distance" scale.
//   palette: Delta-E 0=identical, 30+=very different. Map 0..30 → 0..1.
//   material: property vector distance. 0..1 typical range → 0..1.
//   style: Jaccard similarity → 1 - J = distance.
function normalizePalette(deltaE: number): number {
  return Math.max(0, Math.min(1, deltaE / 30));
}
function normalizeMaterial(euclidean: number): number {
  return Math.max(0, Math.min(1, euclidean / 1.2));
}

function compareColorLists(a: string[], b: string[]): number {
  const aLab: Array<[number, number, number]> = [];
  const bLab: Array<[number, number, number]> = [];
  for (const name of a) {
    const hsl = lookupColor(name);
    if (hsl) aLab.push(hslToLab(hsl));
  }
  for (const name of b) {
    const hsl = lookupColor(name);
    if (hsl) bLab.push(hslToLab(hsl));
  }
  if (aLab.length === 0 || bLab.length === 0) return 15; // neutral fallback

  // For each color in A, find nearest in B — and vice versa. Use symmetric mean.
  const minDe = (src: Array<[number, number, number]>, tgt: Array<[number, number, number]>): number => {
    let sum = 0;
    for (const s of src) {
      let best = Infinity;
      for (const t of tgt) {
        const de = deltaE2000(s, t);
        if (de < best) best = de;
      }
      sum += best;
    }
    return sum / src.length;
  };
  return (minDe(aLab, bLab) + minDe(bLab, aLab)) / 2;
}

function compareMaterialLists(a: string[], b: string[]): number {
  const aProps: MaterialProperties[] = [];
  const bProps: MaterialProperties[] = [];
  for (const name of a) {
    const p = lookupMaterial(name);
    if (p) aProps.push(p);
  }
  for (const name of b) {
    const p = lookupMaterial(name);
    if (p) bProps.push(p);
  }
  if (aProps.length === 0 || bProps.length === 0) return 0.5; // neutral fallback

  // Average per axis, then compute Euclidean between averages.
  const avg = (xs: MaterialProperties[]): MaterialProperties => {
    const out = { warmth: 0, roughness: 0, sheen: 0, weight: 0 };
    for (const p of xs) {
      out.warmth += p.warmth; out.roughness += p.roughness;
      out.sheen += p.sheen; out.weight += p.weight;
    }
    return {
      warmth: out.warmth / xs.length,
      roughness: out.roughness / xs.length,
      sheen: out.sheen / xs.length,
      weight: out.weight / xs.length,
    };
  };
  const ca = avg(aProps);
  const cb = avg(bProps);
  return Math.sqrt(
    (ca.warmth - cb.warmth) ** 2 +
    (ca.roughness - cb.roughness) ** 2 +
    (ca.sheen - cb.sheen) ** 2 +
    (ca.weight - cb.weight) ** 2,
  );
}

// Style tokens: strip stopwords, keep meaningful adjectives/nouns.
const STYLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "with", "to", "in", "for", "on",
  "room", "space", "piece", "pieces", "item", "items", "very", "really",
  "quite", "some", "any", "this", "that", "these", "those", "is", "be",
  "should", "would", "could", "feel", "feels", "look", "looks", "have",
  "has", "are", "use", "using", "design", "style", "aesthetic",
]);

function tokenizeStyle(dir: DesignDirection): Set<string> {
  const text = [
    dir.style_notes || "",
    ...(dir.recommended_textures || []),
    ...(dir.recommended_furniture_types || []).map((t) =>
      typeof t === "string" ? t : (t as { type?: string }).type ?? "",
    ),
  ]
    .join(" ")
    .toLowerCase();

  const tokens = text.match(/\b[a-z][a-z-]{2,}\b/g) || [];
  const out = new Set<string>();
  for (const t of tokens) {
    if (STYLE_STOPWORDS.has(t)) continue;
    // Strip plural "s" for better match
    const stem = t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t;
    out.add(stem);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = new Set<string>();
  for (const x of a) if (b.has(x)) inter.add(x);
  const union = new Set<string>([...a, ...b]);
  return inter.size / union.size;
}

// ─── Main export ───────────────────────────────────────────────────────

export function compareDesignDirections(
  a: DesignDirection | undefined | null,
  b: DesignDirection | undefined | null,
): DirectionDistance {
  if (!a || !b) {
    // Neutral fallback when either side is missing — no signal.
    return {
      overall: 0.5,
      palette_distance: 0.5,
      material_distance: 0.5,
      style_distance: 0.5,
      raw: { palette_mean_deltaE: 15, material_mean_euclidean: 0.5, style_jaccard: 0.0 },
      compatibility_score: 0.5,
      issues: ["Insufficient data: one of the design directions is missing"],
    };
  }

  const paletteDe = compareColorLists(a.recommended_palette || [], b.recommended_palette || []);
  const materialEu = compareMaterialLists(a.recommended_materials || [], b.recommended_materials || []);
  const styleJ = jaccard(tokenizeStyle(a), tokenizeStyle(b));

  const paletteDist = normalizePalette(paletteDe);
  const materialDist = normalizeMaterial(materialEu);
  const styleDist = 1 - styleJ;

  const overall =
    WEIGHTS.palette * paletteDist +
    WEIGHTS.material * materialDist +
    WEIGHTS.style * styleDist;

  const compatibility = Math.max(0, Math.min(1, 1 - overall));

  const issues: string[] = [];
  if (paletteDe > 25) {
    issues.push(`Palettes diverge significantly (ΔE≈${Math.round(paletteDe)}) — cross-room colors won't read as one apartment`);
  } else if (paletteDe > 15) {
    issues.push(`Palettes are moderately distant (ΔE≈${Math.round(paletteDe)}) — consider pulling an accent color across`);
  }
  if (materialEu > 0.6) {
    issues.push(`Material vibes diverge (Euclidean=${materialEu.toFixed(2)}) — warmth/sheen/roughness mismatch`);
  }
  if (styleJ < 0.10 && (a.style_notes || b.style_notes)) {
    issues.push(`Style vocabularies barely overlap (Jaccard=${styleJ.toFixed(2)}) — directions feel like different houses`);
  }

  return {
    overall: round2(overall),
    palette_distance: round2(paletteDist),
    material_distance: round2(materialDist),
    style_distance: round2(styleDist),
    raw: {
      palette_mean_deltaE: round2(paletteDe),
      material_mean_euclidean: round2(materialEu),
      style_jaccard: round2(styleJ),
    },
    compatibility_score: round2(compatibility),
    issues,
  };
}

/** Compute the mean compatibility of a room's direction against every sibling room. */
export function computeApartmentCoherence(
  thisDirection: DesignDirection | undefined | null,
  siblingDirections: Array<{ name?: string; direction?: DesignDirection | null } | null | undefined>,
): {
  mean_compatibility: number;
  per_room: Array<{ name?: string; distance: DirectionDistance }>;
} {
  const perRoom: Array<{ name?: string; distance: DirectionDistance }> = [];
  for (const s of siblingDirections) {
    if (!s || !s.direction) continue;
    perRoom.push({
      name: s.name,
      distance: compareDesignDirections(thisDirection, s.direction),
    });
  }
  const mean =
    perRoom.length > 0
      ? perRoom.reduce((sum, p) => sum + p.distance.compatibility_score, 0) / perRoom.length
      : 0.7; // neutral when nothing to compare
  return { mean_compatibility: round2(mean), per_room: perRoom };
}

export function formatDirectionDistanceForPrompt(d: DirectionDistance, otherName?: string): string {
  const lines: string[] = [];
  const label = otherName ? ` vs ${otherName}` : "";
  lines.push(`### Direction compatibility${label}: ${d.compatibility_score.toFixed(2)}/1.0`);
  lines.push(
    `- Palette ΔE=${d.raw.palette_mean_deltaE.toFixed(1)} | material Euclid=${d.raw.material_mean_euclidean.toFixed(2)} | style Jaccard=${d.raw.style_jaccard.toFixed(2)}`,
  );
  for (const issue of d.issues) lines.push(`- ${issue}`);
  return lines.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
