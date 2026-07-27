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

---

## Run 3 — 2026-07-20

**Overall: A · ship_gate_met: TRUE** (was B / false at Run 2 — the ship gate is MET for the first time)

Graded GROWTH_STATUS (as_of 2026-07-19, Growth Agent Run 12) + BUSINESS_CASE (summary as_of
2026-07-13, body notes through 2026-07-15) with four fresh, independent, adversarial per-dimension
graders (each told to REFUTE the Factory's claims and re-derive the math), cross-checked against my
own direct git/file/PENDING_OPS verification. Read GTM_AUDIT_MEMORY first and diffed against Run 2.

### Grades
| Dimension | Run 1 | Run 2 | Run 3 | Ship-critical | Δ vs Run 2 |
|---|---|---|---|---|---|
| Metric integrity | A | A+ | A+ | ★ | = |
| Business-case honesty | **F** | **B** | **A** | ★ | ↑ (B→A, gate-opening) |
| Experiment validity | A | A | A | | = |
| Roadmap-steer justification | A+ | A+ | A+ | ★ | = |
| Self-validation honesty | A | A | **A+** | ★ | ↑ |
| PMF read accuracy | A+ | A+ | A+ | | = |
| Compliance | A | A | **A+** | | ↑ |
| Artifact freshness | B | A | **A+** | | ↑ |

### What changed since Run 2 (the one gate-blocking gap is fixed; three cheap raises landed)
1. **Business-case honesty B → A (opens the ship gate).** Run 2's sole open gap — the planning case
   modeling ~38% of MRR on the non-transactable Pro Annual tier as if live (issue #600) — is
   GENUINELY FIXED. docs/BUSINESS_CASE.md now carries an explicit "Annual billing is currently GATED
   OFF, not live" disclosure at the Pro Annual section (:101-107) AND at the without-$100K section
   (:406), both citing PENDING_OPS.md apply-migration-021 (confirmed status:open — the claim is true).
   The without-annual figure is tightened to the correct $99,926 ($74 below the floor). Independently
   re-derived via node: Scenario A $46,109 / B $122,956 / C $276,652 / without-annual $99,926 exactly;
   year-1 exit ~$58.6K; summary YAML reconciles to the body on every field; anti-gaming holds (Apple
   15% SBP excluded, year-1 timing honestly false/~year-3). Figures now mechanically reproducible
   (analysis/*.mjs + figures.json, #631). Issue #600 closed as resolved.
2. **Self-validation A → A+.** Run-2 stripe_reporting nit closed — now its own next_action (:246) with
   honest reasoning for why it is NOT an owner_blocker (a Product-Factory build gap). Every named
   self-report spot-checked against the actual files and ALL hold (GTM_SCORECARD unchanged claim,
   annual-disclosure-fixed claim, "Run 98 store-listing edit didn't reintroduce Pro Annual" via
   git show 88a7e6f, all PENDING_OPS status:open claims). Zero findings.
3. **Compliance A → A+.** Run-2 CAN-SPAM footer nit fixed fail-closed: lib/email/templates/lifecycle.ts
   renders EMAIL_PHYSICAL_ADDRESS (footer :60 + plaintext :89-91, never invented); lib/email/index.ts
   force-dry-runs every marketing stage (requiresPhysicalAddress, :69-71,:92-98) until the address is
   set — a non-compliant marketing email cannot leave the system even after RESEND_API_KEY lands.
4. **Artifact freshness A → A+.** Annual tier cleanly quarantined in store-listing.md/press-kit.md
   (every $399 mention inside the dated omission note; advertised pricing only $29 + $49/mo); domain
   uniformly aptdesignerai.com in customer-facing assets.

### Ship gate
MET. Every ship-critical dimension is A/A+ (metric A+, business-case A, roadmap A+, self-validation
A+) and every non-critical dimension is A/A+. Overall held at A (not A+) because business-case
honesty and experiment validity carry real-but-trivial nits below exemplary.

### Two things NOT wrong (verified, do not re-litigate unless they change)
- No GTM steer ever reached ROADMAP.md/VISION.md (git-confirmed); BUSINESS_CASE edits are honesty
  recomputes that made the case MORE conservative. Demand signal held recommend-only, "not actioned".
- Metric integrity pristine: all funnel/pmf/acquisition/email/content/outreach 0/null; the new
  Interium App Store citation is correctly attributed + verbatim-fenced (an evidence improvement).

### Notes for next run
- Watch for SILENT REGRESSION now that the gate is met: re-derive the year-1 exit run-rate and the
  without-annual $99,926 each run; confirm floor_met_year1 stays false and the gated-off disclosure
  stays present. The gate being met is not a reason to grade on trust — re-verify the math cold.
- Remaining paths to overall A+ are purely cosmetic: (a) business-case — tighten :406 "AT the floor"
  to "$74 BELOW the floor" (the doc already says "$74 below" at :32-34, so this is a wording fix);
  (b) experiment validity — pair each confirmation-seeking demand-signal query with a disconfirming
  one (Run-12's "waste of money" angle selects for competitor-negative signal). Neither blocks the gate.
- Bump summary as_of on BUSINESS_CASE the next time the body changes (currently 2026-07-13 vs a
  2026-07-15 no-number-change note — benign, but keep an eye on it).
- The real launch constraint is owner env-connect blockers (site gate / Resend / metrics token /
  migrations), not GTM quality — those are owner actions the GTM Factory correctly cannot resolve.

---

## Run 4 — 2026-07-27

**Overall: C · ship_gate_met: FALSE** (was A / TRUE at Run 3 — but see the framing below, this is
mostly an AUDIT CORRECTION, not a Factory regression)

Graded GROWTH_STATUS (as_of 2026-07-25, Growth Agent Run 14) + BUSINESS_CASE (summary as_of
2026-07-13, unchanged since commit a680327) with six fresh, independent, adversarial per-dimension
graders, then re-verified every load-bearing finding myself before accepting it.

### Grades
| Dimension | R1 | R2 | R3 | R4 | Ship-critical | Δ vs R3 |
|---|---|---|---|---|---|---|
| Metric integrity | A | A+ | A+ | **A** | ★ | ↓ |
| Business-case honesty | F | B | A | **B** | ★ | ↓ (gate-closing) |
| Experiment validity | A | A | A | **C** | | ↓↓ |
| Roadmap-steer justification | A+ | A+ | A+ | **A** | ★ | ↓ |
| Self-validation honesty | A | A | A+ | **C** | ★ | ↓↓ (gate-closing) |
| PMF read accuracy | A+ | A+ | A+ | **B** | | ↓ |
| Compliance | A | A | A+ | **B** | | ↓ |
| Artifact freshness | B | A | A+ | **C** | | ↓↓ |

### THE HONEST FRAMING — I over-graded at Run 3
Most of this drop is me correcting my own prior over-grade on **unchanged artifacts**:
- `docs/BUSINESS_CASE.md` is byte-identical to when Run 3 graded it **A** (last commit a680327,
  2026-07-16, which predates Run 3). It grades **B** now on defects that were present and missed.
- The self-validation MRR overstatement has been in the file since **Run 9** and was missed by TWO
  prior audits (Runs 2 and 3).
- Run 3 asserted **"Zero findings"** on roadmap-steer, self-validation, PMF, compliance and
  freshness. Five of those carry verified findings today. That assertion was too generous.
- Genuinely NEW since 2026-07-20: only the OG-image and analytics-event freshness drifts.
- The Factory's Runs 13–14 were clean — doc-only diffs, no steer, confidence honestly held at
  `emerging` under five rounds of new evidence. **Do not report this as a Factory decline.**

### The findings that matter (filed as issues)
1. **Self-validation C (★).** (a) `GROWTH_STATUS:38` claims `internal_metrics_api` surfaces
   "MRR/active-subscriber/churn" — `lib/growth/metrics.ts` has **no MRR field** (grep for `mrr`
   across `lib/growth/` + `app/api/internal/` = zero hits) and only an APPROXIMATE `cancelled_30d`
   count, not a churn rate. The false clause is load-bearing: it justifies keeping `stripe_reporting`
   out of `owner_blockers`. (b) **Vercel Analytics** is live (`package.json:31`,
   `app/layout.tsx:63`), named in `CONNECT.md:87`, backs `visitors_7d`/`organic_sessions_7d` — and is
   declared **nowhere** in a validation block claiming to cover "every external source." Both err
   self-servingly (they under-report the connect burden).
2. **Business-case B (★).** Two sensitivity figures don't reproduce and sit outside the 4-figure
   computation gate — churn 7→12% is **$93,556** (doc "~$85K"); annual churn →40% is **$103,214**
   (doc "~$106K", flattering direction). `:118`'s "84% (7%/mo × 12)" is a rate/probability
   conflation — true 12-month churn is **1−0.93¹² = 58.1%**, so the annual tier's "−59pp" edge is
   really ~−33pp, overstating exactly the lever that lifts ARR from $99,926 to $122,956.
3. **Compliance B.** `waitlist_welcome_1` is classified MARKETING by `lib/email/index.ts:70-73` but
   `templates/waitlist-welcome.ts` renders **no unsubscribe link and no physical address** (greps
   clean for `href`). The gate keys on the ENV VAR, not the email — so setting
   `EMAIL_PHYSICAL_ADDRESS` makes a non-compliant email send LIVE. **This directly refutes Run 3's
   "a non-compliant marketing email cannot leave the system."**
4. **Freshness C.** `EARLY30`: the live `app/waitlist/page.tsx:33` promises "30% off … No promo code
   required" with **no coupon in code**; PENDING_OPS itself calls it "a broken public promise," while
   four GTM assets publicize a contradictory code. Plus `docs/analytics.md` missing 3 of 10 shipped
   funnel events, a shipped OG image still marked "Owner to create", and two email docs describing a
   pre-engine product against `engine_pct: 100`.
5. **Experiment validity C.** Run 14's Decorist "0 complaints" *disconfirming* datum is **void** —
   Decorist shut down Sept 2022 (Business of Home), so zero complaints is a dead-company artifact,
   and its shutdown is actually **confirming** for theme 3 (a second concierge collapse beside Modsy).
   Run 3's named sampling-frame fix was never implemented or acknowledged.

### What genuinely survived refutation (do NOT re-litigate)
- **No fabricated metric anywhere.** Twelve external citations independently re-fetched and
  verbatim-accurate; every funnel/pmf/outreach value honestly 0/null; `engine_pct: 100` is
  mechanically recomputed by `preflight.sh:444-458`, not a self-claim.
- **No steer ever reached ROADMAP/VISION** — full guarded-file history reconstructed via the GitHub
  API (69 ROADMAP + 5 VISION + 9 BUSINESS_CASE commits); zero GTM-authored steers.
- **ARR core reproducible to the dollar** (A $46,109 / B $122,956 / C $276,652 / without-annual
  $99,926), independent hand-reimplementation matched, nothing gamed to clear the floor,
  `floor_met_year1:false` and the ~year-3 timing honest.
- **Outbound provably hard-off** — nothing sent or posted; social publishing is unbuilt, not merely
  unconfigured. Pro Annual quarantine and $29/$49 pricing consistency intact.
- The Factory correctly reports the PRODUCT gate blocking **itself** (`QUALITY_SCORECARD`
  ship_gate_met false) and states its own GTM grade does not unlock outreach.

### METHODOLOGICAL NOTE FOR FUTURE RUNS (important)
**This repo is a SHALLOW clone** (`.git/shallow` present, grafted at `a680327` / 2026-07-16). Local
`git log --all` covers only ~11 days and will SILENTLY miss older commits — the roadmap-steer sweep
must reconstruct guarded-file history via the GitHub API, or it will produce a false "no steer ever"
on incomplete evidence. My Run 3 git verification may have been limited by this without my noticing.

### Notes for next run
- Re-check the two ship-critical gaps first: is `:38` corrected (MRR/churn claim honest) and is
  `vercel_analytics` declared in the validation block? Is the stripe_reporting owner_blocker
  exclusion still justified once the overstatement is removed?
- Re-derive the two failing sensitivity bullets and confirm `84%` → `58.1%`; re-run all four ARR
  scripts cold each run regardless of whether the doc changed — an unchanged doc is NOT a reason to
  carry forward a grade (that error is what produced Run 3's inflated A).
- Verify the CAN-SPAM fix guards the RENDERED email, not the env var, and that a test ratchets it.
- Do not let the gate-met status of a prior run anchor the next grade. Grade the artifact, not the
  history.
