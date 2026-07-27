export type PriceTier = "budget" | "balanced" | "high_end";

/**
 * The price-tier palette for the focus page's tier comparison (totals summary,
 * desktop table headers/cells, and the per-product tier badge).
 *
 * Deliberately a ONE-HUE EMPHASIS LADDER, not three colours. The previous
 * palette assigned emerald → blue → purple, putting three unrelated accent
 * families on the flagship surface — both of the things VISION.md's design bar
 * names as slop ("purple-gradient-on-white", "three competing accent colors")
 * — and none of them from the warm-editorial token system.
 *
 * The tiers are a LADDER (cheapest → dearest), so they should read as one: the
 * eye follows increasing weight rather than hopping between hues.
 *
 *   budget    → muted foreground     quiet, recedes
 *   balanced  → warm accent          the house accent marks the middle option
 *   high_end  → full foreground ink  heaviest, top of the ladder
 *
 * Every value is a design-system token, so a token change moves this palette
 * with the rest of the product instead of stranding it.
 *
 * `text` uses `--accent-warm-strong` rather than `--accent-warm` for exactly
 * the reason globals.css defines that token: it is the variant intended for
 * accent TEXT, where the plain accent sits closer to the AA floor.
 *
 * Contrast is NOT asserted here in prose. It is computed from the real
 * globals.css token values, against the surfaces this palette actually renders
 * on, in __tests__/design/tier-colors-system.test.ts.
 *
 * Only `text` and `badge` exist because only those are consumed. The former
 * `bg` and `border` entries had no call site anywhere in the repo.
 */
export const TIER_COLORS: Record<PriceTier, { text: string; badge: string }> = {
  budget: {
    text: "text-muted-foreground",
    badge: "text-muted-foreground border-border",
  },
  balanced: {
    text: "text-accent-warm-strong",
    badge: "text-accent-warm-strong border-border",
  },
  high_end: {
    text: "text-foreground",
    badge: "text-foreground border-border",
  },
};

export const TIER_LABELS: Record<PriceTier, string> = {
  budget: "Budget",
  balanced: "Mid-Range",
  high_end: "Luxury",
};
