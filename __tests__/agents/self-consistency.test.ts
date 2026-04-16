import { describe, it, expect, vi } from "vitest";
import { selfConsistent, seedForSample, SELF_CONSISTENCY_N } from "@/lib/agents/self-consistency";

describe("seedForSample", () => {
  it("returns deterministic offsets from the base seed", () => {
    const a = seedForSample(0);
    const b = seedForSample(1);
    const c = seedForSample(2);
    expect(b - a).toBe(1);
    expect(c - a).toBe(2);
  });
});

describe("SELF_CONSISTENCY_N", () => {
  it("is a positive integer (defaults to 3)", () => {
    expect(Number.isInteger(SELF_CONSISTENCY_N)).toBe(true);
    expect(SELF_CONSISTENCY_N).toBeGreaterThanOrEqual(1);
  });
});

describe("selfConsistent", () => {
  it("short-circuits the judge when n=1", async () => {
    const generate = vi.fn(async () => ({ id: "only" }));
    const judge = vi.fn(async () => 0);

    const result = await selfConsistent<{ id: string }>({
      n: 1,
      generate,
      judge,
    });

    expect(result.chosen.id).toBe("only");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(judge).not.toHaveBeenCalled();
    expect(result.fellBack).toBe(false);
  });

  it("generates n samples in parallel and calls judge to pick", async () => {
    const generate = vi.fn(async (_seed: number, i: number) => ({ id: `sample-${i}` }));
    const judge = vi.fn(async () => 1);

    const result = await selfConsistent<{ id: string }>({
      n: 3,
      generate,
      judge,
    });

    expect(generate).toHaveBeenCalledTimes(3);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(3);
    expect(result.chosen.id).toBe("sample-1");
    expect(result.judgeIndex).toBe(1);
    expect(result.fellBack).toBe(false);
  });

  it("skips failed samples (returns null) and still runs judge on survivors", async () => {
    const generate = vi.fn(async (_seed: number, i: number) =>
      i === 1 ? null : { id: `sample-${i}` },
    );
    const judge = vi.fn(async (candidates: Array<{ id: string }>) => {
      // Judge receives only survivors
      expect(candidates).toHaveLength(2);
      return 0;
    });

    const result = await selfConsistent<{ id: string }>({
      n: 3,
      generate,
      judge,
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.chosen.id).toBe("sample-0");
  });

  it("skips judge when only one survivor remains", async () => {
    const generate = vi.fn(async (_seed: number, i: number) =>
      i === 2 ? { id: `sample-${i}` } : null,
    );
    const judge = vi.fn(async () => 0);

    const result = await selfConsistent<{ id: string }>({
      n: 3,
      generate,
      judge,
    });

    expect(judge).not.toHaveBeenCalled();
    expect(result.chosen.id).toBe("sample-2");
    expect(result.candidates).toHaveLength(1);
  });

  it("falls back to sample 0 when the judge throws", async () => {
    const generate = vi.fn(async (_seed: number, i: number) => ({ id: `sample-${i}` }));
    const judge = vi.fn(async () => {
      throw new Error("judge blew up");
    });

    const result = await selfConsistent<{ id: string }>({
      n: 3,
      generate,
      judge,
    });

    expect(result.chosen.id).toBe("sample-0");
    expect(result.fellBack).toBe(true);
  });

  it("falls back to sample 0 when the judge returns an out-of-range index", async () => {
    const generate = vi.fn(async (_seed: number, i: number) => ({ id: `sample-${i}` }));
    const judge = vi.fn(async () => 99);

    const result = await selfConsistent<{ id: string }>({
      n: 3,
      generate,
      judge,
    });

    expect(result.chosen.id).toBe("sample-0");
    expect(result.fellBack).toBe(true);
  });

  it("throws when every sample fails", async () => {
    const generate = vi.fn(async () => null);
    const judge = vi.fn(async () => 0);

    await expect(
      selfConsistent({
        n: 3,
        generate,
        judge,
        label: "test",
      }),
    ).rejects.toThrow(/all 3 samples failed/);
  });

  it("uses distinct seeds for each sample", async () => {
    const seedsSeen: number[] = [];
    const generate = vi.fn(async (seed: number) => {
      seedsSeen.push(seed);
      return { seed };
    });
    const judge = vi.fn(async () => 0);

    await selfConsistent<{ seed: number }>({
      n: 3,
      generate,
      judge,
    });

    // All seeds should be unique
    expect(new Set(seedsSeen).size).toBe(seedsSeen.length);
    expect(seedsSeen).toHaveLength(3);
  });
});
