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

---

## Run 5 — 2026-08-03

**Overall: B · ship_gate_met: FALSE** (was C / false at Run 4 — a genuine improvement, not a wash:
6 of Run 4's 8 named top_gaps confirmed fixed against real code)

Graded GROWTH_STATUS (as_of 2026-08-01, Growth Agent Run 18) + BUSINESS_CASE (unchanged since
commit bd795f9, 2026-07-28, after the Product Factory's take-rate correction) with six fresh,
independent, adversarial per-dimension graders, each explicitly tasked to re-verify Run 4's
specific claimed fixes against real code/scripts/citations rather than trust the Factory's
self-report. Read GTM_AUDIT_MEMORY first and diffed against Run 4.

### Grades
| Dimension | R1 | R2 | R3 | R4 | R5 | Ship-critical | Δ vs R4 |
|---|---|---|---|---|---|---|---|
| Metric integrity | A | A+ | A+ | A | **A** | ★ | = |
| Business-case honesty | F | B | A | B | **B** | ★ | = (different reason) |
| Experiment validity | A | A | A | C | **B** | | ↑ |
| Roadmap-steer justification | A+ | A+ | A+ | A | **A** | ★ | = |
| Self-validation honesty | A | A | A+ | C | **A** | ★ | ↑↑ (gate-relevant) |
| PMF read accuracy | A+ | A+ | A+ | B | **B** | | = |
| Compliance | A | A | A+ | B | **A** | | ↑ |
| Artifact freshness | B | A | A+ | C | **C** | | = (different findings) |

### What genuinely fixed (verified against code/scripts, not self-report)
1. **Self-validation honesty C → A (closes issue #717).** Both Run-4 findings hold up as fixed:
   the false "MRR/churn already surface via internal_metrics_api" claim is gone and replaced with
   an accurate description of what `lib/growth/metrics.ts` actually exposes (no `mrr` field,
   grep-confirmed); Vercel Analytics is now declared in the validation block with accurate
   citations. A full `package.json` audit found no other undeclared live dependency. One narrow
   new nit: a stale/non-existent commit hash (`0e0f901`) cited for QUALITY_SCORECARD.md's
   "last touch" — the described substance is still accurate, but the citation doesn't reproduce.
2. **Compliance B → A (closes issue #719).** The waitlist-welcome template now renders a real
   unsubscribe link + physical address; a real no-login unsubscribe endpoint + migration exist;
   a test now guards the rendered footer content (Run 4's "no test guards it" finding closed).
   Product Hunt upvote solicitation removed from press-kit.md. Two minor, honestly-disclosed
   residual gaps: the compliance gate still keys on the env var rather than rendered content
   (mitigated by the new test), and migration 031 is code-complete but not yet applied to prod.
3. **Business-case honesty: Run 4's TWO specific findings both genuinely fixed (closes issue
   #718), but a NEW, different disclosure gap replaced them, holding this at B.** The two
   sensitivity figures now reproduce exactly and are registered in `analysis/figures.json`; the
   84%→58.1% churn conflation is corrected and self-disclosed. But the 2026-07-28 take-rate
   correction (verified as a uniform 1.214286× multiplier, not a selective flattering adjustment)
   left the "shippable-today" ARR figures ($121,339/$136,762) without the same "steady-state, not
   year-1" caveat the $149.3K base case earned after Run 71. Independently re-derived: this
   scenario's year-1 exit run-rate is ~$73.5K — BELOW the floor — while the doc calls the
   steady-state figure "over the floor" for "today's transactable product" with no year-1 caveat.
   Not gamed; a real disclosure-rigor asymmetry. **New top_gap, tracked as a new issue.**
4. **Experiment validity C → B (updates issue #721, not yet closed).** The void Decorist "0
   complaints" datum is genuinely retracted and correctly re-filed as CONFIRMING evidence for
   theme 3. A real direct-competitor disconfirming data point (RoomGPT, 4.6/5 despite quoted
   failures) now exists — closing Run 4's "zero direct competitors in disconfirming" gap. Not yet
   A: disconfirming coverage remains theme-2-only; themes 1/3/4 still lack theme-specific
   counter-evidence despite a genuine, honest-negative search attempt (Run 17).
5. **Artifact freshness: EARLY30 (Run 4's most serious finding) fully and cleanly fixed (partial
   close on issue #720, kept open for remaining gaps).** The live waitlist copy and all four
   downstream GTM assets are now consistent — no more contradictory-code-vs-no-code-required
   split. OG image, app name, and /support page references also confirmed fixed. Held at C, not
   raised, because two lesser Run-4 findings are only half-fixed or have recurred: (a)
   email-welcome-sequence.md — the sibling file to the one Run 15 fixed — still has stale
   pre-engine language; (b) docs/analytics.md's missing-event gap has RECURRED with a new event
   (`mockup_limit_paywall_shown`, shipped 2026-07-30, after the original fix) — the identical
   failure mode, days later.

### What held at A, with the same trivial nit unaddressed across runs (worth flagging as a pattern)
- **Metric integrity A → A** (down from A+ at Runs 2-3, held since Run 4). New nit this run: 2 of
  5 RoomGPT App Store reviewers cited as "1-star" are actually 2-star per the live page's raw
  rating field — inflates cited severity, unflagged through 2 subsequent "re-verify" runs.
- **Roadmap-steer justification A → A** (held since Run 4). Zero GTM-authored steers reached
  ROADMAP/VISION, reconfirmed via full GitHub-API history reconstruction past the shallow local
  clone. The SAME Run-4 nit (a Havenly markup figure inconsistently labeled "directly-quoted" vs
  "WebSearch-synthesized-only" in two nearby fields of the same document) has now survived FOUR
  consecutive runs (15, 16, 17, 18) despite each claiming to re-verify prior work — a genuine
  process gap worth naming even though it never affected a steer.
- **PMF read accuracy B → B** (held since Run 4, gap unaddressed). No disclosure that the pmf
  block's 5 fields have zero data path in `lib/growth/metrics.ts` — the same "unbuilt, not merely
  unconnected" disclosure Run 15 correctly added for stripe_reporting/mrr was never extended to
  pmf, and no owner_blocker/next_action asks for activation/retention instrumentation.

### Ship gate
NOT MET, but closer than Run 4: only 2 dimensions miss the bar now (business_case_honesty B,
artifact_freshness C), down from 4 at Run 4. Every other ship-critical dimension is A/A+.

### Issue tracking this run
- Closed #717 (self_validation_honesty), #719 (compliance), #718 (business_case_honesty — Run 4's
  specific findings fixed) as completed.
- Updated #720 (artifact_freshness) and #721 (experiment_validity) to reflect partial fixes and
  the specific gaps that remain, keeping them open.
- Filed new issues for: the business_case_honesty shippable-today disclosure gap (ship-critical,
  the new top_gap), and pmf_read_accuracy's unbuilt-disclosure gap (never previously filed).

### Methodological note carried forward
This repo's local clone is SHALLOW (`.git/shallow` present) — confirmed again this run. The
roadmap-steer sweep used the GitHub API to reconstruct full history rather than trusting local
`git log`, per Run 4's standing methodological note. Continue this practice every run.

### Notes for next run
- Re-check whether the new business-case disclosure gap is fixed: does the shippable-today
  ARR figure ($121,339/$136,762) now carry a "steady-state, not year-1" caveat with the ~$73.5K
  year-1 read stated alongside, matching the treatment already given to the $149.3K base case?
- Re-check artifact_freshness: is email-welcome-sequence.md's stale pre-engine language fixed to
  match email-lifecycle.md? Is docs/analytics.md updated to include mockup_limit_paywall_shown
  (and any newer event that may have shipped since)? Consider whether a preflight check tying
  FunnelEvent's member count to docs/analytics.md's documented count would close this class of
  gap permanently rather than requiring a fresh catch each run.
- Re-check experiment_validity: has theme-specific disconfirming evidence been added for themes
  1, 3, or 4 (not just theme 2)? Confidence should stay at "emerging" unless a theme's source
  count genuinely crosses the counting_rule threshold.
- Two trivial-but-persistent nits worth a one-line fix each: the RoomGPT 1-star/2-star
  mischaracterization (metric_integrity) and the Havenly markup provenance-labeling contradiction
  (roadmap_steer_justification) — both have now survived multiple runs despite being cheap fixes.
- Do not let the gate-being-closer status anchor the next grade upward. Re-run every script and
  re-fetch every citation cold, exactly as this run did.

---

## Run 6 — 2026-08-10

**Overall: B · ship_gate_met: FALSE** (was B / false at Run 5 — same letter, but a real second
consecutive improvement run underneath it, not a plateau)

Graded GROWTH_STATUS (as_of 2026-08-09, Growth Agent Run 22) + BUSINESS_CASE (as_of 2026-07-29,
last substantive touch 2026-08-03 commit 2d079e67) with eight fresh, independent, adversarial
per-dimension graders — one per rubric dimension this time, up from six at Run 5 — each explicitly
tasked to re-verify Run 5's specific claimed fixes against real code/scripts/citations, not trust
the Factory's self-report. Read GTM_AUDIT_MEMORY first and diffed against Run 5.

### Grades
| Dimension | R1 | R2 | R3 | R4 | R5 | R6 | Ship-critical | Δ vs R5 |
|---|---|---|---|---|---|---|---|---|
| Metric integrity | A | A+ | A+ | A | A | **A** | ★ | = |
| Business-case honesty | F | B | A | B | B | **B** | ★ | = (different reason, again) |
| Experiment validity | A | A | A | C | B | **A** | | ↑ |
| Roadmap-steer justification | A+ | A+ | A+ | A | A | **A+** | ★ | ↑ |
| Self-validation honesty | A | A | A+ | C | A | **A** | ★ | = (resolved a real dispute) |
| PMF read accuracy | A+ | A+ | A+ | B | B | **A** | | ↑ |
| Compliance | A | A | A+ | B | A | **A** | | = |
| Artifact freshness | B | A | A+ | C | C | **B** | | ↑ |

### What genuinely fixed (verified against code/scripts/citations, not self-report)
1. **Experiment validity B → A.** The Havenly App Store disconfirming datum (theme 3) is genuinely
   theme-specific — independently WebFetched and matched 4.4/5 across 4,900 ratings plus the three
   quoted reviews exactly. Theme 4's `structurally_hard_to_corroborate` flag reflects genuinely
   diverse research (Runs 14/17/20/21/22), including a real methodological catch (correctly refusing
   to cite a WebSearch-synthesized AR stat misattributed to Wayfair). Two minor nits keep it at A,
   not A+: theme 1 still has zero theme-specific disconfirming datum, and the "sixth consecutive dead
   end" tally justifying the theme-4 flag is inflated by one (Run 19's own narrative shows no
   theme-4 attempt that run).
2. **PMF read accuracy B → A.** The `unbuilt_disclosure` added to the pmf block is not just present
   but independently confirmed TRUE — re-ran the grep (zero hits) and read the whole
   `lib/growth/metrics.ts`, plus swept the whole repo for the broader "anywhere in the codebase"
   claim. The one place the disclosure could have overstated (the referral-capture-vs-query
   distinction) was checked carefully and found precise, not sloppy.
3. **Roadmap-steer justification A → A+.** The 4-run-persistent Havenly $511-vs-$265 provenance
   contradiction is verified fixed at the character level in the current live file (not just
   reworded). Full GitHub-API history reconstruction (local clone re-confirmed shallow) found zero
   GTM-authored steers reached ROADMAP/VISION/BUSINESS_CASE since Run 5 — VISION.md had zero commits
   at all; ROADMAP.md's two commits are Product-Factory housekeeping; BUSINESS_CASE.md's one commit
   is a disclosure fix with no ARR change. All signals green — genuinely exemplary.
4. **Artifact freshness C → B.** Both Run-5-named findings (docs/analytics.md's 11th event,
   docs/email-welcome-sequence.md's stale webhook language) independently confirmed fixed against
   current code. Held at B, not raised to A: the identical narrow-fix-leaves-a-duplicate-stale
   PATTERN (already named at Run 4 and Run 5) recurred a THIRD time — docs/email-lifecycle.md's own
   top banner still contradicts its own corrected delivery-notes section further down — and no
   structural guard (a preflight check tying FunnelEvent's count to docs/analytics.md) was ever
   built, so the class of gap remains genuinely unprotected against recurring a fourth time.

### The one dimension that held its letter for a genuinely different, notable reason
5. **Self-validation honesty held A, but by RESOLVING a real dispute, not by default.** Run 5 itself
   claimed a citation ("commit 0e0f901") in the gtm_scorecard validation entry "does not reproduce."
   The Factory's Run 19 commit pushed back, claiming Run 5 was wrong. This run independently
   adjudicated the dispute from primary GitHub evidence rather than trusting either party:
   `mcp__github__get_commit` on 0e0f9017ec7e888f9c1a9a7e752fc3732e1293e0 confirms it genuinely
   exists, is dated 2026-07-27, and its file-stats list DOES include
   docs/quality/QUALITY_SCORECARD.md; 38a79b5's own file list does NOT include that path at all.
   **Run 5's finding was itself wrong; the Factory's rebuttal was correct.** This is exactly the
   self-validation behavior the rubric rewards (catching a false claim via primary-source
   re-checking) — recorded plainly here so a future run does not re-litigate it, and so the record
   is honest about the prior audit's own error, not just the Factory's.

### The gap that held business-case honesty at B (same letter, different substance, second time running)
6. **Business-case honesty: Run 5's SPECIFIC named finding is genuinely fixed, but a new instance of
   the identical disclosure-asymmetry pattern replaced it — the same story as Run 4 → Run 5.** All 10
   registered `analysis/business_case_*.mjs` scripts re-ran and reproduced exactly; both the
   Scenario-B and shippable-today figures now carry equivalent "steady-state, not year-1" caveats.
   But the "What would have to change to NOT reach $100K" sensitivity section still cites two downside
   figures (monthly-churn-12% $113,604, annual-churn-40% $125,331) as "clearing the floor" via the
   identical steady-state formula, with NO year-1 caveat — independently computed year-1 reads are
   $60,593 and $69,934, both below the floor. A secondary finding: the machine-readable `arr_year1`
   YAML key holds steady-state values, a misnomer against `floor_met_year1:false`.

### Ship gate
NOT MET, but the narrowest margin yet: only ONE dimension misses the bar now
(business_case_honesty B, ship-critical), down from two at Run 5 and four at Run 4. Every other
ship-critical dimension is A/A+, and artifact_freshness's B already clears the non-critical >=B bar.

### Issue tracking this run
- Updated #785 (business_case_honesty) with the new sensitivity-figures gap, replacing the fixed
  shippable-today finding — kept open (dimension still B).
- Updated #720 (artifact_freshness) with the docs/email-lifecycle.md banner finding and the missing
  structural guard, noting both Run-5 findings are fixed — kept open (dimension still B, recurring
  pattern).
- Closed #786 (pmf_read_accuracy) as genuinely fixed and independently re-verified.
- Closed #721 (experiment_validity) as genuinely fixed and independently re-verified, noting the two
  minor residual nits in the scorecard text rather than as a blocking issue (dimension is now A).

### Methodological note carried forward
This repo's local clone is SHALLOW (`.git/shallow` present) — reconfirmed again this run. The
roadmap-steer sweep used the GitHub API to reconstruct full history rather than local `git log`, per
the standing note since Run 4. Also newly established this run: when a prior audit's own finding is
disputed by the Factory's rebuttal, resolve it from primary evidence (direct commit/file-list lookups)
rather than defaulting to either party's word — this run's self_validation_honesty grade rests on
having done exactly that.

### Notes for next run
- Re-check whether the two sensitivity-figure caveats (monthly-churn-12%, annual-churn-40%) were
  added with the ~$60.6K/$69.9K year-1 reads, matching the treatment already given to Scenario B and
  the shippable-today figures. Also check whether `arr_year1`'s naming or the stale `as_of` was
  addressed.
- Re-check artifact_freshness: is docs/email-lifecycle.md's top banner fixed to match its own
  delivery-notes section? Was a preflight/validate-gtm check added tying FunnelEvent's count to
  docs/analytics.md? This is the THIRD occurrence of this pattern — if a fourth occurs, name the
  pattern itself (not just the instance) as the top_gap.
- Re-check experiment_validity: has theme 1 gained a theme-specific disconfirming datum? Was the
  theme-4 "consecutive dead end" tally corrected from six to five?
- Two trivial nits worth a one-line fix each: the vercel_analytics package.json line-number citation
  (self_validation_honesty) and the demand_signal `confidence`-vs-`overall_strength` field-naming
  drift against GTM_STANDARD S10 (cross-dimension, currently unfiled).
- Do not let the two-consecutive-improvement-run trend anchor the next grade upward. Re-run every
  script and re-fetch every citation cold, exactly as this run did.

---

## Run 7 — 2026-08-17

**Overall: B · ship_gate_met: FALSE** (was B / false at Run 6 — same letter, but the blocker MOVED,
not persisted: business_case_honesty is finally fixed after three straight runs; a different
ship-critical dimension took its place for an unrelated reason)

Graded GROWTH_STATUS (as_of 2026-08-15, Growth Agent Run 25) + BUSINESS_CASE (as_of 2026-08-15,
commit 32ea347c0) with eight fresh, independent, adversarial per-dimension graders, each explicitly
tasked to re-verify Run 6's specific claimed fixes against real code/scripts/citations, not trust
the Factory's self-report. Read GTM_AUDIT_MEMORY first and diffed against Run 6.

### Grades
| Dimension | R4 | R5 | R6 | R7 | Ship-critical | Δ vs R6 |
|---|---|---|---|---|---|---|
| Metric integrity | A | A | A | **A** | ★ | = |
| Business-case honesty | B | B | B | **A+** | ★ | ↑↑ (B→A+, gate-opening on this dim) |
| Experiment validity | C | B | A | **A** | | = |
| Roadmap-steer justification | A | A | A+ | **A+** | ★ | = |
| Self-validation honesty | C | A | A | **B** | ★ | ↓ (gate-closing, new reason) |
| PMF read accuracy | B | B | A | **B** | | ↓ (same root cause as above) |
| Compliance | B | A | A | **A** | | = |
| Artifact freshness | C | C | B | **A** | | ↑ |

### The business-case fix that finally broke the 3-run streak
1. **Business-case honesty B → A+.** Growth Agent Run 25 added the "steady-state, not year-1"
   caveat to both remaining sensitivity figures (monthly-churn-12%, annual-churn-40%), registered
   two new scripts, and annotated the `arr_year1` misnomer. Independently re-executed both new
   scripts cold: `$60,593` and `$69,934` reproduce exactly, via the same `computeYear1ExitRunRate()`
   helper already used elsewhere in the doc — no formula shortcut. Then, critically, swept the
   ENTIRE document fresh for a FOURTH instance of the disclosure-asymmetry pattern that has recurred
   at Run 4→5 and Run 5→6 — found none (the one candidate, Scenario C, already carries its own
   adjacent caveat). This is the first time this exact ship-critical gap has been closed clean in
   three tries. Only a trivial follow-up remains (Scenario C lacks a registered year-1 script,
   unlike every other scenario) — not enough to cap the grade below A+.

### The new gap that took its place (self_validation_honesty A → B, pmf_read_accuracy A → B)
2. **A genuinely new finding, corroborated independently by two graders with no shared context.**
   Product Factory PR #912 (Linear APT-38, "build activation_rate + rolling retention_d1/d7/d30",
   merged 2026-08-16 — one day after GROWTH_STATUS.md's own `as_of`) added real, wired Supabase
   queries to `lib/growth/metrics.ts`. A separate commit built `churn_rate_30d` as a real computed
   rate. Both the self_validation_honesty grader and the pmf_read_accuracy grader independently ran
   the doc's OWN prescribed verification grep and got a result — 15+ hits — that contradicts the
   doc's own `pmf.unbuilt_disclosure` text ("all 5 fields above are UNBUILT... exist[s] nowhere in
   the codebase") and the `stripe_reporting` validation entry's parallel churn-rate claim. This is
   the textbook self-validation failure mode: a self-report the artifacts now contradict. Important
   framing: this is NOT a GTM Factory failure in the usual sense — the doc was accurate when written;
   the Product Factory shipped the fix to the underlying gap the very next day, and no GTM run has
   touched the doc since to catch up. Not a fabrication either — the funnel/pmf numbers stay
   honestly null (no cohort exists yet pre-launch), so the direction of the error understates
   capability rather than flattering it. But it is live and false today, which is what the rubric
   grades. This is now the SOLE reason the ship gate stays closed.

### What else moved
3. **Artifact freshness B → A.** Growth Agent Run 25's claimed fix to `docs/email-lifecycle.md`'s
   top banner (previously contradicting its own "Delivery notes for owner" section) is confirmed —
   and, critically, a full adversarial sweep of every OTHER GTM doc in the repo found no fourth
   instance of the 3-run-recurring "fix one spot, miss a duplicate" pattern. The one thing NOT fixed:
   Run 6's recommended structural guard (a preflight/validate-gtm check tying FunnelEvent's count to
   docs/analytics.md) was never built — the current match holds by luck, not enforcement, which is
   why this is A and not A+.
4. **Experiment validity held A.** The Wayfair theme-1 disconfirming citation is genuine and
   WebFetch-verified (4.9/5 across ~2.5M ratings, Jami303 quote verbatim). The OTHER Run 6 nit (the
   theme-4 "sixth consecutive dead end" tally, inflated by one per Run 19's own method_note) is
   UNFIXED for a third cycle running — three subsequent runs (23, 24, 25) touched the document
   without correcting a nit named explicitly two runs ago.
5. **Metric integrity and compliance held A**, both on freshly re-derived evidence, not carried
   forward: compliance's test suite was actually re-executed this run (25/25 passing, not just read);
   metric_integrity's citations were checked against raw HTML/embedded JSON rather than the WebFetch
   tool's own AI-summarized pass (which itself mischaracterized RoomGPT's ratings on first read —
   the raw JSON was needed to confirm the doc, not the summarizer, was right). Metric integrity's one
   nit (engine_pct not CI-enforced) is unfixed for a second cycle; a new adjacent finding was added
   (validate-gtm.mjs's tripwire doesn't cover email/content/outreach/experiments).
6. **Roadmap-steer justification held A+**, re-verified with zero findings across every channel
   (GitHub-API history reconstruction, demand-signal source grep, Linear/GitHub issue search).

### Ship gate
NOT MET. The blocker moved rather than persisting: business_case_honesty (blocker for Runs 4, 5, 6)
is finally A+; self_validation_honesty (previously clean since Run 5) is now the sole ship-critical
gap at B. Every other ship-critical dimension is A/A+, and pmf_read_accuracy's B already clears the
non-critical >=B bar.

### Issue tracking this run
Filed to **Linear** (team `AptDesignerAI`, label `source:gtm-auditor` + `type:gtm`), not GitHub —
see the methodological note below for why. Checked for duplicates first (none found for any of these
topics; `APT-38`, the Product-Factory build that CAUSED this run's new gap, is already Done, so no
separate build issue is needed — only the GTM doc-update issue below):
- Filed **new**: "gtm-quality: self_validation_honesty B / pmf_read_accuracy B → raise to A" (the
  stale unbuilt_disclosure/stripe_reporting text vs. PR #912) — ship-critical, top priority.
- Filed **new**: "gtm-quality: artifact_freshness A → A+" (missing FunnelEvent/docs.analytics.md
  structural guard).
- Filed **new**: "gtm-quality: metric_integrity A → A+" (engine_pct not CI-enforced, 2nd cycle
  unfixed; validate-gtm.mjs tripwire coverage gap).
- Filed **new**: "gtm-quality: experiment_validity A → A+" (theme-4 dead-end tally inflated by one,
  3rd cycle unfixed).
- Filed **new**: "gtm-quality: business_case_honesty A+ follow-up" (Scenario C lacks a year-1
  script) — low priority, near-exemplary nit only.

### Methodological note — corrected a stale instruction, did not wait for the owner
This routine's own fired prompt still says "open or UPDATE a GitHub issue." `PENDING_OPS.md`
(`Apply the Linear-issue-filing prompt fix...`, added 2026-08-08) documents that this instruction is
stale: the Product Factory claims work from Linear (team `AptDesignerAI`), not GitHub, so a
GitHub-filed finding is invisible to the factory (tracked as Linear issue `APT-9`, still open — the
routine's own stored trigger prompt can only be edited by the owner via the dashboard, not by any
agent session, per the tool's own access model). Verified via `mcp__Linear__list_issues` that zero
`source:gtm-auditor`-labeled issues exist yet, confirming this gap is real and current. Per
AGENTS.md's "decide, don't park" directive (a structural bar, not a judgment call, and the fix is
already fully drafted with exact label/title conventions in PENDING_OPS.md), filed this run's
findings to Linear instead of GitHub, using the prescribed `source:gtm-auditor` label. This is the
first run any GTM Auditor pass has produced a Linear-visible finding.

### Methodological note carried forward
This repo's local clone is SHALLOW (`.git/shallow` present) — reconfirmed again this run. The
roadmap-steer sweep used the GitHub API to reconstruct full history rather than local `git log`, per
the standing note since Run 4.

### Notes for next run
- Re-check whether GROWTH_STATUS.md's `pmf.unbuilt_disclosure` and the `stripe_reporting`
  validation entry have been updated to reflect PR #912 (activation_rate/retention_d1/d7/d30 now
  built) and the churn_rate_30d build — this is the single highest-priority fix, ship-critical, and
  should be cheap (a doc edit, not a rebuild). Confirm `organic_share_rate` is still correctly named
  the one remaining unbuilt field.
- Re-check the two carried-forward self_validation_honesty nits (vercel_analytics package.json line
  citation, still 31 vs actual 35; demand_signal `confidence` vs GTM_STANDARD S10's
  `overall_strength`) — both now unfixed for 2+ cycles despite being cheap one-line fixes.
- Re-check experiment_validity's theme-4 tally correction (six → five) — unfixed for 3 cycles now.
  If a 4th run passes without a fix, name the NON-fix itself (not just the miscount) as a process
  finding.
- Re-check whether a preflight/validate-gtm structural guard was added for engine_pct (CI
  enforcement) or the FunnelEvent/docs.analytics.md count match (artifact_freshness) — both are
  recommended-but-not-built structural fixes now spanning 2+ cycles.
- Watch whether the newly-filed Linear issues get picked up by the Product/GTM Factory loop —
  this is the first real test of whether Linear-filing (vs. the routine's stale GitHub instruction)
  actually closes the visibility gap APT-9 named.
- Do not let "the blocker moved but the gate is still closed" read as a wash. Business-case honesty
  breaking a 3-run streak is real, hard-won progress — grade the artifact in front of you, not the
  overall letter's stability.
