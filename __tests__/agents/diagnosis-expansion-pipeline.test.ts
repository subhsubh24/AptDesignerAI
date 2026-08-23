import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionItem } from "@/lib/types/database";

// The pipeline delegates the actual greedy expansion + floor-plan lookup to
// other agents; mock those so we exercise ONLY this module's orchestration:
// the empty-baseline short-circuit, the parallel context fetches, the result
// mapping, and the fail-open-to-baseline guard.
const runDiagnosisExpansion = vi.fn();
vi.mock("@/lib/agents/greedy-decorator", () => ({
  runDiagnosisExpansion: (...args: unknown[]) => runDiagnosisExpansion(...args),
}));
vi.mock("@/lib/agents/format-floor-plan", () => ({
  getRoomFromFloorPlan: vi.fn(() => null),
}));

import { runFullDiagnosisExpansion } from "@/lib/agents/diagnosis-expansion-pipeline";

function item(category: string, quantity = 1): ActionItem {
  return { category, quantity } as unknown as ActionItem;
}

/**
 * Chainable Supabase stub. buildExpansionBudgetContext awaits `.single()`;
 * fetchSiblingRoomSummaries awaits `.limit()`. Every intermediate builder method
 * returns the builder, so both query shapes resolve to their configured value.
 */
function makeSupabase(opts: {
  budgetRoom?: unknown;
  siblingRooms?: unknown;
  singleThrows?: boolean;
  limitThrows?: boolean;
  // In-band Supabase failure — {data: null, error} resolved (not thrown), the
  // real shape a query failure takes. Distinct from *Throws above, which
  // simulate a thrown exception (e.g. a network-level rejection).
  budgetError?: { code?: string; message: string };
  siblingsError?: { code?: string; message: string };
}) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = self;
  builder.eq = self;
  builder.neq = self;
  builder.single = () =>
    opts.singleThrows
      ? Promise.reject(new Error("budget db down"))
      : Promise.resolve({ data: opts.budgetRoom ?? null, error: opts.budgetError ?? null });
  builder.limit = () =>
    opts.limitThrows
      ? Promise.reject(new Error("siblings db down"))
      : Promise.resolve({ data: opts.siblingRooms ?? null, error: opts.siblingsError ?? null });
  return { from: vi.fn(() => builder) };
}

function baseArgs(overrides: Partial<Parameters<typeof runFullDiagnosisExpansion>[0]> = {}) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeSupabase({}) as any,
    roomId: "room-1",
    projectId: "proj-1",
    roomType: "living_room",
    budgetMode: "balanced" as const,
    priorities: [],
    baselineActionList: [item("sofa"), item("area_rug")],
    designDirection: null,
    roomPhotos: [],
    floorPlanImageUrl: null,
    extractedFloorPlan: undefined,
    preferences: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runFullDiagnosisExpansion", () => {
  it("short-circuits on an empty baseline without calling expansion or the DB", async () => {
    const supabase = makeSupabase({});
    const result = await runFullDiagnosisExpansion(
      baseArgs({
        baselineActionList: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
      }),
    );
    expect(result).toEqual({
      expandedActionList: [],
      expansionLog: null,
      siblingRoomCount: 0,
    });
    expect(runDiagnosisExpansion).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("maps a successful expansion into the result shape and counts siblings", async () => {
    const expanded = [item("sofa"), item("area_rug"), item("floor_lamp")];
    const decisionLog = [{ category: "floor_lamp", action: "add" }];
    runDiagnosisExpansion.mockResolvedValue({
      expanded_items: expanded,
      decision_log: decisionLog,
      added_count: 1,
      stop_reason: "budget",
    });
    const supabase = makeSupabase({
      budgetRoom: { budget_dollars: 5000, budget_mode: "balanced" },
      siblingRooms: [
        { id: "r2", room_type: "bedroom", room_diagnoses: [] }, // no diagnoses -> skipped
        {
          id: "r3",
          room_type: "office",
          room_diagnoses: [
            { design_direction_json: null, action_list: [item("desk")], created_at: "2026-01-01" },
          ],
        },
      ],
    });

    const result = await runFullDiagnosisExpansion(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseArgs({ supabase: supabase as any }),
    );

    expect(result.expandedActionList).toBe(expanded);
    expect(result.expansionLog).toBe(decisionLog);
    // siblingRoomCount is the number of siblings with a USABLE diagnosis: r2 has
    // none (skipped), r3 has one -> 1. It is not the raw fetched row count.
    expect(result.siblingRoomCount).toBe(1);
    expect(runDiagnosisExpansion).toHaveBeenCalledTimes(1);
  });

  it("falls open to the baseline list when the expansion agent throws", async () => {
    runDiagnosisExpansion.mockRejectedValue(new Error("model exploded"));
    const baseline = [item("bed"), item("nightstand")];
    const result = await runFullDiagnosisExpansion(
      baseArgs({ baselineActionList: baseline }),
    );
    expect(result).toEqual({
      expandedActionList: baseline,
      expansionLog: null,
      siblingRoomCount: 0,
    });
  });

  it("still expands when the sibling and budget DB reads both fail (best-effort context)", async () => {
    const expanded = [item("sofa"), item("area_rug"), item("throw_pillow")];
    runDiagnosisExpansion.mockResolvedValue({
      expanded_items: expanded,
      decision_log: null,
      added_count: 1,
      stop_reason: "saturated",
    });
    const supabase = makeSupabase({ singleThrows: true, limitThrows: true });

    const result = await runFullDiagnosisExpansion(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseArgs({ supabase: supabase as any }),
    );

    // The two context helpers swallow their own errors and return null, so the
    // expansion still runs and its output is returned; sibling count is 0.
    expect(result.expandedActionList).toBe(expanded);
    expect(result.siblingRoomCount).toBe(0);
    expect(runDiagnosisExpansion).toHaveBeenCalledTimes(1);
    // Budget context degraded to null -> passed through to the expansion call.
    const passedBudget = runDiagnosisExpansion.mock.calls[0][0].budget;
    expect(passedBudget).toBeNull();
  });

  // Regression guard: buildExpansionBudgetContext / fetchSiblingRoomSummaries
  // destructured only `data` from their Supabase calls, discarding `error`.
  // A real DB failure resolves IN-BAND as {data: null, error} — it never
  // throws — so the surrounding try/catch alone never observed it, and
  // nothing was logged server-side. Both now capture and log the error.
  it("logs a warning when the budget lookup fails with a real (non-PGRST116) DB error", async () => {
    runDiagnosisExpansion.mockResolvedValue({
      expanded_items: [item("sofa")],
      decision_log: null,
      added_count: 0,
      stop_reason: "saturated",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = makeSupabase({
      budgetError: { code: "53300", message: "too many connections" },
    });
    await runFullDiagnosisExpansion(baseArgs({ supabase: supabase as unknown as never }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("buildExpansionBudgetContext: room lookup error"),
    );
    warnSpy.mockRestore();
  });

  it("does NOT log when the budget lookup errors with PGRST116 (genuine no-row)", async () => {
    runDiagnosisExpansion.mockResolvedValue({
      expanded_items: [item("sofa")],
      decision_log: null,
      added_count: 0,
      stop_reason: "saturated",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = makeSupabase({
      budgetError: { code: "PGRST116", message: "no rows" },
    });
    await runFullDiagnosisExpansion(baseArgs({ supabase: supabase as unknown as never }));
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("buildExpansionBudgetContext"),
    );
    warnSpy.mockRestore();
  });

  it("logs a warning when the siblingRooms lookup fails with a real DB error", async () => {
    runDiagnosisExpansion.mockResolvedValue({
      expanded_items: [item("sofa")],
      decision_log: null,
      added_count: 0,
      stop_reason: "saturated",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = makeSupabase({
      siblingsError: { code: "53300", message: "too many connections" },
    });
    await runFullDiagnosisExpansion(baseArgs({ supabase: supabase as unknown as never }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fetchSiblingRoomSummaries: siblingRooms lookup error"),
    );
    warnSpy.mockRestore();
  });
});
