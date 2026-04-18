import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("system-cache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns null when ENABLE_GEMINI_CACHE is explicitly disabled", async () => {
    process.env.ENABLE_GEMINI_CACHE = "0";
    const mod = await import("@/lib/ai/system-cache");
    const name = await mod.getOrCreateSystemCache("gemini-3-flash-preview", "x".repeat(10000));
    expect(name).toBeNull();
  });

  it("returns null and memoizes the negative result on empty prompts", async () => {
    delete process.env.ENABLE_GEMINI_CACHE;
    const mod = await import("@/lib/ai/system-cache");
    mod.__resetSystemCacheForTests();
    const name = await mod.getOrCreateSystemCache("gemini-3-flash-preview", "");
    expect(name).toBeNull();
  });
});
