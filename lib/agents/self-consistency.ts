/**
 * Self-consistency sampling for reducing LLM variance at high-commitment
 * decision points (e.g., Pass A in room-diagnostician and area-analysis).
 *
 * Reference: Wang et al. 2022, "Self-Consistency Improves Chain of Thought
 * Reasoning in Language Models" — on reasoning tasks, sampling N outputs
 * and aggregating consistently outperforms single-shot decoding.
 *
 * We adapt it for open-ended design generation by having a judge LLM select
 * the single most coherent candidate. The judge uses a *different* prompt
 * framing than the generator to mitigate self-confirmation bias (a known
 * failure mode when the same model generates and evaluates).
 *
 * Cost: each use multiplies the generation call count by N. Default N=3
 * (sweet spot for variance reduction; higher N has diminishing returns per
 * Wang et al.). Disable via SELF_CONSISTENCY_N=1.
 */
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("self-consistency");

/** Number of parallel samples per self-consistent call (defaults to 1).
 *  Changed from 3→1: single-sample is sufficient for most runs since the
 *  judge rarely picks a non-zero candidate. The downstream self-correction
 *  loop catches quality issues anyway. Override via SELF_CONSISTENCY_N=3. */
export const SELF_CONSISTENCY_N = (() => {
  const raw = process.env.SELF_CONSISTENCY_N;
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
})();

/**
 * Resolve the seed for sample index `i`. With DETERMINISTIC_MODE on, the
 * sequence `DETERMINISTIC_SEED, DETERMINISTIC_SEED+1, …` gives reproducible
 * variation between samples. With it off, callers can supply undefined to
 * fall back on Gemini's stochastic sampling.
 */
export function seedForSample(i: number): number {
  return DETERMINISTIC_SEED + i;
}

export interface SelfConsistencyConfig<T> {
  /** Number of parallel samples. Defaults to SELF_CONSISTENCY_N. */
  n?: number;
  /** Generate one sample with a specific seed. Receives sample index 0..n-1. */
  generate: (seed: number, sampleIndex: number) => Promise<T | null>;
  /**
   * Judge that picks the best candidate by index. Receives only valid
   * (non-null) samples — the caller passes through whatever data is needed
   * for judgment in its closure. If the judge throws or returns an out-of-
   * range index, we fall back to sample 0.
   */
  judge: (candidates: T[]) => Promise<number>;
  /** Label used in logging. */
  label?: string;
  /** Optional quality check for lazy escalation: if the sole sample from
   *  N=1 fails this check, auto-escalate to N=3 + judge. Return true if
   *  the sample passes quality, false to trigger escalation. */
  qualityCheck?: (sample: T) => boolean;
}

/**
 * Generate N samples in parallel, then use the judge to pick the best.
 *
 * Guarantees:
 *   - Returns the first valid sample if only one survives
 *   - Returns sample 0 if the judge fails or returns out-of-range
 *   - Throws only if every sample fails to generate
 */
export async function selfConsistent<T>(config: SelfConsistencyConfig<T>): Promise<{
  chosen: T;
  candidates: T[];
  judgeIndex: number;
  fellBack: boolean;
}> {
  const n = config.n ?? SELF_CONSISTENCY_N;
  const label = config.label ?? "self-consistency";

  // Skip judge entirely when n=1 — lets callers disable the feature via env
  // without paying for a judge call that only sees one option.
  if (n === 1) {
    const only = await config.generate(seedForSample(0), 0);
    if (only == null) throw new Error(`${label}: sole sample failed`);
    // Lazy escalation: if the sole sample fails quality, auto-escalate to 3
    if (config.qualityCheck && !config.qualityCheck(only)) {
      log.warn(`${label}: sole sample failed quality check — escalating to N=3`);
      const escalated = await selfConsistent({ ...config, n: 3, qualityCheck: undefined });
      return escalated;
    }
    return { chosen: only, candidates: [only], judgeIndex: 0, fellBack: false };
  }

  const raw = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      config.generate(seedForSample(i), i).catch((err) => {
        log.warn(`${label}: sample ${i} failed`, { error: String(err) });
        return null;
      })
    )
  );
  const candidates: T[] = raw.filter((s): s is Awaited<T> => s != null) as T[];

  if (candidates.length === 0) {
    throw new Error(`${label}: all ${n} samples failed`);
  }
  if (candidates.length === 1) {
    return { chosen: candidates[0], candidates, judgeIndex: 0, fellBack: false };
  }

  let judgeIndex = 0;
  let fellBack = false;
  try {
    const idx = await config.judge(candidates);
    if (Number.isFinite(idx) && idx >= 0 && idx < candidates.length) {
      judgeIndex = idx;
    } else {
      fellBack = true;
      log.warn(`${label}: judge returned out-of-range index ${idx}, falling back to 0`);
    }
  } catch (err) {
    fellBack = true;
    log.warn(`${label}: judge failed, falling back to sample 0`, { error: String(err) });
  }

  log.info(`${label}: selected sample ${judgeIndex} of ${candidates.length}`, {
    surviving: candidates.length,
    totalRequested: n,
    fellBack,
  });

  return { chosen: candidates[judgeIndex], candidates, judgeIndex, fellBack };
}
