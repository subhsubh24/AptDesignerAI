# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-08-10
  auditor_run: 6
  overall: B
  ship_gate_met: false          # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  regression_note: >-
    Not a regression -- a genuine improvement run, the second in a row. Graded against Run 5
    (2026-08-03, overall B, gate false) after Growth Agent Run 19 (2026-08-03, same day as Run 5)
    claimed to fix every one of Run 5's named top_gaps, and Runs 20-22 (through 2026-08-09) added
    further research with no marketing-doc or ROADMAP/VISION/BUSINESS_CASE changes. Eight fresh,
    independent, adversarial per-dimension graders re-verified each claimed fix from scratch (ran
    every analysis/*.mjs script, re-fetched every disputed citation via WebFetch against raw
    page/JSON data, reconstructed full ROADMAP/VISION/BUSINESS_CASE history via the GitHub API past
    the shallow local clone, and independently resolved a direct dispute between the prior audit and
    the Factory's own rebuttal) rather than trusting the Factory's self-report -- consistent with
    this scorecard's standing practice. Four dimensions genuinely moved up this run:
    experiment_validity B->A, pmf_read_accuracy B->A, roadmap_steer_justification A->A+, and
    artifact_freshness C->B. self_validation_honesty held at A, but with a real result inside it: an
    explicit Run-5-vs-Factory dispute over a commit citation was independently re-litigated from
    primary GitHub evidence and resolved in the FACTORY's favor -- the prior audit's finding was
    itself wrong, and the Factory's fresh-evidence rebuttal was correct. business_case_honesty held
    at B, but Run 5's specific named finding (the shippable-today caveat) is genuinely fixed; a new,
    different instance of the identical disclosure-asymmetry pattern was found in its place (the
    sensitivity-downside figures). Overall stays B and the gate stays closed only because
    business_case_honesty (ship-critical) is still B -- every other ship-critical dimension is now
    A/A+, and the only non-critical dimension below A (artifact_freshness, B) already clears the
    ship gate's >=B bar for non-critical dimensions. One ship-critical dimension is the entire
    remaining gate blocker.
  dimensions:
    metric_integrity:
      grade: A
      ship_critical: true
      evidence: >-
        Re-verified from scratch, not carried over. The Run-5 RoomGPT star-rating mischaracterization
        (Deezy16/Leviana Grace cited as 1-star when the live page shows 2-star) is GENUINELY fixed --
        independently re-fetched the live App Store page's raw embedded JSON (not just the rendered
        summary, which itself proved subtly unreliable on a first pass): Deezy16 rating:2,
        Leviana Grace rating:2, Cellicat rating:1, all quotes verbatim-matching GROWTH_STATUS.md:530.
        The current theme-2 `sources` field sidesteps the whole risk class by attributing quotes
        without re-asserting a specific star count for those two reviewers; the original Run-16 "five
        different 1-star reviewers" text is kept append-only as historical record with Run 19's entry
        transparently documenting the correction -- the right fix pattern. Full numeric sweep of
        funnel/acquisition/pmf/email/content/outreach/channels/experiments: every value 0/null/[],
        consistent with channels_connected:[] and awaiting_connect:true -- no F-cap trigger. Six
        further citations independently re-verified via direct WebFetch/raw-HTML (eMarketer, BBB
        Havenly, TechCrunch/Modsy, eightx.co returns data, the Wayfair AR non-claim, Havenly App
        Store) -- all verbatim-accurate. engine_pct:100 re-confirmed as mechanically computed
        (scripts/preflight.sh:480-495 checks 5 real anchor files, all independently confirmed to
        exist), not a self-claim.
      gap: >-
        One new, minor process nit (why A, not A+): scripts/preflight.sh -- the only script tying
        engine_pct/engine_built to reality -- is not invoked by ANY CI job (grepped every workflow
        file: zero direct preflight.sh calls; ci.yml's own comment at line 134 confirms the RLS gate
        "lived ONLY inside preflight.sh, which no CI job runs"). CI only runs the three split-out
        validator scripts, none of which checks engine_pct. The number is honest and accurate TODAY,
        but nothing currently merge-blocks a future drift between the declared engine_pct and the
        real computed value -- it depends on someone manually running `npm run preflight`. Not
        previously disclosed. Fix: either wire scripts/preflight.sh (or an engine_pct-specific check)
        into CI, or add a disclosure that engine_pct is not CI-enforced.
    business_case_honesty:
      grade: B
      ship_critical: true
      evidence: >-
        Re-derived cold. Ran ALL 10 registered analysis/business_case_*.mjs scripts fresh: every one
        reproduces its doc-cited figure EXACTLY (Scenario A $55,989, B $149,304, C $335,934,
        without-annual store $121,339/web $136,762, year-1 exits $71,207/$73,519/$82,873, monthly-
        churn-12% sensitivity $113,604, annual-churn-40% sensitivity $125,331) -- no rounding slack
        needed. `node scripts/validate-computation.mjs` PASSes (10 figures verified); read the script
        itself and confirmed it is a real gate (runs each script twice for determinism, checks
        tolerance:1 i.e. exact-dollar matching against analysis/figures.json), not vacuous. Run 5's
        named finding is GENUINELY fixed: BOTH the Scenario-B (:340-351) and the shippable-today
        Channel-economics (:455-469) figures now carry an equivalent "steady-state, not year-1" box,
        each citing a registered script and an exact year-1 dollar figure. Apple 15%/annual-tier
        disclosures re-confirmed honestly open, not banked (PENDING_OPS.md enroll-apple-small-
        business-program and apply-migration-021 both status:open; lib/billing/stripe.ts:47 defaults
        annual billing off).
      gap: >-
        A NEW instance of the identical disclosure-asymmetry pattern Run 5 found and Run 19 fixed for
        two OTHER figures. The "What would have to change to NOT reach $100K" sensitivity section
        (:549-566) cites the monthly-churn-12% ($113,604) and annual-churn-40% ($125,331) downside
        figures -- computed via the SAME steady-state computeScenario() as the base case -- and states
        affirmatively "this downside now CLEARS the floor," with ZERO year-1 caveat. Independently
        computed both figures' year-1 exit run-rates using the doc's own computeYear1ExitRunRate():
        $60,593 (monthly-churn-12%) and $69,934 (annual-churn-40%) -- BOTH below the $100K floor, and
        both WORSE than the $71,207/$73,519 year-1 figures the doc already discloses elsewhere.
        Declaring these "clear the floor" without the same caveat the doc just added two sections
        earlier for the identical distinction is not gamed math (both figures are honestly computed
        and reproducible) but is the same disclosure-rigor gap in a new spot -- exactly the pattern
        this dimension has now surfaced twice in a row. Secondary finding: the machine-readable
        `arr_year1` YAML key (:6-9) actually holds STEADY-STATE values (56000/149300/335900, matching
        the non-year1 scripts), not year-1 values -- the key name is a misnomer that could read as an
        internal contradiction against floor_met_year1:false without reading the prose; `as_of:
        2026-07-29` is also now stale against the doc's most recent prose edit (2026-08-03). Fix: add
        the same "steady-state, not year-1" caveat (with the ~$60.6K/$69.9K year-1 reads) to both
        sensitivity bullets; rename or annotate `arr_year1` to make clear it is steady-state; bump
        `as_of`.
    experiment_validity:
      grade: A
      ship_critical: false
      evidence: >-
        Up from B, re-verified not carried over. Theme 3's Havenly App Store disconfirming datum
        (Run 5's named gap: disconfirming coverage was theme-2-only) is genuinely theme-specific and
        checks out exactly: independently WebFetched apps.apple.com id1149153371 -- 4.4/5 across 4,900
        ratings, matching the doc precisely, plus the same three quoted 1-star reviews (Sarah Groom,
        Amber_Energy, Jclor) with matching dates/star counts. The theme-4 `structurally_hard_to_
        corroborate` flag reflects genuine, diverse research discipline across Runs 14/17/20/21/22 --
        including a real methodological catch (Run 22 correctly refused to cite a WebSearch-
        synthesized AR claim after verifying it didn't trace to Wayfair's own primary source).
        counting_rule cited_count/verbatim_count independently recounted for themes 1 and 3 (and spot-
        checked 2/4) -- all internally consistent, no p-hacking in the counting itself.
        positioning_implication re-confirmed honestly qualitative, explicitly invoking GTM_STANDARD
        S10's "never a hard number, never PMF" rule, verified against the standard's actual text.
        experiments:[] re-confirmed honest: grepped app/, lib/, components/ for variant/experiment/
        feature-flag infra -- the only real hit is ROADMAP.md itself stating the experiment engine is
        an unbuilt roadmap item ("without this, 'experiments' stay hypotheses").
      gap: >-
        Two minor nits (why A, not A+). (1) Theme 1 still carries zero theme-specific disconfirming
        datum -- only one dedicated attempt since Run 5 (Run 19, an honest negative), then zero
        further attempts across Runs 20-22 (all research redirected to theme 4); honestly disclosed
        in next_actions, not hidden, but a real asymmetric-attention gap. (2) The doc's own "SIXTH
        consecutive dead end (Runs 14, 17, 19, 20, 21, 22)" tally used to justify flagging theme 4
        structurally_hard_to_corroborate is inflated by one: Run 19's own preserved method_note shows
        it targeted themes 1 and 3, not theme 4, and merely NOTED theme 4 was still thin -- the real
        count is five genuine dedicated attempts, not six. Minor but it pads the diligence tally used
        to justify stopping. Fix: correct the run count to five; direct a future run's research budget
        at theme 1's disconfirming gap specifically.
    roadmap_steer_justification:
      grade: A+
      ship_critical: true
      evidence: >-
        Up from A. Reconstructed full history via the GitHub API (owner=subhsubh24,
        repo=aptdesignerai; local clone re-confirmed shallow) rather than local git, per this
        scorecard's standing methodological note. Every commit touching ROADMAP.md/VISION.md/
        docs/BUSINESS_CASE.md since Run 5 (2026-08-03) individually classified: VISION.md had ZERO
        commits (confirmed via list_commits directly, not inferred); ROADMAP.md's two commits
        (988151466942, 3fd406397d94) are both Product-Factory housekeeping (a security-status text
        update, an auditor-count text correction) -- not GTM-authored, not steers, cite zero demand-
        signal sources; BUSINESS_CASE.md's one commit (2d079e67, Growth Agent Run 19) is a disclosure
        correction responding to the auditor's own prior finding -- full diff confirms no ARR figure
        changed, no new direction opened, self-labeled "no ROADMAP/VISION/BUSINESS_CASE steer" in
        Growth Agent Run 20's own commit message. Grep of ROADMAP.md/VISION.md for every demand-signal
        source name (eMarketer, First Chair, MONA, Baymard, BBB, TechCrunch, RoomGPT, Modsy, Havenly,
        eightx.co): zero hits in either file. search_issues for gtm/roadmap-steer/vision-pivot labels
        or phrases: zero open GTM-filed proposals. The 4-run-persistent Havenly $511-vs-$265
        provenance contradiction (Run 5's sole held-open nit) is verified genuinely fixed at the
        character level in the CURRENT live file, not just reworded: positioning_implication (:562)
        and theme-3 sources (:536) now both correctly say "WebSearch-synthesized only," in agreement.
      gap: >-
        None found. All signals green across every verification channel run this pass (GitHub-API
        history reconstruction, source-name grep, issue/PR search, direct current-state file
        inspection) -- the rubric's literal A+ bar ("exemplary: all signals green, zero findings").
    self_validation_honesty:
      grade: A
      ship_critical: true
      evidence: >-
        Independently RESOLVED a direct dispute between Run 5's own finding and the Factory's Run 19
        rebuttal, rather than picking a side by confidence. Run 5 claimed the gtm_scorecard
        validation entry's citation of commit "0e0f901" as QUALITY_SCORECARD.md's last touch "does
        not reproduce" and that the real last touch was 38a79b5. Independently, via
        mcp__github__get_commit: 0e0f9017ec7e888f9c1a9a7e752fc3732e1293e0 GENUINELY EXISTS, dated
        2026-07-27, message "quality: NINTH independent grade," and its file-stats list DOES include
        docs/quality/QUALITY_SCORECARD.md. 38a79b5's own file list does NOT include that path at all
        (it touches BUSINESS_CASE.md and 29 other files). mcp__github__list_commits on the file path
        confirms 0e0f9017... as the historically correct citation at the time it was written, and
        that the CURRENT live validation entry has already moved on to citing the true latest commit
        (15007fe, #793, 2026-08-03) -- matching list_commits' head exactly and matching the live
        QUALITY_SCORECARD.md's actual content word-for-word. VERDICT: Run 5's finding was itself
        wrong; the Factory's Run 19 rebuttal was correct and is exactly the self-validation behavior
        the rubric wants (catching a false audit claim via primary-source re-checking, not blind
        compliance) -- not a new self-validation problem. Rest of the validation block spot-checked
        clean: all PENDING_OPS.md cross-references (set-site-gate-password, connect-email-resend,
        set-metrics-token, set-email-physical-address) confirmed status:open as claimed; @vercel/
        analytics confirmed genuinely live and wired (app/layout.tsx:63 exact); full package.json
        audit found no other undeclared analytics/tracking dependency.
      gap: >-
        One trivial nit (why A, not A+): the vercel_analytics validation entry cites
        `package.json:31` for the @vercel/analytics dependency; the actual current line is 35 (the
        file has grown since the citation was written). Substance unaffected -- the dependency is
        genuinely present and wired -- but it is a stale line-number pointer. Also noted in passing
        (belongs more to this dimension or artifact_freshness than pmf, but flagged nowhere yet):
        GTM_STANDARD S10 specifies the demand_signal block should carry an `overall_strength` field;
        the live block uses `confidence` instead -- a naming drift that causes no PMF/demand-signal
        conflation but is worth a one-line rename for spec conformance. Fix: correct the line-number
        citation on next touch; consider aligning the field name to overall_strength.
    pmf_read_accuracy:
      grade: A
      ship_critical: false
      evidence: >-
        Up from B, re-verified adversarially rather than trusting the commit message. The pmf
        block's `unbuilt_disclosure` (GROWTH_STATUS.md:78-87) claims zero grep hits for the 5 pmf
        field names in lib/growth/metrics.ts and no activation/retention/referral query anywhere in
        the codebase -- independently re-ran the exact grep (zero hits, confirmed) AND read the whole
        133-line metrics.ts file (gatherGrowthMetrics() returns exactly the 6 fields the disclosure
        says it exposes) AND grepped the WHOLE repo, not just metrics.ts, for the broader "anywhere in
        the codebase" claim (zero hits). Specifically checked the one place the disclosure could have
        overstated -- the referral claim -- and found it precise: migration 026 + app/api/waitlist/
        route.ts genuinely WRITE referred_by on signup, but no file anywhere reads/aggregates it into
        a rate; the disclosure's wording ("migration 026 exists but is unqueried") matches this
        exactly, not sloppy. next_actions:619 confirmed to genuinely, accurately name the build gap
        and is correctly filed as a Product-Factory build note, not an owner_blocker. phase:pre_launch
        re-confirmed correctly gated (funnel all 0, site_gate_up:false). No PMF/demand-signal
        conflation found anywhere in GROWTH_STATUS.md or BUSINESS_CASE.md.
      gap: >-
        No findings against this dimension's own rubric text (why A, not lower) -- the one nit found
        (the demand_signal field-naming drift, `confidence` vs the standard's `overall_strength`) is
        cross-filed under self_validation_honesty above since it is a spec-conformance issue, not a
        PMF-accuracy one, and it causes no actual PMF/demand-signal bleed-through. Held at A rather
        than A+ pending a clean pass with genuinely zero cross-referenced nits anywhere in the doc.
    compliance:
      grade: A
      ship_critical: false
      evidence: >-
        Held at A with NO regression, actively checked rather than assumed. `git log --since=
        2026-08-03` on docs/growth/, lib/email/, app/api/waitlist/, supabase/migrations/ shows zero
        touches to any compliance-relevant code since Run 5 -- only status-doc commits. Re-read lib/
        email/templates/waitlist-welcome.ts (still renders the real no-login unsubscribe link + con-
        ditional EMAIL_PHYSICAL_ADDRESS) and app/api/waitlist/unsubscribe/route.ts (still genuinely
        no-login, UUID-validated, rate-limited, idempotent). Went further than reading code: RAN the
        actual test suite (__tests__/email/waitlist-welcome-footer.test.ts, __tests__/api/waitlist-
        unsubscribe.test.ts, __tests__/email/email.test.ts) -- 25/25 passing, confirming behavior, not
        just comments. requiresPhysicalAddress() gate in lib/email/index.ts still force-dry-runs every
        marketing-lifecycle stage until EMAIL_PHYSICAL_ADDRESS is set. Outbound re-confirmed provably
        hard-off (channels_connected:[], RESEND_API_KEY genuinely unset). OUTREACH.md's draft-only
        rail intact; drafted_7d/owner_sent_7d/replies_7d all honestly 0. press-kit.md's Product Hunt
        upvote-solicitation removal holds.
      gap: >-
        Same two minor, honestly-disclosed gaps as Run 5 (unchanged, why A not A+): the compliance
        gate keys on EMAIL_PHYSICAL_ADDRESS being SET rather than inspecting rendered content
        (mitigated, not structurally fixed, by the pinning test); migration 031 remains unapplied to
        prod so the unsubscribe link is code-correct but cannot yet record a real opt-out in
        production. Both are visible in PENDING_OPS.md/GROWTH_STATUS.md, not hidden.
    artifact_freshness:
      grade: B
      ship_critical: false
      evidence: >-
        Up from C, but a genuinely different verification than Run 5's, not a carry-forward. Both
        Run-5-named findings independently confirmed fixed against CURRENT code: lib/analytics.ts's
        FunnelEvent union has exactly 11 members today (git log since Run 5 shows only one unrelated
        RLS-security commit touching that file -- no 12th event has shipped), and docs/analytics.md's
        table + "covers all 11" footnote both match; docs/email-welcome-sequence.md now correctly
        distinguishes Email 1 (verified against app/api/waitlist/confirm/route.ts -- genuinely calls
        sendEmail() directly, code-complete, only env-gated) from Emails 2-4 (verified against
        vercel.json's actual cron list -- genuinely no waitlist-day-N cron exists). Pro Annual
        quarantine, $29/$49/$399-gated pricing consistency, and canonical-domain consistency all
        re-confirmed clean with no regression; sampled five further docs/growth/*.md playbooks with no
        other stale claim found.
      gap: >-
        The exact PATTERN this dimension has now flagged twice (Run 4's finding recurred once already
        by Run 5) has recurred a THIRD time, in a lesser but real form, in a sibling file:
        docs/email-lifecycle.md's own top banner (lines 6-7) still reads "Do not send until the owner
        connects the email platform (e.g. Resend, Loops, Mailchimp) and approves each sequence" --
        directly contradicting that SAME file's own "Delivery notes for owner" section 400+ lines
        below, which correctly states Resend is already wired and no Loops/Mailchimp integration is
        needed. The detailed fix was applied surgically at the bottom; the more visible top-of-file
        banner was left stale -- the identical failure shape named twice before. Separately confirmed
        NO structural guard exists to prevent recurrence: grepped scripts/preflight.sh and scripts/
        validate-gtm.mjs in full -- zero references tying FunnelEvent's member count to docs/
        analytics.md's documented count, something Run 5's own notes suggested considering. The 11/11
        match holds only because nothing has shipped to break it yet, not because anything prevents
        it breaking. Held at B, not C (both specifically-named Run-5 findings are real, verified
        fixes with zero regressions elsewhere) and not A (the underlying freshness-maintenance
        discipline gap is demonstrably still open, evidenced by a fresh instance found this run). Fix:
        correct docs/email-lifecycle.md's top banner to match its own corrected delivery-notes
        section; add a preflight/validate-gtm check tying FunnelEvent's count to docs/analytics.md so
        this class of gap cannot silently recur a fourth time.
  top_gaps:
    - "SHIP-CRITICAL business_case_honesty B: the monthly-churn-12% ($113,604) and annual-churn-40% ($125,331) sensitivity/downside figures (BUSINESS_CASE.md:549-566) are claimed to 'clear the floor' via the same steady-state formula as the already-caveated shippable-today/Scenario-B figures, but carry no 'steady-state, not year-1' caveat; independently re-derived year-1 exit run-rates are $60,593 and $69,934 -- both BELOW the $100K floor. Also: the machine-readable arr_year1 YAML key holds steady-state, not year-1, values -- a misnomer -- and as_of is stale against the doc's most recent prose edit."
    - "artifact_freshness B: docs/email-lifecycle.md's own top banner (lines 6-7) still says 'do not send until the owner connects the email platform' and names Loops/Mailchimp as open options, contradicting its own corrected 'Delivery notes for owner' section further down -- the identical narrow-fix-leaves-a-duplicate-stale pattern already named at Run 4 and Run 5, recurring a third time in a new location. No preflight/validate-gtm check ties FunnelEvent's count to docs/analytics.md, so the freshness-recurrence class remains structurally unprotected."
    - "experiment_validity A (near-exemplary nit): theme 1 still has zero theme-specific disconfirming datum after only one dedicated attempt since Run 5; separately, the 'sixth consecutive dead end' tally used to flag theme 4 structurally_hard_to_corroborate is inflated by one (Run 19's own narrative shows no theme-4 attempt that run)."
    - "metric_integrity A (nit): scripts/preflight.sh, the only script computing engine_pct/engine_built, is not invoked by any CI job -- nothing currently merge-blocks a future drift between the declared and real engine_pct."
    - "self_validation_honesty A (nit): the vercel_analytics validation entry's package.json:31 citation is stale (actual line is 35); separately, the demand_signal block uses `confidence` where GTM_STANDARD S10 specifies `overall_strength` -- a naming-conformance drift, not a conflation."
  notes: >-
    Run 6 (2026-08-10). SHIP GATE STILL NOT MET, but this is the second consecutive genuine
    improvement run: four dimensions moved up (experiment_validity B->A, pmf_read_accuracy B->A,
    roadmap_steer_justification A->A+, artifact_freshness C->B), self_validation_honesty held A while
    correctly resolving a real dispute in the Factory's favor (the prior audit's own finding was
    wrong; independently re-verified via primary GitHub evidence, not taken on either party's word),
    compliance held A with an active re-check (the test suite was actually run, not just read), and
    metric_integrity held A with the Run-5 star-rating fix independently re-confirmed against raw
    App-Store JSON. business_case_honesty held B -- but Run 5's SPECIFIC named finding (the
    shippable-today caveat) is genuinely fixed, replaced by a new, structurally identical gap
    (the sensitivity-downside figures) rather than a repeat of the same one. This is the sole
    remaining ship-critical blocker: every other ship-critical dimension is now A/A+, and
    artifact_freshness's B already clears the >=B bar required of non-critical dimensions. Graded by
    eight fresh, independent, adversarial per-dimension graders, each explicitly re-deriving figures
    (running every analysis/*.mjs script from scratch), re-fetching disputed citations against raw
    page/JSON data rather than rendered summaries, and reconstructing full ROADMAP/VISION/
    BUSINESS_CASE history via the GitHub API past the confirmed-shallow local clone -- consistent
    with this scorecard's standing methodology since Run 4. What remains genuinely strong and should
    NOT be re-litigated: zero GTM-authored steers reached ROADMAP/VISION since Run 3 (now re-verified
    clean through Run 22); the ARR core reproduces to the dollar across all 10 registered figures with
    nothing gamed; outbound remains provably hard-off with an actively-run test suite backing the
    compliance gate; no fabricated metric anywhere, including six freshly spot-checked citations. The
    ship gate's remaining blocker is narrow and specific: one ship-critical disclosure-rigor gap on
    two sensitivity figures in BUSINESS_CASE.md, a cheap, self-contained doc/model edit that mirrors
    a fix the Factory has already made twice for other figures in the same document.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline. The gate is **still closed** this run, narrower than
  ever: only ONE dimension misses the bar now (business_case_honesty B, ship-critical), down from two
  at Run 5 and four at Run 4. `overall` tracks the worst ship-critical grade (B), consistent with this
  scorecard's grading history (Run 2, Run 5).
- **This is the second consecutive genuine improvement run, not a wash.** Four dimensions moved up;
  one (self_validation_honesty) correctly caught the prior audit itself being wrong on a specific
  claim and held its grade rather than dropping it, because the Factory's rebuttal — independently
  re-verified this run — was the honest, correct outcome.
- `top_gaps` is ordered by severity — the one remaining ship-critical gap first, then the freshness
  gap, then trivial nits on dimensions already at A.
- Each dimension's `evidence` states what was actually checked this run — every grader re-derived
  figures, re-fetched citations, or reconstructed history from primary sources rather than trusting
  the Factory's self-report or a prior audit's word.
- The real launch constraint remains the owner env-connect blockers (site gate, Resend, metrics
  token, migrations) in `PENDING_OPS.md`. The business-case disclosure gap above is worth fixing now
  regardless, since it is cheap and self-contained — the Factory has already fixed the identical
  pattern twice elsewhere in the same document.
