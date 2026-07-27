/**
 * POST /api/auth/forgot-password — the PER-ADDRESS send budget (Track G).
 *
 * The route already carried a per-IP limit, but that bounds how fast one SENDER
 * can act, not how much mail one VICTIM receives: a distributed sender gets a
 * fresh per-IP budget from every address it holds and can fill a single inbox
 * indefinitely. `RATE_LIMITS.passwordResetPerEmail` bounds the inbox.
 *
 * The subtle half is the RESPONSE. Returning a 429 on an exhausted address
 * would hand an attacker two things this endpoint exists to withhold: a signal
 * that someone recently requested a reset for that address, and a way to lock a
 * real user out of their own recovery by burning the victim's budget until they
 * hit a visible error. So exhaustion must be INDISTINGUISHABLE from a normal
 * request — same status, same body — with only the send suppressed. These tests
 * pin exactly that, since it is the property a well-meaning "add a proper 429"
 * refactor would quietly destroy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGenerateLink = vi.fn();
const mockGetAdminClient = vi.fn();
const mockSendEmail = vi.fn();
const mockVerifyTurnstile = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockGetAdminClient(),
}));
vi.mock("@/lib/security/turnstile", () => ({
  verifyTurnstile: (...args: unknown[]) => mockVerifyTurnstile(...args),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  isEmailDryRun: () => !process.env.RESEND_API_KEY,
}));

import { POST } from "@/app/api/auth/forgot-password/route";
import { RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { NextRequest } from "next/server";

const PER_EMAIL_LIMIT = RATE_LIMITS.passwordResetPerEmail.maxRequests;

let ipSeq = 0;
/**
 * A fresh IP for every request, so the route's own per-IP limiter can never be
 * what stops a send here. Without this the tests would pass even if the
 * per-address budget did nothing at all.
 */
function freshIp(): string {
  ipSeq += 1;
  return `172.16.${Math.floor(ipSeq / 250) % 250}.${ipSeq % 250}`;
}

let emailSeq = 0;
/** A distinct address per test — the budget is module-scoped and persists. */
function freshEmail(): string {
  emailSeq += 1;
  return `victim${emailSeq}@example.com`;
}

function post(email: string) {
  return POST(
    new NextRequest("https://app.test/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": freshIp() },
      body: JSON.stringify({ email }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.test";
  mockVerifyTurnstile.mockResolvedValue({ success: true });
  mockGenerateLink.mockResolvedValue({
    data: { properties: { hashed_token: "tok_abc123" } },
    error: null,
  });
  mockGetAdminClient.mockReturnValue({
    auth: { admin: { generateLink: (...a: unknown[]) => mockGenerateLink(...a) } },
  });
  mockSendEmail.mockResolvedValue({ delivered: true, dryRun: false, id: "msg_1" });
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("per-address budget — bounds the victim's inbox", () => {
  it("stops sending once one address exhausts its budget, even from new IPs each time", () => {
    // The whole point: every request below comes from a DIFFERENT IP, so the
    // per-IP limiter never fires. Only a per-address bound can stop this.
    const email = freshEmail();
    return (async () => {
      for (let i = 0; i < PER_EMAIL_LIMIT; i++) {
        await post(email);
      }
      expect(mockSendEmail).toHaveBeenCalledTimes(PER_EMAIL_LIMIT);

      await post(email);
      await post(email);
      expect(mockSendEmail).toHaveBeenCalledTimes(PER_EMAIL_LIMIT);
    })();
  });

  it("still makes the SAME provider call while suppressed, so latency cannot leak the cooldown", async () => {
    const email = freshEmail();
    for (let i = 0; i < PER_EMAIL_LIMIT; i++) await post(email);
    const linkCallsAtLimit = mockGenerateLink.mock.calls.length;

    await post(email);

    // generateLink is an awaited network round-trip. Skipping it while
    // suppressed would make those responses measurably FASTER and leak, by
    // latency, the fact the identical body and status exist to hide — the same
    // timing oracle the waitUntil on the send was written to avoid. Both paths
    // must do the same work; only the mail differs.
    expect(mockGenerateLink.mock.calls.length).toBe(linkCallsAtLimit + 1);
    // …and the mail is what actually got suppressed.
    expect(mockSendEmail).toHaveBeenCalledTimes(PER_EMAIL_LIMIT);
  });

  it("bounds each address independently", async () => {
    const a = freshEmail();
    const b = freshEmail();
    for (let i = 0; i < PER_EMAIL_LIMIT + 2; i++) await post(a);
    const sendsAfterA = mockSendEmail.mock.calls.length;

    await post(b);

    // One victim's exhausted budget must not deny an unrelated user their reset.
    expect(mockSendEmail.mock.calls.length).toBe(sendsAfterA + 1);
  });

  it("normalises the address, so casing and padding cannot buy extra sends", async () => {
    const email = freshEmail();
    for (let i = 0; i < PER_EMAIL_LIMIT; i++) await post(email);
    const atLimit = mockSendEmail.mock.calls.length;

    await post(`  ${email.toUpperCase()}  `);

    expect(mockSendEmail.mock.calls.length).toBe(atLimit);
  });
});

describe("per-address budget — exhaustion must be invisible", () => {
  it("returns the SAME status and body as a normal request", async () => {
    const email = freshEmail();

    const first = await post(email);
    const firstBody = await first.json();

    for (let i = 1; i < PER_EMAIL_LIMIT; i++) await post(email);
    const overBudget = await post(email);
    const overBudgetBody = await overBudget.json();

    // Any divergence here is a probe: it would tell an attacker that this
    // address has recently been the target of a reset request.
    expect(overBudget.status).toBe(first.status);
    expect(overBudget.status).toBe(200);
    expect(overBudgetBody).toEqual(firstBody);
    expect(overBudgetBody).toEqual({ ok: true });
  });

  it("never answers 429 for an over-budget address", async () => {
    const email = freshEmail();
    for (let i = 0; i < PER_EMAIL_LIMIT + 3; i++) {
      const res = await post(email);
      // A 429 would also be a denial-of-recovery weapon: an attacker could burn
      // a victim's budget to make their own reset attempts visibly fail.
      expect(res.status).not.toBe(429);
      expect(res.status).toBe(200);
    }
  });

  it("still refuses an invalid address before consuming any budget", async () => {
    const res = await POST(
      new NextRequest("https://app.test/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": freshIp() },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("it is a COOLDOWN, not a quota — the distinction is the whole design", () => {
  it("is configured as a short window, so recovery can never be switched off", () => {
    // A quota ("N per address per hour") would be a denial-of-recovery weapon:
    // the per-IP limit is 3 per 15 min and Turnstile fails OPEN while
    // TURNSTILE_SECRET_KEY is unset, so one anonymous caller could exhaust a
    // small hourly quota and stop a real user receiving ANY reset mail for the
    // rest of the hour. A short window cannot be held shut that way.
    expect(RATE_LIMITS.passwordResetPerEmail.windowMs).toBeLessThanOrEqual(5 * 60_000);
    expect(RATE_LIMITS.passwordResetPerEmail.windowMs).toBeGreaterThanOrEqual(30_000);
  });

  it("lets the NEXT window through, so a flood keeps delivering a fresh link", async () => {
    vi.useFakeTimers();
    try {
      const email = freshEmail();
      await post(email);
      const afterFirst = mockSendEmail.mock.calls.length;

      await post(email);
      // Suppressed inside the window…
      expect(mockSendEmail.mock.calls.length).toBe(afterFirst);

      vi.advanceTimersByTime(RATE_LIMITS.passwordResetPerEmail.windowMs + 1_000);
      await post(email);
      // …and through again after it. This is why suppression never denies
      // recovery: the victim of a flood always holds a link at most one window
      // old, delivered by the attacker's own requests.
      expect(mockSendEmail.mock.calls.length).toBe(afterFirst + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
