// Deterministic-aware retry backoff for the Gemini provider's inline retry loop.
//
// Extracted as a pure function so the DETERMINISTIC gate is unit-testable: the
// cost/determinism contract requires that no scoring/agent path introduces
// unguarded `Math.random()`, and rate-limit retries are common under load. This
// mirrors the jitter gate in `lib/ai/retry.ts` (`if (jitter && !DETERMINISTIC)`).

export type RetryKind = "rate_limit" | "server" | "transport";

/**
 * Full-jitter (AWS pattern) exponential backoff, in milliseconds.
 *
 * - rate_limit: base grows 2s → 4s → 8s → 16s → 32s. A random delay in
 *   [500, baseDelay+500) decorrelates dozens of concurrent 429s so they don't
 *   retry in lockstep forever. Under DETERMINISTIC mode the jitter is disabled
 *   (returns the deterministic baseDelay) so reproducible runs stay reproducible.
 * - server: base grows 1s → 2s → 4s …
 * - transport: base grows 0.5s → 1s → 2s …
 *
 * @param rand injectable RNG (defaults to Math.random) — only consulted when
 *             kind === "rate_limit" AND deterministic === false.
 */
export function computeRetryDelay(
  attempt: number,
  kind: RetryKind,
  deterministic: boolean,
  rand: () => number = Math.random,
): number {
  const baseDelay =
    kind === "rate_limit"
      ? 2000 * Math.pow(2, attempt - 1)
      : kind === "server"
        ? 1000 * Math.pow(2, attempt - 1)
        : 500 * Math.pow(2, attempt - 1);

  if (kind === "rate_limit" && !deterministic) {
    return Math.floor(rand() * baseDelay) + 500;
  }
  return baseDelay;
}
