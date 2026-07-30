import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentContext } from "@/lib/agents/types";

/**
 * Diagnosis-stage integration test (functional reality, hermetic).
 *
 * Drives the REAL two-pass diagnosis agent — image block assembly → Pass A
 * (vision analysis + design direction) → self-consistency selection → the
 * room-type hard gate → style-label inference → few-shot retrieval → Pass B
 * (plan) — against the recorded provider. Only the LLM and image-fetch
 * boundaries are substituted; every line of agent glue (prompt assembly, JSON
 * extraction, Zod validation, defensive field mapping, the gate's branch
 * logic) runs for real.
 *
 * This is the "understand → diagnose" half of the core journey. The existing
 * render-pipeline cassette test covers "design → render"; between them the
 * money path runs end-to-end in CI with no live keys.
 *
 * The agent is otherwise nearly untested: it is one of the lowest-covered
 * modules in lib/agents despite being the maker in the pipeline's first
 * maker/checker loop, so a wiring regression here surfaced only in production.
 */

// The agent imports geminiProvider directly; swap it for the cassette. Stage
// dispatch is by request SHAPE, and both diagnosis passes ask for JSON, so the
// responses are supplied per-call below rather than by a static table.
const chat = vi.fn();
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: (...args: unknown[]) => chat(...args) },
}));

// Image resolution is a network boundary (fetch + Files API upload). The stub
// returns the REAL AIContentBlock image shape (`source.uri`, see
// lib/ai/provider.ts) rather than a convenient flat one: a mock whose shape
// diverges from the module it replaces makes every assertion built on it
// fiction, and vi.mock factories are not type-checked against the real export.
vi.mock("@/lib/ai/resolve-image", () => ({
  resolveImageBlocks: vi.fn(async (urls: string[]) =>
    urls.map((u) => ({
      type: "image" as const,
      source: { type: "file_uri" as const, uri: `data-for:${u}`, media_type: "image/jpeg" },
    })),
  ),
}));

// The style classifier does NOT go through geminiProvider — it calls
// getProvider("quick_score"), which defaults to DeepSeek. Left unmocked, this
// test makes a real outbound request whenever DEEPSEEK_API_KEY happens to be
// set in the environment, and the 401 fallback then routes an extra, untracked
// call into the geminiProvider mock above. It passes in CI today only because
// the verify job sets no keys — an accident, not hermeticity. Own stub, so the
// classifier is deterministic AND stays out of `chat.mock.calls`.
const classifierChat = vi.fn();
vi.mock("@/lib/ai/provider-factory", () => ({
  getProvider: () => ({ chat: (...args: unknown[]) => classifierChat(...args) }),
}));

// No Supabase in tests → fetchDiagnosisExamples short-circuits to []. Pinned
// explicitly so the few-shot path is a known quantity rather than incidental.
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => null }));

function analysisBody(overrides?: { room_type_confirmation?: unknown; style_notes?: string }) {
  return {
    diagnosis: {
      current_vibe_summary: "A sparse rental living room with strong north light",
      what_is_working: ["Wide-plank oak floors", "Tall south-facing windows"],
      what_is_not_working: ["No anchoring rug", "Single harsh overhead light"],
      biggest_improvement_opportunities: ["Ground the seating zone with a large rug"],
      missing_furniture_categories: ["area_rug", "floor_lamp", "coffee_table"],
      color_issues: ["Palette reads cold against the warm floor"],
      texture_material_issues: [],
      scale_proportion_issues: ["Sofa floats away from every wall"],
      layout_issues: [],
      spatial_gaps: [],
      lighting_issues: ["Only one overhead source"],
      clutter_editing_issues: [],
      ...(overrides?.room_type_confirmation !== undefined
        ? { room_type_confirmation: overrides.room_type_confirmation }
        : {}),
    },
    design_direction: {
      recommended_palette: ["warm ivory (#F3ECE0) — dominant (60%)", "walnut (#5A3E2B) — supporting (30%)"],
      recommended_materials: ["solid walnut", "linen", "wool"],
      recommended_textures: ["high-low pile wool"],
      recommended_furniture_types: ["Area rug — at least 8x10, wool, warm neutral"],
      style_notes: overrides?.style_notes ?? "A warm mid-century modern direction with walnut and linen.",
    },
  };
}

const PLAN_BODY = {
  missing_categories: ["area_rug", "floor_lamp", "coffee_table"],
  action_list: [
    { priority: 1, action: "Add an 8x10 wool rug in warm oatmeal", category: "area_rug", reasoning: "Anchors the seating" },
    { priority: 2, action: "Add a walnut arc floor lamp", category: "floor_lamp", reasoning: "Second light source" },
    { priority: 3, action: "Add a 42in round walnut coffee table", category: "coffee_table", reasoning: "Completes the zone" },
  ],
};

/**
 * Dispatch by request SHAPE, not call order — the same rule the cassette
 * provider uses, and the only robust one here: how many calls the agent makes
 * depends on SELF_CONSISTENCY_N, the per-pass retry loop, and whether the
 * style classifier reaches this provider at all. An ordered stub list silently
 * hands Pass B's parser a Pass A body the moment any of those shift — and both
 * plan fields carry a Zod `.default([])`, so that parses clean and yields an
 * EMPTY plan. The test then asserts against nothing and looks green.
 *
 * The discriminator is `mediaResolution`, which only Pass A sets. Presence of
 * image blocks does NOT work: both passes carry the same photos, because Pass
 * B deliberately re-attaches them via `cacheScope` (at cached-input cost) so
 * it can ground placement strings like "against the north wall" in something
 * visible. Both passes' `messages` are text-only for the same reason.
 */
type ChatArgs = { mediaResolution?: string };
function respondWith(analysis: unknown, plan: unknown) {
  chat.mockImplementation(async (params: ChatArgs) => ({
    content: JSON.stringify(params.mediaResolution ? analysis : plan),
    model: "cassette-model",
    usage: { input_tokens: 100, output_tokens: 200, thinking_tokens: 0 },
  }));
}

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    roomId: "room-1",
    roomType: "living_room",
    keepItems: [],
    replaceItems: [],
    priorities: [],
    budgetMode: "balanced",
    sourcingMode: "online",
    imageUrls: ["https://example.test/room-a.jpg", "https://example.test/room-b.jpg"],
    ...overrides,
  } as AgentContext;
}

beforeEach(() => {
  chat.mockReset();
  classifierChat.mockReset();
  // Default: the classifier declines to label, so the deterministic regex tier
  // in inferStyleLabel decides. Individual tests override to drive the LLM tier.
  classifierChat.mockResolvedValue({
    content: JSON.stringify({ label: null }),
    model: "cassette-classifier",
    usage: { input_tokens: 10, output_tokens: 10, thinking_tokens: 0 },
  });
});

/**
 * `AgentResult.data` is optional on a non-discriminated interface, so a
 * `success === true` check does not narrow it. Assert both here so a run that
 * silently returned success WITHOUT data fails loudly rather than reading as a
 * pass — the exact hollow-success shape this suite exists to rule out.
 */
function expectData<T>(result: { success: boolean; data?: T; error?: string }): T {
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
  return result.data as T;
}

describe("diagnosis pipeline (cassette) — photo → understand → diagnose", () => {
  it("runs both passes and returns a validated, populated diagnosis", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    respondWith(analysisBody(), PLAN_BODY);

    const result = await runRoomDiagnosis(makeContext());

    const data = expectData(result);

    // Pass A output survived Zod validation and reached the caller intact.
    expect(data.diagnosis.current_vibe_summary).toContain("north light");
    expect(data.design_direction.recommended_materials).toContain("linen");
    // Pass B output — the plan the rest of the pipeline shops against.
    expect(data.missing_categories).toContain("area_rug");
    expect(data.action_list.length).toBeGreaterThan(0);
    expect(data.action_list[0].category).toBe("area_rug");
    // Real token accounting, not a placeholder.
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.model).toBe("cassette-model");
  });

  it("carries a style label out for persistence, drawn from the closed vocabulary", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    // The style classifier is itself an LLM call through the same provider; it
    // returns {label}. Feeding a body that is not a label object exercises the
    // regex fallback over style_notes, which is the deterministic path.
    respondWith(analysisBody(), PLAN_BODY);

    const result = await runRoomDiagnosis(makeContext());

    // "mid-century modern" appears in style_notes → the regex tier labels it.
    // This value is what app/api/diagnosis/route.ts persists into
    // room_diagnoses.design_direction_label, which the few-shot retrieval
    // query filters on — a null here silently disables that retrieval.
    expect(expectData(result).design_direction_label).toBe("Mid-Century Modern");
  });

  it("prefers the classifier's label over the regex tier when it returns one", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    respondWith(analysisBody(), PLAN_BODY);
    // style_notes still says "mid-century modern", which the regex tier would
    // label. The classifier outranks it, so this also proves the classifier
    // stub is genuinely wired — without it the mock could be shaped wrong and
    // every other test here would pass anyway via the regex fallback.
    classifierChat.mockResolvedValue({
      content: JSON.stringify({ label: "Japandi" }),
      model: "cassette-classifier",
      usage: { input_tokens: 10, output_tokens: 10, thinking_tokens: 0 },
    });

    const result = await runRoomDiagnosis(makeContext());

    expect(classifierChat).toHaveBeenCalled();
    expect(expectData(result).design_direction_label).toBe("Japandi");
  });

  it("reports null rather than guessing when no style matches", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    respondWith(
      analysisBody({ style_notes: "Something calm and personal for the client." }),
      PLAN_BODY,
    );

    const result = await runRoomDiagnosis(makeContext());
    expect(expectData(result).design_direction_label).toBeNull();
  });

  it("hard-gates before Pass B when the photos are confidently a different room", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    const mismatch = analysisBody({
      room_type_confirmation: {
        inferred_room_type: "bedroom",
        matches_declared: false,
        confidence: "high",
        note: "A bed occupies most of the frame.",
      },
    });
    respondWith(mismatch, PLAN_BODY);

    const result = await runRoomDiagnosis(makeContext({ roomType: "kitchen" }));

    expect(result.success).toBe(false);
    if (result.success) return;
    // The user is told BOTH types, so the message is actionable rather than a
    // bare failure.
    expect(result.error).toContain("bedroom");
    expect(result.error).toContain("kitchen");
    // And the saving is REAL: exactly one model call happened — Pass A. Without
    // this, a refactor that ran Pass B and merely discarded its output would
    // keep the same error text and pass, while the "before Pass B spends
    // tokens" claim quietly became false.
    expect(chat.mock.calls.length).toBe(1);
  });

  it("does NOT gate on a low-confidence mismatch — it warns and continues", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    const unsure = analysisBody({
      room_type_confirmation: {
        inferred_room_type: "bedroom",
        matches_declared: false,
        confidence: "low",
        note: "Hard to tell from this angle.",
      },
    });
    respondWith(unsure, PLAN_BODY);

    const result = await runRoomDiagnosis(makeContext({ roomType: "living_room" }));

    // Blocking here would strand users whose room genuinely is what they said.
    expect(expectData(result).action_list.length).toBeGreaterThan(0);
  });

  it("fails loudly — never with a hollow success — when the model returns unusable JSON", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    // Schema-invalid: missing_furniture_categories is required non-empty.
    respondWith({ diagnosis: { current_vibe_summary: "hi" }, design_direction: {} }, PLAN_BODY);

    const result = await runRoomDiagnosis(makeContext());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeTruthy();
  });

  it("passes an explicit thinkingConfig and the deterministic seed on every model call", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    const { DETERMINISTIC_SEED } = await import("@/lib/ai/determinism");
    respondWith(analysisBody(), PLAN_BODY);

    await runRoomDiagnosis(makeContext());

    expect(chat).toHaveBeenCalled();
    // The cost contract and the determinism rule, asserted on the calls the
    // agent actually makes rather than on a source scan.
    for (const [params] of chat.mock.calls) {
      expect(params.thinkingConfig).toBeDefined();
      expect(params.seed).toBe(DETERMINISTIC_SEED);
    }
  });

  it("sends every room photo to BOTH passes, in the order given", async () => {
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    respondWith(analysisBody(), PLAN_BODY);

    await runRoomDiagnosis(
      makeContext({ imageUrls: ["https://example.test/1.jpg", "https://example.test/2.jpg"] }),
    );

    // Both passes get the photos, via cacheScope — Pass B needs them to ground
    // placement strings, and routing them through the cache is what makes that
    // affordable. A refactor that dropped either would leave Pass B writing
    // confident placements for a room it cannot see.
    expect(chat.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [params] of chat.mock.calls) {
      const serialized = JSON.stringify(params.cacheScope ?? {});
      expect(serialized).toContain("data-for:https://example.test/1.jpg");
      expect(serialized).toContain("data-for:https://example.test/2.jpg");
      // Order matters: the prompts refer to photos positionally.
      expect(serialized.indexOf("data-for:https://example.test/1.jpg")).toBeLessThan(
        serialized.indexOf("data-for:https://example.test/2.jpg"),
      );
    }
  });
});
