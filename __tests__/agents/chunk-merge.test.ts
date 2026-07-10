import { describe, it, expect } from "vitest";
import { mergeParallelChunkScores } from "@/lib/agents/chunk-merge";

// Minimal shape mirroring an item score row: a category plus a distinguishing value.
type Score = { category: string; value: number };

describe("mergeParallelChunkScores", () => {
  it("re-assembles both chunks in original item order", () => {
    const g1: Score[] = [
      { category: "sofa", value: 1 },
      { category: "rug", value: 2 },
    ];
    const g2: Score[] = [
      { category: "lamp", value: 3 },
      { category: "art", value: 4 },
    ];
    expect(mergeParallelChunkScores(g1, 2, g2, 2)).toEqual([
      { category: "sofa", value: 1 },
      { category: "rug", value: 2 },
      { category: "lamp", value: 3 },
      { category: "art", value: 4 },
    ]);
  });

  it("keeps each DUPLICATE-category item's own score (the bug this replaces)", () => {
    // Two throw_pillow items in group 1 with DISTINCT scores. A `.find()` by
    // category would return the first pillow's score for BOTH positions, dropping
    // the second's real score. Positional merge must preserve both.
    const g1: Score[] = [
      { category: "throw_pillow", value: 10 },
      { category: "throw_pillow", value: 20 },
      { category: "sofa", value: 30 },
    ];
    const g2: Score[] = [
      { category: "wall_art", value: 40 },
      { category: "wall_art", value: 50 },
    ];
    const merged = mergeParallelChunkScores(g1, 3, g2, 2);
    expect(merged).toEqual([
      { category: "throw_pillow", value: 10 },
      { category: "throw_pillow", value: 20 },
      { category: "sofa", value: 30 },
      { category: "wall_art", value: 40 },
      { category: "wall_art", value: 50 },
    ]);
    // Both distinct duplicate scores survive (no collapse onto the first match).
    expect(merged.map((s) => s.value)).toEqual([10, 20, 30, 40, 50]);
  });

  it("omits tail items when a chunk returns FEWER scores than its group (partial response)", () => {
    // group1 declared 3 items but the model returned only 2 scores.
    const g1: Score[] = [
      { category: "sofa", value: 1 },
      { category: "rug", value: 2 },
    ];
    const g2: Score[] = [{ category: "lamp", value: 3 }];
    const merged = mergeParallelChunkScores(g1, 3, g2, 1);
    // Present group1 scores, then group2 — the missing 3rd group1 item is dropped,
    // NOT back-filled from group2 (which would mis-assign a lamp score to a sofa slot).
    expect(merged).toEqual([
      { category: "sofa", value: 1 },
      { category: "rug", value: 2 },
      { category: "lamp", value: 3 },
    ]);
    // Length is below the expected total (3 + 1 = 4) so the caller can detect the shortfall.
    expect(merged.length).toBeLessThan(4);
  });

  it("ignores extra scores beyond a group's declared size", () => {
    const g1: Score[] = [
      { category: "sofa", value: 1 },
      { category: "rug", value: 2 },
      { category: "extra", value: 99 },
    ];
    const g2: Score[] = [{ category: "lamp", value: 3 }];
    expect(mergeParallelChunkScores(g1, 2, g2, 1)).toEqual([
      { category: "sofa", value: 1 },
      { category: "rug", value: 2 },
      { category: "lamp", value: 3 },
    ]);
  });

  it("handles an empty second group", () => {
    const g1: Score[] = [{ category: "sofa", value: 1 }];
    expect(mergeParallelChunkScores(g1, 1, [], 0)).toEqual([{ category: "sofa", value: 1 }]);
  });
});
