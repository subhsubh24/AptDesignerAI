import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Validation-agent integration test (functional reality, hermetic).
 *
 * Drives the REAL `validateRoomHarmony` and `performFinalAssessment` agents
 * — prompt assembly, the sequential Pass A / Pass B(/ Pass C) calls, Zod
 * validation, and the field-mapping that turns each raw Gemini item into the
 * agent's public result shape — against a scripted provider. Only the
 * `geminiProvider.chat()` boundary is substituted.
 *
 * validation-agent.ts sat at ~13% coverage for 2+ audit cycles, with the gap
 * named specifically at the `revised_search_title` / `revised_specs` /
 * `revised_placement` / `root_cause` coercion in the `.map()` that follows
 * each Pass A parse (`s.revised_search_title ?? undefined`, etc.). That
 * coercion is the thing under test here: it exists so that Gemini's two ways
 * of saying "no revision" — omitting the key, or emitting an explicit JSON
 * `null` (which the `.nullable()` Zod schemas accept) — both collapse to the
 * same `undefined` on the object the rest of the pipeline consumes, rather
 * than leaking `null` through to code that checks `!== undefined`.
 *
 * Follows the existing cassette pattern (see
 * diagnosis-pipeline-cassette.test.ts): mock the Gemini boundary, drive the
 * real agent code, assert on genuine output shape.
 */

const chat = vi.fn();
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: (...args: unknown[]) => chat(...args) },
}));

function chatResponse(body: unknown, model = "cassette-model") {
  return {
    content: JSON.stringify(body),
    model,
    usage: { input_tokens: 100, output_tokens: 200, thinking_tokens: 0 },
  };
}

/**
 * `AgentResult.data` is optional on a non-discriminated interface, so a
 * `success === true` check does not narrow it. Assert both here so a run
 * that silently returned success WITHOUT data fails loudly rather than
 * reading as a pass.
 */
function expectData<T>(result: { success: boolean; data?: T; error?: string }): T {
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
  return result.data as T;
}

beforeEach(() => {
  chat.mockReset();
});

// ─── Shared fixtures ──────────────────────────────────────────────────────

/**
 * Three items exercising the three ways a revision field can arrive:
 *  - "area_rug"    — every revision field present (a real revision)
 *  - "coffee_table"— every revision field simply absent from the JSON
 *  - "floor_lamp"  — every revision field present as an explicit JSON `null`
 * Item count stays under the parallel-chunking threshold (8) so both agents
 * take the single-call Pass A path — call order is deterministic.
 */
function buildAnalysis() {
  return {
    what_works: ["Existing walnut bookshelf against the east wall"],
    what_should_go: [],
    what_it_needs: [
      {
        category: "area_rug",
        search_title: "cream wool area rug",
        specs: "5x7 wool, cream",
        placement: "under the coffee table",
        priority: "high",
        description: "Anchors the seating zone.",
      },
      {
        category: "coffee_table",
        search_title: "walnut coffee table",
        specs: "48x28x17",
        placement: "centered in the seating group",
        priority: "medium",
        description: "Completes the seating zone.",
      },
      {
        category: "floor_lamp",
        search_title: "arc floor lamp",
        specs: "62in, matte black",
        placement: "reading corner",
        priority: "low",
        description: "Adds ambient light.",
      },
    ],
    design_direction: "Warm Japandi-modern with walnut and linen.",
    spatial_layout: "Sofa against the north wall; rug centered on the seating zone.",
  };
}

function makeContext(overrides?: Record<string, unknown>) {
  return {
    roomType: "living_room",
    roomName: "Living Room",
    roomImageUrls: ["https://example.test/room-a.jpg"],
    ...overrides,
  };
}

/** performFinalAssessment additionally requires `roundsCompleted`. */
function makeFinalContext(roundsCompleted: number, overrides?: Record<string, unknown>) {
  return {
    ...makeContext(overrides),
    roundsCompleted,
  };
}

const HARMONY_SUB_SCORES_LOW = {
  color_fit: 8.5,
  spatial_fit: 4.2,
  material_fit: 8.0,
  style_coherence: 8.8,
  cross_room_fit: 7.5,
  functional_fit: 7.0,
};

const HARMONY_SUB_SCORES_HIGH = {
  color_fit: 9.7,
  spatial_fit: 9.8,
  material_fit: 9.5,
  style_coherence: 9.6,
  cross_room_fit: 9.5,
  functional_fit: 9.7,
};

function harmonyPassABody() {
  return {
    item_scores: [
      {
        category: "area_rug",
        harmony_score: 6.8,
        sub_scores: HARMONY_SUB_SCORES_LOW,
        keeps_well_with: ["coffee_table"],
        clashes_with: ["sofa — 5x7 rug too small for the 84-inch sofa"],
        revised_search_title: "Large 8x10 hand-knotted wool area rug in warm cream",
        revised_specs: "96x120 inch (8x10 ft), wool, warm cream",
        revised_placement: "Centered under the coffee table, extending past the sofa front legs",
        drop: false,
        root_cause: "spatial_fit: 5x7 rug undersized for 84-inch sofa — upgrade to 8x10",
        reason: "Right materials and palette, but too small for the seating group.",
        rationale: "COLOR: 8.5. SPATIAL: 5x7 leaves sofa legs off the rug = 4.2. Overall: 6.8.",
      },
      {
        category: "coffee_table",
        harmony_score: 9.6,
        sub_scores: HARMONY_SUB_SCORES_HIGH,
        keeps_well_with: ["area_rug", "sofa"],
        clashes_with: [],
        drop: false,
        reason: "Walnut top anchors the seating group without competing with the sofa.",
        rationale: "All six dims land 9.5+; no revision needed.",
        // revised_search_title / revised_specs / revised_placement / root_cause: absent
      },
      {
        category: "floor_lamp",
        harmony_score: 9.5,
        sub_scores: HARMONY_SUB_SCORES_HIGH,
        keeps_well_with: [],
        clashes_with: [],
        revised_search_title: null,
        revised_specs: null,
        revised_placement: null,
        drop: false,
        root_cause: null,
        reason: "Matte black finish reads intentional as the single metallic accent.",
        rationale: null,
      },
    ],
  };
}

function harmonyPassBBody() {
  return {
    confidence: 8.2,
    pairwise_conflicts: [],
    overall_cohesion: 8.0,
    palette_coherence: "Warm neutral palette holds together across items and keeps.",
    material_coherence: "Two wood species (walnut, oak shelving) stay within the cap.",
    spatial_flow: "Good flow through the seating zone once the rug is upsized.",
    issues: [],
    revisedAnalysis: null,
  };
}

const FINAL_SUB_SCORES_LOW = { ...HARMONY_SUB_SCORES_LOW };
const FINAL_SUB_SCORES_HIGH = { ...HARMONY_SUB_SCORES_HIGH };

function finalPassABody() {
  return {
    item_scores: [
      {
        category: "area_rug",
        final_score: 6.5,
        sub_scores: FINAL_SUB_SCORES_LOW,
        needs_more_work: true,
        revised_search_title: "Large 8x10 hand-knotted wool area rug in warm cream",
        revised_specs: "96x120 inch (8x10 ft), wool, warm cream",
        revised_placement: "Centered under the coffee table",
        root_cause: "spatial_fit: 5x7 rug undersized for 84-inch sofa — upgrade to 8x10",
        reason: "Still undersized after the prior round.",
        rationale: "SPATIAL still fails at 4.2; other dims fine. Overall: 6.5.",
      },
      {
        category: "coffee_table",
        final_score: 9.6,
        sub_scores: FINAL_SUB_SCORES_HIGH,
        needs_more_work: false,
        reason: "Stabilized — no further work needed.",
        rationale: "All six dims 9.5+.",
        // revised_* / root_cause: absent
      },
      {
        category: "floor_lamp",
        final_score: 9.5,
        sub_scores: FINAL_SUB_SCORES_HIGH,
        needs_more_work: false,
        revised_search_title: null,
        revised_specs: null,
        revised_placement: null,
        root_cause: null,
        reason: "Fine as-is.",
        rationale: null,
      },
    ],
  };
}

function finalHolisticBody() {
  return {
    confidence: 7.9,
    overall_cohesion: 7.8,
    palette_coherence: "Warm neutral palette; consistent across rounds.",
    material_coherence: "Wood species stay within the cap; textiles read natural-fiber.",
    spatial_flow: "The rug still needs to be upsized to fully anchor the seating zone.",
    issues: ["Rug remains undersized relative to the sofa"],
    pairwise_conflicts: [],
  };
}

function finalConvergenceBody() {
  return { needs_more_rounds: true, round_budget: 1 };
}

// ─── validateRoomHarmony ────────────────────────────────────────────────

describe("validateRoomHarmony (cassette) — revision-coercion branches", () => {
  it("passes through revised_search_title/specs/placement/root_cause when Gemini returns them", async () => {
    const { validateRoomHarmony } = await import("@/lib/agents/validation-agent");
    chat
      .mockResolvedValueOnce(chatResponse(harmonyPassABody()))
      .mockResolvedValueOnce(chatResponse(harmonyPassBBody()));

    const result = await validateRoomHarmony(buildAnalysis(), makeContext());
    const data = expectData(result);

    const rug = data.item_scores.find((s) => s.category === "area_rug");
    expect(rug).toBeDefined();
    expect(rug!.revised_search_title).toBe("Large 8x10 hand-knotted wool area rug in warm cream");
    expect(rug!.revised_specs).toBe("96x120 inch (8x10 ft), wool, warm cream");
    expect(rug!.revised_placement).toBe("Centered under the coffee table, extending past the sofa front legs");
    expect(rug!.root_cause).toBe("spatial_fit: 5x7 rug undersized for 84-inch sofa — upgrade to 8x10");
    // Non-revision fields still reach the caller intact through the same map.
    expect(rug!.drop).toBe(false);
    expect(rug!.sub_scores).toEqual(HARMONY_SUB_SCORES_LOW);

    // Pass B narrative merges into the same result object.
    expect(data.overall_cohesion).toBe(8.0);
    expect(data.confidence).toBe(8.2);
  });

  it("coerces absent AND explicit-null revision fields to undefined — not null, and no crash", async () => {
    const { validateRoomHarmony } = await import("@/lib/agents/validation-agent");
    chat
      .mockResolvedValueOnce(chatResponse(harmonyPassABody()))
      .mockResolvedValueOnce(chatResponse(harmonyPassBBody()));

    const result = await validateRoomHarmony(buildAnalysis(), makeContext());
    const data = expectData(result);

    // Key omitted entirely from the Gemini JSON.
    const coffeeTable = data.item_scores.find((s) => s.category === "coffee_table");
    expect(coffeeTable).toBeDefined();
    expect(coffeeTable!.revised_search_title).toBeUndefined();
    expect(coffeeTable!.revised_specs).toBeUndefined();
    expect(coffeeTable!.revised_placement).toBeUndefined();
    expect(coffeeTable!.root_cause).toBeUndefined();

    // Key present as an explicit JSON null — the `??` coercion must fold this
    // to undefined too, since `.nullable()` lets `null` pass Zod validation
    // and downstream code checks `!== undefined`, not truthiness.
    const lamp = data.item_scores.find((s) => s.category === "floor_lamp");
    expect(lamp).toBeDefined();
    expect(lamp!.revised_search_title).toBeUndefined();
    expect(lamp!.revised_search_title).not.toBeNull();
    expect(lamp!.revised_specs).toBeUndefined();
    expect(lamp!.revised_placement).toBeUndefined();
    expect(lamp!.root_cause).toBeUndefined();
    expect(lamp!.rationale).toBeUndefined();
  });

  it("passes an explicit thinkingConfig and the deterministic seed on every call", async () => {
    const { validateRoomHarmony } = await import("@/lib/agents/validation-agent");
    const { DETERMINISTIC_SEED } = await import("@/lib/ai/determinism");
    chat
      .mockResolvedValueOnce(chatResponse(harmonyPassABody()))
      .mockResolvedValueOnce(chatResponse(harmonyPassBBody()));

    await validateRoomHarmony(buildAnalysis(), makeContext());

    expect(chat).toHaveBeenCalledTimes(2);
    for (const [params] of chat.mock.calls) {
      expect(params.thinkingConfig).toBeDefined();
      expect(params.seed).toBe(DETERMINISTIC_SEED);
    }
  });
});

// ─── performFinalAssessment ─────────────────────────────────────────────

describe("performFinalAssessment (cassette) — revision-coercion branches", () => {
  it("passes through revised_search_title/specs/placement/root_cause when Gemini returns them", async () => {
    const { performFinalAssessment } = await import("@/lib/agents/validation-agent");
    chat
      .mockResolvedValueOnce(chatResponse(finalPassABody()))
      .mockResolvedValueOnce(chatResponse(finalHolisticBody()))
      .mockResolvedValueOnce(chatResponse(finalConvergenceBody()));

    const result = await performFinalAssessment(buildAnalysis(), makeFinalContext(1));
    const data = expectData(result);

    const rug = data.item_scores.find((s) => s.category === "area_rug");
    expect(rug).toBeDefined();
    expect(rug!.revised_search_title).toBe("Large 8x10 hand-knotted wool area rug in warm cream");
    expect(rug!.revised_specs).toBe("96x120 inch (8x10 ft), wool, warm cream");
    expect(rug!.revised_placement).toBe("Centered under the coffee table");
    expect(rug!.root_cause).toBe("spatial_fit: 5x7 rug undersized for 84-inch sofa — upgrade to 8x10");

    // Pass B (holistic) and Pass C (convergence) both merge into the final result.
    expect(data.overall_cohesion).toBe(7.8);
    expect(data.confidence).toBe(7.9);
    expect(data.needs_more_rounds).toBe(true);
    expect(data.round_budget).toBe(1);
  });

  it("coerces absent AND explicit-null revision fields to undefined — not null, and no crash", async () => {
    const { performFinalAssessment } = await import("@/lib/agents/validation-agent");
    chat
      .mockResolvedValueOnce(chatResponse(finalPassABody()))
      .mockResolvedValueOnce(chatResponse(finalHolisticBody()))
      .mockResolvedValueOnce(chatResponse(finalConvergenceBody()));

    const result = await performFinalAssessment(buildAnalysis(), makeFinalContext(1));
    const data = expectData(result);

    const coffeeTable = data.item_scores.find((s) => s.category === "coffee_table");
    expect(coffeeTable).toBeDefined();
    expect(coffeeTable!.revised_search_title).toBeUndefined();
    expect(coffeeTable!.revised_specs).toBeUndefined();
    expect(coffeeTable!.revised_placement).toBeUndefined();
    expect(coffeeTable!.root_cause).toBeUndefined();
    expect(coffeeTable!.needs_more_work).toBe(false);

    const lamp = data.item_scores.find((s) => s.category === "floor_lamp");
    expect(lamp).toBeDefined();
    expect(lamp!.revised_search_title).toBeUndefined();
    expect(lamp!.revised_search_title).not.toBeNull();
    expect(lamp!.revised_specs).toBeUndefined();
    expect(lamp!.revised_placement).toBeUndefined();
    expect(lamp!.root_cause).toBeUndefined();
    expect(lamp!.rationale).toBeUndefined();
  });

  it("passes an explicit thinkingConfig and the deterministic seed on every call", async () => {
    const { performFinalAssessment } = await import("@/lib/agents/validation-agent");
    const { DETERMINISTIC_SEED } = await import("@/lib/ai/determinism");
    chat
      .mockResolvedValueOnce(chatResponse(finalPassABody()))
      .mockResolvedValueOnce(chatResponse(finalHolisticBody()))
      .mockResolvedValueOnce(chatResponse(finalConvergenceBody()));

    await performFinalAssessment(buildAnalysis(), makeFinalContext(1));

    expect(chat).toHaveBeenCalledTimes(3);
    for (const [params] of chat.mock.calls) {
      expect(params.thinkingConfig).toBeDefined();
      expect(params.seed).toBe(DETERMINISTIC_SEED);
    }
  });
});
