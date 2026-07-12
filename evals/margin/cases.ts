/**
 * Margin eval — the INPUT MATRIX for the `aptdesigner-search` workflow.
 *
 * A real, representative set of search inputs that vary the owner's exact
 * dimensions — room type × budget × #images × image quality × style — so a
 * metered run yields an accurate STATISTICAL cost-per-outcome for AptDesignerAI
 * (not a single anecdote). Cases span easy→hard and good-fit→bad-fit, with
 * genuine variety rather than repeats.
 *
 * These are INPUTS only. The grader (grade.ts) scores each run against the REAL
 * pipeline success signal (validation.isValid + validation.confidence). Where a
 * case has a defined expected outcome (an impossible budget MUST fail — the
 * orchestrator forces isValid=false when the bundle total exceeds budgetDollars,
 * see lib/agents/orchestrator.ts ~3284-3305) it is asserted via `expect`.
 *
 * The images are real, fetchable interior photos (Unsplash) because the deep
 * scorer downloads each room image for vision fit-scoring — a broken URL would
 * make a case error rather than measure. The image-quality dimension is encoded
 * as width/quality query params (a low-res photo genuinely costs fewer vision
 * input tokens), and the #images dimension repeats the room's photos.
 */

export type BudgetMode = "budget" | "balanced" | "best_possible";
export type Difficulty = "easy" | "medium" | "hard";

export interface MarginEvalCase {
  id: string;
  roomType: string;
  /** Human label used in the free-text brief. */
  roomLabel: string;
  budgetMode: BudgetMode;
  /** Hard dollar ceiling. Set only where it is load-bearing (impossible-budget
   *  cases); undefined lets budgetMode drive tiers without a forced ceiling. */
  budgetDollars?: number;
  style: string;
  /** Real, fetchable room photos (see module note). Length = the #images dim. */
  imageUrls: string[];
  imageQuality: "high" | "low";
  imageCount: number;
  userContext: string;
  keepItems: string[];
  replaceItems: string[];
  priorities: string[];
  /** The missing categories to search for (2nd arg to runAgenticSearch). */
  missingCategories: string[];
  difficulty: Difficulty;
  /** Optional expected outcome. When set, the grader asserts passed === shouldPass. */
  expect?: { shouldPass: boolean; why: string };
}

// ── Real fetchable interior photos, per room type (validated image/jpeg) ──────
const IMG: Record<string, string[]> = {
  living_room: ["photo-1555041469-a586c61ea9bc", "photo-1567538096630-e0c55bd6374c"],
  bedroom: ["photo-1586023492125-27b2c045efd7", "photo-1616486338812-3dadae4b4ace"],
  dining_room: ["photo-1615873968403-89e068629265", "photo-1522708323590-d24dbb6b0267"],
  home_office: ["photo-1598928506311-c55ded91a20c", "photo-1583847268964-b28dc8f51f92"],
  studio: ["photo-1560448204-e02f11c3d0e2", "photo-1555041469-a586c61ea9bc"],
  nursery: ["photo-1618221195710-dd6b41faaea6", "photo-1586023492125-27b2c045efd7"],
};

function imgUrl(id: string, quality: "high" | "low"): string {
  // Low-res genuinely costs fewer vision input tokens than high-res.
  return quality === "high"
    ? `https://images.unsplash.com/${id}?w=1600&q=80`
    : `https://images.unsplash.com/${id}?w=200&q=30`;
}

/** Build N image URLs for a room, cycling its photo pool. */
function imagesFor(roomType: string, count: number, quality: "high" | "low"): string[] {
  const pool = IMG[roomType] ?? IMG.living_room;
  return Array.from({ length: count }, (_, i) => imgUrl(pool[i % pool.length], quality));
}

interface ImageProfile { key: string; count: number; quality: "high" | "low" }
const IMAGE_PROFILES: ImageProfile[] = [
  { key: "hi1", count: 1, quality: "high" },
  { key: "hi2", count: 2, quality: "high" },
  { key: "hi3", count: 3, quality: "high" },
  { key: "lo1", count: 1, quality: "low" },
  { key: "lo3", count: 3, quality: "low" },
];

const ROOMS: Array<{ type: string; label: string; categories: string[] }> = [
  { type: "living_room", label: "living room", categories: ["area_rug", "coffee_table", "accent_chair"] },
  { type: "bedroom", label: "bedroom", categories: ["bed_frame", "nightstand", "dresser"] },
  { type: "dining_room", label: "dining room", categories: ["dining_table", "dining_chairs", "sideboard"] },
  { type: "home_office", label: "home office", categories: ["desk", "office_chair", "bookshelf"] },
  { type: "studio", label: "studio", categories: ["sofa_bed", "coffee_table", "floor_lamp"] },
  { type: "nursery", label: "nursery", categories: ["crib", "glider", "dresser"] },
];

const STYLES = [
  "scandinavian",
  "mid_century_modern",
  "industrial",
  "japandi",
  "coastal",
  "traditional",
  "bohemian",
  "minimalist",
];
const STYLE_LABEL: Record<string, string> = {
  scandinavian: "warm Scandinavian",
  mid_century_modern: "mid-century modern",
  industrial: "industrial loft",
  japandi: "Japandi (Japanese × Scandinavian)",
  coastal: "airy coastal",
  traditional: "classic traditional",
  bohemian: "layered bohemian",
  minimalist: "quiet minimalist",
};

const BUDGETS: BudgetMode[] = ["budget", "balanced", "best_possible"];

function difficultyOf(budget: BudgetMode, profile: ImageProfile): Difficulty {
  if (budget === "budget" && profile.quality === "low") return "hard";
  if (budget === "best_possible" && profile.quality === "high") return "easy";
  return "medium";
}

function coreCase(i: number): MarginEvalCase {
  // Coprime-ish rotation over the four dimensions → distinct, varied combos.
  const room = ROOMS[i % ROOMS.length];
  const style = STYLES[(i * 3) % STYLES.length];
  const budget = BUDGETS[i % BUDGETS.length];
  const profile = IMAGE_PROFILES[(i * 2) % IMAGE_PROFILES.length];
  const styleLabel = STYLE_LABEL[style];
  return {
    id: `core-${String(i).padStart(2, "0")}-${room.type}-${style}-${budget}-${profile.key}`,
    roomType: room.type,
    roomLabel: room.label,
    budgetMode: budget,
    style,
    imageUrls: imagesFor(room.type, profile.count, profile.quality),
    imageQuality: profile.quality,
    imageCount: profile.count,
    userContext: `${styleLabel} style. Refresh this ${room.label} with a cohesive, well-priced set — keep it practical and true to the palette.`,
    keepItems: [],
    replaceItems: [],
    priorities: budget === "budget" ? ["value", "durability"] : ["cohesion", "quality"],
    missingCategories: room.categories,
    difficulty: difficultyOf(budget, profile),
  };
}

/** Explicit edge cases — the asserted / adversarial tail of the matrix. */
function edgeCases(): MarginEvalCase[] {
  const out: MarginEvalCase[] = [];

  // Impossible-budget → MUST fail (over-budget forces isValid=false).
  const impossible: Array<{ room: (typeof ROOMS)[number]; cap: number; style: string }> = [
    { room: ROOMS[0], cap: 40, style: "coastal" },
    { room: ROOMS[1], cap: 60, style: "japandi" },
    { room: ROOMS[2], cap: 50, style: "traditional" },
    { room: ROOMS[3], cap: 45, style: "industrial" },
  ];
  impossible.forEach((e, k) => {
    out.push({
      id: `edge-impossible-budget-${String(k).padStart(2, "0")}-${e.room.type}`,
      roomType: e.room.type,
      roomLabel: e.room.label,
      budgetMode: "budget",
      budgetDollars: e.cap,
      style: e.style,
      imageUrls: imagesFor(e.room.type, 2, "high"),
      imageQuality: "high",
      imageCount: 2,
      userContext: `${STYLE_LABEL[e.style]} style. Furnish the whole ${e.room.label} — three pieces — for under $${e.cap} total.`,
      keepItems: [],
      replaceItems: [],
      priorities: ["price"],
      missingCategories: e.room.categories,
      difficulty: "hard",
      expect: { shouldPass: false, why: `bundle for 3 categories cannot fit a $${e.cap} ceiling → over-budget issue forces isValid=false` },
    });
  });

  // Style×room mismatch — genuinely harder to reach a coherent, confident set.
  const mismatch: Array<{ room: (typeof ROOMS)[number]; style: string; note: string }> = [
    { room: ROOMS[5], style: "industrial", note: "raw concrete + steel in a baby's nursery" },
    { room: ROOMS[3], style: "bohemian", note: "maximalist layered boho for a focused work office" },
    { room: ROOMS[2], style: "minimalist", note: "stark empty minimalism for a family dining room" },
  ];
  mismatch.forEach((e, k) => {
    out.push({
      id: `edge-mismatch-${String(k).padStart(2, "0")}-${e.room.type}-${e.style}`,
      roomType: e.room.type,
      roomLabel: e.room.label,
      budgetMode: "balanced",
      style: e.style,
      imageUrls: imagesFor(e.room.type, 2, "high"),
      imageQuality: "high",
      imageCount: 2,
      userContext: `${STYLE_LABEL[e.style]} style for this ${e.room.label} — ${e.note}. Make it work.`,
      keepItems: [],
      replaceItems: [],
      priorities: ["cohesion"],
      missingCategories: e.room.categories,
      difficulty: "hard",
    });
  });

  // Degraded input — single tiny photo, terse brief (cheap input, harder fit).
  const degraded: Array<(typeof ROOMS)[number]> = [ROOMS[0], ROOMS[1], ROOMS[4]];
  degraded.forEach((room, k) => {
    out.push({
      id: `edge-degraded-images-${String(k).padStart(2, "0")}-${room.type}`,
      roomType: room.type,
      roomLabel: room.label,
      budgetMode: "balanced",
      style: "minimalist",
      imageUrls: imagesFor(room.type, 1, "low"),
      imageQuality: "low",
      imageCount: 1,
      userContext: `${room.label}. Just make it look decent.`,
      keepItems: [],
      replaceItems: [],
      priorities: [],
      missingCategories: room.categories,
      difficulty: "hard",
    });
  });

  // Generous, well-matched — the easy good-fit anchor of the range (measured, not asserted).
  out.push({
    id: "edge-generous-coastal-living_room",
    roomType: "living_room",
    roomLabel: "living room",
    budgetMode: "best_possible",
    style: "coastal",
    imageUrls: imagesFor("living_room", 3, "high"),
    imageQuality: "high",
    imageCount: 3,
    userContext: "Airy coastal living room. Generous budget — prioritise a beautifully cohesive, high-quality set.",
    keepItems: ["linen sofa"],
    replaceItems: [],
    priorities: ["cohesion", "quality"],
    missingCategories: ["area_rug", "coffee_table", "accent_chair"],
    difficulty: "easy",
  });
  out.push({
    id: "edge-generous-scandi-bedroom",
    roomType: "bedroom",
    roomLabel: "bedroom",
    budgetMode: "balanced",
    style: "scandinavian",
    imageUrls: imagesFor("bedroom", 2, "high"),
    imageQuality: "high",
    imageCount: 2,
    userContext: "Warm Scandinavian bedroom. Calm, natural materials; a restful, cohesive set.",
    keepItems: [],
    replaceItems: [],
    priorities: ["cohesion"],
    missingCategories: ["bed_frame", "nightstand", "dresser"],
    difficulty: "easy",
  });

  return out;
}

/**
 * The full input matrix — ~57 distinct cases spanning the five dimensions,
 * easy→hard and good→bad, with an asserted impossible-budget tail.
 */
export function buildCaseMatrix(): MarginEvalCase[] {
  const core = Array.from({ length: 45 }, (_, i) => coreCase(i));
  return [...core, ...edgeCases()];
}
