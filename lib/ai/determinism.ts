/**
 * Determinism controls for the AI pipeline.
 *
 * Set DETERMINISTIC_MODE=true to make LLM calls reproducible:
 *   - Forces a fixed seed on every Gemini call
 *   - Strips explicit temperature so Gemini 3's default of 1.0 applies
 *     (Google explicitly warns that sub-1.0 temperatures cause looping /
 *     degraded reasoning on Gemini 3 — see
 *     https://ai.google.dev/gemini-api/docs/gemini-3)
 *   - Disables Math.random() jitter in retry backoff
 *   - Bypasses the in-memory product-extractor TTL cache
 *   - Content-hashes uploaded/generated filenames
 *
 * Residual non-determinism under this flag (documented, unavoidable):
 *   - Google Search grounding returns live web results
 *   - Gemini image generation has pixel-level variance even with seed
 *     (mitigated by the mockup cache keyed on product set)
 */

export const DETERMINISTIC = process.env.DETERMINISTIC_MODE === "true";

export const DETERMINISTIC_SEED = (() => {
  const raw = process.env.DETERMINISTIC_SEED;
  if (!raw) return 42;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 42;
})();

/**
 * Resolve the seed to send to the Gemini API.
 * If DETERMINISTIC=true, always returns DETERMINISTIC_SEED, overriding caller.
 * Otherwise returns the caller's seed (may be undefined — fully stochastic).
 */
export function resolveSeed(callerSeed: number | undefined): number | undefined {
  if (DETERMINISTIC) return DETERMINISTIC_SEED;
  return callerSeed;
}

/**
 * Resolve temperature for a Gemini 3 call.
 * If DETERMINISTIC=true, returns undefined (let Gemini 3 use its default of 1.0).
 * Otherwise returns the caller's temperature (may be undefined).
 *
 * Note: Gemini 3 reasoning is optimized for temperature 1.0. Setting lower
 * values on Gemini 3 can cause looping / degraded output — so even in normal
 * (non-deterministic) mode, callers should prefer passing `undefined` over
 * explicit sub-1.0 values.
 */
export function resolveTemperature(callerTemperature: number | undefined): number | undefined {
  if (DETERMINISTIC) return undefined;
  return callerTemperature;
}
