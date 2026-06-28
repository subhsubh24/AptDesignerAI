import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isSiteGateEnabled,
  isGateExempt,
  gateToken,
  applySiteGate,
} from "@/lib/security/site-gate";

const PW = "launch-soon-123";

function req(path: string, opts?: { gate?: string; cookieToken?: string }): NextRequest {
  const url = new URL(`https://app.example.com${path}`);
  if (opts?.gate !== undefined) url.searchParams.set("gate", opts.gate);
  const r = new NextRequest(url);
  if (opts?.cookieToken) r.cookies.set("apt_site_gate", opts.cookieToken);
  return r;
}

describe("site-gate: enabled flag", () => {
  const prev = process.env.SITE_GATE_PASSWORD;
  afterEach(() => {
    if (prev === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = prev;
  });

  it("is disabled when the env var is unset", () => {
    delete process.env.SITE_GATE_PASSWORD;
    expect(isSiteGateEnabled()).toBe(false);
  });

  it("is disabled when the env var is empty/whitespace", () => {
    process.env.SITE_GATE_PASSWORD = "   ";
    expect(isSiteGateEnabled()).toBe(false);
  });

  it("is enabled when the env var is set", () => {
    process.env.SITE_GATE_PASSWORD = PW;
    expect(isSiteGateEnabled()).toBe(true);
  });
});

describe("site-gate: exempt routes", () => {
  it("exempts marketing/legal/waitlist pages", () => {
    for (const p of ["/waitlist", "/waitlist/confirmed", "/privacy", "/terms", "/support", "/faq", "/pricing"]) {
      expect(isGateExempt(p)).toBe(true);
    }
  });
  it("exempts /guides sub-routes and the public waitlist API by prefix", () => {
    expect(isGateExempt("/guides")).toBe(true);
    expect(isGateExempt("/guides/color-palette-guide")).toBe(true);
    expect(isGateExempt("/api/waitlist")).toBe(true);
    expect(isGateExempt("/api/waitlist/confirm")).toBe(true);
  });
  it("does NOT exempt the app, auth, or other API routes", () => {
    for (const p of ["/dashboard", "/login", "/signup", "/account", "/api/search", "/api/billing/webhook"]) {
      expect(isGateExempt(p)).toBe(false);
    }
  });
  it("does not let a similarly-prefixed path sneak through", () => {
    expect(isGateExempt("/guidescheat")).toBe(false);
    expect(isGateExempt("/api/waitlistx")).toBe(false);
  });
});

describe("site-gate: gateToken", () => {
  it("is deterministic and non-reversible (does not contain the password)", async () => {
    const a = await gateToken(PW);
    const b = await gateToken(PW);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain(PW);
  });
  it("differs for different passwords", async () => {
    expect(await gateToken("a")).not.toBe(await gateToken("b"));
  });
});

describe("site-gate: applySiteGate", () => {
  const prev = process.env.SITE_GATE_PASSWORD;
  beforeEach(() => {
    process.env.SITE_GATE_PASSWORD = PW;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = prev;
  });

  it("is a no-op when the gate is disabled", async () => {
    delete process.env.SITE_GATE_PASSWORD;
    expect(await applySiteGate(req("/dashboard"))).toBeNull();
  });

  it("lets exempt routes through while locked", async () => {
    expect(await applySiteGate(req("/waitlist"))).toBeNull();
    expect(await applySiteGate(req("/privacy"))).toBeNull();
    expect(await applySiteGate(req("/api/waitlist"))).toBeNull();
  });

  it("redirects a locked browser request to the coming-soon page", async () => {
    const res = await applySiteGate(req("/dashboard"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(307);
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/waitlist");
  });

  it("returns 503 for a locked API request", async () => {
    const res = await applySiteGate(req("/api/search"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
  });

  it("unlocks with the correct ?gate= password and sets the cookie", async () => {
    const res = await applySiteGate(req("/dashboard", { gate: PW }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(307);
    // redirects to the clean URL (gate param stripped)
    const loc = new URL(res!.headers.get("location")!);
    expect(loc.pathname).toBe("/dashboard");
    expect(loc.searchParams.has("gate")).toBe(false);
    // sets the gate cookie to the derived token (not the raw password)
    const cookie = res!.cookies.get("apt_site_gate");
    expect(cookie?.value).toBe(await gateToken(PW));
    expect(cookie?.value).not.toContain(PW);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("treats a wrong ?gate= password as still locked", async () => {
    const res = await applySiteGate(req("/dashboard", { gate: "nope" }));
    expect(res!.status).toBe(307);
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/waitlist");
    expect(res!.cookies.get("apt_site_gate")).toBeUndefined();
  });

  it("lets a request with a valid unlock cookie continue", async () => {
    const token = await gateToken(PW);
    expect(await applySiteGate(req("/dashboard", { cookieToken: token }))).toBeNull();
  });

  it("does not honor a stale/invalid cookie", async () => {
    const res = await applySiteGate(req("/dashboard", { cookieToken: "deadbeef" }));
    expect(res!.status).toBe(307);
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/waitlist");
  });
});
