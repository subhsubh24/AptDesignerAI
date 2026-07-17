import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Mock the LLM color-inference so lookupColorAsync's custom-color path resolves
// without a real Gemini call. Each unique name returns a deterministic HSL and
// bumps the mock's call count, which is how we observe cache hits vs. misses.
vi.mock("@/lib/ai/semantic-extract", () => ({
  inferColorHslLLM: vi.fn(async () => ({ h: 200, s: 50, l: 50 })),
}));

import { lookupColorAsync } from "@/lib/validation/lookups";
import { inferColorHslLLM } from "@/lib/ai/semantic-extract";

const mockInfer = inferColorHslLLM as unknown as Mock;

beforeEach(() => {
  mockInfer.mockClear();
});
afterEach(() => vi.restoreAllMocks());

// A custom color name with no real color words, guaranteed to miss the sync
// table and fall through to the LLM (and thus the in-process cache).
const custom = (i: number) => `xqv-tone-${i}`;

describe("lookupColorAsync — in-process LLM color cache", () => {
  it("caches a custom color so a repeat lookup does not re-call the LLM", async () => {
    const a = await lookupColorAsync(custom(0));
    const callsAfterFirst = mockInfer.mock.calls.length;
    const b = await lookupColorAsync(custom(0));
    expect(a).toEqual({ h: 200, s: 50, l: 50 });
    expect(b).toEqual(a);
    // Second lookup served from cache → no additional LLM call.
    expect(mockInfer.mock.calls.length).toBe(callsAfterFirst);
  });

  it("bounds the cache at 500 entries, evicting the OLDEST on overflow", async () => {
    // This test relies on the module-level cache accumulating across the two
    // tests in this file (vitest isolates the module registry per file). The
    // previous test inserted custom(0); insert enough NEW distinct colors to
    // push total inserts past the 500-entry bound, forcing an eviction of the
    // oldest key — which is custom(0), the first ever inserted.
    for (let i = 1; i <= 500; i++) {
      await lookupColorAsync(custom(i));
    }
    // 501 distinct colors have now been inserted (custom(0)..custom(500)); the
    // size>500 guard fired on the last insert and evicted the oldest, custom(0).
    mockInfer.mockClear();

    // A recent color is still cached → served without a new LLM call.
    await lookupColorAsync(custom(500));
    expect(mockInfer).not.toHaveBeenCalled();

    // The oldest color was evicted → re-lookup MUST re-call the LLM. Without the
    // size-bounding guard, custom(0) would still be cached and this would be 0.
    await lookupColorAsync(custom(0));
    expect(mockInfer).toHaveBeenCalledTimes(1);
    expect(mockInfer).toHaveBeenCalledWith(custom(0));
  });
});
