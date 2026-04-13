import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  semanticLookup,
  semanticStore,
  __resetSemanticCacheForTests,
} from "@/lib/ai/semantic-cache";

const ORIGINAL_ENV = { ...process.env };

describe("semantic-cache", () => {
  beforeEach(() => {
    __resetSemanticCacheForTests();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetSemanticCacheForTests();
  });

  it("returns null when ENABLE_SEMANTIC_CACHE is not set", async () => {
    delete process.env.ENABLE_SEMANTIC_CACHE;
    const result = await semanticLookup("ns", "some query text");
    expect(result).toBeNull();
  });

  it("skips store() when disabled — subsequent lookup still returns null", async () => {
    delete process.env.ENABLE_SEMANTIC_CACHE;
    await semanticStore("ns", "hello", { foo: 1 });
    const result = await semanticLookup("ns", "hello");
    expect(result).toBeNull();
  });

  it("returns null on empty text even when enabled", async () => {
    process.env.ENABLE_SEMANTIC_CACHE = "1";
    const result = await semanticLookup("ns", "   ");
    expect(result).toBeNull();
  });
});
