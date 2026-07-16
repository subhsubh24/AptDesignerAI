import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// External collaborators mocked so the test exercises the route's own control
// flow (auth gate, first-analysis window query, idempotency, paid-tier drop-out,
// opt-out, send) without a real Supabase, email provider, entitlement lookup, or
// CRON secret.
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ delivered: false, dryRun: true })),
}));
vi.mock("@/lib/email/preferences", () => ({ isMarketingOptedOut: vi.fn(async () => false) }));
vi.mock("@/lib/entitlements/web", () => ({ hasProEntitlementWeb: vi.fn(async () => false) }));

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { isMarketingOptedOut } from "@/lib/email/preferences";
import { hasProEntitlementWeb } from "@/lib/entitlements/web";
import { GET } from "@/app/api/cron/habit-emails/route";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockSendEmail = sendEmail as unknown as Mock;
const mockOptedOut = isMarketingOptedOut as unknown as Mock;
const mockHasPro = hasProEntitlementWeb as unknown as Mock;

const SECRET = "test-cron-secret";

// A minimal admin double: for every stage's room_diagnoses window it returns the
// configured users (nested owner-chain embed), optionally with duplicate rows so
// the route's de-dup is exercised; no prior email-stage rows unless specified; a
// real email on file.
function fakeAdmin(
  opts: { userIds?: string[]; duplicateRows?: boolean; alreadySentStages?: string[] } = {},
) {
  const userIds = opts.userIds ?? ["user-1"];
  const alreadySent = new Set(opts.alreadySentStages ?? []);
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const state: { table: string; stage?: string } = { table };
      Object.assign(builder, {
        select: () => builder,
        eq: (col: string, val: string) => {
          if (col === "stage") state.stage = val;
          return builder;
        },
        gte: () => builder,
        // room_diagnoses window query resolves here (awaited directly).
        lt: async () => {
          if (state.table === "room_diagnoses") {
            const rows = userIds.map((user_id) => ({ rooms: { projects: { user_id } } }));
            // Optionally add a duplicate of the first user to prove de-dup.
            if (opts.duplicateRows && userIds.length) {
              rows.push({ rooms: { projects: { user_id: userIds[0] } } });
            }
            return { data: rows, error: null };
          }
          return { data: [], error: null };
        },
        maybeSingle: async () => ({
          data: state.stage && alreadySent.has(state.stage) ? { id: "x" } : null,
          error: null,
        }),
        insert: async () => ({ error: null }),
      });
      return builder;
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "free@example.com" } }, error: null }),
      },
    },
  };
}

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/habit-emails", {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  mockGetAdmin.mockReset();
  mockSendEmail.mockClear();
  mockOptedOut.mockReset();
  mockOptedOut.mockResolvedValue(false);
  mockHasPro.mockReset();
  mockHasPro.mockResolvedValue(false);
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/cron/habit-emails", () => {
  it("returns 503 when CRON_SECRET is not configured (and never queries)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(mockGetAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong bearer token", async () => {
    const res = await GET(req("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(mockGetAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 503 when the admin client is unavailable", async () => {
    mockGetAdmin.mockReturnValue(null);
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });

  it("sends the habit sequence to a free-tier user (dry-run) and records each stage", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Three stages fire for a user matching all three windows in the double.
    const stagesSent = mockSendEmail.mock.calls.map((c) => c[0].stage).sort();
    expect(stagesSent).toEqual(["habit_1", "habit_2", "habit_3"]);
    for (const call of mockSendEmail.mock.calls) {
      expect(call[0].to).toBe("free@example.com");
    }
  });

  it("de-duplicates a user with multiple analyses in one window to a single send per stage", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"], duplicateRows: true }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    // Despite two diagnosis rows per window, only one send fires per stage.
    const habit1Sends = mockSendEmail.mock.calls.filter((c) => c[0].stage === "habit_1");
    expect(habit1Sends).toHaveLength(1);
  });

  it("drops out users who have already upgraded to a paid plan", async () => {
    mockHasPro.mockResolvedValue(true);
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips a stage already recorded in user_email_stages (idempotent)", async () => {
    mockGetAdmin.mockReturnValue(
      fakeAdmin({ userIds: ["user-1"], alreadySentStages: ["habit_1", "habit_2", "habit_3"] }),
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips users who opted out of marketing (CAN-SPAM)", async () => {
    mockOptedOut.mockResolvedValue(true);
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
