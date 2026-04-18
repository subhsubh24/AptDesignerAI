/**
 * Category-match guard for search extraction.
 *
 * Problem: a URL can pass quick-screen (which is a URL heuristic) yet point to
 * a completely unrelated product — e.g. a lint roller returned for a "vase"
 * search. The extractor then classifies it as "other" (or hallucinates a
 * matching category), and the orchestrator trusts the label without
 * cross-checking against what was actually requested.
 *
 * Fix: after extraction, verify the extracted product's category/title is
 * consistent with the requested category. Reject clear mismatches before
 * they reach deep-scoring.
 */

/**
 * Keyword aliases for each pipeline category. A product's title or extracted
 * category matching any alias counts as a match. Keywords are lowercase and
 * use spaces (not underscores) since they're matched against normalized title
 * text.
 */
const CATEGORY_ALIASES: Record<string, string[]> = {
  // Seating
  sofa: ["sofa", "couch", "settee", "loveseat", "sectional"],
  sectional: ["sectional", "sofa", "couch"],
  loveseat: ["loveseat", "sofa", "couch"],
  accent_chair: ["chair", "armchair", "lounge chair", "accent chair", "club chair", "wingback", "occasional chair"],
  armchair: ["armchair", "chair", "lounge chair", "club chair"],
  dining_chair: ["dining chair", "chair", "side chair", "host chair"],
  desk_chair: ["desk chair", "office chair", "task chair", "ergonomic chair"],
  rocking_chair: ["rocking chair", "rocker", "glider"],
  bar_stool: ["bar stool", "counter stool", "stool"],
  bar_stools: ["bar stool", "counter stool", "stool"],
  bench: ["bench", "storage bench", "entry bench"],

  // Tables
  coffee_table: ["coffee table", "cocktail table"],
  side_table: ["side table", "end table", "accent table", "night table"],
  end_table: ["end table", "side table", "accent table"],
  dining_table: ["dining table", "table"],
  console_table: ["console", "console table", "entry table", "sofa table", "hallway table"],
  console: ["console", "console table"],
  desk: ["desk", "writing desk", "office desk", "workstation"],

  // Storage
  dresser: ["dresser", "chest of drawers", "chest"],
  nightstand: ["nightstand", "bedside table", "night table", "bedside"],
  second_nightstand: ["nightstand", "bedside table", "night table", "bedside"],
  media_console: ["media console", "tv stand", "credenza", "entertainment center", "sideboard", "tv console"],
  sideboard: ["sideboard", "credenza", "buffet", "server"],
  bookshelf: ["bookshelf", "bookcase", "shelving unit", "shelving", "shelf"],
  storage: ["storage", "cabinet", "chest", "cubby"],
  storage_bench: ["storage bench", "bench"],
  storage_cabinet: ["cabinet", "storage cabinet", "cupboard"],

  // Beds
  bed: ["bed", "bedframe", "bed frame", "platform bed", "upholstered bed", "headboard"],
  crib: ["crib", "cot", "bassinet"],

  // Lighting
  floor_lamp: ["floor lamp", "standing lamp", "torchiere"],
  table_lamp: ["table lamp", "bedside lamp"],
  desk_lamp: ["desk lamp", "task lamp"],
  task_lamp: ["task lamp", "desk lamp"],
  pendant_light: ["pendant", "pendant light", "chandelier", "ceiling light", "flush mount", "semi-flush", "hanging light"],
  sconce: ["sconce", "wall sconce", "wall light"],

  // Textiles
  rug: ["rug", "carpet", "runner"],
  area_rug: ["area rug", "rug", "carpet"],
  kitchen_runner: ["runner", "rug"],
  kitchen_rug: ["kitchen rug", "rug", "runner"],
  bath_mat: ["bath mat", "rug", "mat"],
  throw_pillow: ["pillow", "throw pillow", "cushion", "accent pillow"],
  throw_pillows: ["pillow", "throw pillow", "cushion", "accent pillow"],
  throw_blanket: ["throw", "throw blanket", "blanket", "afghan"],
  curtains: ["curtain", "curtains", "drape", "drapery", "panel", "window panel"],
  table_runner: ["runner", "table runner"],

  // Wall & decor
  mirror: ["mirror", "looking glass"],
  art: ["art", "painting", "print", "poster", "canvas", "wall art", "artwork"],
  wall_art: ["wall art", "art", "painting", "print", "poster", "canvas"],
  frames: ["frame", "picture frame"],

  // Plants & greenery
  plant: ["plant", "faux plant", "planter", "tree", "greenery", "fiddle leaf", "monstera", "succulent"],
  greenery_small: ["greenery", "plant", "succulent", "eucalyptus", "branches", "stems"],

  // Decor objects
  vase: ["vase", "urn", "vessel", "pitcher", "jug"],
  candle: ["candle", "pillar candle", "taper", "tealight"],
  candles: ["candle", "pillar candle", "taper", "tealight"],
  candleholder: ["candleholder", "candle holder", "candlestick"],
  tray: ["tray", "serving tray", "decorative tray"],
  tray_styling: ["tray", "serving tray"],
  baskets: ["basket", "storage basket", "woven basket"],
  sculpture: ["sculpture", "statue", "figurine", "objet", "decorative object"],
  sculptures: ["sculpture", "statue", "figurine"],
  decorative_objects: ["decorative object", "objet", "figurine", "sculpture", "bookend", "bowl", "box"],
  decorative_bowl: ["bowl", "decorative bowl", "serving bowl"],
  decorative_bowls: ["bowl", "decorative bowl"],
  books_styled: ["book", "books", "coffee table book"],
  centerpiece: ["centerpiece", "decor"],
  poufs: ["pouf", "ottoman", "footstool"],

  // Misc
  pendant: ["pendant", "pendant light", "chandelier"],
  mobile: ["mobile", "hanging mobile"],
  coat_hooks: ["coat hook", "hook rack", "wall hooks"],
  towel_rack: ["towel rack", "towel bar", "towel holder"],
  cookbook_display: ["cookbook", "book"],
  storage_containers: ["container", "canister", "jar"],
  desk_accessories: ["desk organizer", "desk accessory", "desk caddy"],

  // Generic escape hatches
  other: [],
};

/**
 * Extracted categories from the extraction prompt's closed vocabulary.
 * "other" is a valid extraction output but not a valid requested category,
 * so we treat it as a flag for "extractor didn't recognize this".
 */
const UNCERTAIN_EXTRACTED = new Set(["", "other", "unknown"]);

/**
 * Negative-match terms: if the title contains these AND the expected category
 * is clearly something visual/furniture, reject. Catches cleaning supplies,
 * gift cards, tools, etc. that retailers occasionally surface for unrelated
 * furniture queries.
 */
const DISQUALIFYING_TITLE_TERMS = [
  "lint roller",
  "gift card",
  "warranty",
  "protection plan",
  "assembly service",
  "installation service",
  "cleaning kit",
  "cleaner",
  "polish",
  "touch-up",
  "touch up",
];

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export interface CategoryMatchResult {
  ok: boolean;
  reason: string;
}

/**
 * Check whether an extracted product plausibly belongs to the requested
 * category.
 *
 * Rules (order matters):
 *  1. Reject titles containing known disqualifying terms (lint roller, gift
 *     card, cleaning kit, etc.) for ANY furniture category.
 *  2. If extracted category string matches expected (after normalization) —
 *     match.
 *  3. If expected category's alias keywords appear in the title — match.
 *  4. If extractor returned "other"/"unknown" AND no alias hit — reject
 *     (extractor couldn't classify, AND title gives us no signal).
 *  5. If extractor returned a different category not in the expected alias
 *     list — reject.
 */
export function productMatchesCategory(
  expectedCategory: string,
  extractedCategory: string | null | undefined,
  title: string | null | undefined,
): CategoryMatchResult {
  const expected = normalize(expectedCategory);
  const extracted = normalize(extractedCategory);
  const titleNorm = normalize(title);

  if (!expected) return { ok: true, reason: "no expected category to check" };

  // Rule 1: disqualifying title terms
  for (const term of DISQUALIFYING_TITLE_TERMS) {
    if (titleNorm.includes(term)) {
      return { ok: false, reason: `title contains disqualifying term "${term}"` };
    }
  }

  // Rule 2: direct extracted category match
  if (extracted && !UNCERTAIN_EXTRACTED.has(extracted) && extracted === expected) {
    return { ok: true, reason: "extracted category matches expected" };
  }

  // Rule 3: alias match in title
  const aliases = CATEGORY_ALIASES[expectedCategory.toLowerCase()] ?? [expected];
  for (const a of aliases) {
    if (a && titleNorm.includes(a)) {
      return { ok: true, reason: `title contains "${a}"` };
    }
  }

  // Rule 4: extractor uncertain and no alias hit
  if (UNCERTAIN_EXTRACTED.has(extracted)) {
    return {
      ok: false,
      reason: `extractor returned "${extracted || "empty"}" and title has no "${expected}" keywords`,
    };
  }

  // Rule 5: extractor said something else, and it's not an alias
  return {
    ok: false,
    reason: `extracted category "${extracted}" doesn't match expected "${expected}", and title has no aliases`,
  };
}
