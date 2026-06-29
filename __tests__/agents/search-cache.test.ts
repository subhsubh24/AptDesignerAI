import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PriceTier } from "@/lib/prompts/search-brief";
import type { SearchCandidate } from "@/lib/agents/shopping-researcher";
import type { DesignDirection } from "@/lib/types/database";

// The cache short-circuits to a miss whenever DETERMINISTIC is true (the repo
// default, including in this test runner). Force it false so the real LRU/TTL
// behaviour is exercised; the production bypass is asserted separately below.
vi.mock("@/lib/ai/determinism", () => ({ DETERMINISTIC: false }));

type Cache = typeof import("@/lib/agents/search-cache");

/**
 * Re-import the module fresh so the module-level Maps start empty for every
 * test (they are private, so this is the only way to isolate state).
 */
async function freshCache(): Promise<Cache> {
  vi.resetModules();
  return import("@/lib/agents/search-cache");
}

function cand(url: string, title = "Item"): SearchCandidate {
  return { title, url, snippet: "s", source: "example.com" };
}

const TIER: PriceTier = "balanced";

describe("search-cache — query cache", () => {
  it("returns null on a miss and the stored value on a hit (round trip)", async () => {
    const { getCachedQuery, cacheQuery } = await freshCache();
    expect(getCachedQuery("sofa", TIER, "seating", 10)).toBeNull();

    const data = [cand("https://a.com/1"), cand("https://a.com/2")];
    cacheQuery("sofa", TIER, "seating", 10, data);
    expect(getCachedQuery("sofa", TIER, "seating", 10)).toEqual(data);
  });

  it("keys on every input — a different query/tier/category/maxResults misses", async () => {
    const { getCachedQuery, cacheQuery } = await freshCache();
    cacheQuery("sofa", "balanced", "seating", 10, [cand("https://a.com/1")]);

    expect(getCachedQuery("couch", "balanced", "seating", 10)).toBeNull(); // query
    expect(getCachedQuery("sofa", "budget", "seating", 10)).toBeNull(); // tier
    expect(getCachedQuery("sofa", "balanced", "tables", 10)).toBeNull(); // category
    expect(getCachedQuery("sofa", "balanced", "seating", 20)).toBeNull(); // maxResults
    // The exact key still hits.
    expect(getCachedQuery("sofa", "balanced", "seating", 10)).not.toBeNull();
  });

  it("treats undefined tier/category as a stable, distinct key", async () => {
    const { getCachedQuery, cacheQuery } = await freshCache();
    cacheQuery("rug", undefined, undefined, 5, [cand("https://a.com/rug")]);
    expect(getCachedQuery("rug", undefined, undefined, 5)).toHaveLength(1);
    // A defined tier is a different key than undefined.
    expect(getCachedQuery("rug", "budget", undefined, 5)).toBeNull();
  });
});

describe("search-cache — screen cache", () => {
  const reqs = ["under $500", "neutral palette"];

  it("round-trips a batch and is order-insensitive on the batch URLs", async () => {
    const { getCachedScreen, cacheScreen } = await freshCache();
    const batch = [cand("https://x.com/b"), cand("https://x.com/a")];
    const passed = [cand("https://x.com/a")];
    cacheScreen(batch, "seating", TIER, reqs, undefined, passed);

    // Same URLs in a different order must hit (keys sort the URLs).
    const reordered = [cand("https://x.com/a"), cand("https://x.com/b")];
    expect(getCachedScreen(reordered, "seating", TIER, reqs, undefined)).toEqual(passed);
  });

  it("includes the design direction in the key", async () => {
    const { getCachedScreen, cacheScreen } = await freshCache();
    const batch = [cand("https://x.com/a")];
    const dd = {
      style_notes: "warm minimal",
      recommended_palette: ["sand", "clay"],
      recommended_materials: ["oak"],
    } as unknown as DesignDirection;
    cacheScreen(batch, "seating", TIER, reqs, dd, [cand("https://x.com/a")]);

    // With the same direction → hit; with no direction → miss.
    expect(getCachedScreen(batch, "seating", TIER, reqs, dd)).not.toBeNull();
    expect(getCachedScreen(batch, "seating", TIER, reqs, undefined)).toBeNull();
  });

  it("misses when the requirements differ", async () => {
    const { getCachedScreen, cacheScreen } = await freshCache();
    const batch = [cand("https://x.com/a")];
    cacheScreen(batch, "seating", TIER, ["a"], undefined, [cand("https://x.com/a")]);
    expect(getCachedScreen(batch, "seating", TIER, ["b"], undefined)).toBeNull();
  });
});

describe("search-cache — TTL expiry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("evicts an entry once it is older than the 48h TTL", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { getCachedQuery, cacheQuery } = await freshCache();
    cacheQuery("lamp", TIER, "lighting", 8, [cand("https://a.com/lamp")]);

    // Just under 48h → still a hit.
    vi.advanceTimersByTime(48 * 60 * 60 * 1000 - 1000);
    expect(getCachedQuery("lamp", TIER, "lighting", 8)).not.toBeNull();

    // Past 48h → expired.
    vi.advanceTimersByTime(2000);
    expect(getCachedQuery("lamp", TIER, "lighting", 8)).toBeNull();
  });

  it("measures age from creation, not last access (a hit does not refresh TTL)", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { getCachedQuery, cacheQuery } = await freshCache();
    cacheQuery("chair", TIER, "seating", 8, [cand("https://a.com/chair")]);

    // Access at 24h (bumps recency but must NOT reset the timestamp).
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(getCachedQuery("chair", TIER, "seating", 8)).not.toBeNull();

    // 25h later (49h total) → expired despite the mid-life access.
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(getCachedQuery("chair", TIER, "seating", 8)).toBeNull();
  });
});

describe("search-cache — LRU eviction", () => {
  it("drops the least-recently-used entry past the 500-entry cap", async () => {
    const { getCachedQuery, cacheQuery } = await freshCache();
    // Fill exactly to the cap.
    for (let i = 0; i < 500; i++) {
      cacheQuery(`q${i}`, TIER, "c", 10, [cand(`https://a.com/${i}`)]);
    }
    // Touch q0 so it is the most-recently-used, not the oldest.
    expect(getCachedQuery("q0", TIER, "c", 10)).not.toBeNull();

    // One more insert overflows the cap; the LRU victim is q1 (oldest untouched),
    // while the freshly-touched q0 survives.
    cacheQuery("q500", TIER, "c", 10, [cand("https://a.com/500")]);
    expect(getCachedQuery("q1", TIER, "c", 10)).toBeNull();
    expect(getCachedQuery("q0", TIER, "c", 10)).not.toBeNull();
    expect(getCachedQuery("q500", TIER, "c", 10)).not.toBeNull();
  });
});

describe("search-cache — deterministic bypass", () => {
  afterEach(() => {
    // Restore the file-wide false mock + a clean module registry so this test's
    // DETERMINISTIC=true override can never leak into another test regardless of
    // run order (vi.doUnmock would drop the mock entirely, exposing the real flag).
    vi.doMock("@/lib/ai/determinism", () => ({ DETERMINISTIC: false }));
    vi.resetModules();
  });

  it("never returns a cached value when DETERMINISTIC is true", async () => {
    vi.resetModules();
    vi.doMock("@/lib/ai/determinism", () => ({ DETERMINISTIC: true }));
    const mod = await import("@/lib/agents/search-cache");
    mod.cacheQuery("sofa", TIER, "seating", 10, [cand("https://a.com/1")]);
    // Determinism bypasses the read path entirely → always a miss.
    expect(mod.getCachedQuery("sofa", TIER, "seating", 10)).toBeNull();
  });
});
