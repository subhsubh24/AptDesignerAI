import type { Verdict } from "@/lib/types/scoring";

/**
 * The scoring colour system — verdict chips, 0–10 score text, score bars, and
 * the scorecard summary surface.
 *
 * Deliberately a ONE-HUE EMPHASIS LADDER, not a traffic light.
 *
 * The previous palette put emerald → green → amber → red on the verdict chip and
 * emerald → amber → rose on the score, i.e. four (and three) unrelated Tailwind
 * accent families on the surfaces the user reads most — exactly what VISION.md's
 * design bar names as slop ("three competing accent colors"), and none of them
 * from the warm-editorial token system. Two of them (emerald vs green) were also
 * near-indistinguishable, so the hue carried no information the label did not
 * already carry in words.
 *
 * Verdicts and scores are a LADDER (worst → best), so they should read as one:
 * the eye follows increasing WEIGHT rather than hopping between hues. The
 * ordering signal is emphasis, and it runs in the same direction everywhere:
 *
 *   worst  → muted foreground / outline   quiet, recedes
 *   middle → warm accent                  the house accent marks the middle
 *   best   → full foreground ink          heaviest, top of the ladder
 *
 * Nothing is lost by dropping the hue: every one of these surfaces renders the
 * verdict LABEL ("Strong Yes" / "No") or the NUMBER right next to the colour, so
 * the colour was never the only carrier of the meaning — it was decoration that
 * happened to be off-system.
 *
 * Every value is a design-system token, so a token change moves this palette
 * with the rest of the product instead of stranding it. This mirrors the ladder
 * already proven on the price tiers in `lib/utils/tier-colors.ts`.
 *
 * `text-accent-warm-strong` rather than `text-accent-warm` for accent TEXT, for
 * exactly the reason globals.css defines that token: the plain accent sits
 * closer to the AA floor when used as text on a tinted surface.
 *
 * Light/dark parity is automatic — these are semantic tokens, not `dark:`-paired
 * palette weights, so the theme moves them. `__tests__/scoring/verdicts.test.ts`
 * COMPUTES the contrast ratios from the real globals.css token values rather
 * than asserting them in prose here.
 *
 * The matching CSS half of the old traffic light (`--score-excellent/good/fair/
 * poor` in app/globals.css) had zero consumers in either theme and was removed
 * with this change.
 */

export const VERDICT_LABELS: Record<Verdict, string> = {
  strong_yes: "Strong Yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

/**
 * Verdict chip: four rungs of a single emphasis ladder.
 *
 *   strong_yes → solid ink pill   (inverted; the strongest mark on the page)
 *   yes        → accent tint      (the house accent, filled)
 *   maybe      → muted fill       (present but quiet)
 *   no         → outline only     (quietest; recedes to the border)
 */
export const VERDICT_COLORS: Record<Verdict, string> = {
  strong_yes: "text-background bg-foreground border-foreground",
  yes: "text-accent-warm-strong bg-accent-warm/10 border-accent-warm/30",
  maybe: "text-muted-foreground bg-muted border-border",
  no: "text-muted-foreground bg-transparent border-border",
};

/**
 * Score TEXT colour by band (≥8 excellent, ≥6 fair, else poor).
 *
 * NaN falls through both comparisons to the lowest rung, which is the safe
 * default: an unknown score should recede, not read as excellent.
 */
export function getScoreColor(score: number): string {
  if (score >= 8) return "text-foreground";
  if (score >= 6) return "text-accent-warm-strong";
  return "text-muted-foreground";
}

/** Score BAR fill by band — the same ladder, as a background. */
export function getScoreBgColor(score: number): string {
  if (score >= 8) return "bg-foreground";
  if (score >= 6) return "bg-accent-warm";
  return "bg-muted-foreground";
}

/**
 * Score SURFACE (border + background) for a card that summarises a score.
 *
 * Exists because `components/manual-sourcing/ManualScorecardView.tsx` inlined
 * its own emerald → blue → amber ternary for exactly this — a third competing
 * ladder, in a third set of hues, on the /focus flagship. A consumer that needs
 * a score colour should reach for the system rather than re-derive one.
 */
export function getScoreSurface(score: number): string {
  if (score >= 8) return "border-foreground/25 bg-accent-warm/5";
  if (score >= 6) return "border-border bg-muted/40";
  return "border-border bg-transparent";
}
