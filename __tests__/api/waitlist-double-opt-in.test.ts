import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ delivered: false, dryRun: true })) }));

import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { POST } from "@/app/api/waitlist/route";
import { GET as CONFIRM } from "@/app/api/waitlist/confirm/route";
import { buildWaitlistConfirmEmail } from "@/lib/email/templates/waitlist";

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
    const url = "https://aptdesigner.ai/api/waitlist/confirm?token=abc123";
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

function confirmReq(token: string) {
  return new NextRequest(`http://localhost/api/waitlist/confirm?token=${token}`);
}

describe("GET /api/waitlist/confirm", () => {
  beforeEach(() => {
    mockGetAdmin.mockReset();
  });

  it("redirects to ?status=invalid for a malformed token without touching the DB", async () => {
    mockGetAdmin.mockReturnValue(fakeAdmin({}));
    const res = await CONFIRM(confirmReq("nope!"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/waitlist/confirmed");
    expect(res.headers.get("location")).toContain("status=invalid");
  });

  it("confirms a pending row and redirects to the success page", async () => {
    const token = "a".repeat(64);
    mockGetAdmin.mockReturnValue(fakeAdmin({ updateResult: () => ({ data: [{ id: "row-3" }], error: null }) }));
    const res = await CONFIRM(confirmReq(token));
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/waitlist/confirmed");
    expect(loc).not.toContain("status=invalid");
  });

  it("treats an unknown/used token as invalid (no row updated)", async () => {
    const token = "b".repeat(64);
    mockGetAdmin.mockReturnValue(fakeAdmin({ updateResult: () => ({ data: [], error: null }) }));
    const res = await CONFIRM(confirmReq(token));
    expect(res.headers.get("location")).toContain("status=invalid");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
