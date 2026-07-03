import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "@/lib/ai/embeddings";

// cosineSimilarity gates furniture retrieval: topKSimilar() (and the pgvector
// fallback path) score every candidate embedding against the query crop with
// it, and priors below minSimilarity (0.55) are dropped as noise. A regression
// here silently changes which product priors reach the identifier, so these
// pin the exact numeric contract and its guard branches.
describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  it("is scale-invariant — a positively scaled vector is still fully similar", () => {
    // Direction, not magnitude: [2,4,6] is [1,2,3] * 2.
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 12);
  });

  it("computes the known cosine for a non-trivial pair", () => {
    // a·b = 1*4 + 2*5 + 3*6 = 32; |a| = sqrt(14); |b| = sqrt(77)
    // 32 / (sqrt(14)*sqrt(77)) = 32 / sqrt(1078) ≈ 0.974631846
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.974631846, 8);
  });

  it("is symmetric in its arguments", () => {
    const a = [0.2, -0.5, 0.9, 0.1];
    const b = [-0.3, 0.4, 0.8, -0.6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 12);
  });

  it("returns a value within [-1, 1] for arbitrary real vectors", () => {
    const a = [3, -7, 2, 11, -4];
    const b = [-1, 5, 9, -2, 6];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it("returns 0 when the first vector is all zeros (avoids divide-by-zero NaN)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 when the second vector is all zeros", () => {
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("returns 0 when both vectors are all zeros (not NaN)", () => {
    const sim = cosineSimilarity([0, 0], [0, 0]);
    expect(sim).toBe(0);
    expect(Number.isNaN(sim)).toBe(false);
  });

  it("throws with a dimension-mismatch message rather than scoring silently", () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(/dim mismatch 3 vs 2/);
  });

  it("throws when the first vector is empty and the second is not", () => {
    expect(() => cosineSimilarity([], [1])).toThrow(/dim mismatch 0 vs 1/);
  });
});
