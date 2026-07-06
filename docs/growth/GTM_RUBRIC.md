# GTM Quality Rubric — AptDesignerAI

The standard the **independent GTM Auditor** grades the GTM Factory's work against every
cycle. The Auditor is a SEPARATE routine from the GTM Factory (maker ≠ checker): the GTM
Factory does the revenue/go-to-market work and writes `docs/growth/GROWTH_STATUS.md` +
`docs/BUSINESS_CASE.md`; the Auditor never does GTM work — it grades, writes
`docs/growth/GTM_SCORECARD.md`, and files gaps as issues for the Factory to fix. This rubric
is the symmetric twin of the product-side quality rubric.

## Grade scale (per dimension)
- **A+** — exemplary: all signals green, zero findings.
- **A** — ship-bar: world-class, only trivial nits.
- **B** — solid, but with a real, named gap.
- **C** — notable gaps; below the ship bar.
- **D** — significant problems.
- **F** — broken or dishonest. A fabricated/flattered metric, a gamed business case, a
  summary that doesn't reconcile to its body, dishonest floor math, or a speculative/
  low-confidence roadmap steer that reached ROADMAP/VISION is an automatic **F** for the
  dimension it lands in.

## Dimensions (★ = ship-critical — the honesty/integrity ones)

- **★ METRIC INTEGRITY.** Every metric in `GROWTH_STATUS` is REAL and sourced from a
  connected source, verifiable, and honest. No fabricated, flattered, or unsourced numbers.
  A metric no connected source reported is `0`/`null`, never invented. *A single fabricated
  or unsourced metric caps this at F.*
- **★ BUSINESS-CASE HONESTY.** `docs/BUSINESS_CASE.md` reconciles to the real billing config
  + sourced inputs; the machine-readable `BUSINESS_CASE_SUMMARY` YAML matches the prose body;
  no number (or timing claim) is inflated/gamed to clear the `floor_usd`; floor math and the
  time-to-floor claim are honest. *A gamed number, a summary that doesn't reconcile, or
  dishonest floor/timing math is an automatic F.*
- **EXPERIMENT VALIDITY.** Falsifiable hypotheses, sufficient N / a stated significance, no
  p-hacking or selecting on noise, correlation ≠ causation respected; "insufficient data"
  used honestly. Pre-launch (no funnel) an empty `experiments` block with honest zeros is
  correct.
- **★ ROADMAP-STEER JUSTIFICATION.** Every ROADMAP/BUSINESS_CASE/VISION steer the GTM Factory
  opened is backed by REAL data + significance + a CAUSAL revenue mechanism (GTM_STANDARD §3).
  No speculative or low-confidence steer reached the roadmap; a VISION steer cleared the higher
  adversarial-panel bar. *A speculative or low-confidence steer that reached ROADMAP/VISION is
  an automatic F.* (No steer, when none is warranted, is the correct/exemplary outcome — not a
  penalty.)
- **★ SELF-VALIDATION HONESTY.** The `GROWTH_STATUS` validation/sources block is accurate —
  declared sources match reality, no channel claimed as connected that isn't, every
  unverifiable source marked `unavailable` and surfaced as a `gtm-connect-*` owner action.
  Fail-closed (GTM_STANDARD §4). A self-report claiming a verification result the artifacts
  contradict is a self-validation failure.
- **PMF READ ACCURACY.** The `pmf` block reflects real cohort data, not flattery; pre-PMF the
  recommendation is product/retention, not scaling acquisition; phase is correctly gated;
  demand-signal (a leading indicator) is never conflated with PMF.
- **COMPLIANCE.** Outreach + public claims are TRUE, FTC/CAN-SPAM/GDPR-clean, ToS-respecting;
  no fake accounts/engagement/reviews; outreach is draft-only (never auto-sent); outbound is
  hard-off below the readiness bar.
- **ARTIFACT FRESHNESS.** GTM assets (positioning, pricing, copy, ASO, store listing) are
  consistent with the CURRENT product — no advertised tier/feature that cannot actually be
  transacted or delivered, no stale price/domain/claim.

## Hard rules
- Graded by an INDEPENDENT party — never the GTM maker.
- A grade may NOT exceed the evidence; every grade cites concrete evidence (file/line/commit).
- Below A ⇒ name the SPECIFIC actionable gap.
- **Ship gate** = A/A+ on every ★ ship-critical dimension AND ≥ B everywhere else.
- A null/ungraded dimension is NOT a pass.
- A fabricated/gamed GTM claim the Auditor lets pass is the Auditor's failure too — default
  skeptical; when the evidence is thin, grade LOWER and say why.
