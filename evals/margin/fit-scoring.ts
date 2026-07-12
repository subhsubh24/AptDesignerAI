/**
 * Fit-scoring suite — the `aptdesigner-fit-scoring` workflow (scoreProduct).
 *
 * Scores ONE product's fit to a room via the real vision scorer
 * (lib/agents/fit-scorer.ts:121, powering /api/products/evaluate). The genuine
 * signal is `data.final_item_score` (0–10) + `data.scores.confidence_score`.
 * The grader is NOT always-pass: a clearly good-fit product MUST score well and a
 * clearly bad-fit product MUST score poorly — the eval asserts that direction.
 *
 * Standalone: scoreProduct touches no DB. It needs a real room photo (vision) and
 * a Gemini key. Products are text-only (materials/colors/description) — no product
 * image fetch — which is how the existing sourcing eval exercises it.
 */

import type { CandidateProduct, DesignDirection } from "@/lib/types/database";
import type { Suite } from "./suite";
import type { Grade } from "./grade";
import { mulberry32, pick, int } from "./prng";

/** A product scoring ≥ this (0–10) counts as "the scorer rated it a good fit". */
const FIT_PASS = 6;
export const FIT_QUALITY_METHOD = "fit_score";

const ROOM_IMG: Record<string, string> = {
  living_room: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1280&q=80",
  bedroom: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1280&q=80",
  dining_room: "https://images.unsplash.com/photo-1615873968403-89e068629265?w=1280&q=80",
  home_office: "https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=1280&q=80",
  nursery: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1280&q=80",
};

export interface FitCase {
  id: string;
  roomType: string;
  budgetMode: string;
  style: string;
  userContext: string;
  designDirection?: DesignDirection;
  product: {
    title: string;
    category: string;
    materials?: string[];
    colors?: string[];
    price?: number;
    dimensions?: string;
    description?: string;
  };
  difficulty: "easy" | "medium" | "hard";
  expect?: { shouldPass: boolean; why: string };
}

const WARM_SCANDI: DesignDirection = {
  recommended_palette: ["warm beige", "cream", "warm white", "natural oak"],
  recommended_materials: ["linen", "oak", "walnut", "natural fiber"],
  recommended_textures: ["textured weave", "matte"],
  recommended_furniture_types: ["sofa", "coffee table", "area rug"],
  style_notes: "Warm Scandinavian. Neutral palette, natural wood, clean lines, textured fabrics.",
} as DesignDirection;

const COASTAL: DesignDirection = {
  recommended_palette: ["soft white", "sea glass", "sand", "pale blue"],
  recommended_materials: ["rattan", "jute", "light oak", "linen"],
  recommended_textures: ["woven", "matte"],
  recommended_furniture_types: ["rug", "accent chair", "coffee table"],
  style_notes: "Airy coastal. Light, breezy, natural fibers, relaxed.",
} as DesignDirection;

// ── Curated good-fit and bad-fit cases (asserted directions) ──────────────────
const CURATED: FitCase[] = [
  {
    id: "fit-good-midcentury-walnut-coffee-table",
    roomType: "living_room",
    budgetMode: "balanced",
    style: "mid_century_modern",
    userContext: "Mid-century modern living room with a walnut media console and a warm wool rug.",
    designDirection: WARM_SCANDI,
    product: {
      title: "Walnut Tapered-Leg Coffee Table",
      category: "coffee_table",
      materials: ["solid walnut"],
      colors: ["warm walnut brown"],
      price: 420,
      dimensions: '48"W x 24"D x 16"H',
      description: "Mid-century walnut coffee table with tapered legs and a clean rectangular top.",
    },
    difficulty: "easy",
    expect: { shouldPass: true, why: "material + style + scale all match a mid-century living room" },
  },
  {
    id: "fit-good-linen-accent-chair-scandi",
    roomType: "living_room",
    budgetMode: "balanced",
    style: "scandinavian",
    userContext: "Warm Scandinavian living room, leather sofa, oak floors.",
    designDirection: WARM_SCANDI,
    product: {
      title: "Ivory Linen Accent Chair, Oak Legs",
      category: "accent_chair",
      materials: ["linen", "oak"],
      colors: ["warm ivory"],
      price: 340,
      description: "Low-profile linen accent chair on solid oak legs, warm ivory upholstery.",
    },
    difficulty: "easy",
    expect: { shouldPass: true, why: "palette + materials cohere with warm Scandinavian" },
  },
  {
    id: "fit-good-jute-rug-coastal",
    roomType: "living_room",
    budgetMode: "budget",
    style: "coastal",
    userContext: "Airy coastal living room, lots of natural light.",
    designDirection: COASTAL,
    product: {
      title: "Handwoven Natural Jute Area Rug",
      category: "area_rug",
      materials: ["jute"],
      colors: ["natural sand"],
      price: 180,
      dimensions: "8x10 ft",
      description: "Chunky handwoven jute rug in natural sand — relaxed coastal texture.",
    },
    difficulty: "easy",
    expect: { shouldPass: true, why: "natural fiber + palette are textbook coastal" },
  },
  {
    id: "fit-bad-rgb-gaming-chair-nursery",
    roomType: "nursery",
    budgetMode: "balanced",
    style: "coastal",
    userContext: "Calm, soft coastal nursery for a newborn.",
    designDirection: COASTAL,
    product: {
      title: "XL RGB LED Racing Gaming Chair",
      category: "glider",
      materials: ["black PVC leather", "plastic"],
      colors: ["black", "neon red", "RGB"],
      price: 260,
      description: "Aggressive racing-style gaming chair with neon RGB lighting and a black plastic frame.",
    },
    difficulty: "easy",
    expect: { shouldPass: false, why: "neon/plastic gaming chair violates a calm coastal nursery on every dimension" },
  },
  {
    id: "fit-bad-baroque-console-minimalist-office",
    roomType: "home_office",
    budgetMode: "best_possible",
    style: "minimalist",
    userContext: "Quiet minimalist home office. Clean lines, restrained palette.",
    product: {
      title: "Ornate Baroque Gilded Console with Cherubs",
      category: "desk",
      materials: ["gilded resin", "marble"],
      colors: ["gold", "ivory"],
      price: 1900,
      description: "Heavily ornamented baroque console, gold-leaf cherub carvings, veined marble top.",
    },
    difficulty: "medium",
    expect: { shouldPass: false, why: "ornate gilded baroque is the antithesis of quiet minimalism" },
  },
  {
    id: "fit-bad-inflatable-couch-midcentury",
    roomType: "living_room",
    budgetMode: "balanced",
    style: "mid_century_modern",
    userContext: "Refined mid-century living room with walnut and wool.",
    designDirection: WARM_SCANDI,
    product: {
      title: "Neon Green Inflatable Vinyl Couch",
      category: "accent_chair",
      materials: ["PVC vinyl"],
      colors: ["neon green"],
      price: 45,
      description: "Inflatable neon-green vinyl couch, novelty pool-party seating.",
    },
    difficulty: "easy",
    expect: { shouldPass: false, why: "novelty vinyl clashes with material, palette and quality of a mid-century room" },
  },
  // Borderline / measured (no assertion) — the grey zone the score should place sensibly.
  {
    id: "fit-mid-glass-coffee-table-scandi",
    roomType: "living_room",
    budgetMode: "balanced",
    style: "scandinavian",
    userContext: "Warm Scandinavian living room.",
    designDirection: WARM_SCANDI,
    product: {
      title: "Round Glass-Top Coffee Table, Chrome Base",
      category: "coffee_table",
      materials: ["tempered glass", "chrome"],
      colors: ["clear", "silver"],
      price: 210,
      description: "Round glass top on a chrome base — cooler materials than the warm-wood direction.",
    },
    difficulty: "medium",
  },
];

// ── Fuzz: randomized product attributes for a fixed room (measured, not asserted) ─
function fuzzFitCases(seed = 0xf17, n = 6): FitCase[] {
  const rng = mulberry32(seed);
  const rooms = Object.keys(ROOM_IMG);
  const materials = ["oak", "walnut", "linen", "steel", "plastic", "velvet", "rattan", "acrylic", "concrete"];
  const colors = ["beige", "charcoal", "neon orange", "sage", "gold", "teal", "cream", "hot pink"];
  const cats = ["coffee_table", "accent_chair", "area_rug", "desk", "nightstand", "floor_lamp"];
  const out: FitCase[] = [];
  for (let k = 0; k < n; k++) {
    const roomType = pick(rng, rooms);
    out.push({
      id: `fit-fuzz-${String(k).padStart(2, "0")}-${roomType}`,
      roomType,
      budgetMode: pick(rng, ["budget", "balanced", "best_possible"]),
      style: "unspecified",
      userContext: `${roomType.replace(/_/g, " ")}.`,
      product: {
        title: `${pick(rng, colors)} ${pick(rng, materials)} ${pick(rng, cats).replace(/_/g, " ")}`,
        category: pick(rng, cats),
        materials: [pick(rng, materials)],
        colors: [pick(rng, colors)],
        price: int(rng, 20, 2500),
        description: `A ${pick(rng, colors)} ${pick(rng, cats).replace(/_/g, " ")} in ${pick(rng, materials)}.`,
      },
      difficulty: "hard",
    });
  }
  return out;
}

const cases: FitCase[] = [...CURATED, ...fuzzFitCases()];

function makeProduct(c: FitCase): CandidateProduct {
  return {
    id: `eval-${c.id}`,
    room_id: "eval-room",
    search_session_id: null,
    title: c.product.title,
    category: c.product.category,
    retailer: "eval",
    product_url: null,
    image_url: null,
    local_image_path: null,
    price: c.product.price ?? null,
    dimensions: c.product.dimensions ?? null,
    materials: c.product.materials ?? null,
    colors: c.product.colors ?? null,
    description: c.product.description ?? null,
    source_type: "manual_url",
    metadata: null,
    status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as CandidateProduct;
}

/** Grade a scoreProduct result — genuine, never always-pass. */
export function gradeFit(
  c: FitCase,
  result: { success: boolean; error?: string; data?: { final_item_score?: number; scores?: { confidence_score?: number } }; tokensUsed?: number },
): Grade {
  const notes: string[] = [];
  const tokensUsed = result.tokensUsed ?? 0;
  const assertOutcome = (passed: boolean): boolean | null => {
    if (!c.expect) return null;
    const met = passed === c.expect.shouldPass;
    if (!met) notes.push(`EXPECTATION MISS: expected passed=${c.expect.shouldPass} (${c.expect.why}) — got passed=${passed}`);
    return met;
  };

  if (!result.success || !result.data) {
    notes.push(`scorer did not complete: ${result.error ?? "unknown error"}`);
    return { caseId: c.id, ran: false, passed: false, confidence: 0, qualityScore: 0, candidateCount: 0, tokensUsed, expectationMet: assertOutcome(false), notes };
  }
  const score = result.data.final_item_score ?? 0; // 0–10
  const confidence = result.data.scores?.confidence_score ?? 0;
  const passed = score >= FIT_PASS;
  return {
    caseId: c.id,
    ran: true,
    passed,
    confidence,
    qualityScore: Math.max(0, Math.min(1, score / 10)),
    candidateCount: 1,
    tokensUsed,
    expectationMet: assertOutcome(passed),
    notes,
  };
}

export const fitScoringSuite: Suite = {
  workflow: "fit-scoring",
  workflowId: "aptdesigner-fit-scoring",
  qualityMethod: FIT_QUALITY_METHOD,
  description: "Single-product room-fit vision scoring (scoreProduct → final_item_score)",
  size: () => cases.length,
  caseMeta: (i) => ({ id: cases[i].id, difficulty: cases[i].difficulty }),
  async runCase(i) {
    const c = cases[i];
    const { scoreProduct } = await import("@/lib/agents/fit-scorer");
    const scoringCtx = {
      roomType: c.roomType,
      budgetMode: c.budgetMode,
      existingItems: [],
      roomImageUrls: [ROOM_IMG[c.roomType] ?? ROOM_IMG.living_room],
      userContext: c.userContext,
      designDirection: c.designDirection,
    };
    try {
      const result = await scoreProduct(makeProduct(c), scoringCtx);
      return gradeFit(c, result);
    } catch (err) {
      return gradeFit(c, { success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export function buildFitCases(): FitCase[] {
  return cases;
}
