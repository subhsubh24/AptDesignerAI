/**
 * Tier-aware AI generation limits — makes the advertised Pro benefit real.
 *
 * "Higher AI generation limits" is sold as a Pro differentiator in three
 * places (app/pricing/page.tsx, app/billing/upgrade/page.tsx ×2), but every
 * generation endpoint applied one flat `RATE_LIMITS.*` config to free and Pro
 * users alike. A subscriber hit the identical 429 a free user did — a paid
 * benefit that did not exist, discoverable within minutes of subscribing.
 *
 * WHAT THIS WIDENS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It widens the per-endpoint BURST limits on the user-facing AI generation
 * surfaces — the ones a subscriber actually runs into while working: room
 * diagnosis, mockup rendering, area analysis, apartment analysis, floor-plan
 * extraction.
 *
 * It does NOT touch the per-user DAILY paid-call ceiling in
 * lib/utils/spend-limiter.ts (DEFAULT_DAILY_LIMIT = 60, shared across ~20 paid
 * routes). That is an abuse circuit-breaker (ROADMAP G7), not a product tier:
 * it exists so a single compromised or abusive account cannot drain the API
 * budget by pacing calls under each endpoint's limit.
 *
 * KNOWN LIMITATION, stated plainly rather than glossed: 60/day is NOT far above
 * heavy use. Pro is sold to "designers & property managers working across many
 * spaces", and that user — diagnosis + area analysis + several mockups per room,
 * across a few apartments in one sitting — can reach 60 paid calls in a single
 * long session and then hits the same flat wall a free user would. So this
 * change makes the burst experience genuinely better for a subscriber (no more
 * per-minute stalls mid-iteration) but does NOT give them a higher daily
 * ceiling. Raising that ceiling is a real follow-up, and deliberately not done
 * here: the limit is read inside checkDailySpend() from a single env-backed
 * number with no tier plumbed through any of its ~20 call sites, so making it
 * tier-aware is its own change — and doing it half-way (a higher ceiling only
 * at the routes that happen to know the tier) would give one shared counter two
 * different ceilings depending on which route observed it, which is worse than
 * a flat limit. Tracked in issue #699.
 *
 * Windows are never widened, only the allowance inside them. A longer window
 * would change how a burst is smoothed; a larger allowance just lets a paying
 * user keep working.
 */

import type { RateLimitConfig } from "@/lib/utils/rate-limiter";

/**
 * How much more generation headroom a paid subscriber gets per window.
 *
 * 3× is chosen to be a difference a subscriber can feel on the limits they
 * actually meet (5 mockups/min → 15; 3 area analyses/5min → 9) while staying
 * inside the daily spend ceiling, which still bounds total cost per user per
 * day regardless of tier. Deliberately a single reviewable number rather than
 * a per-endpoint table: one constant is auditable, and per-endpoint tuning
 * belongs to real usage data we do not have pre-launch.
 */
export const PRO_GENERATION_LIMIT_MULTIPLIER = 3;

/**
 * Widen a generation endpoint's rate-limit config for a paid subscriber.
 *
 * Returns the base config UNCHANGED for free users, so a free user's
 * experience is byte-identical to before this existed — this only ever adds
 * headroom, it never takes any away.
 *
 * Call this ONLY with a generation endpoint's config. It is not a general
 * "make any limit bigger" helper: write limits, auth limits and the abuse
 * breakers are sized for safety, not for tier.
 */
export function generationLimitFor(base: RateLimitConfig, isPro: boolean): RateLimitConfig {
  if (!isPro) return base;
  return {
    ...base,
    maxRequests: base.maxRequests * PRO_GENERATION_LIMIT_MULTIPLIER,
  };
}
