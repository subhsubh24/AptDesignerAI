/**
 * Touch-target sizing for text-only controls.
 *
 * Its own module rather than part of `theme.ts` because `theme.ts` imports
 * `global.css` for the web build, which makes it unloadable from the Node test
 * runner — and this arithmetic is exactly the part that needs testing.
 */

/**
 * Minimum touch-target edge, in points. Apple's HIG asks for 44pt, Android's
 * Material guidance for 48dp; one app ships to both stores, so the larger wins.
 * Both are guidelines rather than automated submission gates — WCAG 2.5.8 (AA)
 * only requires 24×24 — so this is a design-bar standard, not a blocker.
 */
export const MinTapTarget = 48;

/**
 * Line-box heights from `components/themed-text.tsx`, and the `Spacing` steps
 * from `theme.ts`. Mirrored here because neither a StyleSheet nor a
 * css-importing module is readable from the test runner;
 * `__tests__/mobile/tap-targets.test.ts` parses both sources and asserts these
 * still match, so a change there fails rather than silently invalidating the
 * maths below.
 */
export const TextLineHeight = { small: 20, default: 24 } as const;
export const SpacingStep = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** `hitSlop` that grows `contentHeight` to MinTapTarget on both edges. */
export function tapSlopFor(contentHeight: number): number {
  return Math.max(0, Math.ceil((MinTapTarget - contentHeight) / 2));
}

/**
 * Slop for text-only controls, by shape — one entry per pattern the app
 * actually renders, each with at least one call site. These are quiet inline
 * links and secondary actions whose VISUAL size is deliberately small, so the
 * target is grown with hitSlop, which extends only the touch region, rather
 * than with padding.
 *
 * The values had been picked by eye, one control at a time, and the small-text
 * cases landed short: the four `type="small"` links (auth "Create one" /
 * "Sign in", the settings and home back-links) carried `hitSlop={8}` over a
 * bare 20pt line box — a 36pt target, under Apple's 44 as well as Android's 48.
 */
export const TapSlop = {
  /** Bare `type="small"` label — 20pt. */
  smallLabel: tapSlopFor(TextLineHeight.small),
  /** `type="small"` label with `paddingVertical: 4` — 28pt. */
  smallLabelPadded: tapSlopFor(TextLineHeight.small + 2 * SpacingStep.one),
  /** Default-size label with `paddingVertical: Spacing.two` — 40pt. */
  defaultLabelPadded: tapSlopFor(TextLineHeight.default + 2 * SpacingStep.two),
  /**
   * A row whose height comes from a 24pt icon box beside the label rather than
   * from the label itself — the accordion header on the tips screen, which had
   * no padding and no hitSlop at all, the smallest target in the app.
   */
  iconRow: tapSlopFor(SpacingStep.four),
} as const;
