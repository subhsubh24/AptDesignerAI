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

---

## Run 2 — 2026-07-13

**Overall: B · ship_gate_met: false** (was C / false at Run 1 — a real improvement: the outright F is gone)

Graded GROWTH_STATUS (as_of 2026-07-11) + BUSINESS_CASE (as_of 2026-07-08) with four fresh,
independent, adversarial per-dimension graders on the four ship-critical dimensions (each told to
REFUTE the Factory's claims and re-derive the math), plus evidence-backed grading of the four
non-critical dimensions. Read GTM_AUDIT_MEMORY first and diffed against Run 1.

### Grades
| Dimension | Run 1 | Run 2 | Ship-critical | Δ |
|---|---|---|---|---|
| Metric integrity | A | **A+** | ★ | ↑ |
| Business-case honesty | **F** | **B** | ★ | ↑↑ (F→B) |
| Experiment validity | A | A | | = |
| Roadmap-steer justification | A+ | A+ | ★ | = |
| Self-validation honesty | A | A | ★ | = |
| PMF read accuracy | A+ | A+ | | = |
| Compliance | A | A | | = |
| Artifact freshness | B | **A** | | ↑ (fixed) |

### What changed since Run 1 (both top gaps genuinely fixed)
1. **Business-case honesty F → B.** Run 1's F (summary `floor_met_year1:true` overstating a
   steady-state ARR as a year-1 result) is GENUINELY FIXED — re-derived independently: summary now
   `floor_met_year1:false` with an honest `time_to_floor` (steady-state $122.9K; year-1 exit
   ~$58–60K; floor ~year 3), body relabels $122.9K steady-state throughout (BUSINESS_CASE.md:242-247,
   :263-266, :381-386), now agrees with Scenario A's "2–3 years." Math verified: year-1 exit
   ~$58.6K, 0%-annual steady-state ~$99.9K, summary reconciles to body. Issue #486 closed.
   **New B-level gap** (why not A): the planning case models ~37.9% of total MRR on the Pro Annual
   tier while annual is currently NON-transactable (migration 021 unapplied, ANNUAL_BILLING_ENABLED
   off, gated by #597); line 67 + the annual-economics section imply the tier is live with no
   "gated off pre-launch" disclosure. NOT F — the floor is disclosed to clear without annual
   (~$99.9K, :366), so no number is gamed. Filed as the one open top gap.
2. **Artifact freshness B → A.** store-listing.md:84-92 + press-kit.md:162-165 now carry dated
   Pro-Annual-omitted notes; pricing advertises only $29/$49; PR #597 additionally gated annual
   checkout product-side (was a charge-then-fail-webhook risk). The false "Pro Annual omitted /
   grep clean" learnings are corrected. Issue #487 closed as completed.
3. **Metric integrity A → A+** (all metrics 0/null, demand-signal citations correctly walled off,
   confidence honestly held at emerging) and **self-validation** added the `web_research:degraded`
   structured entry (Run 1's A→A+ nit) — held at A only on a trivial stripe_reporting-surfacing nit.
   The Run-1 false-self-report pattern is genuinely resolved: every "I verified X" learning
   spot-checked against the real files this run and ALL held.

### Ship gate
Fails on ONE ship-critical dimension: business-case honesty = B (annual-tier disclosure gap).
Every other ship-critical dim is A/A+ and all non-critical dims are A. Closing that single
disclosure gap → business_case_honesty A → ship gate met.

### Notes for next run
- Re-check whether the business case discloses that Pro Annual is gated off pre-launch (migration
  021 + ANNUAL_BILLING_ENABLED) and tightens the 0%-annual line to ~$99.9K (at, not over, the
  floor). If fixed, business-case honesty → A and the ship gate is met.
- Watch that the year-1-timing honesty does NOT silently regress (floor_met_year1 back to true, or
  $122.9K re-presented as year-1). Re-derive the year-1 exit run-rate each run.
- Cheap raises still on the table: surface stripe_reporting as its own owner action (self-validation
  A→A+); render a full CAN-SPAM footer in staged email templates (compliance A→A+).
