# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-07-20
  auditor_run: 3
  overall: A
  ship_gate_met: true           # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  dimensions:
    metric_integrity:
      grade: A+
      ship_critical: true
      evidence: >-
        Verified line by line, independently: channels_connected [] (GROWTH_STATUS.md:26) +
        awaiting_connect true (:27), all six validation sources unavailable/degraded (:30-47) -- so NO
        connected source exists, and correctly EVERY product metric is 0/null: funnel visitors/waitlist/
        trial/paid/subs/mrr 0, rates null (:49-59); acquisition all null (:60-64); pmf all null,
        signal none (:65-71); email list_size 0 (:210-215); content 0 (:216-219); outreach 0, signal
        none (:220-224). Zero fabricated/unsourced non-zero business metrics -- the only non-zero value,
        engine_pct 100, is an explicitly preflight-verified CODE-completion metric, not a laundered
        funnel number. Every demand_signal external number passes the two-part test (named-source +
        URL AND framed qualitative): eMarketer "9hrs/13 tabs" (:171), Baymard 87% (:183), the softer
        "$511-vs-$265" and "2.8/5 on 3 reviews" both explicitly fenced as "WebSearch-synthesized only,
        trustpilot 403s" (:175,:179). This run's ONE new citation (Interium App Store reviews, :175) is
        a new source TYPE (real paying-customer reviews) and is correctly attributed + verbatim-fenced --
        an evidence improvement, not a fabrication. confidence held at emerging, NOT raised to strong,
        on the honest per-theme source-count gate (:92-97,:163-168) -- self-restraint, not flattery.
      gap: >-
        Trivial nit only (does not lower the grade; held A+ matching Run 2 as there is no regression and
        no actual violation): the same hard-looking external numbers (87%, 9hrs/13tabs, $511/$265, 2.8/5)
        are re-cited across themes/disconfirming/positioning prose -- a laundering RISK if a reader skims,
        though every instance is correctly attributed and fenced, so there is no violation.
    business_case_honesty:
      grade: A
      ship_critical: true
      evidence: >-
        Run 2's B gap (the planning case modeling ~38% of MRR on the non-transactable Pro Annual tier as
        if live) is GENUINELY FIXED and independently re-derived via node. Disclosure fix is real and
        complete: an explicit "Annual billing is currently GATED OFF, not live" block at the Pro Annual
        section (BUSINESS_CASE.md:101-107) AND at the without-$100K section (:406), both citing
        PENDING_OPS.md apply-migration-021 -- which I confirmed is status:open, so the "gated off" claim
        is TRUE. Every number reconciles: Scenario A $46,109 (doc ~$46,200), B $122,956 (doc ~$122,900),
        C $276,652 (doc ~$276,800), without-annual $99,926 EXACTLY ($74 below the $100K floor). Year-1
        exit run-rate re-derived from month-12 pool accumulation new*(1-(1-churn)^12)/churn = ~99.7
        monthly + 42.1 annual Pro subs -> MRR ~$4,887 -> ~$58.6K ARR, matching the doc's "~$58-60K"
        (:53-54,:283-286). Summary YAML (floor_met_year1 false, time_to_floor, arr tiers, floor_usd
        100000, planning_case base) reconciles to the body on every field. Anti-gaming holds: Apple 15%
        SBP excluded from the headline (:331-338), year-1 timing honestly false/~year-3 (not regressed),
        organic anchored at 40% (top-not-above the benchmark). Figures now mechanically reproducible via
        analysis/*.mjs + figures.json (Run 10 computation-integrity commit #631).
      gap: >-
        Trivial nits only (why A not A+; neither is a finding): (1) :406 phrases the $99,926 figure as
        "AT the floor rather than over it" when it is precisely $74 BELOW -- slightly generous wording,
        though the same doc's verification note (:32-34) states "$74 below the floor" plainly, so no
        deception. (2) summary as_of 2026-07-13 predates the 2026-07-15 Run-10 note, but that note added
        only reproducible scripts and changed no number ("No figure or number in this document changed",
        re-verified) -- benign staleness. Cosmetic; every load-bearing number is honest and reconciled.
    experiment_validity:
      grade: A
      ship_critical: false
      evidence: >-
        experiments: [] (GROWTH_STATUS.md:209) is empty and honestly justified -- the whole funnel is
        0/null pre-launch (:49-59) with the learning "no fabrication" (:232). The demand_signal
        disconfirming[] block (:186-190) is genuinely adversarial, not decorative: it carries the
        free-substitute ChatGPT threat (:188), category fatigue / "no clear winner, lightly scammy cash
        grabs" (:187), the AR-avoidance "visualization alone is insufficient" counter (:189), and
        honestly flags Reddit as an unreachable TOOLING gap "not read as disconfirming" (:190) rather
        than laundering absence into a positive. No lift/effect claimed with zero N; per-theme source
        counts honestly characterized as thin (1-3/theme), which is exactly why confidence is held at
        emerging not strong (:163-168).
      gap: >-
        Nit (why A not A+): the Run-12 demand-signal search angle deliberately targeted "AI app reviews
        using words like 'waste of money'" (:82) -- a confirmation-seeking sampling frame that selects
        for competitor-negative signal favoring the product's own positioning. Mitigated (confidence held
        flat, disconfirming section intact, thinness disclosed) so the inference stays honest, but the
        sampling method itself is biased. Fix toward A+: pair each confirmation-seeking angle with a
        disconfirming query (e.g. "people who love [competitor]" / "AI redesign that worked great").
    roadmap_steer_justification:
      grade: A+
      ship_critical: true
      evidence: >-
        Git-confirmed no GTM/Growth steer ever reached the guarded files. git log -- ROADMAP.md
        VISION.md docs/BUSINESS_CASE.md: ROADMAP.md touched only by #615 (initial doc) and #638 (a
        Product-Factory "Run 90" housekeeping ledger whose diff only updates an inline E7 status note and
        states "No ROADMAP box ticked"); VISION.md only by #615. The single growth-authored guarded-file
        commit is #631 (Growth Agent Run 10), a pure computation-integrity verification adding
        reproducible scripts and stating verbatim "No figure or number in this document changed" -- an
        honesty recompute, not a steer; the other BUSINESS_CASE annotations (Run 9 annual disclosure,
        Run 71 floor-timing) made claims MORE conservative (floor_met_year1 true->false), "No number was
        gamed." demand_signal.positioning_implication holds the signal recommend-only: "confidence held
        at emerging, NOWHERE NEAR the S3 bar for a business-case number change or a roadmap steer ...
        stays qualitative pain-signal ... worth surfacing in a FUTURE ASO/copy pass ... still not
        actioned now" (:191-207). The exemplary no-steer outcome.
      gap: null
    self_validation_honesty:
      grade: A+
      ship_critical: true
      evidence: >-
        Every named self-report spot-checked against the actual artifacts and ALL hold -- adversarial
        refutation failed on every axis. "GTM_SCORECARD unchanged since Run 9/10 (auditor_run 2, as_of
        2026-07-13, business_case_honesty B)" TRUE. "the B-grade gap is ALREADY FIXED in BUSINESS_CASE.md"
        TRUE (gated-off block :101-107, without-annual ~$99.9K :406). "Run 98's store-listing.md edit did
        not reintroduce the Pro Annual note" TRUE (git show 88a7e6f: edit only ADDED auto-renewal +
        account-deletion compliance language; the "$399" that remains is inside the intact omission note).
        "PENDING_OPS.md items still status:open" TRUE (set-site-gate-password/connect-email-resend/
        set-metrics-token/set-cron-secret/set-email-physical-address/apply-migration-021 all open, file
        as_of 2026-07-14). The six validation sources are each unavailable/degraded with concrete
        fail-closed reasons (:30-47); none claimed connected. site_gate reasoning honestly fail-closed --
        notes the agent's own sandbox carries a SITE_GATE_PASSWORD-named value but refuses to infer prod
        config (:41). The Run-2 stripe_reporting nit is CLOSED: now surfaced as its own next_action (:246)
        with honest reasoning for why it is NOT an owner_blocker (a Product-Factory build gap, no owner
        action unblocks it). Zero findings.
      gap: null
    pmf_read_accuracy:
      grade: A+
      ship_critical: false
      evidence: >-
        pmf block entirely null (activation, retention d1/d7/d30, organic_share) with signal none
        (:65-71) -- accurate pre-launch (no real users). phase pre_launch (:23). demand_signal is
        explicitly and repeatedly firewalled from PMF: block header "pre-launch demand validation
        (leading indicator, NOT PMF)" (:72), confidence note "still qualitative signal, never PMF
        (S1/S10)" (:168). No "PMF confirmed" claimed anywhere from demand signal. Recommendation is
        correctly product-oriented, not acquisition -- inline gate "pre-PMF => prioritize PRODUCT, not
        acquisition" (:71). Exemplary.
      gap: null
    compliance:
      grade: A+
      ship_critical: false
      evidence: >-
        Outbound provably hard-off, no metric fabricated. outreach block all zeros (drafted/sent/replies
        0, signal none, :220-224); channels_connected [] (:26), awaiting_connect true (:27), site_gate_up
        false (:28); whole funnel 0/null (:49-59). No docs/growth/MARKETING_HOLD and no MARKETING_APPROVED
        record exist -- consistent with PREPARE-only. The Run-2 CAN-SPAM nit is FIXED and fail-closed:
        lib/email/templates/lifecycle.ts renders EMAIL_PHYSICAL_ADDRESS in both the HTML footer (:60) and
        the plaintext unsub line (:89-91) and never invents an address (:25-28); lib/email/index.ts forces
        the DryRunProvider whenever a marketing stage would send live without the address set
        (requiresPhysicalAddress + !isEmailDryRun + missing env -> DryRunProvider, :92-98), and
        requiresPhysicalAddress (:69-71) covers every stage except the transactional waitlist_confirm --
        broader (more fail-closed) than strictly required. A non-compliant marketing email cannot leave
        the system even once RESEND_API_KEY lands.
      gap: null
    artifact_freshness:
      grade: A+
      ship_critical: false
      evidence: >-
        The non-transactable annual tier is correctly quarantined in the customer-facing assets. In both
        store-listing.md (:84-92) and press-kit.md (:162-165) every "399"/"Pro Annual"/"annual"
        occurrence sits inside a dated "intentionally omitted (2026-07-09)" blockquote citing the
        unapplied migration 021 -- none is an advertised plan. Advertised pricing is only Apartment $29
        one-time + Pro $49/month (store-listing :73-75,:158-159; press-kit :129-130,:159-160), consistent
        across both. Canonical domain uniformly aptdesignerai.com (store-listing :67,:81,:107,:113,:118,
        :153,:165; press-kit :136,:171); the only aptdesigner.ai hit under docs/ is in loop-memory.md:1113
        (an internal memory note about domain-drift, not a customer-facing asset). Zero findings in the
        GTM assets. (The BUSINESS_CASE annual wording is graded under business_case_honesty to avoid
        double-counting.)
      gap: null
  top_gaps: []
  notes: >-
    Run 3 (2026-07-20). SHIP GATE MET for the first time -- every ship-critical dimension is A/A+
    (metric_integrity A+, business_case_honesty A, roadmap_steer_justification A+, self_validation_honesty
    A+) and every non-critical dimension is A/A+. Overall A (not A+: business_case_honesty and
    experiment_validity carry real-but-trivial nits below exemplary). The single gap that kept the gate
    closed at Run 2 -- business_case_honesty B, the annual-tier disclosure gap (issue #600) -- is
    GENUINELY FIXED: docs/BUSINESS_CASE.md now carries an explicit "annual billing is GATED OFF, not
    live" disclosure at both the Pro Annual section (:101-107) and the without-$100K section (:406), and
    the without-annual figure is tightened to the correct $99,926 ($74 below the floor). Independently
    re-derived every ARR figure via node; all reconcile and are now mechanically reproducible
    (analysis/*.mjs, #631). Two non-critical dimensions ALSO rose to A+ this cycle: compliance (the Run-2
    CAN-SPAM footer nit is fixed fail-closed -- EMAIL_PHYSICAL_ADDRESS renders + marketing stages are
    force-dry-run until it is set) and artifact_freshness (annual tier cleanly quarantined, domain
    consistent). Graded by four fresh, independent, adversarial per-dimension graders (each told to
    REFUTE the Factory's claims and re-derive the math), cross-checked against direct git/file/PENDING_OPS
    verification. Issue #600 closed as resolved. No ship-critical dimension is below A, no fabricated
    metric / gamed number / speculative steer was found, so NO new gap issues are filed this run. The
    remaining paths to overall A+ are purely cosmetic (see per-dimension gap notes): tighten the "at the
    floor" wording to "$74 below", and pair confirmation-seeking demand-signal queries with disconfirming
    ones. Owner env-connect blockers (site gate / Resend / metrics token / migrations) remain the real
    launch constraint -- those are owner actions, not GTM-quality gaps.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline; `ship_gate_met:true` means every ship-critical
  dimension is A/A+ and everything else is ≥ B. As of Run 3 the GTM work clears the ship gate for
  the first time — the business-case annual-tier disclosure gap that held it closed at Run 2 is fixed.
- `top_gaps` is empty this run: no ship-critical dimension is below A and no fabricated/gamed/
  speculative finding survived adversarial verification. The only remaining improvements are the
  cosmetic A→A+ nits named in each dimension's `gap`.
- Each dimension's `evidence` cites what the Auditor actually checked; a `gap` (where present) names
  the specific trivial fix to reach A+.
- The real launch constraint is not GTM quality but the owner env-connect blockers (site gate,
  Resend, metrics token, migrations) tracked in `PENDING_OPS.md` / `GROWTH_STATUS` owner_blockers.
