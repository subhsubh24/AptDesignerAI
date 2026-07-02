import { describe, it, expect, vi } from "vitest";
import {
  insertEmbedding,
  insertEmbeddingWithRetry,
} from "@/lib/store/embedding-index";
import type { MemoryClient } from "@/lib/store/memory-store";
import type { InsertEmbeddingInput } from "@/lib/store/embedding-index";

const INPUT: InsertEmbeddingInput = {
  brand: "Muuto",
  model: "Rest Sofa",
  variant: null,
  image_url: "https://cdn.example.com/rest-sofa.jpg",
  embedding: [0.1, 0.2, 0.3],
  source: "user_confirmed",
};

/**
 * Build a MemoryClient stub whose insert() returns the queued results in order.
 * `null` = success (no error), a string = a transient DB error.
 */
function clientWithInsertResults(results: Array<string | null>): {
  client: MemoryClient;
  insert: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn();
  for (const r of results) {
    insert.mockResolvedValueOnce({ error: r === null ? null : new Error(r) });
  }
  // Any calls beyond the queued results default to success — a test that relies
  // on this is over-calling, which the count assertions will catch.
  insert.mockResolvedValue({ error: null });
  const client = {
    from: vi.fn(() => ({ insert })),
  } as unknown as MemoryClient;
  return { client, insert };
}

describe("insertEmbeddingWithRetry", () => {
  it("returns ok on the first attempt without retrying when the insert succeeds", async () => {
    const { client, insert } = clientWithInsertResults([null]);
    const result = await insertEmbeddingWithRetry(client, INPUT, { delayMs: 0 });
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("recovers a transient failure: retries and returns ok once a later attempt succeeds", async () => {
    // Fail twice, then succeed on the third attempt.
    const { client, insert } = clientWithInsertResults(["ETIMEDOUT", "ECONNRESET", null]);
    const result = await insertEmbeddingWithRetry(client, INPUT, {
      attempts: 3,
      delayMs: 0,
    });
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt budget and surfaces the last error", async () => {
    const { client, insert } = clientWithInsertResults([
      "fail-1",
      "fail-2",
      "fail-3",
    ]);
    const result = await insertEmbeddingWithRetry(client, INPUT, {
      attempts: 3,
      delayMs: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("fail-3");
    }
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("does not retry beyond a single attempt when attempts=1 (matches insertEmbedding)", async () => {
    const { client, insert } = clientWithInsertResults(["boom"]);
    const result = await insertEmbeddingWithRetry(client, INPUT, {
      attempts: 1,
      delayMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("clamps a zero/negative attempt budget up to a single attempt (never zero writes)", async () => {
    const { client, insert } = clientWithInsertResults([null]);
    const result = await insertEmbeddingWithRetry(client, INPUT, {
      attempts: 0,
      delayMs: 0,
    });
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("passes the full embedding payload through to the underlying insert", async () => {
    const { client, insert } = clientWithInsertResults([null]);
    await insertEmbeddingWithRetry(client, INPUT, { delayMs: 0 });
    expect(insert).toHaveBeenCalledWith({
      brand: "Muuto",
      model: "Rest Sofa",
      variant: null,
      image_url: "https://cdn.example.com/rest-sofa.jpg",
      embedding: [0.1, 0.2, 0.3],
      source: "user_confirmed",
    });
  });

  it("single-shot insertEmbedding still surfaces a failure without retrying", async () => {
    const { client, insert } = clientWithInsertResults(["one-shot-fail"]);
    const result = await insertEmbedding(client, INPUT);
    expect(result.ok).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
