import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin client factory so we can drive each branch of the fail-closed
// suppression logic without a real Supabase connection.
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(),
}));

import { isMarketingOptedOut } from "@/lib/email/preferences";
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
