import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin client factory so we can drive each branch of the fail-closed
// suppression logic without a real Supabase connection.
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(),
}));

import { isMarketingOptedOut, getMarketingOptOutMap } from "@/lib/email/preferences";
import { getAdminClient } from "@/lib/supabase/admin";

const mockGetAdminClient = getAdminClient as unknown as ReturnType<typeof vi.fn>;

/** Build a fake admin client whose preference query resolves to the given result. */
function adminReturning(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as ReturnType<typeof getAdminClient>;
}

describe("isMarketingOptedOut", () => {
  beforeEach(() => {
    mockGetAdminClient.mockReset();
  });

  it("treats a missing row as subscribed (not opted out)", async () => {
    const admin = adminReturning({ data: null, error: null });
    expect(await isMarketingOptedOut("user-1", admin)).toBe(false);
  });

  it("suppresses when the user has explicitly opted out", async () => {
    const admin = adminReturning({ data: { marketing_emails: false }, error: null });
    expect(await isMarketingOptedOut("user-1", admin)).toBe(true);
  });

  it("does not suppress when the user is explicitly subscribed", async () => {
    const admin = adminReturning({ data: { marketing_emails: true }, error: null });
    expect(await isMarketingOptedOut("user-1", admin)).toBe(false);
  });

  it("fails CLOSED (suppresses) on a query error", async () => {
    const admin = adminReturning({ data: null, error: { message: "boom" } });
    expect(await isMarketingOptedOut("user-1", admin)).toBe(true);
  });

  it("fails CLOSED (suppresses) when no admin client is available", async () => {
    mockGetAdminClient.mockReturnValue(null);
    // No client passed → falls back to getAdminClient(), which returns null.
    expect(await isMarketingOptedOut("user-1")).toBe(true);
  });
});

/** Build a fake admin client whose batched `.in()` preference query resolves to the given result. */
function adminReturningBatch(result: { data: unknown; error: unknown }) {
  const inFn = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as ReturnType<typeof getAdminClient>;
}

describe("getMarketingOptOutMap", () => {
  beforeEach(() => {
    mockGetAdminClient.mockReset();
  });

  it("returns an empty map for an empty cohort without querying", async () => {
    const admin = adminReturningBatch({ data: [], error: null });
    const result = await getMarketingOptOutMap([], admin);
    expect(result.size).toBe(0);
  });

  it("resolves a mixed cohort per-user: opted-out, subscribed, and missing-row default to their own outcome, not each other's", async () => {
    // The exact bug class this test guards against: a mis-keyed batch result
    // (one user's row leaking onto another) can't be caught by a single-user
    // cohort — it only manifests when outcomes genuinely differ per user.
    const admin = adminReturningBatch({
      data: [
        { user_id: "opted-out", marketing_emails: false },
        { user_id: "subscribed", marketing_emails: true },
        // "missing-row" has no row at all — must default to subscribed (false).
      ],
      error: null,
    });
    const result = await getMarketingOptOutMap(["opted-out", "subscribed", "missing-row"], admin);
    expect(result.get("opted-out")).toBe(true);
    expect(result.get("subscribed")).toBe(false);
    expect(result.get("missing-row")).toBe(false);
  });

  it("fails CLOSED (suppresses every user in the cohort) on a batch query error", async () => {
    const admin = adminReturningBatch({ data: null, error: { message: "boom" } });
    const result = await getMarketingOptOutMap(["user-1", "user-2"], admin);
    expect(result.get("user-1")).toBe(true);
    expect(result.get("user-2")).toBe(true);
  });

  it("fails CLOSED (suppresses every user in the cohort) when no admin client is available", async () => {
    mockGetAdminClient.mockReturnValue(null);
    const result = await getMarketingOptOutMap(["user-1", "user-2"]);
    expect(result.get("user-1")).toBe(true);
    expect(result.get("user-2")).toBe(true);
  });
});
