/**
 * Domain extraction-success router.
 *
 * Tracks per-domain extraction outcomes (success vs sentinel/failure) both
 * within the current run (domainSentinelStats in orchestrator) and across runs
 * (persisted via loop memory). On the next run the prior stats inform domain
 * ordering in search queries — high-success domains go first, chronically-
 * failing domains are deprioritized — and the extraction gate can skip domains
 * with near-zero success rate.
 *
 * Design constraints:
 *   • No per-retailer search queries (user: "don't search every single retailer
 *     individually"). Instead we reorder the include_domains list so Tavily
 *     naturally favors better-extracting retailers.
 *   • Lightweight — just sorting/filtering a string[], no LLM calls.
 *   • Merges across runs like triedQueries — additive, not overwriting.
 */

export interface DomainStats {
  attempts: number;
  successes: number;
}

export type DomainStatsMap = Record<string, DomainStats>;

export function trackDomainResult(
  stats: DomainStatsMap,
  url: string,
  success: boolean,
): void {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const entry = stats[domain] ?? { attempts: 0, successes: 0 };
    entry.attempts++;
    if (success) entry.successes++;
    stats[domain] = entry;
  } catch { /* invalid URL */ }
}

export function getDomainSuccessRate(stats: DomainStatsMap, domain: string): number {
  const clean = domain.replace(/^www\./, "").toLowerCase();
  const entry = stats[clean];
  if (!entry || entry.attempts === 0) return 0.5; // unknown = neutral
  return entry.successes / entry.attempts;
}

/**
 * Merge prior-run domain stats into current stats. Adds attempts/successes
 * cumulatively with a decay factor to avoid stale data dominating.
 * Prior stats are halved (exponential decay) so recent runs matter more.
 */
export function mergeDomainStats(
  current: DomainStatsMap,
  prior: DomainStatsMap | undefined,
): DomainStatsMap {
  if (!prior) return { ...current };
  const merged: DomainStatsMap = { ...current };
  for (const [domain, priorEntry] of Object.entries(prior)) {
    const existing = merged[domain];
    if (existing) {
      existing.attempts += Math.round(priorEntry.attempts * 0.5);
      existing.successes += Math.round(priorEntry.successes * 0.5);
    } else {
      merged[domain] = {
        attempts: Math.round(priorEntry.attempts * 0.5),
        successes: Math.round(priorEntry.successes * 0.5),
      };
    }
  }
  return merged;
}

/**
 * Reorder a domain list so high-success-rate domains come first and
 * chronically-failing domains (<20% over 3+ attempts) are removed entirely.
 * Unknown domains keep their original position.
 */
export function prioritizeDomains(
  domains: string[],
  stats: DomainStatsMap,
): string[] {
  const MIN_ATTEMPTS_TO_JUDGE = 3;
  const BLOCK_THRESHOLD = 0.2;

  return domains
    .filter((d) => {
      const clean = d.replace(/^www\./, "").toLowerCase();
      const entry = stats[clean];
      if (!entry || entry.attempts < MIN_ATTEMPTS_TO_JUDGE) return true;
      return entry.successes / entry.attempts >= BLOCK_THRESHOLD;
    })
    .sort((a, b) => {
      const rateA = getDomainSuccessRate(stats, a);
      const rateB = getDomainSuccessRate(stats, b);
      return rateB - rateA;
    });
}
