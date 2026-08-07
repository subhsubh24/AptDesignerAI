/**
 * POST /api/auth/forgot-password — the three properties the route exists to
 * hold (see the route's own header): no fake success, enumeration safety, and
 * abuse limits on a public endpoint that sends mail to a supplied address.
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
import { NextRequest } from "next/server";

function req(body: unknown, ip = "1.2.3.4"): NextRequest {
  return new NextRequest("https://app.test/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

let ipSeq = 0;
/** A fresh IP per call so the module-scoped rate limiter doesn't bleed across tests. */
function freshIp(): string {
  ipSeq += 1;
  return `10.0.0.${ipSeq % 250}`;
}

let emailSeq = 0;
/**
 * A fresh recipient per call. The route now also caps sends PER ADDRESS, so a
 * shared literal like "user@example.com" would silently start returning the
 * suppressed (send-nothing) path once enough tests had used it — the same
 * cross-test bleed freshIp() exists to prevent, on the other bucket.
 */
function freshEmail(): string {
  emailSeq += 1;
  return `t${emailSeq}@example.com`;
}

describe("POST /api/auth/forgot-password", () => {
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

  it("sends the reset link and returns the neutral body", async () => {
    const res = await POST(req({ email: "Someone@Example.com " }, freshIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Normalised before use — a leading space / mixed case must not mint a link
    // for a different address than the one that gets the mail.
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recovery", email: "someone@example.com" }),
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "someone@example.com", stage: "password_reset" }),
    );
    // The link must carry the token_hash to OUR page. Mailing Supabase's
    // action_link instead would land the user on an implicit-flow callback that
    // the app's pkce-configured browser client refuses to process, so every
    // valid link would read as expired.
    expect(mockSendEmail.mock.calls[0][0].html).toContain(
      "https://app.test/reset-password?token_hash=tok_abc123&amp;type=recovery",
    );
  });

  it("refuses to build a link from a request Host header in production", async () => {
    // Without a configured site URL the origin would come from a caller-supplied
    // header — i.e. we would email a victim a one-time account-takeover
    // credential pointing at the attacker's domain.
    const prev = process.env.NODE_ENV;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    try {
      // @ts-expect-error test override
      process.env.NODE_ENV = "production";
      const res = await POST(req({ email: freshEmail() }, freshIp()));
      expect(res.status).toBe(503);
    } finally {
      // @ts-expect-error restore
      process.env.NODE_ENV = prev;
    }
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when generateLink succeeds but returns no token", async () => {
    // A provider-contract violation. Mailing a "here's your link" email with no
    // link, or claiming success while silently sending nothing, are both worse
    // than the neutral response plus a server-side error log.
    mockGenerateLink.mockResolvedValue({ data: { properties: {} }, error: null });
    const res = await POST(req({ email: freshEmail() }, freshIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns the SAME body for an unknown address as for a real one (no enumeration)", async () => {
    const known = await POST(req({ email: "known@example.com" }, freshIp()));
    const knownBody = await known.json();

    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });
    const unknown = await POST(req({ email: "nobody@example.com" }, freshIp()));

    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(knownBody);
    // ...and nothing was mailed to the address with no account.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("stays neutral when generateLink throws", async () => {
    mockGenerateLink.mockRejectedValue(new Error("boom"));
    const res = await POST(req({ email: freshEmail() }, freshIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("NEVER claims an email was sent while the provider is in dry-run", async () => {
    delete process.env.RESEND_API_KEY; // no provider => dry-run
    const res = await POST(req({ email: freshEmail() }, freshIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailUnavailable: true });
    // The whole point: no link minted, no send attempted, no "check your inbox".
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("fails visibly (503) when email is live but the admin client is missing", async () => {
    mockGetAdminClient.mockReturnValue(null);
    const res = await POST(req({ email: freshEmail() }, freshIp()));
    expect(res.status).toBe(503);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a malformed or oversized address before doing any work", async () => {
    for (const email of ["", "not-an-email", `${"a".repeat(250)}@example.com`]) {
      const res = await POST(req({ email }, freshIp()));
      expect(res.status).toBe(400);
    }
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("rejects a failed captcha before minting a link", async () => {
    mockVerifyTurnstile.mockResolvedValue({ success: false, reason: "invalid" });
    const res = await POST(req({ email: freshEmail() }, freshIp()));
    expect(res.status).toBe(400);
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("mints at most ONCE per address per window, even across many requests from DIFFERENT IPs", async () => {
    // The distributed case the per-IP limit cannot see: a botnet / proxy pool /
    // rotating IPv6 gets a fresh per-IP budget for each host it comes from, all
    // aimed at one victim's inbox. The cooldown (not a multi-send quota) is what
    // stops each of those requests from re-minting and overwriting the token
    // the first one already mailed (#712).
    const victim = freshEmail();
    const first = await POST(req({ email: victim }, freshIp()));
    expect(first.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i++) {
      const res = await POST(req({ email: victim }, freshIp()));
      expect(res.status).toBe(200);
    }
    // Nothing minted and nothing mailed on any later request in the window.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockGenerateLink).toHaveBeenCalledTimes(1);
  });

  it("never overwrites the already-mailed token — generateLink is called exactly ONCE per window even when it would mint a DIFFERENT token each time", async () => {
    // The issue's specific ask: don't mock generateLink to return the same
    // fixed hashed_token on every call, since that masks the overwrite bug
    // entirely (GoTrue keeps exactly one recovery_token per user, so a second
    // mint replaces the first with whatever it returns). Model that a second
    // call WOULD produce a different token, then assert the route never makes
    // that second call within the cooldown window — the only way the first
    // link mailed to the victim can stay valid.
    const victim = freshEmail();
    mockGenerateLink
      .mockResolvedValueOnce({ data: { properties: { hashed_token: "tok_first" } }, error: null })
      .mockResolvedValueOnce({ data: { properties: { hashed_token: "tok_SECOND_would_kill_first" } }, error: null })
      .mockResolvedValueOnce({ data: { properties: { hashed_token: "tok_THIRD" } }, error: null });

    for (let i = 0; i < 4; i++) {
      await POST(req({ email: victim }, freshIp()));
    }

    expect(mockGenerateLink).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].html).toContain("token_hash=tok_first");
  });

  it("returns a byte-identical response on cooldown — suppression must not be observable in the BODY", async () => {
    // A 429 here would be its own oracle: it would tell the caller that someone
    // recently requested a reset for that address. The suppressed request has to
    // look exactly like a delivered one. (The route also documents a known,
    // accepted residual TIMING signal — see the RESIDUAL TIMING SIGNAL comment
    // in the route source — which is deliberately not addressed by this test.)
    const victim = freshEmail();
    const delivered = await POST(req({ email: victim }, freshIp()));
    const deliveredBody = await delivered.json();

    const suppressed = await POST(req({ email: victim }, freshIp()));
    expect(suppressed.status).toBe(delivered.status);
    expect(await suppressed.json()).toEqual(deliveredBody);
  });

  it("scopes the cooldown to ONE address — a flooded victim can't lock everyone else out", async () => {
    const victim = freshEmail();
    for (let i = 0; i < 2; i++) await POST(req({ email: victim }, freshIp()));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    const bystander = freshEmail();
    const res = await POST(req({ email: bystander }, freshIp()));
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: bystander }),
    );
  });

  it("counts case and whitespace variants of an address against the SAME cooldown", async () => {
    // The cooldown keys off the normalised address. If it did not, "Victim@x.com",
    // "victim@x.com" and " VICTIM@X.com " would each get their own slot and
    // the cap would be trivially bypassable.
    const local = `case${Date.now() % 100000}`;
    const variants = [
      `${local}@example.com`,
      `${local.toUpperCase()}@Example.com`,
      ` ${local}@EXAMPLE.COM `,
      `${local}@example.com`,
    ];
    for (const v of variants) {
      const res = await POST(req({ email: v }, freshIp()));
      expect(res.status).toBe(200);
    }
    // Four requests, one address: only the first mints/mails.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("does NOT distinguish a nonexistent address from a suppressed real one by timing — the mint slot is never released", async () => {
    // THE property that closes the two-request account-existence timing
    // oracle a reviewer found in an earlier revision of this route. That
    // revision released the mint slot whenever nothing was delivered — which
    // included EVERY attempt for an unregistered address (generateLink always
    // errors for one), so request 2+ for a nonexistent address always took the
    // slow path (a real generateLink call), while request 2+ for a real,
    // delivered address was suppressed and fast. A stopwatch alone could then
    // tell the two apart in exactly 2 requests.
    //
    // The fix: the slot is consumed on the ATTEMPT, not the outcome, so a
    // second request behaves identically — no generateLink call, same
    // response — whether or not the first attempt found an account.
    const nobody = freshEmail();
    mockGenerateLink.mockResolvedValue({ data: null, error: { message: "User not found" } });

    const first = await POST(req({ email: nobody }, freshIp()));
    expect(first.status).toBe(200);
    expect(mockGenerateLink).toHaveBeenCalledTimes(1); // the real, slow path

    // A later request for the SAME nonexistent address must be suppressed —
    // no second generateLink call — exactly like a real, already-delivered
    // address would be. This is the assertion that would have failed against
    // the release-on-failure design: it used to call generateLink again here.
    const second = await POST(req({ email: nobody }, freshIp()));
    expect(second.status).toBe(200);
    expect(mockGenerateLink).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not release the mint slot when the provider accepts nothing (delivered: false) — a real transient failure costs the rest of the window, not the enumeration property", async () => {
    // The accepted tradeoff, pinned: unlike the earlier release-on-failure
    // design, a delivery failure for a REAL address now also holds the slot
    // for the rest of the window — see "THE COST OF CLOSING IT" in the route's
    // own comment for why this is judged the lesser failure (rare, not
    // attacker-triggerable, bounded/self-healing) versus reopening the timing
    // oracle above.
    const victim = freshEmail();
    mockSendEmail.mockResolvedValue({ delivered: false, dryRun: false, error: "provider down" });

    const first = await POST(req({ email: victim }, freshIp()));
    expect(first.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    mockSendEmail.mockResolvedValue({ delivered: true, dryRun: false, id: "msg_ok" });
    const second = await POST(req({ email: victim }, freshIp()));
    expect(second.status).toBe(200);
    // Suppressed, not retried: the earlier undelivered attempt already
    // consumed the address's one mint for this window.
    expect(mockGenerateLink).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("EXPIRES the per-recipient cooldown, so the mint slot is not a permanent denial", async () => {
    // The trade-off this cap makes, pinned. An attacker who knows the victim's
    // address can claim the mint slot before the victim ever asks, silently
    // suppressing the OWNER's own later reset within the window. That is
    // accepted only because it is BOUNDED — 15 minutes, then it self-heals —
    // AND because the slot being claimed means a real link already reached the
    // owner's inbox (see the "never overwrites" test above). This test is what
    // stops anyone quietly widening the window into a real denial of service.
    const victim = freshEmail();
    for (let i = 0; i < 3; i++) await POST(req({ email: victim }, freshIp()));
    expect(mockSendEmail).toHaveBeenCalledTimes(1); // only the first mints/mails

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1);
      const afterWindow = await POST(req({ email: victim }, freshIp()));
      expect(afterWindow.status).toBe(200);
      // The owner gets their link again once the window has passed.
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rate-limits repeated requests from one IP (an email cannon is the abuse case)", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await POST(req({ email: `u${i}@example.com` }, ip))).status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
  });
});
