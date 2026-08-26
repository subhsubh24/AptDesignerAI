import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// External collaborators mocked so the test exercises the route's own control
// flow (auth gate, signup-window query, idempotency, engaged-user drop-out,
// opt-out, claim-before-send) without a real Supabase, email provider, or secret.
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ delivered: false, dryRun: true })),
  isEmailDryRun: vi.fn(() => true),
}));
vi.mock("@/lib/email/preferences", () => ({
  getMarketingOptOutMap: vi.fn(async (userIds: string[]) => new Map(userIds.map((id) => [id, false]))),
}));

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { getMarketingOptOutMap } from "@/lib/email/preferences";
import { GET } from "@/app/api/cron/activation-emails/route";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockSendEmail = sendEmail as unknown as Mock;
const mockOptOutMap = getMarketingOptOutMap as unknown as Mock;

const SECRET = "test-cron-secret";

// A minimal admin double: the profiles signup-window query returns the configured
// users; each has no project (not engaged) unless `engaged` is set; no prior
// email-stage rows unless specified; a real email on file. The claim INSERT into
// user_email_stages can be forced to fail, and released (DELETE) claims recorded.
function fakeAdmin(
  opts: {
    userIds?: string[];
    engaged?: boolean;
    alreadySentStages?: string[];
    claimError?: string;
    releasedStages?: string[];
  } = {},
) {
  const userIds = opts.userIds ?? ["user-1"];
  const alreadySent = new Set(opts.alreadySentStages ?? []);
  const released = opts.releasedStages;
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const state: { table: string; stage?: string; op?: string } = { table };
      Object.assign(builder, {
        select: () => builder,
        eq: (col: string, val: string) => {
          if (col === "stage") {
            state.stage = val;
            // Terminal for the claim-release DELETE chain (.delete().eq().eq()).
            if (state.op === "delete" && released) released.push(val);
          }
          return builder;
        },
        gte: () => builder,
        limit: () => builder,
        // profiles signup-window query resolves here (awaited directly).
        lt: async () => {
          if (state.table === "profiles") {
            return { data: userIds.map((id) => ({ id })), error: null };
          }
          return { data: [], error: null };
        },
        maybeSingle: async () => {
          // projects engaged-check: return a row when the user is "engaged".
          if (state.table === "projects") {
            return { data: opts.engaged ? { id: "proj-1" } : null, error: null };
          }
          // user_email_stages idempotency check.
          return {
            data: state.stage && alreadySent.has(state.stage) ? { id: "x" } : null,
            error: null,
          };
        },
        // Batched idempotency (user_email_stages) / engaged (projects) checks:
        // one .in("user_id", ids) query per stage for the whole cohort.
        in: async (_col: string, ids: string[]) => {
          if (state.table === "user_email_stages") {
            const sentIds = state.stage && alreadySent.has(state.stage) ? ids : [];
            return { data: sentIds.map((user_id) => ({ user_id })), error: null };
          }
          if (state.table === "projects") {
            const engagedIds = opts.engaged ? ids : [];
            return { data: engagedIds.map((user_id) => ({ user_id })), error: null };
          }
          return { data: [], error: null };
        },
        // Claim-before-send INSERT: fail with claimError when configured.
        insert: async () =>
          opts.claimError ? { error: { message: opts.claimError } } : { error: null },
        delete: () => {
          state.op = "delete";
          return builder;
        },
      });
      return builder;
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "new@example.com" } }, error: null }),
      },
    },
  };
}

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/activation-emails", {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  mockGetAdmin.mockReset();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ delivered: false, dryRun: true });
  mockOptOutMap.mockReset();
  mockOptOutMap.mockImplementation(async (userIds: string[]) => new Map(userIds.map((id) => [id, false])));
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/cron/activation-emails", () => {
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

  it("sends the activation sequence to a signed-up-but-inactive user (dry-run)", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const stagesSent = mockSendEmail.mock.calls.map((c) => c[0].stage).sort();
    expect(stagesSent).toEqual(["activation_1", "activation_2", "activation_3"]);
    for (const call of mockSendEmail.mock.calls) {
      expect(call[0].to).toBe("new@example.com");
    }
  });

  it("drops out users who have already engaged (have a project)", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"], engaged: true }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips a stage already recorded in user_email_stages (idempotent)", async () => {
    mockGetAdmin.mockReturnValue(
      fakeAdmin({
        userIds: ["user-1"],
        alreadySentStages: ["activation_1", "activation_2", "activation_3"],
      }),
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips users who opted out of marketing (CAN-SPAM)", async () => {
    mockOptOutMap.mockImplementation(async (userIds: string[]) => new Map(userIds.map((id) => [id, true])));
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send when the stage claim loses to a concurrent run (duplicate key)", async () => {
    // Claim-before-send: the INSERT into user_email_stages fails on the unique
    // (user_id, stage) constraint because another run already claimed it → skip,
    // never send. This is what prevents the double-send on an at-least-once retry.
    mockGetAdmin.mockReturnValue(
      fakeAdmin({ userIds: ["user-1"], claimError: "duplicate key value violates unique constraint" }),
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(body.results.every((r: { sent: number }) => r.sent === 0)).toBe(true);
  });

  it("releases the claim (DELETE) when the send fails so a later run can retry", async () => {
    // Send fails AFTER the claim was written → the marker must be removed,
    // otherwise the stage would be stuck as "sent" forever and never retried.
    mockSendEmail.mockResolvedValue({ error: "resend 500" });
    const releasedStages: string[] = [];
    mockGetAdmin.mockReturnValue(fakeAdmin({ userIds: ["user-1"], releasedStages }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalled();
    expect(releasedStages).toEqual(["activation_1", "activation_2", "activation_3"]);
    const body = await res.json();
    expect(
      body.results.every((r: { sent: number; errors: number }) => r.sent === 0 && r.errors > 0),
    ).toBe(true);
  });
});
