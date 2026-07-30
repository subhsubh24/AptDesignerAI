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

  it("caps sends PER RECIPIENT even when every request comes from a DIFFERENT IP", async () => {
    // The distributed case the per-IP limit cannot see: a botnet / proxy pool /
    // rotating IPv6 gets a fresh per-IP budget for each host it comes from, all
    // aimed at one victim's inbox. Without a per-recipient cap this is an
    // unbounded mail flood at a single address.
    const victim = freshEmail();
    for (let i = 0; i < 3; i++) {
      const res = await POST(req({ email: victim }, freshIp()));
      expect(res.status).toBe(200);
    }
    expect(mockSendEmail).toHaveBeenCalledTimes(3);

    const overQuota = await POST(req({ email: victim }, freshIp()));
    expect(overQuota.status).toBe(200);
    // Nothing minted and nothing mailed on the 4th.
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
    expect(mockGenerateLink).toHaveBeenCalledTimes(3);
  });

  it("returns a byte-identical response over quota — suppression must not be observable", async () => {
    // A 429 here would be its own oracle: it would tell the caller that someone
    // recently requested a reset for that address. The suppressed request has to
    // look exactly like a delivered one.
    const victim = freshEmail();
    let firstStatus = 0;
    let firstBody: unknown;
    for (let i = 0; i < 3; i++) {
      const res = await POST(req({ email: victim }, freshIp()));
      if (i === 0) {
        firstStatus = res.status;
        firstBody = await res.json();
      }
    }
    const suppressed = await POST(req({ email: victim }, freshIp()));
    expect(suppressed.status).toBe(firstStatus);
    expect(await suppressed.json()).toEqual(firstBody);
  });

  it("scopes the quota to ONE address — a flooded victim can't lock everyone else out", async () => {
    const victim = freshEmail();
    for (let i = 0; i < 4; i++) await POST(req({ email: victim }, freshIp()));
    expect(mockSendEmail).toHaveBeenCalledTimes(3);

    const bystander = freshEmail();
    const res = await POST(req({ email: bystander }, freshIp()));
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(4);
    expect(mockSendEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: bystander }),
    );
  });

  it("counts case and whitespace variants of an address against the SAME quota", async () => {
    // The quota keys off the normalised address. If it did not, "Victim@x.com",
    // "victim@x.com" and " VICTIM@X.com " would each get their own budget and
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
    // Four requests, one address: the 4th is suppressed.
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
  });

  it("EXPIRES the per-recipient lockout, so a burned quota is not a permanent denial", async () => {
    // The trade-off this cap makes, pinned. An attacker who knows the victim's
    // address can burn the quota before the victim ever asks, silently
    // suppressing the OWNER's own reset. That is accepted only because it is
    // BOUNDED — 15 minutes, then it self-heals. This test is what stops anyone
    // quietly widening the window into a real denial of service.
    const victim = freshEmail();
    for (let i = 0; i < 4; i++) await POST(req({ email: victim }, freshIp()));
    expect(mockSendEmail).toHaveBeenCalledTimes(3); // 4th suppressed

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1);
      const afterWindow = await POST(req({ email: victim }, freshIp()));
      expect(afterWindow.status).toBe(200);
      // The owner gets their link again once the window has passed.
      expect(mockSendEmail).toHaveBeenCalledTimes(4);
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
