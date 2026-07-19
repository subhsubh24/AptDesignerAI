import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ delivered: false, dryRun: true })) }));

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { POST } from "@/app/api/waitlist/route";
import { GET as CONFIRM } from "@/app/api/waitlist/confirm/route";
import { buildWaitlistConfirmEmail } from "@/lib/email/templates/waitlist";
import { buildWaitlistWelcomeEmail } from "@/lib/email/templates/waitlist-welcome";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockSendEmail = sendEmail as unknown as Mock;

// Configurable Supabase-shaped fake. Each handler resolves the terminal of a
// builder chain used by the waitlist routes (insert / update…select /
// select…maybeSingle).
interface Handlers {
  insert?: () => { error: unknown };
  maybeSingle?: () => { data: unknown; error?: unknown };
  updateResult?: () => { data?: unknown; error: unknown };
}
function fakeAdmin(h: Handlers) {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        insert: () => Promise.resolve(h.insert ? h.insert() : { error: null }),
        update: () => builder,
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        maybeSingle: () =>
          Promise.resolve(h.maybeSingle ? h.maybeSingle() : { data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(h.updateResult ? h.updateResult() : { data: [], error: null }).then(resolve),
      });
      return builder;
    },
  };
}

function postReq(email: unknown, ip = "5.5.5.5") {
  return new NextRequest("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

describe("buildWaitlistConfirmEmail", () => {
  it("includes the confirm URL and a non-empty subject/body", () => {
    const url = "https://aptdesignerai.com/api/waitlist/confirm?token=abc123";
    const { subject, html, text } = buildWaitlistConfirmEmail(url);
    expect(subject.length).toBeGreaterThan(0);
    expect(html).toContain(url);
    expect(text).toContain(url);
  });

  it("escapes HTML metacharacters in the URL so markup can't be injected", () => {
    const { html } = buildWaitlistConfirmEmail('https://x/?token=a"><script>alert(1)</script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("POST /api/waitlist (double opt-in)", () => {
  beforeEach(() => {
    mockGetAdmin.mockReset();
    mockSendEmail.mockClear();
  });

  it("rejects a malformed email with 400 and never sends", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({}));
    const res = await POST(postReq("not-an-email", "5.5.5.1"));
    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("stores a new sign-up as pending and sends a confirmation email", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({ insert: () => ({ error: null }) }));
    const res = await POST(postReq("new@example.com", "5.5.5.2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingConfirmation).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.stage).toBe("waitlist_confirm");
    expect(arg.to).toBe("new@example.com");
  });

  it("returns alreadySubscribed for an existing CONFIRMED address (no resend)", async () => {
    mockGetAdmin.mockReturnValue(
      fakeAdmin({
        insert: () => ({ error: { code: "23505" } }),
        maybeSingle: () => ({ data: { id: "row-1", confirmed_at: "2026-01-01T00:00:00Z" } }),
      }),
    );
    const res = await POST(postReq("confirmed@example.com", "5.5.5.3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadySubscribed).toBe(true);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("re-sends the confirmation for an existing PENDING address (no recent send)", async () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockGetAdmin.mockReturnValue(
      fakeAdmin({
        insert: () => ({ error: { code: "23505" } }),
        maybeSingle: () => ({ data: { id: "row-2", confirmed_at: null, token_sent_at: longAgo } }),
        updateResult: () => ({ error: null }),
      }),
    );
    const res = await POST(postReq("pending@example.com", "5.5.5.4"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingConfirmation).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("throttles the resend when a confirmation was sent recently (no second email)", async () => {
    const justNow = new Date(Date.now() - 30 * 1000).toISOString();
    mockGetAdmin.mockReturnValue(
      fakeAdmin({
        insert: () => ({ error: { code: "23505" } }),
        maybeSingle: () => ({ data: { id: "row-5", confirmed_at: null, token_sent_at: justNow } }),
      }),
    );
    const res = await POST(postReq("pending@example.com", "5.5.5.7"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingConfirmation).toBe(true);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

function confirmReq(token: string, ip?: string) {
  return new NextRequest(`http://localhost/api/waitlist/confirm?token=${token}`, {
    headers: ip ? { "x-forwarded-for": ip } : undefined,
  });
}

describe("buildWaitlistWelcomeEmail", () => {
  it("returns a non-empty subject and grounded HTML/text (no confirm-link CTA)", () => {
    const { subject, html, text } = buildWaitlistWelcomeEmail();
    expect(subject.length).toBeGreaterThan(0);
    expect(html).toContain("early-access");
    expect(text).toContain("App Store");
    // The welcome email is post-confirmation: it must NOT contain a confirm link.
    expect(html).not.toContain("/api/waitlist/confirm");
  });
});

describe("GET /api/waitlist/confirm", () => {
  beforeEach(() => {
    mockGetAdmin.mockReset();
    mockSendEmail.mockClear();
  });

  it("redirects to ?status=invalid for a malformed token without touching the DB", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({}));
    const res = await CONFIRM(confirmReq("nope!"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/waitlist/confirmed");
    expect(res.headers.get("location")).toContain("status=invalid");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("confirms a pending row, sends the welcome email once, and redirects to success", async () => {
    const token = "a".repeat(64);
    mockGetAdmin.mockReturnValue(
      fakeAdmin({ updateResult: () => ({ data: [{ id: "row-3", email: "new@example.com" }], error: null }) }),
    );
    const res = await CONFIRM(confirmReq(token));
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/waitlist/confirmed");
    expect(loc).not.toContain("status=invalid");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.stage).toBe("waitlist_welcome_1");
    expect(arg.to).toBe("new@example.com");
    // The mock bypasses sendEmail's own validators, so assert the route passed a
    // real subject + body (guards against accidentally sending empty content).
    expect(typeof arg.subject).toBe("string");
    expect(arg.subject.length).toBeGreaterThan(0);
    expect(arg.html.length).toBeGreaterThan(0);
  });

  it("treats an unknown/used token as invalid (no row updated, no welcome email)", async () => {
    const token = "b".repeat(64);
    mockGetAdmin.mockReturnValue(fakeAdmin({ updateResult: () => ({ data: [], error: null }) }));
    const res = await CONFIRM(confirmReq(token));
    expect(res.headers.get("location")).toContain("status=invalid");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rate-limits a burst from one IP (11th request is blocked before the DB/email)", async () => {
    // Valid pending token so every allowed request would otherwise write + send.
    const token = "c".repeat(64);
    mockGetAdmin.mockReturnValue(
      fakeAdmin({ updateResult: () => ({ data: [{ id: "row-4", email: "burst@example.com" }], error: null }) }),
    );
    const ip = "203.0.113.7"; // dedicated IP so the limiter bucket is isolated

    // First 10 are within the 10/15min window and confirm successfully.
    for (let i = 0; i < 10; i++) {
      const ok = await CONFIRM(confirmReq(token, ip));
      expect(ok.headers.get("location")).not.toContain("status=invalid");
    }
    expect(mockSendEmail).toHaveBeenCalledTimes(10);

    // The 11th is throttled: redirected to the friendly page WITHOUT another
    // DB write or email send, proving the limiter short-circuits before the
    // expensive work.
    mockGetAdmin.mockClear();
    const blocked = await CONFIRM(confirmReq(token, ip));
    expect(blocked.headers.get("location")).toContain("status=invalid");
    expect(mockGetAdmin).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(10); // unchanged — no 11th send
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
