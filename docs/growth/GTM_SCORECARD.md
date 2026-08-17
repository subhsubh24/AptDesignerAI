# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-08-17
  auditor_run: 7
  overall: B
  ship_gate_met: false          # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  regression_note: >-
    A genuine mixed run -- one long-standing ship-critical blocker is FINALLY closed, and a
    DIFFERENT ship-critical dimension drops to take its place, so the gate stays shut for a new
    reason. Graded against Run 6 (2026-08-10, overall B, gate false, sole blocker
    business_case_honesty B) after Growth Agent Run 25 (2026-08-15) claimed to fix both of Run 6's
    named top_gaps. Eight fresh, independent, adversarial per-dimension graders re-verified every
    claim from scratch (re-ran every analysis/*.mjs script including two NEW ones, re-fetched
    disputed citations via WebFetch against raw page/JSON data, reconstructed ROADMAP/VISION/
    BUSINESS_CASE history via the GitHub API past the shallow local clone, ran the actual test
    suite, and diffed the doc's own claims against the CURRENT state of lib/growth/metrics.ts)
    rather than trusting the Factory's self-report.
    business_case_honesty B->A+ (the 3-run-running "fix one instance, find a new one" streak on
    this exact dimension, Run 4->5->6, is GENUINELY BROKEN this run -- a full adversarial sweep of
    the whole document for a fourth instance of the pattern found none). artifact_freshness B->A
    (the email-lifecycle.md banner fix holds under a full sweep of every other GTM doc).
    experiment_validity held A (one of two Run-6 nits fixed and WebFetch-verified; the other,
    an inflated dead-end tally, is unfixed for a 3rd cycle). metric_integrity and compliance held A
    on unchanged evidence, actively re-derived, not carried forward. roadmap_steer_justification
    held A+, re-verified fresh via the GitHub API with zero findings.
    self_validation_honesty A->B and pmf_read_accuracy A->B, BOTH FOR THE SAME NEWLY-DISCOVERED
    ROOT CAUSE: Product Factory PR #912 (APT-38, "build activation_rate + rolling retention_d1/d7/
    d30", merged 2026-08-16 -- one day after GROWTH_STATUS.md's own as_of) plus a second commit
    building churn_rate_30d, gave lib/growth/metrics.ts real, wired queries for 4 of the 5 fields
    the pmf.unbuilt_disclosure block calls "UNBUILT... exist[s] nowhere in the codebase," and for
    the churn-rate claim the stripe_reporting validation entry makes. Both graders independently
    ran the doc's OWN prescribed verification grep and got a result that contradicts the doc's own
    text -- the precise self-validation failure mode this rubric exists to catch. Not a fabrication
    (funnel/pmf numbers stay honestly null; the error understates capability, not overstates it) and
    not yet correctable by the Factory that wrote it (the code landed after the doc's last edit), but
    live and real today. This is now the SOLE reason the ship gate stays closed: every OTHER
    ship-critical dimension is A/A+, business_case_honesty (the prior blocker) is finally fixed, and
    the only non-critical dimension below A (pmf_read_accuracy, B) already clears the >=B bar. The
    blocker moved, the gate did not open -- filed as this run's top_gap.
  dimensions:
    metric_integrity:
      grade: A
      ship_critical: true
      evidence: >-
        Held at A, re-derived fresh, not carried over. Full numeric sweep of GROWTH_STATUS.md's
        funnel/acquisition/pmf/email/content/outreach/channels/experiments: every value 0/null/[]/
        none, consistent with channels_connected:[] and awaiting_connect:true -- no F-cap trigger.
        engine_pct:100 re-confirmed: all 5 anchor files scripts/preflight.sh checks genuinely exist
        (app/api/waitlist/confirm/route.ts, lib/email/index.ts, lib/social/queue.ts,
        lib/growth/metrics.ts, docs/growth/CONNECT.md). Three citations re-verified against RAW
        HTML/embedded JSON, not the WebFetch tool's own AI-summarized pass (which itself
        mischaracterized RoomGPT's star ratings on a quick fetch -- the raw JSON, not the doc, was
        needed to settle it): RoomGPT (Deezy16/Leviana Grace both rating:2, matching the doc exactly),
        Havenly (4.4/5, 4.9K ratings, all 3 quotes verbatim), Wayfair (4.9/5, Jami303 quote verbatim).
        The two new business-case year-1 sensitivity figures ($60,593/$69,934) independently
        reproduced via `node scripts/validate-computation.mjs` (12 figures, all PASS).
      gap: >-
        Same nit as Run 6, unfixed for a second cycle: scripts/preflight.sh -- the only script
        computing engine_pct/engine_built -- is still called by NO CI job (grepped every workflow
        file in .github/workflows/); scripts/validate-gtm.mjs (which IS wired into CI) never checks
        engine_pct. Nothing merge-blocks a future drift between the declared and real value.
        NEW adjacent finding: validate-gtm.mjs's own metric-without-source tripwire only covers
        `funnel`/`acquisition`/`pmf`/`channels` -- `email`/`content`/`outreach`/`experiments` are
        currently all honestly zero/empty so there's no live violation, but a future fabricated
        non-zero value in those sections would not be mechanically caught either. Fix: extract
        engine_pct's computation into a standalone script (mirroring how security-invariants was
        extracted from preflight.sh) and wire it into CI; extend validate-gtm.mjs's tripwire to the
        four uncovered sections.
    business_case_honesty:
      grade: A+
      ship_critical: true
      evidence: >-
        Up from B -- the 3-run-running streak on this exact dimension (Run 4->5: fixed, new instance
        found; Run 5->6: fixed, new instance found) is GENUINELY BROKEN this run, not just moved.
        Independently re-derived, not trusted from the commit message: `node
        scripts/validate-computation.mjs` -> "12 figure(s) verified... PASS"; directly executed BOTH
        new scripts (`analysis/business_case_sensitivity_monthly_churn12_year1_arr.mjs` ->
        {"value":60593}, `..._annual_churn40_year1_arr.mjs` -> {"value":69934}) and confirmed both
        call the SAME shared computeYear1ExitRunRate() helper (analysis/business-case-model.mjs:170-
        206) already used for the Scenario-B and shippable-today year-1 figures -- no formula
        shortcut. docs/BUSINESS_CASE.md:571-580 and :590-596 now carry the explicit "Steady-state, not
        year-1" caveat with both year-1 reads stated inline, matching the treatment already given
        elsewhere in the doc. The `arr_year1` YAML key (:6-11) now carries an explanatory annotation
        (not silently left as a misnomer) and `as_of` is bumped to 2026-08-15.
        THE CRITICAL STEP: a fresh adversarial sweep of the ENTIRE document (grep every "floor" /
        "clears" / "exceeds" / "steady-state" / "year-1" hit, hand-read each) for a FOURTH instance of
        the pattern found none -- the one candidate (Scenario C's optimistic verdict, :523-532)
        already carries its own adjacent steady-state disclaimer ("a STEADY-STATE ceiling, not a
        12-18-month timeline"), so it does not reproduce the failure mode. `git diff` on the fixing
        commit (32ea347) confirms the change is scoped exactly to the two flagged bullets + YAML
        annotation + as_of -- no other ARR figure or lever moved.
      gap: >-
        One minor, non-blocking observation (why A+ still stands, not a deduction): Scenario C's
        optimistic verdict carries a qualitative steady-state caveat but, unlike every OTHER scenario
        in the document, has no registered year-1 exit-run-rate script backing it. Scenario C is
        explicitly the non-planning optimistic case and already discloses the caveat in prose, so
        this is a consistency nit, not a disclosure gap -- filed as a low-priority follow-up
        (analysis/business_case_scenario_c_year1_arr.mjs) rather than held against the grade.
    experiment_validity:
      grade: A
      ship_critical: false
      evidence: >-
        Held at A. One of Run 6's two named nits is genuinely fixed and independently WebFetch-
        verified: theme 1's new Wayfair disconfirming citation (apps.apple.com id836767708) -- live-
        fetched, confirmed 4.9/5 across ~2.5M ratings and the Jami303 (2023-10-24) "makes it easy to
        find, all I do is filter it to what I am interested in" quote reproduces verbatim, genuinely
        theme-1-specific (findability/filtering, not delivery or pricing). `experiments:[]`
        re-confirmed honest -- grepped app/, lib/, components/ and found only two internal pipeline
        kill-switches (ENABLE_DESIGN_COORDINATOR, ENABLE_POST_SEARCH_COORDINATOR), not user-facing
        variant/bucketing infrastructure. counting_rule cited_count/verbatim_count independently
        recounted for themes 1 and 3 against their actual `sources` text -- both correct, no
        inflation. Bias check: the doc actively records disconfirming aggregates alongside its own
        confirming quotes (RoomGPT 4.6/5, Havenly 4.4/5, now Wayfair 4.9/5) and multiple honest
        negatives rather than forcing weak citations -- not one-sided pain-seeking.
      gap: >-
        The SECOND Run-6 nit is UNFIXED for a third cycle running: the live theme-4
        `research_status` field (GROWTH_STATUS.md:630) still reads "six consecutive dedicated
        attempts (Runs 14, 17, 19, 20, 21, 22)." Re-checked Run 19's own preserved method_note again
        this run -- it targeted theme 3 (confirming) and theme 1 (disconfirming), never theme 4. The
        real count is five (Runs 14, 17, 20, 21, 22), not six. Three subsequent runs (23, 24, 25)
        touched this document without correcting a nit named explicitly at Run 6. Fix: correct "six"
        to "five" and drop Run 19 from the parenthetical list.
    roadmap_steer_justification:
      grade: A+
      ship_critical: true
      evidence: >-
        Held at A+, re-verified fresh via the GitHub API (owner=subhsubh24, repo=aptdesignerai; local
        clone re-confirmed shallow), not carried forward. Every commit touching ROADMAP.md/VISION.md/
        docs/BUSINESS_CASE.md since Run 6 (2026-08-10) individually classified: VISION.md had ZERO
        commits. ROADMAP.md's two commits (376de1203, f4b2e31a3) are both Product-Factory housekeeping
        (a stale-banner resolution, a test-count correction) -- not steers. docs/BUSINESS_CASE.md's
        one commit (32ea347c0, Growth Agent Run 25, PR #897) verified via full-patch diff: the
        `arr_year1` block and both sensitivity ARR figures are byte-identical before/after; the commit
        only adds year-1 disclosure caveats and two new registered figures -- a disclosure-honesty
        fix, not a lever/steer. Grep of the CURRENT ROADMAP.md (81,695 chars) and full VISION.md text
        for every demand-signal source name (eMarketer, First Chair, MONA, Baymard, BBB, TechCrunch,
        RoomGPT, Modsy, Havenly, eightx.co, Wayfair): zero hits in either. Linear (team AptDesignerAI)
        and GitHub issue search for any roadmap-steer/vision-pivot label or phrase: zero open items.
        GROWTH_STATUS.md's own demand_signal.confidence remains "emerging" with its
        positioning_implication field explicitly stating it is "NOWHERE NEAR the S3 bar... for a
        roadmap steer" -- the correct, self-aware non-steer outcome.
      gap: >-
        None found. All signals green across every verification channel run this pass -- the
        rubric's literal A+ bar.
    self_validation_honesty:
      grade: B
      ship_critical: true
      evidence: >-
        Down from A -- a genuine new finding, not a carried-forward nit, and the SOLE reason the ship
        gate stays closed this run. Product Factory PR #912 (APT-38, "build activation_rate + rolling
        retention_d1/d7/d30", merged 2026-08-16 -- one day after GROWTH_STATUS.md's own as_of) added
        real, wired Supabase queries to lib/growth/metrics.ts: computeActivationRate() and
        computeRollingRetention() (query profiles + room_diagnoses), called from
        gatherGrowthMetrics(), which now returns pmf.activation_rate/retention_d1/retention_d7/
        retention_d30. A separate commit (9bed74e) built churn_rate_30d as a real computed rate
        (cancelled_30d / active_30d_ago). Both graders independently ran the doc's OWN prescribed
        verification command -- `grep -n "activation_rate\|retention_d\|organic_share_rate\|
        activation\|retention\|referral" lib/growth/metrics.ts` -- and got 15+ hits, contradicting
        pmf.unbuilt_disclosure's live text ("all 5 fields above are UNBUILT... exist[s] nowhere in
        the codebase") and the stripe_reporting validation entry's parallel churn-rate claim. This is
        exactly the rubric's target failure mode: a self-report the artifacts now contradict.
        Two long-standing Run-6 nits are ALSO still unfixed for a second cycle: the vercel_analytics
        citation still points to package.json:31 when the dependency is now at line 35; the
        demand_signal block still uses `confidence` where GTM_STANDARD S10 specifies
        `overall_strength`. All PENDING_OPS.md cross-references spot-checked and still accurate
        (set-site-gate-password, connect-email-resend, set-metrics-token, set-email-physical-address,
        apply-migration-031 all genuinely status:open as claimed).
      gap: >-
        SHIP-CRITICAL. Not a fabrication (funnel/pmf numbers stay honestly null since no cohort data
        exists yet; the error understates built capability, not overstates it) and not yet
        correctable by the Factory that wrote the stale text (the code landed the day after the doc's
        last edit) -- but it is live and false today. Fix: update pmf.unbuilt_disclosure to name
        activation_rate/retention_d1/d7/d30 as BUILT (querying profiles/room_diagnoses, still
        returning null pre-launch because no cohort exists) and organic_share_rate as the one field
        still genuinely unbuilt; correct the stripe_reporting validation entry's churn_rate_30d claim
        the same way; also close the two carried-forward nits (package.json:31->35;
        confidence->overall_strength).
    pmf_read_accuracy:
      grade: B
      ship_critical: false
      evidence: >-
        Down from A, same root cause as self_validation_honesty above -- independently discovered by
        a SEPARATE grader with no shared context, corroborating rather than duplicating the finding.
        Ran the doc's own prescribed grep against lib/growth/metrics.ts at current HEAD (10022a92):
        does NOT return zero hits as pmf.unbuilt_disclosure claims. computeActivationRate() (:155-
        171) and computeRollingRetention() (:173-194), added by PR #912 (2026-08-16), are real and
        called from gatherGrowthMetrics() (:280-283, :297-302). 4 of the 5 fields the disclosure
        calls "UNBUILT" are in fact built; only organic_share_rate remains genuinely unbuilt
        (re-confirmed). The referral claim (migration 026 writes referred_by; nothing reads/
        aggregates it) is STILL accurate -- repo-wide grep for referred_by finds only the write site.
        What remains clean: phase:pre_launch correctly gated (funnel all 0, site_gate_up:false); no
        scaling-acquisition recommendation anywhere in next_actions/owner_blockers (all product/
        instrumentation/owner-env work); demand_signal explicitly self-labeled "never PMF" with zero
        cross-contamination found in either GROWTH_STATUS.md or BUSINESS_CASE.md.
      gap: >-
        The unbuilt_disclosure block and the mirroring next_actions:710 bullet are now factually
        false against current code for 4 of 5 named fields -- a reproducible, disprovable error
        inside the exact block this rubric grades, even though the direction is conservative (still
        shows null/none, not a flattered number) and the staleness is only ~1 day old relative to the
        code that outdated it. Fix: same edit as self_validation_honesty's fix above (this is one
        underlying gap surfacing in two dimensions, not two separate defects) -- name
        activation_rate/retention_d1/d7/d30 as built-but-still-null-pre-launch, keep
        organic_share_rate as the one genuinely unbuilt field.
    compliance:
      grade: A
      ship_critical: false
      evidence: >-
        Held at A with NO regression, actively re-checked. mcp__github__list_commits on lib/email/,
        app/api/waitlist/, supabase/migrations/ since 2026-08-10 returns ZERO commits -- no
        compliance-relevant code changed. Re-read lib/email/templates/waitlist-welcome.ts (still
        renders the real no-login unsubscribe link keyed on the row's own UUID + conditional
        EMAIL_PHYSICAL_ADDRESS) and app/api/waitlist/unsubscribe/route.ts (still genuinely no-login,
        UUID-regex-validated, rate-limited, idempotent via `.is("unsubscribed_at", null)`). RAN the
        actual test suite this run (after `npm install`, node_modules was absent):
        __tests__/email/waitlist-welcome-footer.test.ts, __tests__/api/waitlist-unsubscribe.test.ts,
        __tests__/email/email.test.ts -- 3 files, 25 tests, ALL PASSING. requiresPhysicalAddress()
        gate in lib/email/index.ts still force-dry-runs every marketing-lifecycle stage (excluding
        only TRANSACTIONAL_STAGES) until EMAIL_PHYSICAL_ADDRESS is set. channels_connected:[] and
        RESEND_API_KEY genuinely unset re-confirmed. OUTREACH.md's draft-only rail intact;
        drafted_7d/owner_sent_7d/replies_7d all honestly 0.
      gap: >-
        Same two minor, honestly-disclosed gaps as Run 6 (unchanged, why A not A+): the compliance
        gate keys on EMAIL_PHYSICAL_ADDRESS being SET rather than inspecting rendered content
        (mitigated, not structurally fixed, by the pinning test); migration 031 remains unapplied to
        prod. Both visible in PENDING_OPS.md/GROWTH_STATUS.md, not hidden.
    artifact_freshness:
      grade: A
      ship_critical: false
      evidence: >-
        Up from B -- the 3-run-recurring pattern (Run 4, Run 5, Run 6: fix one spot, miss a duplicate
        elsewhere) does NOT recur a fourth time. Growth Agent Run 25's claimed fix to
        docs/email-lifecycle.md's top banner CONFIRMED: lines 6-9 now read "Sending engine:
        code-complete, dry-run until the owner sets credentials... send through Resend (lib/email,
        already wired -- no Loops/Mailchimp integration exists or is needed)," now agreeing with the
        "Delivery notes for owner" section (:439-441). The file even self-documents the correction
        inline. A FULL adversarial sweep of every other docs/growth/*.md and docs/*.md file
        (docs/email-welcome-sequence.md, store-listing.md, press-kit.md, content-calendar.md,
        social-drafts.md, and all six *_PLAYBOOK.md files, plus OUTREACH.md/CONNECT.md) found no
        other internal contradiction and no claim inconsistent with current code. Pro Annual ($399)
        appears ONLY inside dated quarantine blockquotes, never in a live-pricing table; confirmed
        against lib/billing/stripe.ts:47 (ANNUAL_BILLING_ENABLED still unset/off). FunnelEvent's
        member count re-verified by hand: lib/analytics.ts has exactly 11 members, docs/analytics.md
        documents exactly those 11 -- still an honest match.
      gap: >-
        Run 6's structural recommendation was NOT acted on: grepped scripts/preflight.sh and
        scripts/validate-gtm.mjs in full again this run -- still zero references tying FunnelEvent's
        member count to docs/analytics.md's documented count. The 11/11 match holds only because
        nothing has shipped to break it yet, not because anything prevents it breaking -- this is a
        known, disclosed, not-yet-recurred gap (why A, not B) rather than a fresh instance of the
        content-level pattern (why not A+). Fix: add a preflight/validate-gtm check tying the two
        counts together so this class of gap cannot silently recur a fourth time at the enforcement
        level, having now been fixed three times at the content level.
  top_gaps:
    - "SHIP-CRITICAL self_validation_honesty B (+ pmf_read_accuracy B, same root cause): GROWTH_STATUS.md's pmf.unbuilt_disclosure and the stripe_reporting validation entry's churn-rate claim are now factually FALSE against current code -- PR #912 (APT-38, merged 2026-08-16, one day after the doc's own as_of) built real activation_rate + retention_d1/d7/d30 queries in lib/growth/metrics.ts, and a separate commit built churn_rate_30d, but the doc still says these fields 'exist nowhere in the codebase.' This is the SOLE reason the ship gate stays closed this run -- business_case_honesty, the prior blocker, is now genuinely A+."
    - "artifact_freshness A (nit): Run 6's recommended structural guard -- a preflight/validate-gtm check tying FunnelEvent's member count (lib/analytics.ts) to docs/analytics.md's documented count -- was never built. The current 11/11 match holds by luck, not enforcement."
    - "metric_integrity A (nit, unfixed a 2nd cycle): scripts/preflight.sh, the only script computing engine_pct/engine_built, is still not invoked by any CI job. Separately, validate-gtm.mjs's metric-without-source tripwire covers funnel/acquisition/pmf/channels but not email/content/outreach/experiments."
    - "experiment_validity A (nit, unfixed a 3rd cycle): the theme-4 research_status field still tallies 'six consecutive dead ends (Runs 14, 17, 19, 20, 21, 22)' when Run 19's own preserved method_note shows it targeted themes 1 and 3, not theme 4 -- the real count is five."
    - "business_case_honesty A+ (near-exemplary follow-up, not a grade issue): Scenario C's optimistic verdict has no registered year-1 exit-run-rate script, unlike every other scenario in the document -- a consistency gap, not a disclosure gap, since it already carries a qualitative steady-state caveat."
  notes: >-
    Run 7 (2026-08-17). SHIP GATE STILL NOT MET, but the blocker MOVED, not just persisted:
    business_case_honesty -- the sole blocker for three straight runs (4, 5, 6) on the exact same
    disclosure-asymmetry pattern -- is FINALLY, genuinely fixed to A+ this run, verified by a full
    adversarial sweep of the whole document for a fourth instance that found none. In its place, a
    DIFFERENT ship-critical dimension (self_validation_honesty) dropped from A to B, for a reason
    that has nothing to do with anything the GTM Factory did wrong: the Product Factory shipped real
    PMF instrumentation (PR #912, APT-38) the day after the GTM doc's last edit, and the doc's own
    "this is unbuilt" disclosure text hasn't caught up yet. Two independent, un-cross-contaminated
    graders found the identical root cause from separate angles (one grading self_validation_honesty,
    one grading pmf_read_accuracy), which is why both dimensions dropped together -- strong
    corroboration, not noise. artifact_freshness genuinely improved B->A (the 3-run-recurring
    pattern broken cleanly, verified via a full sweep of every other GTM doc). experiment_validity
    held A with one of two named nits fixed and WebFetch-verified. metric_integrity and compliance
    held A on freshly re-derived, not carried-forward, evidence -- compliance's test suite was
    actually re-run (25/25 passing) and metric_integrity's citations were checked against raw
    HTML/JSON, not a summarizer. roadmap_steer_justification held A+ with zero findings across every
    verification channel. Graded by eight fresh, independent, adversarial per-dimension graders, each
    re-executing scripts, re-fetching citations against raw source data, reconstructing ROADMAP/
    VISION/BUSINESS_CASE history via the GitHub API past the confirmed-shallow local clone, and
    running the actual test suite -- consistent with this scorecard's standing methodology since
    Run 4. What remains genuinely strong and should NOT be re-litigated: zero GTM-authored steers
    have EVER reached ROADMAP/VISION (re-verified clean through the current HEAD); the ARR core now
    reproduces to the dollar across all 12 registered figures with nothing gamed, including the
    previously-uncaveated sensitivity downside figures; outbound remains provably hard-off with an
    actively-run test suite backing the compliance gate; no fabricated metric anywhere. The ship
    gate's remaining blocker this run is narrow, specific, and NOT the Factory's fault to have caused
    -- but closing it (updating two stale "unbuilt" disclosures to match code that shipped one day
    after the doc) is squarely the GTM Factory's next-run priority per GTM_STANDARD S8.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline. The gate is **still closed** this run, but the
  BLOCKER MOVED: business_case_honesty (the sole blocker for three straight runs) is now A+, and
  self_validation_honesty (previously A) dropped to B and is now the sole remaining ship-critical
  gap. `overall` tracks the worst ship-critical grade (B), consistent with this scorecard's grading
  history (Run 2, Run 5, Run 6).
- **Not a Factory regression — the new blocker was caused by the Product Factory shipping real PMF
  instrumentation (PR #912) the day after the GTM doc's last edit.** Two independent graders (one on
  self_validation_honesty, one on pmf_read_accuracy) found the identical root cause with no shared
  context, which is why both dimensions dropped together — corroboration, not noise. The fix is a
  cheap doc update (name the newly-built fields as built-but-still-null-pre-launch), not a rebuild.
- `top_gaps` is ordered by severity — the one remaining ship-critical gap first, then freshness/
  metric/experiment nits, then a trivial follow-up on a dimension already at A+.
- Each dimension's `evidence` states what was actually checked this run — every grader re-derived
  figures, re-fetched citations, re-ran the actual test suite, or reconstructed history from primary
  sources rather than trusting the Factory's self-report or a prior audit's word.
- The real launch constraint remains the owner env-connect blockers (site gate, Resend, metrics
  token, migrations) in `PENDING_OPS.md`. The self-validation gap above is worth fixing now
  regardless, since it is cheap and self-contained.
