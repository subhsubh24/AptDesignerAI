# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-07-27
  auditor_run: 4
  overall: C
  ship_gate_met: false          # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  regression_note: >-
    IMPORTANT -- most of this run's drop from Run 3 (overall A, gate MET) is the AUDITOR CORRECTING
    ITS OWN PRIOR OVER-GRADE, not the GTM Factory regressing. docs/BUSINESS_CASE.md has not changed
    since commit a680327 (2026-07-16, before Run 3 graded it A), yet it grades B this run on defects
    that were present and missed. The self_validation MRR claim has been in the file since Run 9 and
    was missed by two prior audits. Run 3 asserted "Zero findings" on three dimensions that carry
    verified findings today. Two freshness drifts (OG image, analytics events) ARE genuinely new
    since 2026-07-20. The Factory's Runs 13-14 were clean, doc-only, and opened no steer. Treating
    this as a Factory decline would itself be dishonest; it is an audit-depth correction.
  dimensions:
    metric_integrity:
      grade: A
      ship_critical: true
      evidence: >-
        Re-verified from scratch, not carried over. No connected source exists (channels_connected []
        :26, awaiting_connect true :27, all sources unavailable/degraded except gtm_scorecard :29-50),
        and correctly EVERY product metric is 0/null -- funnel :52-62, acquisition :64-67, pmf :68-74,
        email :272-276, content :278-280, outreach :281-285, experiments [] :270. I re-parsed the
        block as YAML and dumped every value to confirm rather than reading prose. The one non-zero
        value, engine_pct 100 (:25), is NOT a self-claim -- scripts/preflight.sh:444-458 recomputes it
        from 5 pinned anchor files and hard-exits on any hand-set value; all 5 anchors exist. A fresh
        adversarial grader independently re-fetched TWELVE external citations from the live web
        (First Chair 14-21 days / 4,000 variables / 47%; Baymard 87%/6%/66%/21% + new participant
        quotes; eMarketer 9hrs/13 tabs; TechCrunch Modsy; MONA) -- ALL verbatim-accurate. Zero
        fabricated, flattered, or laundered metrics. The F-cap condition is definitively not met.
      gap: >-
        Three real findings (why A, not the prior A+). (1) The per-theme source COUNT -- the single
        number gating `confidence` -- is stated four irreconcilable ways for theme 1 in one file:
        "the eMarketer citation alone" (=1, :90), "only 2 independent sources" (:106), "its existing
        3-source base" (:141), and 4 named sources in the field itself (:231). I verified this
        contradiction directly. No counting rule is defined, so the tier gate is unauditable.
        Mitigating: the error runs CONSERVATIVE (holds confidence lower), so it is anti-flattery.
        (2) The Run-14 Decorist BBB citation (:250) is the only external citation with no URL.
        (3) :243 presents a Baymard PARAPHRASE inside quote marks as verbatim -- the real sentence
        opens "When users make the effort to try AR and fail to get sufficient (or any) value out of
        the experience," which is compressed away with no ellipsis, while the same line quotes other
        figures correctly. Fix: define the counting rule and emit one count per theme; add the URL;
        restore the elided clause.
    business_case_honesty:
      grade: B
      ship_critical: true
      evidence: >-
        Re-derived cold. I ran all four committed scripts (Scenario A 46109, B 122956, C 276652,
        without-annual 99926) and scripts/validate-computation.mjs PASSes; an independent
        hand-reimplementation from the prose formula (:209-222) that imports nothing from analysis/
        reproduced all four to the dollar, so the scripts are NOT rigged to hit a target. The honest
        core holds and is not gamed -- floor_met_year1 false, time_to_floor honest, year-1 exit
        re-derived at $58,641 (doc "~$58-60K"), first $100K crossing month 39 (doc "~year 3"),
        summary YAML reconciles to the body on every field. The "annual billing is GATED OFF" claim
        is TRUE against real config (migration 021 unapplied, PENDING_OPS apply-migration-021 open,
        lib/billing/stripe.ts:47 ANNUAL_BILLING_ENABLED default off, app/pricing/page.tsx:186 hides
        the CTA); prices $29/$49/$399 match lib/billing/stripe.ts:8-11. Anti-gaming holds -- Apple
        15% SBP excluded as upside, 7% churn at the unflattering end of benchmark, the figure nearest
        the floor ($99,926) reported as BELOW it.
      gap: >-
        Three findings past nit level (why B, not the prior A). (1) TWO sensitivity figures do not
        reproduce and neither is covered by the 4-figure computation gate -- I recomputed both
        myself: monthly churn 7->12% doc says "~$85K", actual $93,556; annual renewal churn ->40%
        doc says "~$106K", actual $103,214. The second errs in the FLATTERING direction, making that
        downside look like it clears the $100K floor by $6K when it clears by $3.2K. (2) :118 states
        "Annual renewal churn | 84% (7%/mo x 12)" -- a rate-vs-probability conflation; the true
        12-month churn probability is 1-0.93^12 = 58.1%, so the annual tier's claimed "-59pp"
        advantage is really ~-33pp (repeated at :307). This overstates the durability of exactly the
        lever that carries ARR from $99,926 (below floor) to $122,956 (above). It does not corrupt
        the ARR math, which uses the separate 2.4%/mo constant. (3) Run 71's steady-state fix was
        never propagated to the scenario verdicts -- :366 calls $276,652 "the reachable ceiling
        within 12-18 months" though the doc's own analysis shows even the $122.9K base needs ~3
        years. Fix: recompute the two bullets, correct 84% to 58.1%, restate the verdicts as
        steady-state. NOT F -- nothing is gamed to clear the floor and the summary reconciles.
    experiment_validity:
      grade: C
      ship_critical: false
      evidence: >-
        experiments: [] (:270) is truthful, not merely convenient -- a grader grepped lib/, app/ and
        components/ for A/B, variant-assignment and feature-flag infrastructure and found none, so no
        live test is going unreported. No lift, effect, or causal claim is made anywhere with zero N.
        confidence has been held at "emerging" across Runs 6-14 despite five rounds of new evidence,
        which is genuine restraint. The disconfirming block carries real threats (ChatGPT as a free
        substitute, category fatigue, the AR-avoidance counter).
      gap: >-
        Four findings, one of them a methodological inversion. (1) The Run-14 Decorist "0 complaints"
        datum (:250), presented as this run's genuine disconfirming evidence, is VOID: I confirmed
        via Business of Home that Decorist SHUT DOWN in September 2022. A company with no customers
        for ~4 years mechanically has no current complaints -- an unchecked confound with no
        denominator on either side. Worse, the sign is inverted: Decorist's shutdown is a SECOND
        concierge e-design collapse alongside Modsy, i.e. CONFIRMING for theme 3, not disconfirming.
        (2) The prior scorecard's named fix -- pair each confirmation-seeking angle with a
        disconfirming query -- was not implemented and is not acknowledged anywhere; Run 13's frames
        (a complaint-aggregate search, the BBB *complaints* URL) return only negatives by
        construction, and the forward plan (:303-304) remains 100% pain-seeking. (3) First Chair,
        cited 16x and load-bearing for themes 1 and 2, is a COMPETING commercial AI interior-design
        app whose "statistics" page is a promotional CTA; the conflict is undisclosed, and the
        positioning it is used to validate (:257-259) closely mirrors First Chair's own product
        description -- yet not one direct competitor appears in `disconfirming`. (4) S10's mandated
        per-theme cited_count field is absent, so N is only assertable from contradictory prose.
    roadmap_steer_justification:
      grade: A
      ship_critical: true
      evidence: >-
        The dimension's defining test passes cleanly and was verified exhaustively. A grader
        reconstructed the FULL guarded-file history via the GitHub API after discovering the local
        clone is SHALLOW (.git/shallow present, grafted at a680327 / 2026-07-16) -- local-only git
        would have covered just 11 days and silently missed everything earlier. Across 69 ROADMAP.md
        commits (back to 2026-06-23), 5 VISION.md commits (none since 2026-07-07) and 9
        BUSINESS_CASE.md commits, ZERO are GTM-authored steers; every growth-adjacent ROADMAP edit
        carries the Product Factory trailer and cites a standard requirement, not demand data. The
        GTM-authored BUSINESS_CASE commits are recomputes that moved numbers DOWN or not at all
        (organic 50%->40%, floor_met_year1 true->false). grep of ROADMAP/VISION for every
        demand-signal source name returns zero hits. Runs 13 (dc91a91) and 14 (8c1f784) are strictly
        2-file diffs to docs/growth/; Run 14 states outright "no finding cleared the S3 bar this
        run." Indirect-steer sweep negative: no growth-filed issues, no open PRs, PENDING_OPS
        untouched. positioning_implication holds the signal recommend-only and unactioned.
      gap: >-
        One real nit (why A, not A+). :260 describes the $511-vs-$265 markup example as
        "directly-quoted" in the same breath as the genuinely directly-fetched Modsy source, while
        :239 states three lines earlier that the figure is "still WebSearch-synthesized only
        (trustpilot.com 403s)". I verified both lines. The parallel adjective puts a never-fetched
        source on the same evidentiary tier as a fetched one, in the one field carrying a pricing
        recommendation, and it has survived three runs. Graded A rather than B because the
        provenance-labeling defect is the same family already docked under metric_integrity and it
        produced no steer -- docking it fully here would double-count. Fix: one clause, relabel to
        match :239.
    self_validation_honesty:
      grade: C
      ship_critical: true
      evidence: >-
        An enormous battery of refutation tests HELD, and that is worth stating plainly: a grader
        reproduced the aptdesignerai.com unreachability verbatim by curl ("CONNECT tunnel failed,
        response 502") while baymard.com returned 200, confirming the block is host-specific and not
        a general-network excuse; the reddit.com WebFetch refusal returns the exact quoted string;
        trustpilot 403 reproduced; the "eleven probes across eleven runs" arithmetic matches real
        commit dates including the absent 07-21. The Resend fail-closed gate is REAL in code
        (lib/email/index.ts:42-43, :70-73, :84-86, :107-113). Both scorecard self-reports are TRUE
        field-by-field -- including the inconvenient one, where the Factory correctly reports the
        PRODUCT gate blocking itself as ship_gate_met false and states its own GTM A does not unlock
        outreach. Every PENDING_OPS status:open claim is true. Nothing is falsely claimed connected.
      gap: >-
        Two real gaps in the block being graded, BOTH erring self-servingly, which is the pattern
        this dimension exists to catch. (1) :38 asserts "MRR/active-subscriber/churn numbers already
        surface via internal_metrics_api once INTERNAL_METRICS_TOKEN is set." I verified this against
        the code: lib/growth/metrics.ts exposes exactly six fields and there is NO MRR field --
        grep for "mrr" across lib/growth/ and app/api/internal/ returns ZERO hits -- and churn is
        only cancelled_30d, self-documented at :36-42 as APPROXIMATE, a count not a rate. So 2 of 3
        named items are false, and the clause is load-bearing: it is the stated justification for
        keeping an unavailable source OUT of owner_blockers. Propagated to GROWTH_MEMORY.md:703
        since Run 9 and missed by two prior audits. (2) Vercel Analytics is a live dependency
        (package.json:31, app/layout.tsx:63) that CONNECT.md:87 names as the source for
        visitor/conversion metrics, and three reported values depend on it (visitors_7d,
        visitor_to_waitlist_rate, organic_sessions_7d) -- yet it is declared NOWHERE in the
        validation block, which claims to cover "every external source this agent depends on."
        The Factory wrote a 100-word entry for the Stripe half of CONNECT.md:87 and dropped the
        Vercel half. Fail-closed held on the NUMBERS (0/null is correct) but not on the DECLARATION.
        NOT F -- no metric is fabricated and no channel is falsely claimed connected.
    pmf_read_accuracy:
      grade: B
      ship_critical: false
      evidence: >-
        All pmf fields null with signal none (:68-74) and that is accurate, verified three ways
        beyond the doc's own say-so: the internal metrics route returns 503 without a token,
        lib/growth/metrics.ts shows the only queryable counts are waitlist + subscribers, and the
        product QUALITY_SCORECARD independently grades functional_reality C because persistence
        ships inert -- so no user cohort can exist. phase pre_launch is correct. The PMF firewall is
        real rather than sloganeering: a grader grepped every pmf/demand_signal occurrence repo-wide
        and found ZERO instances of demand signal being upgraded into a PMF, funnel, or
        business-case claim; demand_signal.confidence "emerging" never leaks into pmf.signal, which
        stays none. The recommendation is correctly product-oriented -- :301 names the PRODUCT
        scorecard as the most important one to watch, and there are no acquisition-scaling proposals.
      gap: >-
        No data path exists for ANY of the five pmf fields, and the doc never discloses it. There is
        no activation event, no return-cohort query and no share/referral query in
        lib/growth/metrics.ts; organic_share_rate's only schema support (migration 026) is both
        unapplied and unqueried. Net: even after all eight owner blockers land, the pmf block still
        cannot be populated. The file makes exactly this "unbuilt, not merely unconnected"
        distinction for stripe_reporting (:38) but withholds it here, so "0/null pre-launch" carries
        an unearned implicit promise of a measurement path, and no next_action or owner_blocker asks
        for activation/retention instrumentation -- pre-PMF, the highest-leverage growth-owned ask.
    compliance:
      grade: B
      ship_critical: false
      evidence: >-
        Outbound is provably hard-off and nothing was sent or posted: outreach all zeros (:281-285),
        channels_connected [] (:26), no MARKETING_HOLD or MARKETING_APPROVED record, and social
        sending is not merely unconfigured but UNBUILT (lib/growth/ contains only metrics.ts, so no
        publishing code exists that could post). Crons fail closed (503 without CRON_SECRET, then a
        constant-time token compare); marketing suppression fails closed (returns "suppress" on a
        missing admin client or a query error). ToS posture is explicit and correct --
        DEMAND_VALIDATION_PLAYBOOK.md:55-58 forbids autonomous account creation, auto-posting under
        the owner's identity, and manufactured engagement; ANALYSIS_PLAYBOOK.md:18 forbids scraping;
        OUTREACH.md is draft-only. No fabricated social proof, testimonials, or invented user counts
        anywhere. GDPR clean: real double opt-in, privacy link on /waitlist, no pre-ticked consent,
        working opt-out UI.
      gap: >-
        Two real gaps (why B, not the prior A+ -- and this DIRECTLY refutes Run 3's claim that "a
        non-compliant marketing email cannot leave the system"). (1) A marketing email can escape
        with NEITHER a physical address NOR any unsubscribe mechanism. I verified in code:
        waitlist_welcome_1 is NOT in TRANSACTIONAL_STAGES (lib/email/index.ts:70-73 lists only
        waitlist_confirm and password_reset), so the code itself classifies it as commercial -- but
        it is built by lib/email/templates/waitlist-welcome.ts, which greps clean for unsubscribe,
        physicalAddress, EMAIL_PHYSICAL and even href; its footer is prose only, the plaintext has
        no opt-out, and lib/email/resend.ts sends no List-Unsubscribe header. The gate at :107-113
        keys on the ENV VAR, not on the rendered email, so once the owner sets EMAIL_PHYSICAL_ADDRESS
        (owner_blocker PRIORITY 7) alongside RESEND_API_KEY (PRIORITY 2) the gate PASSES and the send
        goes live non-compliant. No test guards it -- the footer test covers only a lifecycle.ts
        template and the gate test never exercises this stage. Either the template must render both,
        or the stage must be reclassified transactional. (2) press-kit.md:14,:200,:247 instruct the
        owner to solicit Product Hunt upvotes from the waitlist -- against PH community guidelines
        and against the factory's own "NEVER manufacture engagement" rule. Graded B not C because
        nothing has actually been sent or posted and the defect is latent until an owner action.
    artifact_freshness:
      grade: C
      ship_critical: false
      evidence: >-
        The highest-stakes freshness item is genuinely clean and I re-confirmed it: the
        non-transactable Pro Annual tier stays quarantined -- every 399/Pro Annual occurrence in
        store-listing.md (:86-94) and press-kit.md (:162-165) sits inside the dated omission
        blockquote, and advertised pricing is only $29 one-time + $49/month, matching
        app/pricing/page.tsx:50,69 and lib/billing/stripe.ts:8-9 exactly. Canonical domain is
        uniformly aptdesignerai.com; the ai.aptdesigner.app hits are bundle IDs, not domain drift.
        Share copy in README/press-kit describing token-gated sharing became TRUE with #710.
      gap: >-
        Six verified drifts across five assets; the prior "Zero findings in the GTM assets" claim is
        falsified. Most serious: EARLY30 is an unbacked public promise on the LIVE conversion
        surface. app/waitlist/page.tsx:33 promises "30% off their first paid plan at launch. No
        promo code required," yet grep shows NO coupon exists in code (one comment in
        lib/billing/stripe.ts:136), and PENDING_OPS.md:111-116 states it plainly -- "no mechanism
        behind it ... a broken public promise" -- while email-welcome-sequence.md:114, press-kit:248,
        social-drafts:191 and content-calendar:448 all tell the owner to publicize a CODE, directly
        contradicting the live "no promo code required" copy. Also: docs/analytics.md documents 7 of
        the 10 shipped FunnelEvents, missing save_limit_paywall_shown, share_nudge_shown and
        share_nudge_clicked (verified in lib/analytics.ts:19-21) -- the two most recently shipped
        conversion levers, and the doc's own "update this table" step was skipped twice;
        press-kit.md:181 still lists the OG image as "Owner to create" though Run 118 shipped it
        (app/opengraph-image.tsx, 2026-07-26); email-welcome-sequence.md:136 and
        email-lifecycle.md:423-435 describe a pre-engine product ("you'll need to connect a webhook")
        contradicting engine_pct 100; brand-kit.md:132 gives an app name matching neither store
        listing; store-listing.md:111 still asks the owner to create a /support page that has existed
        since 2026-06-24.
  top_gaps:
    - "SHIP-CRITICAL self_validation_honesty C: GROWTH_STATUS:38 claims internal_metrics_api surfaces MRR + churn -- lib/growth/metrics.ts has NO mrr field (grep: zero hits) and only an approximate cancelled count; the false clause justifies excluding stripe_reporting from owner_blockers. Propagated to GROWTH_MEMORY:703 since Run 9."
    - "SHIP-CRITICAL self_validation_honesty C: Vercel Analytics is a live dependency (package.json:31, app/layout.tsx:63) backing visitors_7d / organic_sessions_7d, named in CONNECT.md:87, but declared nowhere in the validation block that claims to cover every external source."
    - "SHIP-CRITICAL business_case_honesty B: two sensitivity figures do not reproduce and are outside the computation gate -- churn 7->12% is $93,556 not ~$85K; annual churn ->40% is $103,214 not ~$106K (flattering direction). Plus :118's 84% annual churn is a rate/probability conflation (true 58.1%), overstating the annual tier's advantage as -59pp when it is ~-33pp."
    - "compliance B: waitlist_welcome_1 is classified marketing by lib/email/index.ts:70-73 but its template renders NO unsubscribe link and NO physical address; the gate keys on the env var not the email, so setting EMAIL_PHYSICAL_ADDRESS lets a CAN-SPAM-non-compliant email send live. Untested."
    - "artifact_freshness C: EARLY30 -- app/waitlist/page.tsx:33 promises 30% off with no promo code required, no coupon exists, and four GTM assets publicize a contradictory code. PENDING_OPS itself calls it a broken public promise."
    - "experiment_validity C: the Run-14 Decorist '0 complaints' disconfirming datum is void -- Decorist shut down in Sept 2022, so zero complaints is a dead-company artifact, and its shutdown is actually CONFIRMING for theme 3. Prior run's named sampling-frame fix was never implemented."
    - "artifact_freshness C: docs/analytics.md is missing 3 of 10 shipped funnel events (save_limit_paywall_shown, share_nudge_shown, share_nudge_clicked) -- the two newest conversion levers, in the growth loop's own measurement contract."
    - "metric_integrity A: theme 1's source count is stated four irreconcilable ways (1 / 2 / 3 / 4 named) with no counting rule, making the confidence tier gate unauditable. Errs conservative."
  notes: >-
    Run 4 (2026-07-27). SHIP GATE NOT MET -- two ship-critical dimensions fall below A
    (self_validation_honesty C, business_case_honesty B) and two non-critical dimensions fall below
    the >= B bar (experiment_validity C, artifact_freshness C). Overall C. READ THE regression_note
    ABOVE BEFORE CONCLUDING THE FACTORY REGRESSED: docs/BUSINESS_CASE.md is byte-identical to when
    Run 3 graded it A, and the self-validation MRR overstatement dates to Run 9 -- these are audit
    corrections on unchanged artifacts, and Run 3's "Zero findings" assertions on three dimensions
    are falsified. The Factory's own Runs 13-14 were clean, doc-only, opened no steer, and held
    confidence at emerging under pressure to raise it. Graded by six fresh, independent, adversarial
    per-dimension graders, every load-bearing finding then re-verified by the auditor directly: I
    re-ran the four ARR scripts and recomputed both failing sensitivity figures, confirmed the
    1-0.93^12 = 58.1% conflation, grepped lib/growth/metrics.ts for the absent MRR field, read
    lib/email/templates/waitlist-welcome.ts for the missing unsubscribe link, and confirmed
    Decorist's 2022 shutdown via Business of Home. What remains genuinely strong and should NOT be
    re-litigated: no fabricated metric anywhere (twelve external citations independently re-fetched
    and verbatim-accurate), no steer ever reached ROADMAP/VISION (full history reconstructed via the
    GitHub API past a shallow clone), outbound provably hard-off with no send or post, the Pro Annual
    quarantine and pricing consistency intact, and the ARR core reproducible to the dollar with
    nothing gamed to clear the floor. Methodological note for future runs: this repo is a SHALLOW
    clone -- local git history alone covers ~11 days and will silently miss older commits.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline. The gate is **closed** this run: `ship_gate_met`
  requires A/A+ on every ship-critical dimension and ≥ B everywhere else; four dimensions miss.
- **The drop from Run 3's A is mostly the auditor correcting itself, not the Factory sliding.**
  See `regression_note`. The business case has not changed since before it was graded A; the
  self-validation defect dates to Run 9. Deeper auditing found what two prior runs missed.
- `top_gaps` is ordered by severity — ship-critical dimensions first, then the gaps with a live
  external consequence (a non-compliant email that can actually send, a public promise with no
  mechanism behind it).
- Each dimension's `evidence` states what was actually checked, and deliberately records what
  SURVIVED refutation as well as what failed — a dimension can carry real findings and still be
  substantially honest, which is the case for self-validation here.
- The real launch constraint remains the owner env-connect blockers (site gate, Resend, metrics
  token, migrations) in `PENDING_OPS.md`. Note that two of the gaps above (the CAN-SPAM email and
  the EARLY30 coupon) become live defects **the moment** those blockers are cleared, so they should
  be fixed before, not after.
