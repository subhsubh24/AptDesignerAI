import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));

import { getAdminClient } from "@/lib/supabase/admin";
import { GET as UNSUBSCRIBE } from "@/app/api/waitlist/unsubscribe/route";

const mockGetAdmin = getAdminClient as unknown as Mock;

const VALID_ID = "9c6f4e2a-1b3d-4a7e-9c0a-2f8e6d1b5a3c";

// Configurable Supabase-shaped fake mirroring the one in
// __tests__/api/waitlist-double-opt-in.test.ts (no shared test-helper module
// exists in this repo — each test file defines its own local fake).
interface Handlers {
  updateResult?: () => { error: unknown };
}
function fakeAdmin(h: Handlers) {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        update: () => builder,
        eq: () => builder,
        is: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(h.updateResult ? h.updateResult() : { error: null }).then(resolve),
      });
      return builder;
    },
  };
}

function unsubReq(id: string, ip?: string) {
  return new NextRequest(`http://localhost/api/waitlist/unsubscribe?id=${id}`, {
    headers: ip ? { "x-forwarded-for": ip } : undefined,
  });
}

describe("GET /api/waitlist/unsubscribe", () => {
  beforeEach(() => {
    mockGetAdmin.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to ?status=invalid for a malformed id without touching the DB", async () => {
    const res = await UNSUBSCRIBE(unsubReq("not-a-uuid", "1.1.1.1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/waitlist/confirmed");
    expect(res.headers.get("location")).toContain("status=invalid");
    expect(mockGetAdmin).not.toHaveBeenCalled();
  });

  it("redirects to ?status=unsubscribed on a successful update", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({}));
    const res = await UNSUBSCRIBE(unsubReq(VALID_ID, "2.2.2.2"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("status=unsubscribed");
  });

  it("redirects to ?status=invalid when the datastore errors", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({ updateResult: () => ({ error: new Error("boom") }) }));
    const res = await UNSUBSCRIBE(unsubReq(VALID_ID, "3.3.3.3"));
    expect(res.headers.get("location")).toContain("status=invalid");
  });

  it("redirects to ?status=invalid when the datastore is unavailable", async () => {
    mockGetAdmin.mockReturnValue(null);
    const res = await UNSUBSCRIBE(unsubReq(VALID_ID, "4.4.4.4"));
    expect(res.headers.get("location")).toContain("status=invalid");
  });

  it("is idempotent: re-clicking an already-unsubscribed link still redirects to unsubscribed, not an error", async () => {
    // .is("unsubscribed_at", null) means a second click matches zero rows —
    // that is NOT a Postgres error, so the route must not treat "0 rows
    // touched" as a failure the way /confirm treats "0 rows matched" as invalid.
    mockGetAdmin.mockReturnValue(fakeAdmin({ updateResult: () => ({ error: null }) }));
    const res = await UNSUBSCRIBE(unsubReq(VALID_ID, "5.5.5.5"));
    expect(res.headers.get("location")).toContain("status=unsubscribed");
  });

  it("rate-limits repeated requests from the same IP", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({}));
    let lastRes;
    for (let i = 0; i < 15; i++) {
      lastRes = await UNSUBSCRIBE(unsubReq(VALID_ID, "9.9.9.9"));
    }
    expect(lastRes!.headers.get("location")).toContain("status=invalid");
  });
});
