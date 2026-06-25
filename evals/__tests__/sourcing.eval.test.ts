/**
 * Live eval tests for the product-sourcing relevance pipeline stage.
 *
 * Tests whether scoreProduct() correctly identifies well-matched products
 * for a given room context and design direction. A regression here means the
 * scoring pipeline started rating clearly relevant products as poor matches.
 *
 * Gates behind RUN_EVALS=1 — never fires in the standard `npm test` run
 * (which has no Gemini key). Run with:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/sourcing.eval.test.ts
 * or via the project shorthand:
 *   npm run eval
 *
 * Timeout: 3 minutes per test — each call deep-scores the product across
 * 8 dimensions with the live Gemini API.
 */

import { describe, it, expect } from "vitest";
import { evalsEnabled } from "../runner";
import { scoreProduct } from "@/lib/agents/fit-scorer";
import type { ScoringContext } from "@/lib/agents/fit-scorer";
import type { CandidateProduct } from "@/lib/types/database";

const EVAL_TIMEOUT_MS = 3 * 60 * 1000;

// Warm neutral living room with beige sofa — shared with the diagnosis eval gold cases.
const WARM_LIVING_ROOM_IMAGE =
  "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1280&q=80";

// Design direction for a warm Scandinavian living room.
const WARM_SCANDI_DIRECTION = {
  recommended_palette: ["warm beige", "cream", "warm white", "natural oak"],
  recommended_materials: ["linen", "oak", "walnut", "natural fiber"],
  recommended_textures: ["textured weave", "matte"],
  recommended_furniture_types: ["sofa", "coffee table", "area rug"],
  style_notes:
    "Warm Scandinavian. Neutral palette with natural wood accents, clean lines, textured fabrics.",
};

const BASE_SCORING_CTX: ScoringContext = {
  roomType: "living_room",
  budgetMode: "balanced",
  existingItems: [],
  roomImageUrls: [WARM_LIVING_ROOM_IMAGE],
  userContext: "Looking for a warmer, cozier feel. Scandinavian-inspired.",
  designDirection: WARM_SCANDI_DIRECTION,
};

function makeMockProduct(
  fields: Partial<
    Pick<
      CandidateProduct,
      | "id"
      | "title"
      | "category"
      | "retailer"
      | "price"
      | "materials"
      | "colors"
      | "dimensions"
      | "description"
    >
  >,
): CandidateProduct {
  return {
    id: fields.id ?? "eval-product-placeholder",
    room_id: "eval-room",
    search_session_id: null,
    title: fields.title ?? null,
    category: fields.category ?? null,
    retailer: fields.retailer ?? null,
    product_url: null,
    image_url: null,
    local_image_path: null,
    price: fields.price ?? null,
    dimensions: fields.dimensions ?? null,
    materials: fields.materials ?? null,
    colors: fields.colors ?? null,
    description: fields.description ?? null,
    source_type: "manual_url",
    metadata: null,
    status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("product-sourcing relevance live evals — run with RUN_EVALS=1", () => {
  it.skipIf(!evalsEnabled())(
    "warm beige linen sofa: scores as a relevant match for warm Scandinavian living room",
    async () => {
      const product = makeMockProduct({
        id: "eval-sofa-warm-beige-linen",
        title: "Nori Linen Sofa — 84\" 3-Seater",
        category: "sofa",
        retailer: "Article",
        price: 799,
        materials: ["linen", "solid walnut"],
        colors: ["warm beige", "sand"],
        dimensions: { width: 84, depth: 34, height: 32, unit: "inches" },
        description:
          "Tight-back linen sofa with solid walnut legs. Clean Scandinavian lines, " +
          "warm sand fabric. Well-scaled for open-plan living rooms.",
      });

      const result = await scoreProduct(product, BASE_SCORING_CTX);

      expect(
        result.success,
        `scoreProduct failed: ${result.error ?? "unknown"}`,
      ).toBe(true);
      expect(
        result.data,
        "scoreProduct returned success:true but data was undefined",
      ).toBeDefined();
      if (!result.data) return;

      // A warm beige linen sofa with walnut legs is an excellent match for a
      // warm Scandinavian living room. The pipeline should never call it "no".
      expect(
        result.data.verdict,
        `Expected verdict to be at least 'maybe' for a clearly relevant product, ` +
          `got '${result.data.verdict}'. Reasoning: ${JSON.stringify(result.data.reasoning)}`,
      ).not.toBe("no");

      // final_item_score is 0-10. These products match the design direction on every
      // dimension (palette, materials, style, category) — a score below 6 would indicate
      // a regression. Note: image_url is null here (text-only scoring path), so
      // groundConfidence applies a -1.5 penalty; the raw LLM score must still be strong
      // enough to land above 6 after that adjustment.
      expect(
        result.data.final_item_score,
        `Expected final_item_score ≥ 6 for a clearly relevant product, ` +
          `got ${result.data.final_item_score}. Reasoning: ${JSON.stringify(result.data.reasoning)}`,
      ).toBeGreaterThanOrEqual(6);
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(!evalsEnabled())(
    "oak and brass coffee table: scores as a relevant match for warm Scandinavian living room",
    async () => {
      const product = makeMockProduct({
        id: "eval-coffee-table-oak-brass",
        title: "Wren Round Coffee Table — 36\" Diameter",
        category: "coffee_table",
        retailer: "CB2",
        price: 449,
        materials: ["solid oak", "brass"],
        colors: ["natural oak", "warm brass"],
        dimensions: { diameter: 36, height: 16, unit: "inches" },
        description:
          "Round coffee table with solid oak top and tapered legs with brass tips. " +
          "Natural warm finish pairs well with linen sofas and neutral area rugs.",
      });

      const result = await scoreProduct(product, BASE_SCORING_CTX);

      expect(
        result.success,
        `scoreProduct failed: ${result.error ?? "unknown"}`,
      ).toBe(true);
      expect(
        result.data,
        "scoreProduct returned success:true but data was undefined",
      ).toBeDefined();
      if (!result.data) return;

      // Oak and brass are in the recommended materials/palette for this room.
      // The pipeline should score this at least 'maybe'.
      expect(
        result.data.verdict,
        `Expected verdict to be at least 'maybe' for a clearly relevant product, ` +
          `got '${result.data.verdict}'. Reasoning: ${JSON.stringify(result.data.reasoning)}`,
      ).not.toBe("no");

      expect(
        result.data.final_item_score,
        `Expected final_item_score ≥ 6 for a clearly relevant product, ` +
          `got ${result.data.final_item_score}. Reasoning: ${JSON.stringify(result.data.reasoning)}`,
      ).toBeGreaterThanOrEqual(6);
    },
    EVAL_TIMEOUT_MS,
  );
});
