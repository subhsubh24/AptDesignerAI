/**
 * Deterministic escalation ladder — generalizes self-consistency's N=1→N=3
 * pattern into an N-tier ladder where each tier runs only if the previous
 * tier's output fails a deterministic verify() check.
 *
 * The verify function is contractually LLM-free: it uses math, Zod schemas,
 * or counter-based checks. This keeps the common path (tier 0 passes) at
 * one cheap LLM call + one free check.
 */

import { createLogger } from "@/lib/logging/logger";

const log = createLogger("escalation-ladder");

export interface EscalationTier<T> {
  label: string;
  generate: (prev?: { output: T; reason: string }) => Promise<T | null>;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export interface EscalationConfig<T> {
  tiers: EscalationTier<T>[];
  verify: (candidate: T) => VerifyResult;
  onTier?: (tierIndex: number, label: string, accepted: boolean) => void;
}

export interface EscalationResult<T> {
  chosen: T;
  tierReached: number;
  accepted: boolean;
  attempts: number;
}

export async function escalate<T>(cfg: EscalationConfig<T>): Promise<EscalationResult<T>> {
  if (cfg.tiers.length === 0) {
    throw new Error("escalation-ladder: at least one tier required");
  }

  let best: { output: T; tier: number; accepted: boolean } | null = null;
  let attempts = 0;

  for (let i = 0; i < cfg.tiers.length; i++) {
    const tier = cfg.tiers[i];
    const prev = best ? { output: best.output, reason: "" } : undefined;

    // Thread the rejection reason from the last verify failure
    if (prev && !best!.accepted) {
      const lastVerify = cfg.verify(best!.output);
      if (!lastVerify.ok) {
        prev.reason = lastVerify.reason ?? "verification failed";
      }
    }

    try {
      const output = await tier.generate(prev);
      attempts++;

      if (output == null) {
        log.warn(`${tier.label}: generate returned null, skipping`);
        cfg.onTier?.(i, tier.label, false);
        continue;
      }

      const result = cfg.verify(output);
      const accepted = result.ok;

      if (!best || accepted) {
        best = { output, tier: i, accepted };
      }

      cfg.onTier?.(i, tier.label, accepted);

      if (accepted) {
        log.info(`Accepted at tier ${i} (${tier.label})`);
        return { chosen: output, tierReached: i, accepted: true, attempts };
      }

      log.info(`Tier ${i} (${tier.label}) rejected: ${result.reason ?? "unknown"}`);
    } catch (err) {
      attempts++;
      log.warn(`Tier ${i} (${tier.label}) threw`, {
        error: err instanceof Error ? err.message : String(err),
      });
      cfg.onTier?.(i, tier.label, false);
    }
  }

  if (!best) {
    throw new Error("escalation-ladder: all tiers returned null or threw");
  }

  log.warn(`Exhausted all ${cfg.tiers.length} tiers — returning best candidate (unaccepted)`);
  return {
    chosen: best.output,
    tierReached: best.tier,
    accepted: false,
    attempts,
  };
}
