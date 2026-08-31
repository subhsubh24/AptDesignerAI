# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-08-31
  auditor_run: 8
  overall: C
  ship_gate_met: false          # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  regression_note: >-
    Graded against Run 7 (2026-08-17, overall B, gate false, sole ship-critical blocker
    self_validation_honesty B). Both the four ★ ship-critical grades and three of four
    non-critical grades are UNCHANGED or IMPROVED this run: metric_integrity holds A,
    business_case_honesty holds A+, roadmap_steer_justification holds A+, experiment_validity
    holds A, compliance holds A, self_validation_honesty holds B, pmf_read_accuracy holds B --
    all independently re-derived by eight fresh adversarial graders, not carried forward.
    Overall still drops B->C because ONE dimension collapsed hard: artifact_freshness A->D, the
    worst single-dimension grade this project has ever received on a non-ship-critical dimension.
    This is NOT the GTM Factory fabricating or gaming anything -- no F-trigger anywhere this
    run -- but a genuinely severe, wide, newly-surfaced problem: on 2026-08-26 the OWNER (not
    the GTM Factory, not any auditor) discovered that aptdesignerai.com was NEVER REGISTERED
    (whois: "No match"), production had been 45 days stale (last deploy 2026-07-12 against a
    repo at Run 191+), Vercel Web Analytics was never enabled, and `/` had been silently
    redirecting every anonymous visitor to a login wall since the marketing landing page was
    built -- meaning the product has NEVER been exposed to a single real visitor, and the
    all-zero funnel this project has reported for ~two months was never actually market
    feedback. Filed as PENDING_OPS.md APT-69/70/71 and Linear APT-69 (already open, filed by
    the owner directly -- not duplicated here). Both the Product Factory and GTM Factory loops
    were paused (`enabled:false`) the same day, per `docs/growth/DEMAND_TEST.md`, which lays out
    a pre-committed demand test with kill criteria and states the loops stay off "not before" a
    result lands. This means Growth Agent Run 27 (2026-08-21, GROWTH_STATUS.md's current
    `as_of`) plus the follow-up commit f8a8f70 (2026-08-22, APT-42) are the LAST GTM Factory
    activity -- there has been no new GTM Factory work to grade beyond that, and none is
    possible again until the owner un-pauses the loop. This run therefore grades that
    last-active output AS IT STANDS TODAY, including how the domain revelation now reads
    against it -- exactly the maker-independent safety-net role `docs/growth/DEMAND_TEST.md`
    itself says the two weekly auditors are being kept running to perform while the factories
    are down.
  dimensions:
    metric_integrity:
      grade: A
      ship_critical: true
      evidence: >-
        Held at A, re-derived fresh. Every value in the current GROWTH_STATUS.md fenced block
        (funnel/acquisition/pmf/email/content/outreach/channels/experiments, as_of 2026-08-21)
        is genuinely 0/null/[]/none, consistent with channels_connected:[] -- no F-trigger.
        engine_pct:100 re-confirmed: all 5 preflight-checked files
        (app/api/waitlist/confirm/route.ts, lib/email/index.ts, lib/social/queue.ts,
        lib/growth/metrics.ts, docs/growth/CONNECT.md) genuinely exist. Commit f8a8f70
        (2026-08-22, APT-42) independently confirmed real: `git show --stat` shows 17
        insertions/12 deletions in GROWTH_STATUS.md, and the doc's own prescribed grep against
        current lib/growth/metrics.ts reproduces exactly as claimed (computeActivationRate,
        computeRollingRetention, churnRate30d all real; organic_share_rate the sole unbuilt
        field). `node scripts/validate-computation.mjs` -> "12 figure(s) verified... PASS";
        both cited sensitivity scripts ($60,593/$69,934) reproduce exactly on independent
        re-run. Two demand-signal citations picked at random (not previously spot-checked) were
        WebFetched against raw content: First Chair's decision-time page reproduces all three
        quoted figures verbatim. Swept the whole doc for any metric that could only exist if the
        domain-never-registered/analytics-never-enabled facts were false: none found -- the
        vercel_analytics source has been marked `unavailable` throughout its history, fully
        consistent with (not contradicted by) analytics never having been turned on.
      gap: >-
        NEW this run: the eightx.co citation (GROWTH_STATUS.md:354, :704) is labeled
        VERBATIM-VERIFIED for "$55-108 all-in" but the live source's actual text is "$55 to
        $90-plus... a midpoint around $72" -- the "$108" figure belongs to a DIFFERENT vendor
        benchmark (Optoro, a 27%-of-purchase-price figure) quoted elsewhere on the same page.
        The doc concatenated two figures from two different framings into one quoted range and
        labeled the splice verbatim. Same severity class as Run 5's RoomGPT star-rating miss
        (a citation-characterization error, not a fabricated business metric) -- held at A, not
        capped at F. CARRIED, 3rd cycle unfixed (Linear APT-44): scripts/preflight.sh's
        engine_pct computation still not invoked by any CI job. CARRIED, 2nd cycle unfixed:
        validate-gtm.mjs's metric-without-source tripwire still covers only
        funnel/acquisition/pmf/channels, not email/content/outreach/experiments.
    business_case_honesty:
      grade: A+
      ship_critical: true
      evidence: >-
        Held at A+. docs/BUSINESS_CASE.md is byte-unchanged since commit 32ea347c0 (2026-08-15,
        the exact commit Run 7 graded) -- confirmed via the GitHub API against the full history,
        not the shallow local clone. Per this scorecard's standing rule that an unchanged doc is
        NOT evidence it's still correct, re-derived fresh regardless: `node
        scripts/validate-computation.mjs` -> "12 figure(s) verified... PASS." Independently
        ran 5 of the 12 registered analysis/business_case_*.mjs scripts cold, deliberately
        picking ones not previously highlighted -- scenario_b_year1_arr.mjs -> 71207,
        without_annual_year1_arr.mjs -> 73519, without_annual_year1_web_arr.mjs -> 82873,
        scenario_a_arr.mjs -> 55989, scenario_c_arr.mjs -> 335934 -- all reproduce the doc's
        quoted figures exactly. Summary YAML reconciles to body exactly (floor_met_year1:false,
        time_to_floor states the real $71,207 year-1 figure). Full document sweep (grepped
        every "floor"/"clears"/"exceeds"/"steady-state"/"year-1" hit, hand-read each) for a
        FOURTH instance of the Run 4->5->6 disclosure-asymmetry pattern found none among live,
        current claims -- every steady-state figure still carries its year-1 caveat.
        Cross-checked docs/growth/DEMAND_TEST.md's own citation of "$71,207 year-1 exit
        run-rate against a $100,000 floor": it cites the business case's own figure and script
        exactly, introduces no new number, does not misrepresent the case.
      gap: >-
        One non-blocking observation: the dated "Take-rate correction 2026-07-28" changelog
        paragraph (docs/BUSINESS_CASE.md:79-82) states the shippable-today figures "clear the
        $100K floor" with no caveat inline, while the caveat itself lives ~380 lines below in
        the live Channel-economics table. The doc's own stated policy is to leave historical
        changelog text intact, so this is not scored as a fresh instance of the ship-critical
        pattern, but a reader stopping mid-changelog would miss it -- worth a one-line "(see
        below)" pointer. CARRIED (Linear APT-46, unchanged, low priority): Scenario C still has
        no registered year-1 script, unlike every other scenario, though it already carries its
        own qualitative steady-state caveat.
    experiment_validity:
      grade: A
      ship_critical: false
      evidence: >-
        Held at A. experiments:[] re-confirmed honest -- grepped app/, lib/, components/ and
        found only six internal ENABLE_* pipeline kill switches, none user-facing, none
        mischaracterized as experiments. Three demand-signal citations independently re-verified
        via direct WebFetch against raw pages, all verbatim-accurate: eMarketer (Dan Bennett
        quote reproduces exactly), Wayfair (4.9/5, 2.5M ratings confirmed; Jami303's dated
        review quote reproduces exactly and is genuinely theme-1-specific), Havenly (4.4/5,
        4.9K ratings confirmed). counting_rule independently recounted for themes 1 and 3
        against their actual sources text -- both correct, no inflation. disconfirming[] carries
        genuine two-sided counter-evidence, not one-sided pain-seeking. The Run 26-27 Provoke
        Insights PDF thread is a strong discipline signal: the doc pip-installed pymupdf,
        extracted all 35 pages, grepped for every claim WebSearch's synthesis had attributed to
        it, found zero hits, and correctly recorded a confirmed misattribution as an honest
        negative rather than citing it -- the third such catch. positioning_implication stays
        qualitative, explicitly "NOWHERE NEAR the S3 bar" for a steer.
      gap: >-
        CARRIED, now unfixed across Auditor Runs 6, 7, AND this run, plus 8+ Growth-Agent runs
        touching the doc (Linear APT-45): GROWTH_STATUS.md:720 still tallies theme 4's dead
        ends as "six consecutive dedicated attempts (Runs 14, 17, 19, 20, 21, 22)." Independently
        pulled Run 19's own unedited contemporaneous note (:432-439) again this run: it targeted
        theme 3 (confirming) and theme 1 (disconfirming) -- no theme-4 action is described. The
        correct count is five (Runs 14, 17, 20, 21, 22), not six. Cosmetic (doesn't inflate
        cited_count or confidence), but its persistence across three independent audit cycles
        despite trivial fix cost is itself now a process finding worth naming, not just the
        miscount.
    roadmap_steer_justification:
      grade: A+
      ship_critical: true
      evidence: >-
        Held at A+, re-verified fresh via the GitHub API (local clone reconfirmed shallow).
        `list_commits` with path filters on ROADMAP.md, VISION.md, and docs/BUSINESS_CASE.md,
        since 2026-08-17, all return EMPTY -- zero commits to any steering-governed file in the
        two weeks since Run 7, through today. Sanity-checked the tool itself works (an unfiltered
        call on the same path returns real history). f8a8f70 (APT-42) touches only
        GROWTH_STATUS.md, confirmed via get_commit stats -- not a steer. docs/growth/DEMAND_TEST.md
        (commit 961f8a8) is authored by the human owner (Subh Mukherjee), not the GTM Factory
        loop, and edits only PENDING_OPS.md and its own new file -- no ROADMAP/VISION/
        BUSINESS_CASE touch, and its own commit message states it is pausing both factories, an
        owner-level action, not a GTM-authored roadmap steer. PR #994 (the root-redirect fix) is
        owner-authored and owner-merged with no growth-doc touch -- a plain infra bug fix outside
        GTM's remit, not a steering-authority action. Linear and GitHub issue search for any
        roadmap-steer/vision-pivot item since 2026-08-17: zero found. GROWTH_STATUS.md's own
        `overall_strength: emerging` and `positioning_implication` still self-disclaim reaching
        the steer bar.
      gap: >-
        None found. Every commit touching a steering-governed file since Run 7 was checked
        individually via the GitHub API (there were zero); the one file that reads like a
        "steer" in spirit, DEMAND_TEST.md, is correctly outside this dimension's scope on both
        authorship and mechanism.
    self_validation_honesty:
      grade: B
      ship_critical: true
      evidence: >-
        Held at B -- Run 7's specific finding (the stale pmf.unbuilt_disclosure/stripe_reporting
        text) IS genuinely fixed and holds up: `git show f8a8f70` confirms the rewrite, and a
        fresh grep of the LIVE lib/growth/metrics.ts today still matches the doc's current
        claims (computeActivationRate/computeRollingRetention/churnRate30d real and wired;
        organic_share_rate/mrr_usd the only genuinely unbuilt fields). That portion has not
        regressed. But a SEPARATE, deeper instance of the same failure mode is now understood
        for what it is: the `internal_metrics_api` validation entry (GROWTH_STATUS.md:30-32)
        attributes 27 consecutive connection failures to "this agent's own runtime has no
        outbound network path to aptdesignerai.com," cross-checked only against agent-proxy
        relay logs, and states as established fact that "resolving JUST the aptdesignerai.com
        egress path... would unblock this source." PENDING_OPS.md APT-69 (owner-filed,
        2026-08-26) confirms via whois/dig that the domain was never registered -- there is no
        host, so no egress-path fix could ever have worked. The vercel_analytics entry similarly
        never asks whether Analytics is actually enabled on the Vercel dashboard, framing the
        gap purely as "no read access from this runtime." Both entries are live and unrevised as
        of today (GROWTH_STATUS.md as_of is still 2026-08-21; the Factory paused 2026-08-26
        before it could update them) -- a confident, specific causal claim the artifacts now
        contradict, which is exactly this rubric's target failure mode, regardless of whether it
        was reasonable good-faith inference at the time it was written. Carried-forward nits
        both fixed: vercel_analytics package.json citation correctly reads :35; the
        confidence->overall_strength rename is complete and consistent.
      gap: >-
        SHIP-CRITICAL, unresolved. GROWTH_STATUS.md's validation block still actively points a
        reader toward fixes (set INTERNAL_METRICS_TOKEN, grant Vercel API read access) that
        cannot work, when the real, now-known blocker (no registered domain) requires a
        completely different owner action. Not a fabrication -- the funnel stayed honestly
        null throughout, and the misdiagnosis reads as a genuine blind spot (a whois/dig check
        was never attempted across 27 runs, not obviously self-serving) rather than bad faith --
        but it is a live, current inaccuracy in the project's source of truth. Not fixable by
        the GTM Factory today since it is paused; the fix (rewrite internal_metrics_api and
        vercel_analytics to point at APT-69/70/71 as the real root cause, and drop the
        egress-path framing) is queued as this run's top-priority GTM-quality issue for
        whenever the loop resumes.
    pmf_read_accuracy:
      grade: B
      ship_critical: false
      evidence: >-
        Held at B, same root cause as self_validation_honesty, independently re-derived. The
        literal `pmf:` block (GROWTH_STATUS.md:71-92) is clean: signal:none, all leading
        indicators null, phase:pre_launch correct, site_gate_up:false correct. No
        acquisition-scaling recommendation anywhere in next_actions/owner_blockers -- every item
        is env-var/instrumentation/product work. demand_signal stays explicitly labeled "never
        PMF," zero cross-contamination found. But the surrounding diagnostic narrative that
        explains WHY PMF stayed unmeasured was materially wrong for 27 runs and 55 days: the
        identical "connect_rejected/gateway 502" signature repeated unchanged never once
        triggered the question "does this host exist at all" (zero mentions of
        whois/DNS/domain-registration anywhere in the doc's history). The framing functioned as
        an accidental excuse that insulated "we have never actually tested demand" from being
        stated plainly -- docs/growth/DEMAND_TEST.md's own read ("we have evidence neither for
        nor against this business") is a more accurate PMF read than 27 runs of Factory output
        produced, and it took the owner, not the loop, to find it.
      gap: >-
        Same underlying gap as self_validation_honesty, surfacing here as a PMF-narrative
        accuracy issue rather than a validation-block accuracy issue -- one root cause, two
        rubric dimensions, consistent with how Run 7 handled the prior pairing. Fix is the same
        edit: once GROWTH_STATUS.md's internal_metrics_api/vercel_analytics text is corrected,
        this dimension's gap closes with it.
    compliance:
      grade: A
      ship_critical: false
      evidence: >-
        Held at A. Test suite actually re-run this cycle (npm install was needed, node_modules
        absent): __tests__/email/waitlist-welcome-footer.test.ts,
        __tests__/api/waitlist-unsubscribe.test.ts, __tests__/email/email.test.ts -- 3 files, 25
        tests, ALL PASSING. requiresPhysicalAddress() gate (lib/email/index.ts) re-read in full,
        still force-dry-runs every marketing-lifecycle stage until EMAIL_PHYSICAL_ADDRESS is
        set; RESEND_API_KEY/EMAIL_PHYSICAL_ADDRESS confirmed genuinely unset in this session's
        own environment. channels_connected:[] and OUTREACH.md's drafted_7d/owner_sent_7d/
        replies_7d all honestly 0. Checked every commit since 2026-08-17 touching lib/email/,
        app/api/waitlist/, or supabase/migrations/ via the GitHub API: one email commit (an N+1
        batching fix preserving the same fail-closed opt-out semantics, read directly) and one
        unrelated migration (mobile push tokens) -- no compliance regression. Migration 031
        remains unapplied to prod, unchanged gap.
      gap: >-
        Same two minor, disclosed gaps as Run 7: the compliance gate keys on the env var being
        set rather than inspecting rendered content (mitigated by the pinning test, not
        structurally fixed); migration 031 still unapplied. One latent (not live) new
        observation: DEFAULT_FROM (lib/email/index.ts) references the unregistered domain, so
        SPF/DKIM cannot authenticate it yet -- but this is dry-run-only today (no key set) and
        already implicitly covered by PENDING_OPS.md's reconcile-canonical-domain item, not a
        new standalone gap.
    artifact_freshness:
      grade: D
      ship_critical: false
      evidence: >-
        DOWN sharply from A -- the worst single-dimension grade this project has received on a
        non-ship-critical dimension. Judgment call: this IS scored as a Factory-attributable
        artifact-freshness defect, not excused as outside its practical reach. The rubric's own
        text names "no stale... domain... claim" explicitly in scope, and a whois/dig check is
        no harder than the citation-verification work this Factory already performs routinely.
        More pointed: the Factory HAD the signal every single run -- 27 consecutive probes of
        aptdesignerai.com returning connect_rejected/gateway 502 -- and explained it away as
        sandbox network policy rather than testing the cheaper, ultimately correct hypothesis.
        Live evidence, as of TODAY (2026-08-31): docs/store-listing.md (10 refs, last touched
        2026-08-19, including live support/privacy/terms URLs App Store reviewers would follow),
        docs/press-kit.md (2 refs), docs/content-calendar.md (1), docs/email-lifecycle.md (2),
        docs/email-welcome-sequence.md (1), and docs/app-privacy.md (3, touched 2026-08-26 itself
        by an unrelated PR that did NOT fix the domain claim) all still assert
        aptdesignerai.com as live/canonical, unquarantined, five days after APT-69/70/71
        confirmed it was never registered. mobile/app.json's ios.associatedDomains and
        lib/email/index.ts's DEFAULT_FROM both still point at it too. What held clean: the
        FunnelEvent/docs.analytics.md 11-member count still matches (no new undocumented event);
        Pro Annual quarantine intact, every $399 mention still inside its dated note, matching
        ANNUAL_BILLING_ENABLED still gated off.
      gap: >-
        Systemic, not a single named spot-fix: nearly every customer-facing GTM asset plus
        native app config still names a domain confirmed not to exist. Not scored as F (the
        rubric's automatic-F trigger is a fabricated/gamed CLAIM; this is an honestly
        self-discovered and openly disclosed infrastructure gap, not invented or flattered, and
        the response -- pausing both factories -- was the correct one). Not held at B either:
        this spans nearly the entire GTM asset surface and was preceded by 27 runs that had the
        diagnostic signal and explained it away rather than checked it, which is a real
        diligence miss squarely inside this dimension's remit. Fix (queued as a GTM-quality
        issue, blocked on the GTM Factory resuming): either quarantine every
        aptdesignerai.com reference the same way Pro Annual was quarantined, or mark the
        affected docs not-submission-ready until APT-69/70/71 close.
  top_gaps:
    - "SHIP-CRITICAL self_validation_honesty B (+ pmf_read_accuracy B, same root cause, held from Run 7): GROWTH_STATUS.md's internal_metrics_api and vercel_analytics validation entries still actively point toward fixes (INTERNAL_METRICS_TOKEN, egress-path resolution, Vercel API read access) that cannot work now that PENDING_OPS.md APT-69 (owner-filed 2026-08-26) has confirmed aptdesignerai.com was never registered and Vercel Analytics was never enabled. Not a fabrication -- funnel stayed honestly null throughout -- but a live, confidently-wrong root-cause claim in the project's source of truth. Not fixable today (GTM Factory is paused); queued as this run's top priority for whenever it resumes."
    - "artifact_freshness A -> D (new, severe, non-ship-critical but the largest single-dimension drop this project has recorded): docs/store-listing.md, press-kit.md, content-calendar.md, email-lifecycle.md, email-welcome-sequence.md, app-privacy.md, mobile/app.json, and lib/email's DEFAULT_FROM all still assert aptdesignerai.com as the live/canonical domain, unquarantined, 5 days after APT-69/70/71 confirmed it was never registered -- including App Store Connect submission copy. Needs the same quarantine treatment already proven for Pro Annual."
    - "pmf_read_accuracy B (same root cause as self_validation_honesty): the 'network policy' framing functioned as an accidental excuse that delayed recognizing 'we have never actually tested demand' for 27 runs / 55 days -- docs/growth/DEMAND_TEST.md's own read is a more accurate PMF statement than anything the GTM Factory itself produced in that span."
    - "metric_integrity A (nit, new instance): the eightx.co '$55-108 all-in' citation (GROWTH_STATUS.md:354, :704) is labeled VERBATIM-VERIFIED but splices two figures from two different framings on the source page. Plus carried, unfixed a 3rd cycle: engine_pct not CI-enforced (Linear APT-44); validate-gtm.mjs's tripwire still doesn't cover email/content/outreach/experiments."
    - "experiment_validity A (nit, unfixed a 3rd audit cycle + 8 Growth-Agent runs, Linear APT-45): theme-4's 'six consecutive dead ends' tally is still wrong -- the real count is five (Run 19 never targeted theme 4, per its own contemporaneous note)."
    - "business_case_honesty A+ (near-exemplary follow-up, Linear APT-46, unchanged): Scenario C still lacks a registered year-1 script, though it already carries its own qualitative caveat."
  notes: >-
    Run 8 (2026-08-31), 14 days after Run 7. Graded with eight fresh, independent, adversarial
    per-dimension graders on Sonnet (this project runs SONNET-MAX; no Opus requested for the
    Auditor or any subagent), each explicitly re-deriving evidence rather than trusting the
    Factory's self-report or the prior scorecard -- consistent with this project's standing
    methodology since Run 4. OVERALL AND SHIP GATE: both factories were paused by the OWNER on
    2026-08-26 (docs/growth/DEMAND_TEST.md) after discovering aptdesignerai.com was never
    registered, production was 45 days stale, Vercel Analytics was never enabled, and the
    marketing landing page was unreachable dead code -- so Growth Agent Run 27 (2026-08-21) plus
    the APT-42 follow-up commit (2026-08-22) is the last GTM Factory work there is to grade, and
    none will exist again until the owner re-enables the loop. Ship gate stays NOT MET on the
    same ship-critical dimension as Run 7 (self_validation_honesty B) -- genuinely unresolved,
    not newly broken, since the Factory has had no run since Run 7's fix landed in which to
    address the deeper instance of the same failure mode this audit surfaced. Overall drops one
    notch, B->C, driven almost entirely by artifact_freshness's fall to D -- the most severe
    single-dimension result this project has recorded outside an automatic-F trigger, and there
    is no F trigger here: nothing was fabricated, flattered, or gamed anywhere this run. What
    remains genuinely strong and should NOT be re-litigated: zero GTM-authored steers have EVER
    reached ROADMAP/VISION (re-verified clean via the GitHub API through today); the ARR core
    still reproduces to the dollar across every checked figure; outbound remains provably
    hard-off with an actively re-run test suite backing the compliance gate; demand-signal
    research discipline (catching three separate WebSearch-synthesis misattributions before
    citing them) is genuinely strong. The through-line across four of this run's five named gaps
    (self_validation_honesty, pmf_read_accuracy, artifact_freshness, and indirectly
    metric_integrity's engine_pct-enforcement nit) is the SAME root event: a fundamental
    infrastructure gap (no domain, no deploy, no analytics) that 27 GTM Factory runs had every
    diagnostic signal for and explained away rather than checked, which the owner caught in one
    session using tools (whois, dig) the Factory's own runtime plausibly could not reach --
    this is recorded as a real, evidence-backed finding, not editorialized as factory
    misconduct, since nothing here was gamed or invented. Per docs/growth/DEMAND_TEST.md, this
    is exactly the role the two weekly auditors are being kept running to serve while the
    factories are paused: an independent, maker-blind check on the state of things, unaffected
    by whether the loop that produced the docs is currently running.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline. The gate is **still closed**, on the same
  ship-critical dimension as last time (self_validation_honesty B) — this is not a new failure,
  it is Run 7's fix (which was real and holds) sitting next to a deeper instance of the same
  problem the Factory has not had a run since to address, because both factories are paused.
- **The big story this cycle is `artifact_freshness` A → D**, driven by a fact outside any prior
  scorecard's scope: `aptdesignerai.com` was never registered. This was discovered by the owner
  on 2026-08-26 (`docs/growth/DEMAND_TEST.md`, `PENDING_OPS.md` APT-69/70/71), not by any GTM run
  — but 27 consecutive GTM Factory runs had the exact diagnostic signal (persistent connection
  failures to that domain) and diagnosed it as a network-policy issue rather than checking
  whether the domain existed at all. Nothing was fabricated or gamed; this is graded as a real,
  severe diligence gap, not editorialized as bad faith.
- `top_gaps` is ordered by severity — the ship-critical validation-block gap first, then the new
  severe freshness gap, then the shared-root-cause PMF gap, then three small, long-carried nits.
- Each dimension's `evidence` states what was actually checked this run — eight independent
  graders each re-derived figures, re-fetched citations, re-ran the actual test suite, or
  reconstructed history from the GitHub API (this repo's local clone is confirmed shallow)
  rather than trusting the Factory's self-report or the prior audit's word.
- The real launch constraint is no longer just the owner env-connect blockers in `PENDING_OPS.md`
  — it is now the demand test itself, laid out in `docs/growth/DEMAND_TEST.md` with pre-committed
  kill criteria. Both factory loops stay paused until that test returns a result, per the owner's
  own decision; this scorecard exists to keep an honest, independent read of the project's
  written state available in the meantime.
