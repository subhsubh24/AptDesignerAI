import { describe, it, expect, vi, beforeEach } from "vitest";

// Drive fetchDiagnosisExamples()'s two-tier query + dedup + shaping without a
// real Supabase connection. These few-shot examples feed the Pass-2 diagnosis
// prompt, so a silent bug here (duplicated example, wrong count, malformed
// action_list) degrades output quality invisibly.
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(),
}));

import {
  fetchDiagnosisExamples,
  formatExamplesForPrompt,
  type DiagnosisExample,
} from "@/lib/db/diagnosis-examples";
import { getAdminClient } from "@/lib/supabase/admin";

const mockGetAdminClient = getAdminClient as unknown as ReturnType<typeof vi.fn>;

/**
 * A chainable query-builder stub. Every filter method returns the same builder;
 * the terminal `.limit()` resolves to the next queued `{ data }` result, so the
 * exact-match query and the fallback query each get their own result in order.
 */
function makeAdmin(results: Array<{ data: unknown }>) {
  const queue = [...results];
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    const passthrough = () => builder;
    for (const m of ["select", "eq", "in", "gte", "neq", "order"]) {
      builder[m] = vi.fn(passthrough);
    }
    builder.limit = vi.fn(() => Promise.resolve(queue.shift() ?? { data: [] }));
    return builder;
  });
  return { admin: { from } as unknown as ReturnType<typeof getAdminClient>, from };
}

/** A valid action_list row with `n` items (each item passes the action+category filter). */
function rowWithItems(id: string, direction: string, n: number) {
  return {
    id,
    room_type: "living room",
    design_direction_label: direction,
    action_list: Array.from({ length: n }, (_, i) => ({
      priority: i + 1,
      action: `action ${i}`,
      category: "seating",
      reasoning: "because",
    })),
  };
}

describe("fetchDiagnosisExamples", () => {
  beforeEach(() => mockGetAdminClient.mockReset());

  it("returns [] when the admin client is unavailable", async () => {
    mockGetAdminClient.mockReturnValue(null);
    expect(await fetchDiagnosisExamples("living room", "Coastal")).toEqual([]);
  });

  it("returns [] when roomType is empty (never queries)", async () => {
    const { admin, from } = makeAdmin([]);
    mockGetAdminClient.mockReturnValue(admin);
    expect(await fetchDiagnosisExamples("", "Coastal")).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the exact-direction matches without running the fallback query", async () => {
    const { admin, from } = makeAdmin([
      { data: [rowWithItems("a", "Coastal", 6), rowWithItems("b", "Farmhouse", 6)] },
    ]);
    mockGetAdminClient.mockReturnValue(admin);

    const result = await fetchDiagnosisExamples("living room", "Coastal");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.designDirection)).toEqual(["Coastal", "Farmhouse"]);
    // Two full matches -> only the first (exact) query runs.
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("tops up from the fallback query and de-dupes the already-seen row", async () => {
    // Exact query returns 1 row ("a"); fallback overfetches and INCLUDES "a"
    // again plus a fresh "c". The dedup must drop the repeat and keep the count
    // at MAX_EXAMPLES (2), never echoing "a" twice.
    const { admin, from } = makeAdmin([
      { data: [rowWithItems("a", "Coastal", 6)] },
      { data: [rowWithItems("a", "Coastal", 6), rowWithItems("c", "Modern", 6)] },
    ]);
    mockGetAdminClient.mockReturnValue(admin);

    const result = await fetchDiagnosisExamples("living room", "Coastal");

    expect(from).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    const dirs = result.map((r) => r.designDirection);
    expect(dirs).toEqual(["Coastal", "Modern"]);
  });

  it("drops examples whose action_list has fewer than 3 usable items", async () => {
    // Row "d" has 2 items (below the >=3 keep threshold) -> filtered out.
    const { admin } = makeAdmin([
      { data: [rowWithItems("d", "Coastal", 2)] },
      { data: [] },
    ]);
    mockGetAdminClient.mockReturnValue(admin);

    expect(await fetchDiagnosisExamples("living room", "Coastal")).toEqual([]);
  });

  it("caps each example's action_list at 6 items", async () => {
    // 8 valid items -> only the first MAX_ITEMS_PER_EXAMPLE (6) are kept.
    const row = {
      id: "e",
      room_type: "living room",
      design_direction_label: "Coastal",
      action_list: Array.from({ length: 8 }, (_, i) => ({
        priority: i + 1,
        action: `a${i}`,
        category: "seating",
        reasoning: "r",
      })),
    };
    const { admin } = makeAdmin([{ data: [row] }, { data: [] }]);
    mockGetAdminClient.mockReturnValue(admin);

    const result = await fetchDiagnosisExamples("living room", "Coastal");
    expect(result).toHaveLength(1);
    expect(result[0].actionList).toHaveLength(6);
  });

  it("strips items missing an action or category from WITHIN the kept window", async () => {
    // The invalid item sits at index 1 — inside the 6-item cap window, so it is
    // reached by the action/category filter (not sliced away first). Without the
    // filter the result would keep it (6 items); with it, only 5 valid remain.
    const row = {
      id: "f",
      room_type: "living room",
      design_direction_label: "Coastal",
      action_list: [
        { priority: 1, action: "keep-0", category: "seating", reasoning: "r" },
        { priority: 2, action: "", category: "seating", reasoning: "r" }, // dropped: empty action
        { priority: 3, action: "keep-2", category: "lighting", reasoning: "r" },
        { priority: 4, action: "keep-3", category: "rugs", reasoning: "r" },
        { priority: 5, action: "keep-4", category: "art", reasoning: "r" },
        { priority: 6, action: "keep-5", category: "storage", reasoning: "r" },
        { priority: 7, action: "keep-6", category: "plants", reasoning: "r" }, // beyond the cap window
      ],
    };
    const { admin } = makeAdmin([{ data: [row] }, { data: [] }]);
    mockGetAdminClient.mockReturnValue(admin);

    const result = await fetchDiagnosisExamples("living room", "Coastal");
    expect(result).toHaveLength(1);
    // 6-item window minus the 1 invalid inside it = 5; the 7th (valid) item is
    // never reached because the cap slices before this row is considered.
    expect(result[0].actionList).toHaveLength(5);
    expect(result[0].actionList.every((it) => it.action && it.category)).toBe(true);
    expect(result[0].actionList.map((it) => it.action)).not.toContain("keep-6");
  });

  it("returns [] and swallows a thrown DB error (graceful degradation to zero-shot)", async () => {
    const admin = {
      from: vi.fn(() => {
        throw new Error("connection reset");
      }),
    } as unknown as ReturnType<typeof getAdminClient>;
    mockGetAdminClient.mockReturnValue(admin);

    expect(await fetchDiagnosisExamples("living room", "Coastal")).toEqual([]);
  });
});

describe("formatExamplesForPrompt", () => {
  it("returns an empty string for no examples (caller falls back to zero-shot)", () => {
    expect(formatExamplesForPrompt([])).toBe("");
  });

  it("wraps examples in a <few_shot_examples> block with per-example metadata", () => {
    const examples: DiagnosisExample[] = [
      {
        roomType: "living room",
        designDirection: "Coastal",
        actionList: [{ priority: 1, action: "add rug", category: "textiles", reasoning: "warmth" }],
      },
    ];
    const out = formatExamplesForPrompt(examples);
    expect(out).toContain("<few_shot_examples>");
    expect(out).toContain('room_type="living room"');
    expect(out).toContain('design_direction="Coastal"');
    expect(out).toContain("add rug");
  });
});
