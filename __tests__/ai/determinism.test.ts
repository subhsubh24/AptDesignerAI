import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * determinism.ts is the reproducibility contract's entry point: resolveSeed /
 * resolveTemperature decide what every Gemini call sends. The flags are read at
 * MODULE LOAD (DETERMINISTIC / DETERMINISTIC_SEED are evaluated once from env),
 * so each case stubs the env and re-imports the module. These pin the two modes
 * (deterministic override vs. pass-through) + the seed-parse fallbacks, so a
 * regression that leaked caller temperature/seed under DETERMINISTIC — or
 * mis-parsed the seed — fails loudly.
 */

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    vi.stubEnv(k, v);
  }
  return import("@/lib/ai/determinism");
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("determinism — DETERMINISTIC flag", () => {
  it("is ON by default (env unset) and for any value other than the literal 'false'", async () => {
    const def = await load({ DETERMINISTIC_MODE: undefined });
    expect(def.DETERMINISTIC).toBe(true);

    const trueish = await load({ DETERMINISTIC_MODE: "true" });
    expect(trueish.DETERMINISTIC).toBe(true);

    // Only the exact string "false" disables it.
    const yes = await load({ DETERMINISTIC_MODE: "1" });
    expect(yes.DETERMINISTIC).toBe(true);
  });

  it("is OFF only when DETERMINISTIC_MODE === 'false'", async () => {
    const off = await load({ DETERMINISTIC_MODE: "false" });
    expect(off.DETERMINISTIC).toBe(false);
  });
});

describe("determinism — DETERMINISTIC_SEED parsing", () => {
  it("defaults to 42 when unset", async () => {
    const mod = await load({ DETERMINISTIC_SEED: undefined });
    expect(mod.DETERMINISTIC_SEED).toBe(42);
  });

  it("parses a valid integer seed", async () => {
    const mod = await load({ DETERMINISTIC_SEED: "1234" });
    expect(mod.DETERMINISTIC_SEED).toBe(1234);
  });

  it("falls back to 42 for a non-numeric seed", async () => {
    const mod = await load({ DETERMINISTIC_SEED: "not-a-number" });
    expect(mod.DETERMINISTIC_SEED).toBe(42);
  });
});

describe("determinism — resolveSeed", () => {
  it("overrides the caller's seed with DETERMINISTIC_SEED when deterministic", async () => {
    const mod = await load({ DETERMINISTIC_MODE: undefined, DETERMINISTIC_SEED: "7" });
    // Caller's seed is ignored; the fixed seed wins.
    expect(mod.resolveSeed(999)).toBe(7);
    expect(mod.resolveSeed(undefined)).toBe(7);
  });

  it("passes the caller's seed through (incl. undefined) when NOT deterministic", async () => {
    const mod = await load({ DETERMINISTIC_MODE: "false" });
    expect(mod.resolveSeed(999)).toBe(999);
    expect(mod.resolveSeed(undefined)).toBeUndefined();
  });
});

describe("determinism — resolveTemperature", () => {
  it("strips temperature (returns undefined) when deterministic, whatever the caller passed", async () => {
    const mod = await load({ DETERMINISTIC_MODE: undefined });
    // Gemini 3's default 1.0 must apply — no explicit sub-1.0 leaks through.
    expect(mod.resolveTemperature(0.2)).toBeUndefined();
    expect(mod.resolveTemperature(undefined)).toBeUndefined();
  });

  it("passes the caller's temperature through when NOT deterministic", async () => {
    const mod = await load({ DETERMINISTIC_MODE: "false" });
    expect(mod.resolveTemperature(0.7)).toBe(0.7);
    expect(mod.resolveTemperature(undefined)).toBeUndefined();
  });
});
