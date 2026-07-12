import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: vi.fn() }));

import { getAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { POST, maxDuration } from "@/app/api/auth/signup/route";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockVerify = verifyTurnstile as unknown as Mock;

const createUser = vi.fn();
function fakeAdmin() {
  return { auth: { admin: { createUser } } };
}

let ipCounter = 0;
function signupReq(body: unknown, ip?: string) {
  // Unique IP per request by default so the module-level rate limiter (5/IP/15m)
  // does not bleed across independent test cases.
  const addr = ip ?? `10.0.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "x-forwarded-for": addr, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = { email: "new@example.com", password: "supersecret", fullName: "New User" };

beforeEach(() => {
  mockGetAdmin.mockReset();
  mockVerify.mockReset();
  createUser.mockReset();
  mockGetAdmin.mockReturnValue(fakeAdmin());
  mockVerify.mockResolvedValue({ success: true });
  createUser.mockResolvedValue({ error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/auth/signup", () => {
  it("bounds the serverless duration on this external-I/O route", () => {
    // Regression guard: signup does an outbound Turnstile fetch + admin auth,
    // so it must carry an explicit maxDuration (unbounded => a slow upstream can
    // hang past the platform budget and 504 mid-signup). Keep it sane (10-30s).
    expect(typeof maxDuration).toBe("number");
    expect(maxDuration).toBeGreaterThanOrEqual(10);
    expect(maxDuration).toBeLessThanOrEqual(30);
  });

  it("creates an auto-confirmed user on a valid request", async () => {
    const res = await POST(signupReq(VALID));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser.mock.calls[0][0]).toMatchObject({ email: "new@example.com", email_confirm: true });
  });

  it("rejects a malformed email with 400 (never creates a user)", async () => {
    const res = await POST(signupReq({ ...VALID, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects a too-short password with 400", async () => {
    const res = await POST(signupReq({ ...VALID, password: "123" }));
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects when the captcha verification fails", async () => {
    mockVerify.mockResolvedValue({ success: false });
    const res = await POST(signupReq(VALID));
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("fails open (allows signup) when Turnstile is unreachable", async () => {
    // When Cloudflare is unreachable the route logs a warning but must not
    // dead-end a legitimate user — verifyTurnstile fails open (success:true).
    mockVerify.mockResolvedValue({ success: true, reason: "unreachable" });
    const res = await POST(signupReq(VALID));
    expect(res.status).toBe(200);
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the admin client is unavailable", async () => {
    mockGetAdmin.mockReturnValue(null);
    const res = await POST(signupReq(VALID));
    expect(res.status).toBe(503);
  });

  it("is enumeration-safe: an already-registered email returns the SAME ok:true", async () => {
    createUser.mockResolvedValue({ error: { code: "user_already_exists", message: "User already registered" } });
    const res = await POST(signupReq({ ...VALID, email: "taken@example.com" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns a generic 500 on an unexpected createUser error (no raw leak)", async () => {
    createUser.mockResolvedValue({ error: { message: "internal db boom" } });
    const res = await POST(signupReq(VALID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toContain("boom");
  });

  it("rate-limits after 5 attempts from the same IP", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++) {
      const ok = await POST(signupReq({ ...VALID, email: `u${i}@example.com` }, ip));
      expect(ok.status).toBe(200);
    }
    const sixth = await POST(signupReq({ ...VALID, email: "u6@example.com" }, ip));
    expect(sixth.status).toBe(429);
  });
});
