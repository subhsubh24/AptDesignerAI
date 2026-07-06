import { describe, it, expect, vi } from "vitest";
import { topKSimilar } from "@/lib/store/embedding-index";
import type { MemoryClient } from "@/lib/store/memory-store";

/**
 * Build a MemoryClient stub whose from(...).select("*") resolves to the given
 * rows (or an error). topKSimilar reads `product_image_embeddings` this way.
 */
function clientWithRows(
  rows: Array<Record<string, unknown>> | null,
  error: string | null = null,
): MemoryClient {
  const select = vi.fn().mockResolvedValue({
    data: rows,
    error: error === null ? null : new Error(error),
  });
  return {
    from: vi.fn(() => ({ select })),
  } as unknown as MemoryClient;
}

function row(
  overrides: Partial<{
    brand: string;
    model: string;
    variant: string | null;
    image_url: string;
    embedding: number[];
    source: string;
  }>,
): Record<string, unknown> {
  return {
    brand: "Brand",
    model: "Model",
    variant: null,
    image_url: "https://cdn.example.com/x.jpg",
    embedding: [1, 0],
    source: "catalog",
    ...overrides,
  };
}

describe("topKSimilar", () => {
  it("filters out matches below minSimilarity and sorts the rest descending", async () => {
    const client = clientWithRows([
      row({ image_url: "https://cdn.example.com/exact.jpg", embedding: [1, 0] }), // sim 1.0
      row({ image_url: "https://cdn.example.com/ortho.jpg", embedding: [0, 1] }), // sim 0.0 -> filtered
      row({ image_url: "https://cdn.example.com/diag.jpg", embedding: [1, 1] }), // sim ~0.707
    ]);
    const out = await topKSimilar(client, [1, 0]);
    expect(out.map((m) => m.image_url)).toEqual([
      "https://cdn.example.com/exact.jpg",
      "https://cdn.example.com/diag.jpg",
    ]);
    expect(out[0].similarity).toBeGreaterThan(out[1].similarity);
  });

  it("applies a deterministic tiebreak on equal similarity regardless of input order", async () => {
    const rowsForward = [
      row({ image_url: "https://cdn.example.com/zzz.jpg", embedding: [1, 0] }),
      row({ image_url: "https://cdn.example.com/aaa.jpg", embedding: [1, 0] }),
    ];
    const forward = await topKSimilar(clientWithRows(rowsForward), [1, 0]);
    const reverse = await topKSimilar(
      clientWithRows([...rowsForward].reverse()),
      [1, 0],
    );
    // Both rows have similarity 1.0; the image_url tiebreak fixes a stable order.
    const expected = [
      "https://cdn.example.com/aaa.jpg",
      "https://cdn.example.com/zzz.jpg",
    ];
    expect(forward.map((m) => m.image_url)).toEqual(expected);
    expect(reverse.map((m) => m.image_url)).toEqual(expected);
  });

  it("respects the k limit", async () => {
    const client = clientWithRows([
      row({ image_url: "https://cdn.example.com/a.jpg", embedding: [1, 0] }),
      row({ image_url: "https://cdn.example.com/b.jpg", embedding: [1, 0] }),
      row({ image_url: "https://cdn.example.com/c.jpg", embedding: [1, 0] }),
    ]);
    const out = await topKSimilar(client, [1, 0], { k: 2 });
    expect(out).toHaveLength(2);
  });

  it("honors a custom minSimilarity threshold", async () => {
    const client = clientWithRows([
      row({ image_url: "https://cdn.example.com/diag.jpg", embedding: [1, 1] }), // ~0.707
    ]);
    expect(await topKSimilar(client, [1, 0], { minSimilarity: 0.8 })).toHaveLength(0);
    expect(await topKSimilar(client, [1, 0], { minSimilarity: 0.5 })).toHaveLength(1);
  });

  it("skips rows whose embedding length does not match the query vector", async () => {
    const client = clientWithRows([
      row({ image_url: "https://cdn.example.com/wrong-dim.jpg", embedding: [1, 0, 0] }),
      row({ image_url: "https://cdn.example.com/ok.jpg", embedding: [1, 0] }),
    ]);
    const out = await topKSimilar(client, [1, 0]);
    expect(out.map((m) => m.image_url)).toEqual(["https://cdn.example.com/ok.jpg"]);
  });

  it("returns [] when the read errors", async () => {
    const client = clientWithRows(null, "db unavailable");
    expect(await topKSimilar(client, [1, 0])).toEqual([]);
  });

  it("returns [] when there are no rows", async () => {
    expect(await topKSimilar(clientWithRows([]), [1, 0])).toEqual([]);
  });
});
