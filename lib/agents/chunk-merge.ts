/**
 * Merge the per-item scores from two parallel scoring chunks back into the
 * original item order.
 *
 * The parallel-chunk scoring paths (Harmony Pass A + Final Assessment Pass A in
 * `validation-agent.ts`) split the item list in half and ask each half to
 * return `item_scores` for its assigned subset IN INPUT ORDER, then re-assemble
 * the full ordered list. Assembly is POSITIONAL: `chunk1Scores[i]` belongs to
 * the i-th item of group 1, `chunk2Scores[i]` to the i-th item of group 2.
 *
 * Positional (not category-keyed) merging is REQUIRED for correctness. Item
 * lists routinely contain duplicate categories (two `throw_pillow` items, two
 * `wall_art`, two `nightstand`). Matching a returned score back to its item via
 * `.find(s => s.category === group[i].category)` returns the FIRST match for
 * BOTH duplicates — silently assigning one item's score to the other and
 * dropping a real score. Positional indexing keeps each duplicate's own score.
 *
 * If a chunk returns FEWER scores than its group size (a partial LLM response),
 * the tail items simply have no score and are omitted; the returned length is
 * therefore less than `group1Size + group2Size`, which the caller can detect
 * (and does log) to surface the shortfall. Extra scores beyond a group's size
 * are ignored.
 */
export function mergeParallelChunkScores<T>(
  chunk1Scores: readonly T[],
  group1Size: number,
  chunk2Scores: readonly T[],
  group2Size: number,
): T[] {
  const merged: T[] = [];
  const take1 = Math.min(chunk1Scores.length, group1Size);
  for (let i = 0; i < take1; i++) merged.push(chunk1Scores[i]);
  const take2 = Math.min(chunk2Scores.length, group2Size);
  for (let i = 0; i < take2; i++) merged.push(chunk2Scores[i]);
  return merged;
}
