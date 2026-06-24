// Saturation-aware running-total tracker for the greedy design expansion loop.
//
// Operates on ActionItem[] (categories + text descriptions) — not products —
// since expansion runs before product search.  Each addition updates a
// SaturationProfile; wouldExceedHardCap() is the math guardrail that prevents
// obvious over-decoration before the LLM even weighs in.
//
// All hard caps are multiplied by a direction_modifier so Bohemian rooms fill
// more than Minimalist ones.

import type { ActionItem, DesignDirection } from "@/lib/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SaturationDimension {
  current: number;
  soft_cap: number;  // LLM sees warning label in prompt
  hard_cap: number;  // guardrail rejects new additions
}

export interface SaturationProfile {
  room_sqft: number;
  direction_modifier: number;        // 0.65 (minimalist) → 1.5 (maximalist)
  total_items: SaturationDimension;
  small_decor_count: SaturationDimension;  // candles, books, objects, trays, vases
  focal_points: SaturationDimension;       // large art, tall plants, sculptures, mirrors
  color_carriers: SaturationDimension;     // items that introduce accent hue
  texture_items: SaturationDimension;      // boucle, rattan, shag, woven, etc.
  per_category: Record<string, SaturationDimension>;
}

export interface CapViolation {
  dimension: string;
  reason: string;
}

// ─── Category classification ─────────────────────────────────────────────────

export const SMALL_DECOR_CATEGORIES = new Set([
  "candles", "candle", "books", "books_styled", "book_display", "tray", "tray_styling",
  "vase", "decorative_objects", "decorative_object", "baskets", "basket", "frames",
  "frame", "photo_display", "decorative_bowls", "decorative_bowl", "greenery_small",
  "succulent", "desk_accessories", "tabletop_decor", "figurine", "sculpture_small",
]);

export const FOCAL_CATEGORIES = new Set([
  "wall_art", "wall_art_large", "sculpture", "sculpture_large", "tall_plant",
  "greenery_tall", "statement_mirror", "mirror", "pendant_light", "chandelier",
  "large_artwork", "gallery_wall", "mural",
]);

export const COLOR_CARRIER_CATEGORIES = new Set([
  "throw_pillows", "throw_pillow", "accent_chair", "area_rug", "curtains", "drapes",
  "wall_art", "throw_blanket", "bedding", "duvet", "pouf", "floor_cushion",
  "upholstered_bench", "ottomans_as_decor",
]);

export const TEXTURE_CATEGORIES = new Set([
  "boucle_chair", "rattan_basket", "shag_rug", "woven_throw", "jute_rug",
  "rattan_chair", "woven_pendant", "boucle_sofa", "bouclé", "wicker",
  "macrame", "sisal_rug", "linen_curtains", "velvet_pillow", "chunky_knit",
]);

// Per-category hard cap base values (before sqft scaling and direction modifier)
// Format: [divisor_for_sqft_scaling, absolute_max]
// final hard_cap = min(floor(sqft / divisor), absolute_max) × direction_modifier
const CATEGORY_CAP_BASES: Record<string, [number, number]> = {
  plant:               [60,  8],
  plants:              [60,  8],
  greenery_small:      [80,  6],
  greenery_tall:       [120, 3],
  wall_art:            [50,  8],
  frames:              [60,  6],
  photo_display:       [60,  6],
  candles:             [70,  6],
  candle:              [70,  6],
  books:               [30, 12],
  books_styled:        [30, 12],
  book_display:        [30, 12],
  throw_pillows:       [80,  8],
  throw_pillow:        [80,  8],
  decorative_objects:  [35, 10],
  decorative_object:   [35, 10],
  baskets:             [100, 4],
  basket:              [100, 4],
  vase:                [80,  6],
  tray:                [90,  4],
  tray_styling:        [90,  4],
  sculptures:          [90,  5],
  sculpture:           [90,  5],
  pouf:                [120, 3],
  floor_cushion:       [120, 3],
  throw_blanket:       [120, 3],
};

const DEFAULT_CATEGORY_CAP: [number, number] = [150, 2]; // unknown category — generous default

// ─── Direction modifier ───────────────────────────────────────────────────────

// Intentionally broad keyword matching — design directions are free text strings
const DIRECTION_MODIFIERS: Array<[RegExp, number]> = [
  [/maximalist/i,          1.5],
  [/bohemian|boho/i,       1.45],
  [/eclectic/i,            1.4],
  [/traditional/i,         1.3],
  [/art.?deco/i,           1.25],
  [/hollywood.?regency/i,  1.3],
  [/coastal/i,             1.2],
  [/farmhouse/i,           1.15],
  [/rustic/i,              1.15],
  [/contemporary/i,        1.0],
  [/modern/i,              1.0],
  [/transitional/i,        1.0],
  [/mid.?century/i,        0.9],
  [/industrial/i,          0.9],
  [/minimalist/i,          0.7],
  [/japandi/i,             0.65],
  [/scandinavian|scandi/i, 0.7],
  [/wabi.?sabi/i,          0.75],
];

export function computeDirectionModifier(direction: DesignDirection | string | null | undefined): number {
  if (!direction) return 1.0;
  const text = typeof direction === "string"
    ? direction
    : [
        (direction as { style?: string }).style ?? "",
        (direction as { style_notes?: string }).style_notes ?? "",
      ].join(" ");

  for (const [pattern, modifier] of DIRECTION_MODIFIERS) {
    if (pattern.test(text)) return modifier;
  }
  return 1.0;
}

// ─── Cap computation helpers ─────────────────────────────────────────────────

function computeCategoryHardCap(category: string, sqft: number, modifier: number): number {
  const norm = category.toLowerCase().replace(/[\s-]+/g, "_");
  const base = CATEGORY_CAP_BASES[norm] ?? DEFAULT_CATEGORY_CAP;
  const sqftScaled = Math.floor(sqft / base[0]);
  const capped = Math.min(sqftScaled, base[1]);
  return Math.max(1, Math.round(capped * modifier));
}

function normalizeCat(c: string): string {
  return c.toLowerCase().replace(/[\s-]+/g, "_");
}

function isSmallDecor(category: string): boolean {
  return SMALL_DECOR_CATEGORIES.has(normalizeCat(category));
}

function isFocal(category: string): boolean {
  return FOCAL_CATEGORIES.has(normalizeCat(category));
}

function isColorCarrier(category: string): boolean {
  return COLOR_CARRIER_CATEGORIES.has(normalizeCat(category));
}

function isTextureItem(category: string, action?: string): boolean {
  if (TEXTURE_CATEGORIES.has(normalizeCat(category))) return true;
  if (action) {
    return /\b(boucle|bouclé|rattan|woven|shag|jute|sisal|macrame|velvet|linen|chunky.?knit|wicker)\b/i.test(action);
  }
  return false;
}

// ─── Adaptive cap derivation ─────────────────────────────────────────────────
//
// Hard-coded caps are heuristic. These functions let callers adjust the
// modifier and per-category ceilings from real signals — Pass A's density
// observation, user preferences inferred from sibling rooms, and explicit
// user priorities. The goal is to keep the guardrail honest without
// over-fitting to any single input.

/** Signals that can tighten or loosen the saturation caps for a room. */
export interface AdaptiveCapContext {
  /**
   * Pass A's read of the room as-is. "busy" or "cluttered" photos mean the
   * room already holds many objects — we should tighten to avoid doubling
   * the clutter. "sparse" rooms can absorb more additions.
   */
  currentRoomDensity?: "sparse" | "balanced" | "busy" | "cluttered";
  /**
   * User's inferred intensity leaning across prior rooms in this apartment
   * (from `infer-preferences`). Independent of design direction — a user
   * may have chosen a "modern" style but consistently over- or under-decorated.
   */
  userDensityPreference?: "minimalist" | "balanced" | "maximalist" | "unknown";
  /** User-stated priority list ("minimalist", "storage", etc.). */
  priorities?: string[];
  /** Free-form intensity hints extracted from design direction style_notes. */
  styleNotes?: string;
  /** Categories the user consistently cares about (from sibling rooms). */
  userPreferredCategories?: string[];
}

/** Net multiplier to apply on top of the direction modifier. Clamped to 0.5..1.6. */
export function computeAdaptiveMultiplier(ctx: AdaptiveCapContext | undefined): number {
  if (!ctx) return 1.0;
  let mult = 1.0;

  // Current room density: if photos already look busy, scale back.
  switch (ctx.currentRoomDensity) {
    case "sparse": mult *= 1.15; break;
    case "busy": mult *= 0.85; break;
    case "cluttered": mult *= 0.7; break;
    // "balanced" and undefined — no change
  }

  // User's historical density tendency — secondary signal.
  switch (ctx.userDensityPreference) {
    case "minimalist": mult *= 0.85; break;
    case "maximalist": mult *= 1.15; break;
    // "balanced" / "unknown" — no change
  }

  // Explicit user priorities.
  const priorityText = (ctx.priorities ?? []).join(" ").toLowerCase();
  const styleText = (ctx.styleNotes ?? "").toLowerCase();
  const combined = `${priorityText} ${styleText}`;
  if (/\bminimal(ist)?\b|\bdeclutter\b|\bpared[- ]?down\b/.test(combined)) mult *= 0.9;
  if (/\bmaximal(ist)?\b|\blayered\b|\babundant\b|\bcollect(ed)?\b/.test(combined)) mult *= 1.1;

  return Math.max(0.5, Math.min(1.6, mult));
}

/**
 * Bump per-category hard caps for categories the user repeatedly uses in prior
 * rooms. Soft signal: we nudge by +1 (cap still respects absolute max).
 */
function applyPreferredCategoryBoost(
  perCat: Record<string, SaturationDimension>,
  preferredCategories: string[] | undefined,
  sqft: number,
  modifier: number,
): Record<string, SaturationDimension> {
  if (!preferredCategories?.length) return perCat;
  const out = { ...perCat };
  for (const rawCat of preferredCategories) {
    const cat = normalizeCat(rawCat);
    const base = CATEGORY_CAP_BASES[cat] ?? DEFAULT_CATEGORY_CAP;
    const absoluteMax = base[1];
    const existing = out[cat];
    if (existing) {
      const bumped = Math.min(existing.hard_cap + 1, Math.round(absoluteMax * modifier));
      out[cat] = {
        ...existing,
        hard_cap: bumped,
        soft_cap: Math.max(1, Math.round(bumped * 0.7)),
      };
    } else {
      const baseCap = computeCategoryHardCap(cat, sqft, modifier);
      const bumped = Math.min(baseCap + 1, Math.round(absoluteMax * modifier));
      out[cat] = {
        current: 0,
        soft_cap: Math.max(1, Math.round(bumped * 0.7)),
        hard_cap: bumped,
      };
    }
  }
  return out;
}

// ─── Initialization ───────────────────────────────────────────────────────────

export function initializeSaturation(
  items: ActionItem[],
  room: { type?: string; sqft?: number },
  direction: DesignDirection | string | null | undefined,
  adaptive?: AdaptiveCapContext,
): SaturationProfile {
  const sqft = room.sqft ?? 250; // default assumption: 250 sqft if unknown
  const directionModifier = computeDirectionModifier(direction);
  const adaptiveMult = computeAdaptiveMultiplier(adaptive);
  const modifier = Math.max(0.4, Math.min(1.8, directionModifier * adaptiveMult));

  // Global dimension caps
  const totalHardCap = Math.round(Math.min(Math.floor(sqft / 10) + 5, 40) * modifier);
  const totalSoftCap = Math.round(totalHardCap * 0.75);

  const smallDecorHardCap = Math.round(Math.min(Math.floor(sqft / 22), 16) * modifier);
  const focalHardCap = 3; // rooms have one focal wall — constant regardless of direction

  const colorCarrierHardCap = Math.round(Math.min(Math.floor(sqft / 40), 10) * modifier);
  const textureHardCap = Math.round(Math.min(Math.floor(sqft / 50), 8) * modifier);

  // Seed per-category from existing items
  const seededPerCat: Record<string, SaturationDimension> = {};
  for (const item of items) {
    const cat = normalizeCat(item.category);
    if (!seededPerCat[cat]) {
      seededPerCat[cat] = {
        current: 0,
        soft_cap: Math.max(1, Math.round(computeCategoryHardCap(cat, sqft, modifier) * 0.7)),
        hard_cap: computeCategoryHardCap(cat, sqft, modifier),
      };
    }
    seededPerCat[cat].current += 1;
  }

  // Adaptive: bump caps for categories the user consistently cares about
  const perCat = applyPreferredCategoryBoost(
    seededPerCat,
    adaptive?.userPreferredCategories,
    sqft,
    modifier,
  );

  // Seed global dimensions from existing items
  const totalCurrent = items.length;
  const smallDecorCurrent = items.filter(i => isSmallDecor(i.category)).length;
  const focalCurrent = items.filter(i => isFocal(i.category)).length;
  const colorCurrent = items.filter(i => isColorCarrier(i.category)).length;
  const textureCurrent = items.filter(i => isTextureItem(i.category, i.action)).length;

  return {
    room_sqft: sqft,
    direction_modifier: modifier,
    total_items: {
      current: totalCurrent,
      soft_cap: totalSoftCap,
      hard_cap: totalHardCap,
    },
    small_decor_count: {
      current: smallDecorCurrent,
      soft_cap: Math.round(smallDecorHardCap * 0.7),
      hard_cap: smallDecorHardCap,
    },
    focal_points: {
      current: focalCurrent,
      soft_cap: 2,
      hard_cap: focalHardCap,
    },
    color_carriers: {
      current: colorCurrent,
      soft_cap: Math.round(colorCarrierHardCap * 0.7),
      hard_cap: colorCarrierHardCap,
    },
    texture_items: {
      current: textureCurrent,
      soft_cap: Math.round(textureHardCap * 0.7),
      hard_cap: Math.max(1, textureHardCap),
    },
    per_category: perCat,
  };
}

// ─── Update ───────────────────────────────────────────────────────────────────

/** Pure update — returns a new SaturationProfile with the new item counted. */
export function updateSaturation(profile: SaturationProfile, item: ActionItem): SaturationProfile {
  const cat = normalizeCat(item.category);
  const sqft = profile.room_sqft;
  const modifier = profile.direction_modifier;

  const updatedPerCat = { ...profile.per_category };
  if (!updatedPerCat[cat]) {
    updatedPerCat[cat] = {
      current: 0,
      soft_cap: Math.max(1, Math.round(computeCategoryHardCap(cat, sqft, modifier) * 0.7)),
      hard_cap: computeCategoryHardCap(cat, sqft, modifier),
    };
  }
  updatedPerCat[cat] = { ...updatedPerCat[cat], current: updatedPerCat[cat].current + 1 };

  return {
    ...profile,
    total_items: { ...profile.total_items, current: profile.total_items.current + 1 },
    small_decor_count: {
      ...profile.small_decor_count,
      current: profile.small_decor_count.current + (isSmallDecor(item.category) ? 1 : 0),
    },
    focal_points: {
      ...profile.focal_points,
      current: profile.focal_points.current + (isFocal(item.category) ? 1 : 0),
    },
    color_carriers: {
      ...profile.color_carriers,
      current: profile.color_carriers.current + (isColorCarrier(item.category) ? 1 : 0),
    },
    texture_items: {
      ...profile.texture_items,
      current: profile.texture_items.current + (isTextureItem(item.category, item.action) ? 1 : 0),
    },
    per_category: updatedPerCat,
  };
}

// ─── Guardrail ────────────────────────────────────────────────────────────────

/** Returns null if the item can be added, or a human-readable reason if blocked. */
export function wouldExceedHardCap(
  profile: SaturationProfile,
  candidate: { category: string; action?: string },
): string | null {
  const cat = normalizeCat(candidate.category);

  // Total cap
  if (profile.total_items.current >= profile.total_items.hard_cap) {
    return `Room is at maximum decoration density (${profile.total_items.current}/${profile.total_items.hard_cap} items for this direction and room size)`;
  }

  // Per-category cap
  const catDim = profile.per_category[cat];
  if (catDim && catDim.current >= catDim.hard_cap) {
    return `Category "${cat}" is at its maximum (${catDim.current}/${catDim.hard_cap} items)`;
  }

  // Focal points cap — hard ceiling regardless of direction
  if (isFocal(candidate.category) && profile.focal_points.current >= profile.focal_points.hard_cap) {
    return `Room already has ${profile.focal_points.current} focal/statement pieces — adding more divides attention and creates visual chaos`;
  }

  // Small decor cap
  if (isSmallDecor(candidate.category) && profile.small_decor_count.current >= profile.small_decor_count.hard_cap) {
    return `Small decor items at capacity (${profile.small_decor_count.current}/${profile.small_decor_count.hard_cap}) — surfaces and shelves are full`;
  }

  return null; // OK to add
}

// ─── Soft cap status ─────────────────────────────────────────────────────────

function dimensionStatus(dim: SaturationDimension): string {
  const pct = dim.current / dim.hard_cap;
  if (pct >= 1.0) return "FULL";
  if (pct >= 0.8) return "near full";
  if (pct >= 0.5) return "balanced";
  return "has room";
}

function barChart(dim: SaturationDimension, width = 8): string {
  const filled = Math.min(Math.round((dim.current / dim.hard_cap) * width), width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ─── Prompt formatting ────────────────────────────────────────────────────────

export function formatSaturationForPrompt(profile: SaturationProfile): string {
  const lines: string[] = [];

  lines.push("## Saturation Dashboard");
  lines.push(`Total items:     ${barChart(profile.total_items)}  ${profile.total_items.current}/${profile.total_items.hard_cap} — ${dimensionStatus(profile.total_items)}`);
  lines.push(`Small decor:     ${barChart(profile.small_decor_count)}  ${profile.small_decor_count.current}/${profile.small_decor_count.hard_cap} — ${dimensionStatus(profile.small_decor_count)}`);
  lines.push(`Focal points:    ${barChart(profile.focal_points)}  ${profile.focal_points.current}/${profile.focal_points.hard_cap} — ${dimensionStatus(profile.focal_points)}`);
  lines.push(`Color carriers:  ${barChart(profile.color_carriers)}  ${profile.color_carriers.current}/${profile.color_carriers.hard_cap} — ${dimensionStatus(profile.color_carriers)}`);
  lines.push(`Texture items:   ${barChart(profile.texture_items)}  ${profile.texture_items.current}/${profile.texture_items.hard_cap} — ${dimensionStatus(profile.texture_items)}`);
  lines.push("");
  lines.push("Per-category:");

  // Sort by usage percentage descending
  const catEntries = Object.entries(profile.per_category)
    .sort(([, a], [, b]) => (b.current / b.hard_cap) - (a.current / a.hard_cap));

  for (const [cat, dim] of catEntries) {
    const status = dimensionStatus(dim);
    lines.push(`  ${cat.padEnd(24)} ${dim.current}/${dim.hard_cap}  [${status}]`);
  }

  lines.push("");
  const headroom = Object.entries(profile.per_category)
    .filter(([, d]) => d.current < d.soft_cap)
    .map(([cat]) => cat);
  if (Object.keys(profile.per_category).length === 0) {
    lines.push("Available headroom: all categories open (no items tracked yet)");
  } else if (headroom.length > 0) {
    lines.push(`Available headroom (below soft cap): ${headroom.join(", ")}`);
  } else {
    lines.push("All tracked categories are at or near soft caps.");
  }

  return lines.join("\n");
}
