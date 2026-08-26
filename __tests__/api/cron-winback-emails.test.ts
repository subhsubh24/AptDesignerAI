import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// External collaborators mocked so the test exercises the route's own control
// flow (auth gate, cancelled-window query, idempotency, opt-out, send) without a
// real Supabase, email provider, or CRON secret.
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ delivered: false, dryRun: true })),
  isEmailDryRun: vi.fn(() => true),
}));
vi.mock("@/lib/email/preferences", () => ({
  getMarketingOptOutMap: vi.fn(async (userIds: string[]) => new Map(userIds.map((id) => [id, false]))),
}));

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailDryRun } from "@/lib/email";
import { getMarketingOptOutMap } from "@/lib/email/preferences";
import { GET } from "@/app/api/cron/winback-emails/route";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockSendEmail = sendEmail as unknown as Mock;
const mockDryRun = isEmailDryRun as unknown as Mock;
const mockOptOutMap = getMarketingOptOutMap as unknown as Mock;

const SECRET = "test-cron-secret";

// A minimal admin double: one cancelled subscriber in the day-7 window, none in
// day-30; no prior email-stage rows; a real email on file.
function fakeAdmin(
  opts: {
    cancelledUserIds?: string[];
    alreadySentStages?: string[];
    // Force the claim INSERT on user_email_stages to fail with this message
    // (e.g. "duplicate key value" to simulate a concurrent run winning the claim).
    claimError?: string;
    // Records every stage whose claim row was DELETEd (released on send failure).
    releasedStages?: string[];
    // Records every dry_run value written by a post-send reconcile UPDATE.
    reconciledDryRun?: boolean[];
  } = {},
) {
  const cancelledUserIds = opts.cancelledUserIds ?? ["user-1"];
  const alreadySent = new Set(opts.alreadySentStages ?? []);
  const released = opts.releasedStages;
  const reconciled = opts.reconciledDryRun;
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
        // Batched idempotency check: one .in("user_id", ids) query per stage
        // for the whole cohort instead of one per candidate.
        in: async (_col: string, ids: string[]) => {
          const sentIds = state.stage && alreadySent.has(state.stage) ? ids : [];
          return { data: sentIds.map((user_id) => ({ user_id })), error: null };
        },
        // Claim-before-send INSERT: fail with claimError when configured.
        insert: async () =>
          opts.claimError ? { error: { message: opts.claimError } } : { error: null },
        // Post-send reconcile UPDATE records the dry_run it writes.
        update: (payload: { dry_run?: boolean }) => {
          state.op = "update";
          if (reconciled && typeof payload.dry_run === "boolean") reconciled.push(payload.dry_run);
          return builder;
        },
        delete: () => {
          state.op = "delete";
          return builder;
        },
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
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ delivered: false, dryRun: true });
  mockDryRun.mockReset();
  mockDryRun.mockReturnValue(true);
  mockOptOutMap.mockReset();
  mockOptOutMap.mockImplementation(async (userIds: string[]) => new Map(userIds.map((id) => [id, false])));
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
    mockOptOutMap.mockImplementation(async (userIds: string[]) => new Map(userIds.map((id) => [id, true])));
    mockGetAdmin.mockReturnValue(fakeAdmin({ cancelledUserIds: ["user-1"] }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does NOT send when the stage claim loses to a concurrent run (duplicate key)", async () => {
    // Claim-before-send: the INSERT into user_email_stages fails on the unique
    // (user_id, stage) constraint because another run already claimed it. The
    // stage must be skipped, never sent — this is what prevents the double-send.
    mockGetAdmin.mockReturnValue(
      fakeAdmin({ cancelledUserIds: ["user-1"], claimError: "duplicate key value violates unique constraint" }),
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(body.results.every((r: { sent: number }) => r.sent === 0)).toBe(true);
  });

  it("reconciles dry_run when the send routed differently than the pre-send guess", async () => {
    // Live key present → isEmailDryRun() is false at claim time, but sendEmail
    // still dry-runs (e.g. a marketing stage with no physical address), returning
    // dryRun:true. The claim row (written dry_run:false) must be corrected to true.
    mockDryRun.mockReturnValue(false);
    mockSendEmail.mockResolvedValue({ delivered: false, dryRun: true });
    const reconciledDryRun: boolean[] = [];
    mockGetAdmin.mockReturnValue(fakeAdmin({ cancelledUserIds: ["user-1"], reconciledDryRun }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    // One reconcile UPDATE per stage sent, each correcting dry_run to true.
    expect(reconciledDryRun.length).toBeGreaterThan(0);
    expect(reconciledDryRun.every((v) => v === true)).toBe(true);
  });

  it("does NOT reconcile dry_run when the guess already matched the send", async () => {
    // isEmailDryRun() true and sendEmail dryRun:true agree → no wasted UPDATE.
    const reconciledDryRun: boolean[] = [];
    mockGetAdmin.mockReturnValue(fakeAdmin({ cancelledUserIds: ["user-1"], reconciledDryRun }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(reconciledDryRun).toHaveLength(0);
  });

  it("releases the claim (DELETE) when the send fails so a later run can retry", async () => {
    // Send fails AFTER the claim was written → the marker must be removed,
    // otherwise the stage would be permanently stuck as "sent" and never retried.
    mockSendEmail.mockResolvedValue({ error: "resend 500" });
    const releasedStages: string[] = [];
    mockGetAdmin.mockReturnValue(fakeAdmin({ cancelledUserIds: ["user-1"], releasedStages }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    // A send was attempted for each stage, and each failed claim was released.
    expect(mockSendEmail).toHaveBeenCalled();
    expect(releasedStages).toContain("winback_2");
    expect(releasedStages).toContain("winback_3");
    const body = await res.json();
    expect(body.results.every((r: { sent: number; errors: number }) => r.sent === 0 && r.errors > 0)).toBe(true);
  });
});
