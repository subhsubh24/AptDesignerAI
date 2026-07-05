import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getOrCreateCombinedCache is a cost-optimization path (200+ Gemini calls per
// run share one cached context). Its branch logic is load-bearing: disable flag,
// empty-parts guard, cache-hit reuse, in-flight de-duplication, and a memoized
// null so a failed create isn't retried in a hot loop. We mock the GoogleGenAI
// client so the create call is observable and never hits the network.

const createMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  // A class (not an arrow-returning vi.fn) so `new GoogleGenAI()` yields an
  // instance whose `.caches.create` is the spy — an arrow impl under `new`
  // discards the returned object.
  GoogleGenAI: class {
    caches = { create: createMock };
  },
}));

import {
  getOrCreateCombinedCache,
  __resetUserCacheForTests,
  type CombinedCacheParams,
} from "@/lib/ai/user-cache";

function params(overrides: Partial<CombinedCacheParams> = {}): CombinedCacheParams {
  return {
    model: "gemini-2.5-flash",
    sessionKey: "room-1:v1",
    cacheableParts: [{ text: "room context" }],
    ...overrides,
  };
}

beforeEach(() => {
  __resetUserCacheForTests();
  createMock.mockReset();
  delete process.env.ENABLE_GEMINI_CACHE;
});

afterEach(() => {
  delete process.env.ENABLE_GEMINI_CACHE;
});

describe("getOrCreateCombinedCache — guards", () => {
  it("returns null and never calls the API when disabled", async () => {
    process.env.ENABLE_GEMINI_CACHE = "0";
    expect(await getOrCreateCombinedCache(params())).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns null on empty cacheableParts", async () => {
    expect(await getOrCreateCombinedCache(params({ cacheableParts: [] }))).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("getOrCreateCombinedCache — create + reuse", () => {
  it("creates once and returns the cache name", async () => {
    createMock.mockResolvedValue({ name: "cachedContents/abc" });
    const name = await getOrCreateCombinedCache(params());
    expect(name).toBe("cachedContents/abc");
    expect(createMock).toHaveBeenCalledTimes(1);
    // The system prompt, when present, is passed through to the create config.
    createMock.mockClear();
    createMock.mockResolvedValue({ name: "cachedContents/withsys" });
    await getOrCreateCombinedCache(params({ system: "you are a designer", sessionKey: "s2" }));
    const cfg = createMock.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(cfg.config.systemInstruction).toBe("you are a designer");
    expect(cfg.config.ttl).toMatch(/^\d+s$/);
  });

  it("reuses the cached name on a second identical call (no second create)", async () => {
    createMock.mockResolvedValue({ name: "cachedContents/reused" });
    const a = await getOrCreateCombinedCache(params());
    const b = await getOrCreateCombinedCache(params());
    expect(a).toBe("cachedContents/reused");
    expect(b).toBe("cachedContents/reused");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("keys on the parts fingerprint — different content triggers a new create", async () => {
    createMock.mockResolvedValue({ name: "cachedContents/x" });
    await getOrCreateCombinedCache(params({ cacheableParts: [{ text: "A" }] }));
    await getOrCreateCombinedCache(params({ cacheableParts: [{ text: "B" }] }));
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe("getOrCreateCombinedCache — resilience", () => {
  it("returns null on a create failure and memoizes it (no retry storm)", async () => {
    createMock.mockRejectedValue(new Error("cache too small"));
    const first = await getOrCreateCombinedCache(params());
    const second = await getOrCreateCombinedCache(params());
    expect(first).toBeNull();
    expect(second).toBeNull();
    // The failure is memoized for a short TTL, so create is only attempted once.
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent in-flight requests into a single create", async () => {
    let resolveCreate!: (v: { name: string }) => void;
    createMock.mockImplementation(
      () => new Promise((res) => { resolveCreate = res; }),
    );
    const p1 = getOrCreateCombinedCache(params());
    const p2 = getOrCreateCombinedCache(params());
    resolveCreate({ name: "cachedContents/inflight" });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("cachedContents/inflight");
    expect(r2).toBe("cachedContents/inflight");
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
