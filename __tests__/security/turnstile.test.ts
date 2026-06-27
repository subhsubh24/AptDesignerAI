import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isTurnstileEnabled, verifyTurnstile } from "@/lib/security/turnstile";
import { POST as WAITLIST_POST } from "@/app/api/waitlist/route";

describe("lib/security/turnstile", () => {
  const orig = process.env.TURNSTILE_SECRET_KEY;
  afterEach(() => {
    if (orig === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = orig;
    vi.restoreAllMocks();
  });

  it("is disabled (and verification passes) when no secret key is set", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(isTurnstileEnabled()).toBe(false);
    // Fail-open: no key => the waitlist keeps working with no token.
    const res = await verifyTurnstile(null);
    expect(res.success).toBe(true);
    expect(res.reason).toBe("disabled");
  });

  describe("when enabled", () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = "secret-key";
    });

    it("rejects a missing token without calling Cloudflare", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const res = await verifyTurnstile("");
      expect(res.success).toBe(false);
      expect(res.reason).toBe("missing_token");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("passes when Cloudflare returns success: true", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
      const res = await verifyTurnstile("good-token", "1.2.3.4");
      expect(res.success).toBe(true);
    });

    it("rejects when Cloudflare returns success: false", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: false }), { status: 200 }),
      );
      const res = await verifyTurnstile("bad-token");
      expect(res.success).toBe(false);
      expect(res.reason).toBe("rejected");
    });

    it("fails OPEN when Cloudflare is unreachable (network error)", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
      const res = await verifyTurnstile("any-token");
      expect(res.success).toBe(true);
      expect(res.reason).toBe("unreachable");
    });

    it("fails OPEN on a non-OK HTTP status from Cloudflare", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));
      const res = await verifyTurnstile("any-token");
      expect(res.success).toBe(true);
      expect(res.reason).toBe("unreachable");
    });

    it("the waitlist route rejects a sign-up with no captcha token (wiring)", async () => {
      // Enabled + no token => 400 via the captcha short-circuit (missing_token),
      // BEFORE any DB access. A fetch spy proves we never even reached siteverify
      // (so the 400 is the captcha gate, not some unrelated failure).
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = new NextRequest("http://localhost/api/waitlist", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.9", "content-type": "application/json" },
        body: JSON.stringify({ email: "human@example.com" }),
      });
      const res = await WAITLIST_POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/verify/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
