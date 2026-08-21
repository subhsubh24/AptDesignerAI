import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// APT-54 (Run 180) narrowed the saved-designs POST snapshot-build path's two
// nested reads:
//   candidate_products: "*, product_evaluations(*)"        -> the 8 scalar
//     columns app/saved/[id]/page.tsx + SharedDesignView.tsx actually read
//     (product_evaluations was never field-accessed from the snapshot)
//   product_bundles:    "*, product_bundle_items(*), bundle_evaluations(*)"
//     -> "*" (the nested embeds were never field-accessed; snapshot.products.bundles
//     is stored as `unknown[]` with zero downstream field access)
// Reverting either select back to its old, wider form would compile, pass every
// OTHER test, and silently reintroduce the over-fetch — same failure mode
// __tests__/api/bundles-products-narrowed-embeds.test.ts guards for APT-48. This
// file is the APT-54 sibling (APT-57), asserting the exact select strings so a
// revert turns RED instead of passing silently. It also pins the two discarded-
// error branches added in the same change: diagnosisError (fail loud, not a
// masquerading 404) and projectError (log-only, save still proceeds).

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/entitlements/web", () => ({
  hasProEntitlementWeb: vi.fn(async () => true),
  FREE_SAVE_LIMIT_WEB: 3,
}));
vi.mock("@/lib/utils/api-error", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/api-error")>();
  return { ...actual, logServerError: vi.fn() };
});

import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { logServerError } from "@/lib/utils/api-error";
import { POST as savedDesignsPost } from "@/app/api/saved-designs/route";

const mockCreateClient = createClient as unknown as Mock;
const mockGetCurrentUserId = getCurrentUserId as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;
const mockLogServerError = logServerError as unknown as Mock;

type QueryResult = { data?: unknown; count?: number; error?: unknown };

// A thenable Supabase query stub: chain methods return `this`; awaiting the
// chain (or calling a terminal .single/.maybeSingle) resolves to the table's
// result. `onSelect` records the exact columns string passed to `.select()`.
function makeQuery(result: QueryResult, onSelect?: (columns: string) => void) {
  const chain: Record<string, unknown> = {};
  for (const m of ["eq", "order", "limit", "in", "update", "insert"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.select = vi.fn((columns: string) => {
    onSelect?.(columns);
    return chain;
  });
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: QueryResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

// `existing: { id: "sd-1" }` on saved_designs takes the UPDATE path, which
// skips the free-limit count query and entitlement check entirely — same
// simplification saved-designs-full-persistence.test.ts uses.
function makeClient(over: Partial<Record<string, QueryResult>>, selectCalls: Record<string, string[]>) {
  const results: Record<string, QueryResult> = {
    rooms: { data: { name: "Living Room", room_type: "living_room" }, error: null },
    room_diagnoses: {
      data: { diagnosis_json: { what_it_needs: [], summary: "s" }, design_direction_json: {} },
      error: null,
    },
    candidate_products: { data: [], error: null },
    product_bundles: { data: [], error: null },
    projects: { data: null, error: null },
    saved_designs: { data: { id: "sd-1" }, error: null },
    ...over,
  };
  return {
    from: vi.fn((table: string) =>
      makeQuery(results[table] ?? { data: null, error: null }, (columns) => {
        (selectCalls[table] ??= []).push(columns);
      }),
    ),
  };
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/saved-designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockGetCurrentUserId.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockLogServerError.mockReset();
  mockGetCurrentUserId.mockResolvedValue("user-1");
  mockRequireRoomOwnership.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("saved-designs POST — narrowed snapshot embeds (APT-54/APT-57)", () => {
  it("issues the exact narrowed select for candidate_products and product_bundles on a full-stage save", async () => {
    const selectCalls: Record<string, string[]> = {};
    mockCreateClient.mockResolvedValue(makeClient({}, selectCalls));

    const res = await savedDesignsPost(jsonReq({ room_id: "room-1", stage: "full" }) as never);

    expect(res.status).toBe(200);
    // Exact-match, not a substring/negative check: a revert to the old wider
    // embed string must fail this assertion outright.
    expect(selectCalls.candidate_products).toEqual([
      "id, title, category, retailer, product_url, image_url, price, metadata",
    ]);
    expect(selectCalls.product_bundles).toEqual(["*"]);
    // Belt-and-suspenders against the specific old strings, so a partial
    // revert (only one table widened back) still turns this red.
    expect(selectCalls.candidate_products[0]).not.toContain("product_evaluations");
    expect(selectCalls.product_bundles[0]).not.toContain("product_bundle_items");
    expect(selectCalls.product_bundles[0]).not.toContain("bundle_evaluations");
  });

  it("does not touch candidate_products/product_bundles on an assessment-stage save", async () => {
    const selectCalls: Record<string, string[]> = {};
    mockCreateClient.mockResolvedValue(makeClient({}, selectCalls));

    const res = await savedDesignsPost(jsonReq({ room_id: "room-1", stage: "assessment" }) as never);

    expect(res.status).toBe(200);
    expect(selectCalls.candidate_products).toBeUndefined();
    expect(selectCalls.product_bundles).toBeUndefined();
  });

  it("returns 500 (not the 404 'no analysis found') when the diagnosis read errors", async () => {
    const selectCalls: Record<string, string[]> = {};
    mockCreateClient.mockResolvedValue(
      makeClient({ room_diagnoses: { data: null, error: { message: "db down" } } }, selectCalls),
    );

    const res = await savedDesignsPost(jsonReq({ room_id: "room-1", stage: "assessment" }) as never);

    expect(res.status).toBe(500);
  });

  it("logs but does not fail the save when the project-bind read errors", async () => {
    const selectCalls: Record<string, string[]> = {};
    mockCreateClient.mockResolvedValue(
      makeClient({ projects: { data: null, error: { message: "db down" } } }, selectCalls),
    );

    const res = await savedDesignsPost(
      jsonReq({ room_id: "room-1", project_id: "proj-1", stage: "assessment" }) as never,
    );

    expect(res.status).toBe(200);
    expect(mockLogServerError).toHaveBeenCalledWith("saved-designs", { message: "db down" });
  });
});
