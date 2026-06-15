/**
 * Loop working-memory helpers.
 *
 * The search loop persists what it tried (queries) and how alignment trended
 * (audit history) to the search_sessions row, then seeds the next run from it.
 * Keeping the merge logic here (a) makes the cross-run dedup unit-testable and
 * (b) gives loop memory a single home as it grows. See orchestrator.ts (seed +
 * return) and app/api/search/stream/route.ts (load + persist).
 */

/**
 * Merge prior-run tried queries into this run's set, case-insensitively
 * deduped, preserving order (this run's brief queries first, then any
 * carried-over queries not already present). Returns a new object; inputs are
 * not mutated.
 */
export function mergeTriedQueries(
  current: Record<string, string[]>,
  prior: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [cat, qs] of Object.entries(current)) merged[cat] = [...qs];
  if (!prior) return merged;

  for (const [cat, priorQs] of Object.entries(prior)) {
    const seen = new Set((merged[cat] || []).map((q) => q.trim().toLowerCase()));
    const out = [...(merged[cat] || [])];
    for (const q of priorQs) {
      const key = q?.trim().toLowerCase();
      if (key && !seen.has(key)) {
        out.push(q);
        seen.add(key);
      }
    }
    merged[cat] = out;
  }
  return merged;
}
