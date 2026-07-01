import { describe, it, expect } from "vitest";
import { loadUserFeedbackContext } from "@/lib/agents/user-feedback";

// loadUserFeedbackContext turns past accept/reject decisions across a project
// into a scoring-prompt context block (cross-session learning). It fails
// CLOSED — any query error or empty result yields "" so scoring proceeds
// without stale/partial feedback. These tests mock the Supabase query builder
// to pin each branch + the formatting and the per-status cap.

type QueryResult = { data: unknown; error: unknown };

interface MockResults {
  rooms?: QueryResult;
  accepted?: QueryResult;
  rejected?: QueryResult;
}

function makeSupabase(results: MockResults) {
  const limitArgs: number[] = [];
  const supabase = {
    from(table: string) {
      const state: { status?: string } = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: string) => {
          if (col === "status") state.status = val;
          return builder;
        },
        in: () => builder,
        order: () => builder,
        limit: (n: number) => {
          limitArgs.push(n);
          return builder;
        },
        then: (resolve: (r: QueryResult) => void) => {
          let res: QueryResult | undefined;
          if (table === "rooms") res = results.rooms;
          else if (state.status === "accepted") res = results.accepted;
          else if (state.status === "rejected") res = results.rejected;
          resolve(res ?? { data: [], error: null });
        },
      };
      return builder;
    },
  };
  return { supabase, limitArgs };
}

const roomsOk: QueryResult = { data: [{ id: "room-1" }, { id: "room-2" }], error: null };

function product(overrides: Record<string, unknown> = {}) {
  return {
    title: "Oak Console Table",
    category: "storage",
    price: 349,
    product_evaluations: [{ final_item_score: 8.4 }],
    ...overrides,
  };
}

describe("loadUserFeedbackContext", () => {
  it("returns '' when the rooms lookup errors", async () => {
    const { supabase } = makeSupabase({ rooms: { data: null, error: { message: "boom" } } });
    expect(await loadUserFeedbackContext(supabase, "room-1", "proj-1")).toBe("");
  });

  it("returns '' when the project has no rooms", async () => {
    const { supabase } = makeSupabase({ rooms: { data: [], error: null } });
    expect(await loadUserFeedbackContext(supabase, "room-1", "proj-1")).toBe("");
  });

  it("returns '' (fails closed) when an evaluation query errors", async () => {
    const { supabase } = makeSupabase({
      rooms: roomsOk,
      accepted: { data: null, error: { message: "db down" } },
      rejected: { data: [product()], error: null },
    });
    expect(await loadUserFeedbackContext(supabase, "room-1", "proj-1")).toBe("");
  });

  it("returns '' when there is no accepted or rejected history", async () => {
    const { supabase } = makeSupabase({
      rooms: roomsOk,
      accepted: { data: [], error: null },
      rejected: { data: [], error: null },
    });
    expect(await loadUserFeedbackContext(supabase, "room-1", "proj-1")).toBe("");
  });

  it("renders only the ACCEPTED section when nothing was rejected", async () => {
    const { supabase } = makeSupabase({
      rooms: roomsOk,
      accepted: { data: [product()], error: null },
      rejected: { data: [], error: null },
    });
    const out = await loadUserFeedbackContext(supabase, "room-1", "proj-1");
    expect(out).toContain("## USER FEEDBACK FROM PAST SEARCHES");
    expect(out).toContain("ACCEPTED (user liked these):");
    expect(out).toContain('- "Oak Console Table" (storage, $349) — scored 8.4, user accepted');
    expect(out).not.toContain("REJECTED");
  });

  it("renders only the REJECTED section when nothing was accepted", async () => {
    const { supabase } = makeSupabase({
      rooms: roomsOk,
      accepted: { data: [], error: null },
      rejected: { data: [product({ title: "Glass Coffee Table" })], error: null },
    });
    const out = await loadUserFeedbackContext(supabase, "room-1", "proj-1");
    expect(out).toContain("REJECTED (user disliked these):");
    expect(out).toContain('- "Glass Coffee Table" (storage, $349) — scored 8.4, user rejected');
    expect(out).not.toContain("ACCEPTED");
  });

  it("renders both sections plus the calibration guidance", async () => {
    const { supabase } = makeSupabase({
      rooms: roomsOk,
      accepted: { data: [product({ title: "A" })], error: null },
      rejected: { data: [product({ title: "B" })], error: null },
    });
    const out = await loadUserFeedbackContext(supabase, "room-1", "proj-1");
    expect(out).toContain("ACCEPTED (user liked these):");
    expect(out).toContain("REJECTED (user disliked these):");
    expect(out).toContain("Use this feedback to calibrate");
    expect(out.indexOf("ACCEPTED")).toBeLessThan(out.indexOf("REJECTED"));
  });

  it("formats missing title/category/price/score defensively", async () => {
    const { supabase } = makeSupabase({
      rooms: roomsOk,
      accepted: {
        data: [{ title: null, category: null, price: null, product_evaluations: [] }],
        error: null,
      },
      rejected: { data: [], error: null },
    });
    const out = await loadUserFeedbackContext(supabase, "room-1", "proj-1");
    expect(out).toContain('- "Untitled" (unknown, N/A) — scored N/A, user accepted');
  });

  it("caps each status query at 10 items", async () => {
    const { supabase, limitArgs } = makeSupabase({
      rooms: roomsOk,
      accepted: { data: [product()], error: null },
      rejected: { data: [product()], error: null },
    });
    await loadUserFeedbackContext(supabase, "room-1", "proj-1");
    expect(limitArgs).toEqual([10, 10]);
  });
});
