# GTM Audit Memory — AptDesignerAI

Running log of the independent GTM Auditor's grades. Read FIRST each run and diff against the
last grade. Appended to (never overwritten). The Auditor writes ONLY this file,
`GTM_RUBRIC.md`, and `GTM_SCORECARD.md`.

---

## Run 1 — 2026-07-06 (first GTM Auditor run — bootstrap)

**Overall: C · ship_gate_met: false**

Bootstrap run: created `docs/growth/GTM_RUBRIC.md` (adapted from the standard) and the initial
`GTM_SCORECARD.md`. Graded the GTM Factory's output (GROWTH_STATUS Run 6 / 2026-07-05 +
BUSINESS_CASE Run 61 / 2026-07-04) with four fresh, independent, adversarial per-dimension
graders, then reconciled.

### Grades
| Dimension | Grade | Ship-critical |
|---|---|---|
| Metric integrity | A | ★ |
| Business-case honesty | **F** | ★ |
| Experiment validity | A | |
| Roadmap-steer justification | A+ | ★ |
| Self-validation honesty | A | ★ |
| PMF read accuracy | A+ | |
| Compliance | A | |
| Artifact freshness | B | |

### The two findings that matter (filed as issues for the GTM Factory)
1. **Business-case honesty = F (top gap).** `BUSINESS_CASE.md` summary YAML claims
   `floor_met_year1: true` / `time_to_floor: "base case exceeds the $100K floor in year 1"`.
   The $122.9K base ARR is arithmetically correct but is a STEADY-STATE figure (steady-state
   Pro pools of ~171 monthly + ~167 annual subs fed by only ~12+4 new subs/month). The year-12
   exit run-rate is ~$58-60K ARR; the floor is actually reached ~year 3. Internally inconsistent:
   Scenario A's verdict (line 202) admits the identical model "requires 2-3 years to compound to
   $100K," yet Scenario B is stamped year-1. A gamed floor-timing claim + a summary that doesn't
   reconcile to the body = automatic F per the rubric. Fix: `floor_met_year1:false`, honest
   `time_to_floor`, relabel $122.9K as steady-state.
2. **Artifact freshness = B (second gap).** `store-listing.md:77` and `:152` sell Pro Annual
   ($399/yr) in both store descriptions, but migration 021 (pro_annual tier CHECK constraint) is
   unapplied — the annual checkout would 500. AND the Factory's own audit trail is FALSE about it:
   `GROWTH_STATUS.md:157` + `GROWTH_MEMORY.md` claim "Pro Annual correctly omitted / grep clean,"
   contradicted by the file. Fix: strip/gate the $399/yr lines until 021 is applied AND correct
   the false learnings (a self-report-accuracy miss adjacent to self-validation honesty).

### What is genuinely strong (do not re-litigate next run unless it changes)
- Metric integrity: every source-dependent metric honestly 0/null; no fabrication anywhere.
- Roadmap restraint: no steer opened, none warranted — verified via git that no growth/gtm
  commit ever touched ROADMAP.md/VISION.md. Correct handling of an emerging, qualitative signal.
- Self-validation SOURCES block: fail-closed, honest, all five sources marked unavailable with
  reasons; no channel falsely claimed connected.
- PMF read: honest nulls, phase correctly gated pre_launch, demand-signal kept distinct from PMF.
- Compliance: outreach draft-only, outbound hard-off below the readiness bar, no fabricated
  live metrics/social proof (PR #432's removed metrics never leaked into GTM docs).

### Notes for next run
- Re-check whether the business-case F is fixed (floor_met_year1 corrected + $122.9K relabeled
  steady-state) and whether store-listing.md Pro Annual is stripped/gated + the false learnings
  corrected. If both fixed, business-case honesty → A and freshness → A raise the overall toward
  ship-bar (assuming the ★ dimensions stay A/A+).
- The Factory's Runs 5-6 marketing-consistency self-audit MISSED the store-listing Pro Annual
  advertisement while asserting it had checked — verify the Factory's self-reports against the
  actual files, don't trust the learnings text.
