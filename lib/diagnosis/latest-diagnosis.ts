/**
 * Pick the most-recent diagnosis for a room, deterministically.
 *
 * The cross-room coherence context (see `app/api/diagnosis/route.ts`) picks the
 * latest diagnosis per sibling room to seed the prompt. Sorting on `created_at`
 * ALONE is non-deterministic when two diagnoses share a timestamp (batch writes,
 * same-millisecond inserts): the pick — and therefore the LLM prompt, and the
 * seeded output — flips between runs, violating the determinism contract
 * (`.claude/rules/determinism.md`: "every sort needs a deterministic final
 * tiebreaker (id/slug), not just the primary score").
 *
 * This helper sorts by `created_at` DESC with a stable `id` DESC tiebreaker so
 * the "latest" pick is reproducible for any input order.
 */

export interface DatedRow {
  /** ISO-8601 timestamp; lexical compare is chronological for ISO strings. */
  created_at: string;
  /** Stable unique id (uuid) used as the deterministic final tiebreaker. */
  id: string;
}

/**
 * Return the single most-recent row (latest `created_at`, then highest `id`),
 * or `undefined` when the list is empty. Does not mutate the input.
 */
export function pickLatestDiagnosis<T extends DatedRow>(rows: readonly T[]): T | undefined {
  if (rows.length === 0) return undefined;
  let best = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (isMoreRecent(rows[i], best)) best = rows[i];
  }
  return best;
}

/** True when `a` should rank before `b` (more recent, id-tiebroken). */
function isMoreRecent(a: DatedRow, b: DatedRow): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
}
