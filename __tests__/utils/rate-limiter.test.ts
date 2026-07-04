import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit } from "@/lib/utils/rate-limiter";

/**
 * Core sliding-window behavior of checkRateLimit — the security boundary that
 * caps paid/expensive/auth endpoints against wallet-drain and abuse. The bypass
 * helpers are covered by rate-limiter-bypass.test.ts; this pins the counting,
 * window-reset, and 429 accounting the routes depend on.
 *
 * The store and `Date.now()` are module-global, so every test uses a UNIQUE key
 * and fake timers with an absolute clock to stay isolated.
 */

const config = { maxRequests: 3, windowMs: 60_000 };

describe("checkRateLimit — sliding window", () => {
  beforeEach(() => {
    // Ensure the CI/test bypass is OFF so we exercise the real limiter.
    vi.stubEnv("E2E_RATE_LIMIT_BYPASS", "");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("allows the first request and reports remaining = max - 1", () => {
    const r = checkRateLimit("first:key", config);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBe(Date.now() + config.windowMs);
    expect(r.retryAfterMs).toBeUndefined();
  });

  it("decrements remaining on each request within the window", () => {
    const key = "decrement:key";
    expect(checkRateLimit(key, config).remaining).toBe(2);
    expect(checkRateLimit(key, config).remaining).toBe(1);
    expect(checkRateLimit(key, config).remaining).toBe(0);
  });

  it("blocks once the limit is exceeded and sets retryAfterMs", () => {
    const key = "block:key";
    checkRateLimit(key, config); // 1
    checkRateLimit(key, config); // 2
    const third = checkRateLimit(key, config); // 3 — still allowed (== max)
    expect(third.allowed).toBe(true);

    const fourth = checkRateLimit(key, config); // 4 — over the limit
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBe(config.windowMs);
    expect(fourth.resetAt).toBe(Date.now() + config.windowMs);
  });

  it("resets to a fresh window after the window expires", () => {
    const key = "reset:key";
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    const blocked = checkRateLimit(key, config); // 3rd allowed
    expect(blocked.allowed).toBe(true);
    expect(checkRateLimit(key, config).allowed).toBe(false); // 4th blocked

    // Advance past the window — the next call starts a brand-new window.
    vi.advanceTimersByTime(config.windowMs + 1);
    const fresh = checkRateLimit(key, config);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(2);
    expect(fresh.resetAt).toBe(Date.now() + config.windowMs);
  });

  it("counts distinct keys independently", () => {
    checkRateLimit("tenant:a", config);
    checkRateLimit("tenant:a", config);
    // A different key is unaffected by tenant:a's usage.
    const b = checkRateLimit("tenant:b", config);
    expect(b.remaining).toBe(2);
  });

  it("retryAfterMs shrinks as the window elapses", () => {
    const key = "retry-shrink:key";
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    const firstBlock = checkRateLimit(key, config);
    expect(firstBlock.retryAfterMs).toBe(config.windowMs);

    vi.advanceTimersByTime(20_000);
    const laterBlock = checkRateLimit(key, config);
    expect(laterBlock.allowed).toBe(false);
    expect(laterBlock.retryAfterMs).toBe(config.windowMs - 20_000);
  });

  it("bypasses entirely when E2E_RATE_LIMIT_BYPASS=1 (CI-only escape hatch)", () => {
    vi.stubEnv("E2E_RATE_LIMIT_BYPASS", "1");
    const key = "bypass:key";
    // Even far beyond the limit, every call is allowed with full remaining.
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit(key, config);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(config.maxRequests);
    }
  });
});
