import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// External collaborators mocked so the test exercises the route's own control
// flow (auth gate, cancelled-window query, idempotency, opt-out, send) without a
// real Supabase, email provider, or CRON secret.
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ delivered: false, dryRun: true })),
}));
vi.mock("@/lib/email/preferences", () => ({ isMarketingOptedOut: vi.fn(async () => false) }));

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { isMarketingOptedOut } from "@/lib/email/preferences";
import { GET } from "@/app/api/cron/winback-emails/route";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockSendEmail = sendEmail as unknown as Mock;
const mockOptedOut = isMarketingOptedOut as unknown as Mock;

const SECRET = "test-cron-secret";

// A minimal admin double: one cancelled subscriber in the day-7 window, none in
// day-30; no prior email-stage rows; a real email on file.
function fakeAdmin(opts: { cancelledUserIds?: string[]; alreadySentStages?: string[] } = {}) {
  const cancelledUserIds = opts.cancelledUserIds ?? ["user-1"];
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
        // stripe_customers window query resolves here (awaited directly).
        lt: async () => {
          if (state.table === "stripe_customers") {
            // Only the winback_2 (day-7) window returns a candidate; the code
            // issues one query per stage, so alternate by call is unnecessary —
            // return the candidate for both and let idempotency handle repeats.
            return { data: cancelledUserIds.map((user_id) => ({ user_id })), error: null };
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
        getUserById: async () => ({ data: { user: { email: "gone@example.com" } }, error: null }),
      },
    },
  };
}

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/winback-emails", {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  mockGetAdmin.mockReset();
  mockSendEmail.mockClear();
  mockOptedOut.mockReset();
  mockOptedOut.mockResolvedValue(false);
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/cron/winback-emails", () => {
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

  it("sends a win-back email to a cancelled subscriber (dry-run) and records it", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({ cancelledUserIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Two stages (winback_2 + winback_3); the same candidate matches both
    // windows in the double, so exactly two sends fire — one per stage.
    expect(mockSendEmail).toHaveBeenCalled();
    const stagesSent = mockSendEmail.mock.calls.map((c) => c[0].stage).sort();
    expect(stagesSent).toContain("winback_2");
    expect(stagesSent).toContain("winback_3");
    // Every send targets the recovered email address.
    for (const call of mockSendEmail.mock.calls) {
      expect(call[0].to).toBe("gone@example.com");
    }
  });

  it("skips a stage already recorded in user_email_stages (idempotent)", async () => {
    mockGetAdmin.mockReturnValue(
      fakeAdmin({ cancelledUserIds: ["user-1"], alreadySentStages: ["winback_2", "winback_3"] }),
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips users who opted out of marketing (CAN-SPAM)", async () => {
    mockOptedOut.mockResolvedValue(true);
    mockGetAdmin.mockReturnValue(fakeAdmin({ cancelledUserIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
