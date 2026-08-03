# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-08-03
  auditor_run: 5
  overall: B
  ship_gate_met: false          # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  regression_note: >-
    Not a regression -- a genuine improvement run. Graded against Run 4 (2026-07-27, overall C,
    gate false) after Growth Agent Runs 15-18 (2026-07-27 through 2026-08-01) claimed to fix all
    8 of Run 4's named top_gaps. Six fresh, independent, adversarial per-dimension graders
    re-verified each claimed fix from scratch (re-ran scripts, re-fetched citations, grepped
    code) rather than trusting the Factory's self-report -- consistent with this scorecard's own
    standing practice after Run 4 caught two prior over-grades that did exactly the opposite.
    Two ship-critical dimensions genuinely moved to A (self_validation_honesty C->A,
    roadmap_steer_justification held A) and compliance moved B->A. business_case_honesty stayed
    at B, but for a DIFFERENT and NEW reason -- Run 4's two named defects (non-reproducing
    sensitivity figures, the 84%->58.1% churn conflation) are genuinely fixed; a new disclosure
    gap surfaced instead (see dimension detail). artifact_freshness stayed at C: its single most
    serious Run-4 finding (EARLY30) is fully fixed, but two lesser findings are only half-fixed or
    have recurred in a new file, which is why the ship gate is still not met -- one ship-critical
    dim (business_case_honesty) and one non-critical dim (artifact_freshness) both sit at
    B/C rather than the required A/A+ and >=B.
  dimensions:
    metric_integrity:
      grade: A
      ship_critical: true
      evidence: >-
        Re-verified from scratch. Every GROWTH_STATUS funnel/acquisition/pmf/email/content/outreach
        field is honestly 0/null given channels_connected: [] and awaiting_connect: true (re-parsed
        the YAML and dumped every value, not just read prose); scripts/validate-gtm.mjs enforces this
        mechanically as preflight gate 1e. engine_pct: 100 is NOT a self-claim -- preflight.sh:457-491
        recomputes it from 5 pinned anchor files, all confirmed to exist. Run 4's top_gap (theme 1's
        source count stated four irreconcilable ways) is GENUINELY FIXED: a `counting_rule` field
        (:316-330) now defines cited_count/verbatim_count precisely, and I independently recounted
        every theme's `sources` text against its stated counts -- all four themes match exactly
        (theme 1: 4/3, theme 2: 6/4, theme 3: 5/4, theme 4: 2/1). Direct WebFetch spot-checks of the
        Modsy BBB complaint, the Run-15-corrected Baymard sentence, First Chair's decision-time page,
        and RoomGPT's App Store review JSON all verbatim-confirmed. No fabricated/unsourced metric
        found; the F-cap condition is not met.
      gap: >-
        One real nit (down from three at Run 4). The Run-16 RoomGPT App Store citation (:141) claims
        "five different 1-star reviewers" but the live page's raw JSON rating field shows Deezy16 and
        Leviana Grace are actually 2-star, not 1-star -- inflating 2 of 5 cited reviews' severity, and
        unflagged through two subsequent "re-verify" runs (17, 18). The quoted review TEXT itself is
        verbatim-accurate; only the star-count characterization is wrong. Not fabrication, not a
        GROWTH_STATUS numeric metric, so no F-cap trigger. One cited reviewer ("Kristen C") could not
        be relocated on the current page -- plausibly ordinary App-Store review-list rotation since
        Run 16, recorded as an honest "could not verify," not a confirmed fabrication. Fix: correct
        the star-rating characterization for Deezy16/Leviana Grace.
    business_case_honesty:
      grade: B
      ship_critical: true
      evidence: >-
        Re-derived cold, not carried over. Ran scripts/validate-computation.mjs (PASS) and
        independently re-ran/hand-reimplemented all 7 registered figures: Scenario A $55,989
        (formerly $46,109 pre-correction), B $149,304, C $335,934, without-annual store $121,339,
        web $136,762, monthly-churn-12% sensitivity $113,604, annual-churn-40% sensitivity $125,331
        -- ALL reproduce to the dollar. Confirmed BOTH of Run 4's named defects are genuinely fixed:
        the two sensitivity figures now reproduce and are registered in analysis/figures.json, and
        the 84%->58.1% churn rate/probability conflation is corrected and self-disclosed (:165).
        Verified the 2026-07-28 take-rate correction (30%->15% store commission) is a UNIFORM
        1.214286x multiplier applied identically to every store-priced figure (checked six figures
        against the pre-correction values) -- not a selective, flattering adjustment. Apple SBP
        enrolment is honestly disclosed as an OPEN owner action, not banked as already-active
        (PENDING_OPS enroll-apple-small-business-program, status: open). Annual-tier gating
        disclosure holds (lib/billing/stripe.ts:47 default off, migration 021 open). Independently
        re-derived the Scenario-B year-1 exit run-rate via a month-by-month pool-fill model (not the
        closed-form steady-state): ~$71,212, matching the doc's cited "~$70-73K" -- a genuine
        re-derivation, not a scaled guess. Summary YAML reconciles to the body on every field.
      gap: >-
        A new disclosure-rigor gap replaces the two Run-4 findings (both now fixed): the
        "shippable-today" ARR figures ($121,339 store / $136,762 web, :444) are computed via the
        IDENTICAL multi-year steady-state pool formula as the $149.3K base case -- but unlike that
        figure, which earned a dedicated "steady-state, not year-1" disclosure box after Run 71
        caught this exact conflation, the shippable-today figures get no equivalent caveat anywhere
        they are quoted (:444, :535-540). I ran the same month-by-month pool-fill methodology on this
        scenario (16 new Pro/mo, 0% annual, 7% churn): year-1 exit run-rate is approximately $73,519
        -- BELOW the $100K floor -- while the doc calls $121,339 "the honest number for TODAY'S
        transactable product... over the floor" with no year-1 caveat. Not gamed (the underlying
        steady-state computation is registered, gated, and reproduces exactly) but a real, material
        asymmetry in disclosure rigor between two figures computed the same way. Fix: add a
        "steady-state, not year-1" caveat to the shippable-today figures matching the one already
        applied to Scenario B, with the ~$73.5K year-1 read stated alongside.
    experiment_validity:
      grade: B
      ship_critical: false
      evidence: >-
        Real fixes verified, up from C. The void Decorist "0 complaints" disconfirming datum (Run
        4's top finding) is GENUINELY removed from `disconfirming` and correctly re-filed: theme 3's
        `sources` field now cites the Decorist shutdown (Business of Home, Sept 2022) as a THIRD
        confirming e-design collapse alongside Havenly and Modsy, with an explicit self-correction
        note crediting the auditor and stating the entry was "moved here and the disconfirming entry
        removed" (:347). First Chair's competitor-conflict disclosure is retained, not walked back
        (:361). A genuine direct-competitor negative now appears in `disconfirming` for the first
        time: RoomGPT holds "4.6/5 across 6,000 ratings" despite its quoted failure complaints (Run
        16, :362) -- closing Run 4's "zero direct competitors in disconfirming" gap. The
        confirmation/disconfirming pairing fix is not cosmetic: Run 17 applied it to themes 1 and 4
        and got an HONEST NEGATIVE result ("no new citation added to either theme") rather than
        forcing a weak citation to show progress -- real restraint. experiments: [] re-verified
        honest (grepped lib/, app/, components/ for A/B or feature-flag infra -- none found, all
        "variant"/"test" hits are false positives). The counting_rule fix (shared with
        metric_integrity) resolves the prior irreconcilable-count problem here too.
      gap: >-
        Disconfirming coverage is still uneven, which is why this is B and not A: only theme 2 (AI
        room-render failures) has a theme-specific, competitor-sourced counter-finding (RoomGPT).
        Themes 1, 3, and 4 still rely only on generic, cross-cutting disconfirming items (ChatGPT
        substitution, category fatigue, the AR-avoidance counter) unchanged since Run 5, and two
        dedicated Run-17 search attempts to add theme-specific disconfirming evidence for themes 1
        and 4 came back empty. Fix: keep running the falsification-query pattern per theme until
        each of the four themes carries at least one theme-specific disconfirming data point, not
        just theme 2.
    roadmap_steer_justification:
      grade: A
      ship_critical: true
      evidence: >-
        Re-verified exhaustively via the GitHub API (confirmed .git/shallow is present locally, so a
        local-only sweep would silently miss history -- this run reconstructed full commit history
        via mcp__github__list_commits/get_commit rather than trusting local git). Every commit
        touching ROADMAP.md/VISION.md/BUSINESS_CASE.md since Run 4 (fe1d4bc, e217e955, 5e28664,
        38a79b5, bd795f9, f289ae9, fd56361, a4fbcf4) was individually classified by author and
        content: the one GTM-authored BUSINESS_CASE touch (fe1d4bc, Run 15) is a bug-fix (the
        84%->58.1% conflation), not a direction change; every other GTM commit (Runs 16-18) touches
        only docs/growth/ and each states explicitly in its own commit message "no ROADMAP/VISION/
        BUSINESS_CASE steer" / "no evidence clears the S3 bar." The take-rate correction (38a79b5,
        the one BUSINESS_CASE change that DID move numbers) is Product-Factory-authored, not GTM, and
        the Growth Agent correctly treats it as external data rather than re-grading its own work.
        Zero GTM-authored steers reached ROADMAP.md or VISION.md. grep of both files for every
        demand-signal source name (eMarketer, First Chair, MONA, Baymard, BBB, TechCrunch, RoomGPT,
        Modsy) returns zero hits -- no indirect steer. No open GTM-filed PRs or issues proposing a
        roadmap change.
      gap: >-
        The exact Run-4 nit is STILL UNFIXED across four subsequent runs. GROWTH_STATUS.md's live
        `positioning_implication` field still describes the $511-vs-$265 Havenly markup example as
        "directly-quoted," while the same document's `counting_rule`/sources text three lines away
        explicitly states this figure "stays WebSearch-synthesized only (trustpilot.com 403s)" --
        i.e. never independently re-fetched. A self-identified contradiction that survived Runs 15,
        16, 17, and 18 despite each claiming to re-verify prior work. Held at A rather than docked to
        B because it produces no steer (the same field explicitly disclaims reaching the S3 bar) and
        is the same provenance-labeling defect family already reflected in metric_integrity -- but
        four runs of non-fix on a self-identified, one-clause item is a genuine process gap worth
        naming plainly.
    self_validation_honesty:
      grade: A
      ship_critical: true
      evidence: >-
        Both Run-4 ship-critical findings are GENUINELY fixed, verified against code, not prose. (1)
        The false "MRR/active-subscriber/churn... already surface via internal_metrics_api" claim is
        gone; :38 now states precisely what lib/growth/metrics.ts actually exposes -- no mrr field
        (grep: zero hits across lib/growth/ and app/api/internal/), active/annual subscriber counts
        are real, and cancelled_30d is an approximate count, not a rate -- matching the code exactly.
        (2) Vercel Analytics is now declared (:42-44) with accurate citations (package.json:31,
        app/layout.tsx:63) and an honest reason. A full package.json audit found no OTHER undeclared
        live tracking/analytics dependency -- the failure mode did not recur elsewhere. Every
        validation-block owner-action cross-reference (set-metrics-token, connect-email-resend,
        set-site-gate-password, set-email-physical-address) checked against PENDING_OPS.md and
        confirmed real and status:open. The GTM_SCORECARD "unchanged since fb45671" claim verified
        via `git diff` -- genuinely empty diff. GROWTH_MEMORY.md's append-only history correctly
        preserves the original Run-9 false claim as a historical record while Run 15's entry
        documents the correction explicitly -- proper practice, not an uncorrected gap. Network-
        unreachability claims spot-checked as plausible, evolving evidence, not padded/fabricated
        precision.
      gap: >-
        One narrow, real nit (why A, not A+). The `gtm_scorecard` validation entry's "re-verified
        via git log this run: last touch is still 0e0f901" claim for QUALITY_SCORECARD.md does not
        reproduce -- that commit hash does not exist anywhere in this repo's history; the actual
        last touch is 38a79b5 (Run 121), which DID change the file's content (as_of, ship-critical
        dimension count, and grade narrative all moved). The live QUALITY_SCORECARD.md substance
        GROWTH_STATUS describes (overall C, 5 sub-A ship-critical dims, gate false) still matches
        reality, so this is a stale/non-reproducible citation inside a supplementary cross-reference,
        not a false claim about a channel or an owner blocker -- but a "re-verified this run" claim
        should be reproducible, and this one is not. Fix: re-run the git log command fresh each run
        rather than carrying forward a hash from a prior run's check.
    pmf_read_accuracy:
      grade: B
      ship_critical: false
      evidence: >-
        Unchanged from Run 4 and re-confirmed independently rather than carried over. All 5 pmf
        fields correctly null with signal: none; phase: pre_launch correctly gated; the PMF firewall
        is real -- grepped every pmf/demand_signal co-occurrence repo-wide and found zero instances
        of demand_signal.confidence leaking into pmf.signal. The recommendation stays product-first;
        no acquisition-scaling proposal appears anywhere pre-PMF.
      gap: >-
        The exact Run-4 gap persists unaddressed. lib/growth/metrics.ts exposes exactly 6 fields and
        has zero code path for activation_rate, retention_d1/7/30, or organic_share_rate -- no
        activation event, no return-cohort query, no share/referral query exists anywhere in the
        codebase (organic_share_rate's only schema support, migration 026, is both unapplied and
        unqueried). The doc makes the "unbuilt, not merely unconnected" disclosure explicitly for
        stripe_reporting/mrr_usd (now fixed, see self_validation_honesty) but still nowhere makes
        the same disclosure for the pmf block, and no next_action/owner_blocker asks for activation/
        retention instrumentation -- pre-PMF, the single highest-leverage growth-owned ask per
        GTM_STANDARD S1. Fix: add the same "unbuilt" disclosure to the pmf block and file an
        instrumentation owner_blocker/next_action.
    compliance:
      grade: A
      ship_critical: false
      evidence: >-
        Both Run-4 findings are GENUINELY resolved, verified against code and tests, not claims.
        (1) lib/email/templates/waitlist-welcome.ts now renders a real unsubscribe link
        (${siteUrl}/api/waitlist/unsubscribe?id=...) unconditionally and EMAIL_PHYSICAL_ADDRESS when
        set. app/api/waitlist/unsubscribe/route.ts is a genuine no-login endpoint (rate-limited,
        UUID-validated, idempotently stamps unsubscribed_at); supabase/migrations/031 adds the needed
        column. The Run-4 "no test guards it" finding is closed: __tests__/email/
        waitlist-welcome-footer.test.ts now asserts the rendered HTML/text actually contains the
        unsubscribe URL and correctly includes/omits the address per the env var. (2) press-kit.md
        now explicitly instructs "do NOT ask anyone to upvote" on Product Hunt, citing PH's
        manipulation guidelines -- the upvote-solicitation language is gone. Outbound remains
        provably hard-off (channels_connected: [], RESEND_API_KEY unset forces dry-run on every
        marketing stage). GDPR/double-opt-in spot-checked, still intact.
      gap: >-
        Two minor residual gaps, both honestly disclosed (why A, not A+). (1) The compliance GATE
        (lib/email/index.ts requiresPhysicalAddress) still keys on the env var being set, not on
        inspecting rendered email content -- Run 4's literal complaint about the gate MECHANISM isn't
        structurally fixed, though it is now low-risk in practice since the template reads the same
        env var and a test pins the rendered output (defense-in-depth gap, not a live hole). (2) The
        unsubscribe mechanism is code-complete and tested but NOT YET live in prod -- migration 031 is
        still status:open in PENDING_OPS.md -- and a real click would fail today if RESEND_API_KEY
        were somehow set without the migration also being applied. This is honestly disclosed in
        three places (PENDING_OPS, GROWTH_STATUS next_actions, GROWTH_STATUS owner_blockers PRIORITY
        3) and is currently moot since RESEND_API_KEY remains unset. Fix: apply migration 031 before
        RESEND_API_KEY goes live; consider moving the gate to inspect rendered content in future work.
    artifact_freshness:
      grade: C
      ship_critical: false
      evidence: >-
        Run 4's single most serious finding is FULLY fixed and independently confirmed clean, not
        just claimed: app/waitlist/page.tsx and confirmed/page.tsx now promise only "early-access
        pricing," no specific number or mechanism, and EVERY downstream GTM asset that used to
        publicize the contradictory EARLY30 code (email-welcome-sequence.md, press-kit.md,
        social-drafts.md, content-calendar.md) now explicitly marks it as an unfinalized placeholder
        tied to the open PENDING_OPS item -- the cross-asset contradiction that was Run 4's most
        serious finding is genuinely gone. Also confirmed fixed: the OG image (press-kit.md correctly
        says DONE, shipped PR #714, files exist), the app name (brand-kit.md now matches
        store-listing.md and app.json), and the /support page reference (store-listing.md correctly
        says DONE). Pro Annual quarantine, $29/$49/$399 pricing consistency, and canonical-domain
        consistency all re-confirmed clean.
      gap: >-
        Two of Run 4's six findings are only HALF-fixed or have recurred, keeping this at C rather
        than raising it. (1) email-lifecycle.md got the Run 15 pre-engine-language correction, but
        docs/email-welcome-sequence.md -- the SIBLING file Run 4 also cited -- was never touched:
        line 3 still says "Do not send until the owner connects the email platform" and line 135
        still tells the owner to "connect a webhook," both false today (app/api/waitlist/confirm/
        route.ts already calls sendEmail() with the welcome template). (2) docs/analytics.md's gap is
        not closed, it has RECURRED with a different event: lib/analytics.ts's FunnelEvent union now
        has 11 members (mockup_limit_paywall_shown shipped 2026-07-30, after Run 15's fix, at
        app/projects/[projectId]/rooms/[roomId]/focus/page.tsx), but docs/analytics.md still lists
        only 10 and its own footnote asserting "covers all 10" is now false again -- the identical
        failure mode Run 4 flagged, days after being fixed. This is a pattern of narrow, one-off
        fixes rather than closing the underlying freshness-maintenance gap. Fix: update
        email-welcome-sequence.md to match email-lifecycle.md's correction; add
        mockup_limit_paywall_shown to docs/analytics.md; consider a preflight check that fails when
        FunnelEvent's member count diverges from docs/analytics.md's documented count.
  top_gaps:
    - "SHIP-CRITICAL business_case_honesty B: the shippable-today ARR figures ($121,339 store / $136,762 web, BUSINESS_CASE.md:444) are steady-state figures computed the same way as the $149.3K base case, but get no 'steady-state, not year-1' caveat while the base case does; independently re-derived year-1 exit run-rate for this scenario is ~$73.5K -- BELOW the $100K floor -- contradicting the doc's 'over the floor' framing for today's transactable product."
    - "artifact_freshness C: docs/analytics.md is missing mockup_limit_paywall_shown (shipped 2026-07-30, the 11th FunnelEvent) and its own footnote asserting 'covers all 10' is false again -- the identical gap Run 4 flagged has recurred with a new event days after being fixed."
    - "artifact_freshness C: docs/email-welcome-sequence.md still tells the owner 'you'll need to connect a webhook' and 'do not send until the owner connects the email platform' -- false, contradicts engine_pct:100, and is the sibling file to email-lifecycle.md which DID get this correction."
    - "experiment_validity B: disconfirming evidence is theme-specific for only theme 2 (RoomGPT); themes 1, 3, and 4 still rely solely on generic cross-cutting disconfirming notes despite two dedicated Run-17 search attempts."
    - "pmf_read_accuracy B: no disclosure that the pmf block's 5 fields have zero data path in lib/growth/metrics.ts (unbuilt, not merely unconnected) -- the same disclosure Run 15 correctly added for stripe_reporting/mrr was never extended to pmf, and no owner_blocker asks for activation/retention instrumentation."
    - "roadmap_steer_justification A: the Run-4-identified $511-vs-$265 Havenly markup provenance-labeling contradiction (GROWTH_STATUS.md's positioning_implication calls it 'directly-quoted' while the sources text says WebSearch-synthesized-only) remains unfixed across four subsequent runs despite each claiming to re-verify prior work."
    - "metric_integrity A: the Run-16 RoomGPT App Store citation mischaracterizes 2 of 5 quoted reviewers (Deezy16, Leviana Grace) as 1-star when the live page shows 2-star -- inflating cited severity, unflagged through two subsequent re-verify runs."
    - "self_validation_honesty A: the gtm_scorecard validation entry's 'last touch 0e0f901' citation for QUALITY_SCORECARD.md does not reproduce (no such commit exists); actual last touch is 38a79b5, which did change the file's substance -- the described content is still accurate, but the 're-verified this run' framing overstates what was checked."
  notes: >-
    Run 5 (2026-08-03). SHIP GATE STILL NOT MET, but this is a genuine improvement run, not a wash:
    overall moved C->B. Two ship-critical dimensions moved to A (self_validation_honesty C->A,
    fixing both Run-4 findings against real code) and compliance moved B->A. business_case_honesty
    held at B but Run 4's two specific findings (non-reproducing sensitivity figures, the
    84%->58.1% conflation) are BOTH genuinely fixed -- a new, different disclosure-rigor gap
    surfaced in their place (see dimension detail), which is why this is not yet A. artifact_freshness
    held at C: EARLY30, its most serious Run-4 finding, is fully and cleanly fixed, but two lesser
    findings are only half-fixed (email-welcome-sequence.md) or have recurred with a new instance
    (docs/analytics.md, days after being fixed) -- a real pattern of narrow one-off fixes rather than
    closing the underlying freshness-maintenance discipline. experiment_validity moved C->B: the void
    Decorist datum is genuinely retracted and re-filed correctly, and a real direct-competitor
    disconfirming data point (RoomGPT) now exists, but disconfirming coverage remains uneven across
    themes. Graded by six fresh, independent, adversarial per-dimension graders, each explicitly
    tasked to re-verify Run 4's specific claimed fixes against real code/scripts/citations rather
    than trust the Factory's self-report -- consistent with this scorecard's standing practice
    after Run 4 itself caught two prior over-grades doing the opposite. What remains genuinely
    strong and should NOT be re-litigated: zero GTM-authored steers reached ROADMAP/VISION (full
    history reconstructed via the GitHub API past the shallow local clone); the ARR core reproduces
    to the dollar with nothing gamed, including a verified-uniform take-rate correction; outbound
    remains provably hard-off; no fabricated metric anywhere. The ship gate's remaining blockers are
    one ship-critical disclosure gap (business_case_honesty) and one non-critical freshness-discipline
    gap (artifact_freshness) -- both are narrower and more specific than Run 4's findings, which is
    the right direction of travel.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline. The gate is **still closed** this run, but by a
  narrower margin than Run 4: `ship_gate_met` requires A/A+ on every ship-critical dimension and
  ≥ B everywhere else; only two dimensions miss now (business_case_honesty B, artifact_freshness C),
  down from four at Run 4.
- **This is a genuine improvement run, not a correction like Run 4 was.** See `regression_note`.
  Six of Run 4's eight named top_gaps are confirmed fixed against real code, not self-report.
- `top_gaps` is ordered by severity — the one remaining ship-critical gap first, then the gaps
  keeping non-critical dimensions below the ≥B ship-gate bar, then trivial nits on dimensions
  already at A.
- Each dimension's `evidence` states what was actually checked — every grader re-verified Run 4's
  specific claimed fix against code/scripts/citations rather than trusting the Factory's self-report.
- The real launch constraint remains the owner env-connect blockers (site gate, Resend, metrics
  token, migrations) in `PENDING_OPS.md`. The business-case disclosure gap and the freshness gaps
  above are worth fixing now regardless, since they are cheap, self-contained doc/model edits.
