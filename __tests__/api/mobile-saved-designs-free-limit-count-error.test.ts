import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Regression guard: POST /api/mobile/saved-designs's free-limit COUNT query
// previously ignored its `error` field (`existingSaveCount ?? 0`). A transient
// DB error on that count reads as "0 saves so far", silently BYPASSING the free
// tier's save limit (and skipping the RevenueCat entitlement check) on every
// transient DB error — the same fail-open class fixed on the web route's
// sibling gate (__tests__/api/saved-designs-free-limit-count-error.test.ts).
// The fix fails loud (500).

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser }, from: mockFrom })),
}));
vi.mock("@/lib/entitlements/server", () => ({
  hasProEntitlement: vi.fn(async () => true),
  FREE_SAVE_LIMIT: 3,
}));

import { hasProEntitlement } from "@/lib/entitlements/server";
import { POST } from "@/app/api/mobile/saved-designs/route";

const mockHasProEntitlement = hasProEntitlement as unknown as Mock;

const VALID_ANALYSIS = {
  summary: "A warm mid-century living room with good bones but an undersized rug.",
  style_name: "Mid-Century Modern",
  design_direction: "Layer warm walnut tones against a soft neutral base.",
  recommended_palette: ["#8a5a44", "#efe7dc"],
  recommended_materials: ["walnut", "brass"],
  recommended_textures: ["boucle", "linen"],
  what_works: ["The leather lounge chair"],
  what_should_go: ["The black laminate TV stand"],
};

// A single chain object serves both call sites: the free-limit count query
// (`.select().eq()` then awaited directly via `.then`) and, if the count check
// passes, the insert (`.insert().select().single()`). Both live on the same
// `saved_designs` table but use disjoint chain methods, so one object can
// answer both.
function makeSavedDesignsChain(countResult: { count: number | null; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(countResult).then(resolve);
  chain.insert = vi.fn(() => {
    const ins: Record<string, unknown> = {};
    ins.select = vi.fn(() => ins);
    ins.single = vi.fn(() => Promise.resolve({ data: { id: "sd-1", title: "t" }, error: null }));
    return ins;
  });
  return chain;
}

function req() {
  return new NextRequest("http://localhost/api/mobile/saved-designs", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "content-type": "application/json" },
    body: JSON.stringify({ room_type: "living_room", analysis: VALID_ANALYSIS }),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockHasProEntitlement.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "mobile-user-1" } }, error: null });
  mockHasProEntitlement.mockResolvedValue(true);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mobile saved-designs POST — free-limit count-error integrity", () => {
  it("returns 500 (not a fail-open unlimited save) when the free-limit count query errors", async () => {
    mockFrom.mockReturnValue(makeSavedDesignsChain({ count: null, error: { message: "db down" } }));
    const res = await POST(req());
    expect(res.status).toBe(500);
    // Proves the guard fires before the limit/entitlement logic, not that the
    // limit logic happened to still deny for an unrelated reason.
    expect(mockHasProEntitlement).not.toHaveBeenCalled();
  });

  it("saves normally (201) when the count query succeeds and is under the limit", async () => {
    mockFrom.mockReturnValue(makeSavedDesignsChain({ count: 1, error: null }));
    const res = await POST(req());
    expect(res.status).toBe(201);
    expect(mockHasProEntitlement).not.toHaveBeenCalled();
  });
});
