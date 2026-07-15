import { describe, it, expect } from "vitest";
import { computeRetryDelay } from "@/lib/ai/retry-delay";

describe("computeRetryDelay", () => {
  it("rate_limit under DETERMINISTIC returns the exact base delay (no jitter)", () => {
    // The RNG must never be consulted in deterministic mode.
    const rand = () => {
      throw new Error("rand() must not be called under DETERMINISTIC");
    };
    expect(computeRetryDelay(1, "rate_limit", true, rand)).toBe(2000);
    expect(computeRetryDelay(2, "rate_limit", true, rand)).toBe(4000);
    expect(computeRetryDelay(3, "rate_limit", true, rand)).toBe(8000);
    expect(computeRetryDelay(5, "rate_limit", true, rand)).toBe(32000);
  });

  it("rate_limit is fully reproducible across calls in deterministic mode", () => {
    const a = computeRetryDelay(3, "rate_limit", true);
    const b = computeRetryDelay(3, "rate_limit", true);
    expect(a).toBe(b);
  });

  it("rate_limit non-deterministic applies full jitter in [500, baseDelay+500)", () => {
    // rand=0 → floor(0*base)+500 = 500 (the minimum).
    expect(computeRetryDelay(1, "rate_limit", false, () => 0)).toBe(500);
    // rand≈1 → floor(~base)+500, just under baseDelay+500.
    const nearOne = computeRetryDelay(1, "rate_limit", false, () => 0.9999);
    expect(nearOne).toBeGreaterThan(500);
    expect(nearOne).toBeLessThan(2000 + 500);
    // A mid RNG value lands strictly inside the window.
    expect(computeRetryDelay(2, "rate_limit", false, () => 0.5)).toBe(
      Math.floor(0.5 * 4000) + 500,
    );
  });

  it("server backoff grows 1s/2s/4s and ignores determinism + RNG", () => {
    const rand = () => {
      throw new Error("rand() must not be called for server errors");
    };
    expect(computeRetryDelay(1, "server", false, rand)).toBe(1000);
    expect(computeRetryDelay(2, "server", true, rand)).toBe(2000);
    expect(computeRetryDelay(3, "server", false, rand)).toBe(4000);
  });

  it("transport backoff grows 0.5s/1s/2s and ignores determinism + RNG", () => {
    const rand = () => {
      throw new Error("rand() must not be called for transport errors");
    };
    expect(computeRetryDelay(1, "transport", false, rand)).toBe(500);
    expect(computeRetryDelay(2, "transport", true, rand)).toBe(1000);
    expect(computeRetryDelay(3, "transport", false, rand)).toBe(2000);
  });
});
