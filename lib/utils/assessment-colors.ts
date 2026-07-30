/**
 * The room-assessment colour system — the priority pill, the Keep / Replace
 * panels, and the validation-confidence banner.
 *
 * Deliberately a ONE-HUE EMPHASIS LADDER, not a traffic light. This is the same
 * decision already made for the price tiers (`lib/utils/tier-colors.ts`) and the
 * scoring surfaces (`lib/scoring/verdicts.ts`); this module carries it across the
 * assessment surfaces.
 *
 * What it replaced, and why that mattered:
 *
 *   priority pill      rose / amber / slate      duplicated VERBATIM in
 *                                                app/saved/[id]/page.tsx and
 *                                                app/shared/[token]/SharedDesignView.tsx
 *   Keep / Replace     emerald + amber (focus)   the SAME two lists rendered in
 *                      emerald + rose  (saved)   three different palettes on
 *                      emerald + rose  (shared)  three different routes
 *   confidence banner  emerald / amber           duplicated twice in focus
 *
 * So the public share page alone carried five unrelated Tailwind accent
 * families (emerald, rose, amber, slate, plus the house warm accent) — squarely
 * what VISION.md's design bar names as slop ("three competing accent colors"),
 * and none of them from the warm-editorial token system. Worse, the same
 * `what_should_go` list was amber on /focus and rose on /saved, so a user who
 * saved a design watched its colour change for no reason.
 *
 * That list of three routes was INCOMPLETE, and this docstring used to claim the
 * job was finished. It was not: /diagnosis — the step where the user FIRST meets
 * this content — rendered the same two lists as a FOURTH palette (emerald cards
 * for `what_is_working`, amber for `what_is_not_working`, with matching icon
 * chips and bullet markers), so the very list a user saw in emerald on
 * /diagnosis turned amber on /focus and rose on /saved. /diagnosis and the scene
 * coverage card it renders are now consumers too, which is what closes the loop
 * this module was opened for.
 *
 * Nothing is lost by dropping the hue. Every one of these surfaces renders the
 * meaning in words or in a lucide icon right beside the colour — the priority
 * pill prints "high", the panels are headed "Keep" and "Replace or remove" with
 * CheckCircle2 / XCircle, the banner prints "Confidence: 6/10" next to a
 * ShieldCheck or AlertTriangle. The colour was decoration that happened to be
 * off-system, never the sole carrier.
 *
 * Every value is a design-system token, so light/dark parity is automatic
 * (no hand-paired `dark:` palette weights to keep in sync) and a token edit
 * moves this palette with the rest of the product.
 *
 * `text-accent-warm-strong` rather than `text-accent-warm` for accent TEXT, for
 * exactly the reason globals.css defines that token: the plain accent sits
 * closer to the AA floor on a tinted surface.
 *
 * Contrast is NOT asserted in prose here. It is COMPUTED from the real
 * globals.css token values, against the surfaces these palettes actually render
 * on, in `__tests__/design/assessment-colors.test.ts`.
 */

export type AssessmentPriority = "high" | "medium" | "low";

/** Sort order for the "what it needs" list: high first, unknown last. */
export const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Priority pill: three rungs of one emphasis ladder, mirroring the four-rung
 * verdict chip in `lib/scoring/verdicts.ts`.
 *
 *   high   → solid ink pill   the heaviest mark in the list; act on this first
 *   medium → accent tint      the house accent marks the middle rung
 *   low    → muted fill       present but quiet
 *
 * The ladder runs in the same direction as every other one in the product, so
 * a user who has learned it on the verdict chip already reads this correctly.
 */
export const PRIORITY_BADGE: Record<AssessmentPriority, string> = {
  high: "border-transparent bg-foreground text-background",
  // An OPAQUE accent fill rather than a tint, and the reason is worth keeping.
  //
  // A tinted accent pill is a contrast trap here. In dark mode
  // --accent-warm-strong and --accent-warm are the same value, so tinting the
  // fill with the same hue as the text eats the contrast: at /15 this measured
  // 4.28:1 on a dark card, under the AA floor. Dropping to /10 cleared it at
  // 4.61:1 — but only when composited directly onto the card. This pill also
  // renders inside a `bg-muted/50` row wrapper in app/saved/[id]/page.tsx, and
  // that DOUBLE composite lands at 4.49:1 — under the floor again, and the kind
  // of surface a flat "tint over card" model never asks about.
  //
  // Going opaque removes the whole class of problem instead of tuning around
  // it: an opaque fill is independent of whatever it is nested inside, so no
  // future wrapper can quietly push it under the floor. It measures 4.86:1
  // (light) and 5.62:1 (dark). It also makes all three rungs opaque, which is
  // what lets the ladder read as weight — solid ink, solid accent, muted fill.
  medium: "border-transparent bg-accent-warm text-background",
  low: "border-transparent bg-muted text-muted-foreground",
};

/** Pill classes for a priority that may be absent or unrecognised. */
export function priorityBadge(priority: string | null | undefined): string {
  return PRIORITY_BADGE[priority as AssessmentPriority] ?? PRIORITY_BADGE.low;
}

/**
 * The Keep / Replace pair.
 *
 * These are not a ladder — they are two halves of one verdict — so the ordering
 * signal here is ACTION, not rank: "Replace or remove" is the list the user has
 * to do something about, so it takes the house accent, and "Keep" (which is
 * reassurance, and requires nothing) stays neutral ink on a muted surface.
 * Polarity itself is carried by the heading text and the CheckCircle2 / XCircle
 * icons, which is why neither side needs a hue of its own.
 *
 * `rail` exists for the /diagnosis presentation, which is the one consumer that
 * renders the pair as two side-by-side Cards rather than as bare headed lists.
 * It is part of the shared palette rather than local to that page for the same
 * reason everything else here is: the pair is the thing being styled, and the
 * next surface to render it as cards must not re-derive the mapping.
 *
 * There is deliberately NO tinted chip behind the heading icon. The /diagnosis
 * cards had one (`bg-emerald-100` / `bg-amber-100`), and the obvious token
 * translation — an `accent-warm/10` chip under an `accent-warm-strong` icon —
 * measured 4.49:1 in dark mode, UNDER the AA floor, for exactly the reason
 * PRIORITY_BADGE documents below: dark mode gives `--accent-warm-strong` and
 * `--accent-warm` the same value, so tinting the fill with the icon's own hue
 * eats the contrast. The guard caught it before it shipped. Rather than tune a
 * third opacity, the icon now sits bare on the card — which is also how the
 * other three consumers have always rendered this pair, so the presentations
 * converged instead of diverging again.
 */
export const ASSESSMENT_PANEL = {
  keep: {
    /** Panel wrapper, where the surface is drawn (saved / shared views). */
    surface: "bg-muted/40 border-border",
    /** Section heading + its icon. */
    heading: "text-foreground",
    /** The leading marker on each list item. */
    marker: "text-muted-foreground",
    /** 4px left rail on the card presentation (/diagnosis). */
    rail: "border-l-border",
  },
  replace: {
    surface: "bg-accent-warm/5 border-accent-warm/25",
    heading: "text-accent-warm-strong",
    marker: "text-accent-warm-strong",
    rail: "border-l-accent-warm",
  },
} as const;

/**
 * Validation-confidence banner.
 *
 * The threshold lives here rather than at the two call sites in
 * app/projects/[projectId]/rooms/[roomId]/focus/page.tsx, which previously
 * repeated `confidence >= 7` four times (twice for the surface, twice for the
 * icon) — a drift waiting to happen.
 *
 * High confidence is the expected case, so it RECEDES: a quiet muted surface
 * that does not compete with the results it is annotating. Low confidence is
 * the case the user should notice, so it takes the accent. Which of the two it
 * is stays legible without colour: the banner prints the number, and the icon
 * switches between ShieldCheck and AlertTriangle.
 */
export const CONFIDENCE_THRESHOLD = 7;

export function isHighConfidence(confidence: number): boolean {
  return confidence >= CONFIDENCE_THRESHOLD;
}

export const CONFIDENCE_BANNER = {
  high: {
    surface: "bg-muted/40 border-border text-foreground",
    icon: "text-muted-foreground",
  },
  low: {
    surface: "bg-accent-warm/5 border-accent-warm/30 text-foreground",
    icon: "text-accent-warm-strong",
  },
} as const;

export function confidenceBanner(confidence: number) {
  return isHighConfidence(confidence) ? CONFIDENCE_BANNER.high : CONFIDENCE_BANNER.low;
}
