# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-07-06
  auditor_run: 1
  overall: C
  ship_gate_met: false          # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  dimensions:
    metric_integrity:
      grade: A
      ship_critical: true
      evidence: >-
        Every source-dependent metric in GROWTH_STATUS is 0/null: funnel (visitors/waitlist/
        trial/MRR all 0, rates null, lines 46-56), acquisition (null, 57-61), pmf (null,
        signal none, 62-68), email (list_size 0, 136-139), content (0, 142-144), outreach
        (0, signal none, 145-149). No metric is reported from a source the validation block
        marks unavailable -- no fabricated or flattered number exists. demand_signal counts
        (eMarketer "9hrs/13 tabs", 2.8/5 on 3 reviews, Baymard 87%) are each named-source
        attributed and explicitly framed as qualitative pain-signal, never a funnel/PMF number.
      gap: >-
        Nit only (why A not A+): the demand_signal confidence weak->emerging upgrade rests on
        2 of 4 themes verbatim-verified, a mild self-flatter -- but transparently capped below
        "strong" with stated reasons, so defensible.
    business_case_honesty:
      grade: F
      ship_critical: true
      evidence: >-
        The base ARR $122,900 is arithmetically correct AS A STEADY-STATE figure (re-derived:
        4,000 installs x 0.25 x 0.04 = 40 conversions; apartment 24 x $29 x 0.70 = $487;
        monthly Pro 12/0.07 = 171 subs x $34.30 = $5,865; annual Pro 4/0.024 = 167 x $23.28 =
        $3,888; MRR $10,240 x 12 = $122,880). BUT the summary YAML floor_met_year1:true and
        time_to_floor "base case exceeds the $100K floor in year 1" (BUSINESS_CASE.md:12-13)
        are contradicted by the body's own steady-state formula: those Pro pools are fed by
        only ~12+4 new subs/month, so the year-12 exit run-rate is ~$58-60K ARR, well under
        the $100K floor -- the floor is actually reached ~year 3. It is also internally
        inconsistent: Scenario A's verdict (line 202) admits the IDENTICAL steady-state model
        "requires 2-3 years to compound to $100K," yet Scenario B is stamped year-1. A gamed
        floor-timing claim + a summary that does not reconcile to the body = automatic F.
      gap: >-
        Set floor_met_year1:false and rewrite time_to_floor to the honest ramp ("$122.9K is a
        STEADY-STATE ARR; year-1 exit run-rate ~$58-60K; floor reached ~year 3 as the Pro pools
        compound"), and relabel the $122.9K figure throughout the body as steady-state, not
        year-1. The ARR magnitude, margin sensitivity, and benchmark sourcing are otherwise
        honest -- only the timing claim is the violation.
    experiment_validity:
      grade: A
      ship_critical: false
      evidence: >-
        experiments: [] is correct pre-launch with no funnel; learnings state it plainly
        ("Funnel remains 0/null ... Correct and honest: no fabrication"). No experiment claims
        a lift/result with zero N. demand_signal is handled to-spec: explicitly qualitative,
        respects correlation != causation, carries a real disconfirming[] section, and even
        self-corrects a mis-cited Hacker News URL from the prior run -- the opposite of p-hacking.
      gap: >-
        Nit (why A not A+): the confidence bump leans partly on two carried-over, not-re-verified
        themes; A+ would re-verify them before increasing confidence.
    roadmap_steer_justification:
      grade: A+
      ship_critical: true
      evidence: >-
        Verified via git that NO growth/gtm-authored commit ever modified ROADMAP.md or
        VISION.md (git log -- ROADMAP.md VISION.md shows only "roadmap:"-prefixed Product
        Factory commits; the growth:/gtm: commits touch only GTM_STANDARD.md / GROWTH_STATUS.md
        / GROWTH_MEMORY.md). demand_signal.positioning_implication states outright it is
        "NOWHERE NEAR the S3 bar ... stays qualitative pain-signal" and records the
        multi-retailer angle as a FUTURE copy pass, not actioned. Emerging, qualitative signal
        correctly held recommend-only -- the exemplary no-steer outcome.
      gap: null
    self_validation_honesty:
      grade: A
      ship_critical: true
      evidence: >-
        The validation: block declares all five external sources (internal_metrics_api,
        resend_email, stripe_reporting, site_gate, social_channels) status:unavailable with a
        concrete fail-closed reason each; channels_connected:[] is truthful (no channel falsely
        claimed connected); every unavailable source cross-checks against next_actions /
        owner_blockers. The CRON_SECRET learning shows correct fail-closed discipline (refuses
        to infer prod config from the sandbox env). Sources block itself is honest.
      gap: >-
        Nit (why A not A+): web-research dependencies (Reddit hard-blocked, Trustpilot 403) are
        documented only in prose (method_note/disconfirming), not as a structured validation:
        entry -- add a web_research source with status:degraded. NOTE: the run's ARTIFACT
        FRESHNESS gap below (a FALSE "Pro Annual correctly omitted / grep clean" self-report)
        is a self-report-accuracy miss adjacent to this dimension -- graded under freshness to
        avoid double-counting, but flagged here.
    pmf_read_accuracy:
      grade: A+
      ship_critical: false
      evidence: >-
        pmf block all null, signal:none -- accurate (no real users pre-launch). Recommendation
        is correctly product/retention-focused, not acquisition (ANALYSIS_PLAYBOOK.md). phase
        correctly held pre_launch on the marketing-maturity gate (QUALITY_SCORECARD overall C /
        ship_gate_met false). demand_signal is labeled "leading indicator, NOT PMF" and kept
        rigorously distinct from pmf.signal -- no "PMF confirmed" claimed from demand signal.
      gap: null
    compliance:
      grade: A
      ship_critical: false
      evidence: >-
        Outreach is genuinely draft-only (OUTREACH.md:11-13 "DRAFT ONLY ... cannot send")
        with honest zeros (drafted/sent/replies 0). Outbound hard-off: site_gate_up:false,
        awaiting_connect:true, channels_connected:[], every staged asset gated. Fabricated-
        metrics grep produces zero LIVE hits -- all "500+/4.9*" matches are historical memory
        files narrating PR #432's removal of those invented metrics, none in customer-facing
        copy. No fake accounts/reviews/engagement/auto-send.
      gap: >-
        Nit (why A not A+): staged email bodies carry reply-to opt-out language but not a
        rendered CAN-SPAM footer (physical postal address + one-click unsubscribe); the backing
        exists in code (migration 027 / /account opt-out) but the template should show the block.
    artifact_freshness:
      grade: B
      ship_critical: false
      evidence: >-
        Core pricing ($29 Apartment one-time, $49/mo Pro) is consistent across all GTM assets;
        domain is clean (aptdesignerai.com throughout). BUT store-listing.md:77 and :152
        prominently SELL Pro Annual ($399/yr, "Save 32% vs monthly") in both the Apple and
        Google descriptions, while migration 021 (the pro_annual tier CHECK constraint) is
        unapplied (PENDING_OPS.md apply-migration-021 status:open) -- so an annual checkout
        would fail with a Postgres constraint violation. The listing advertises a plan that
        cannot currently be transacted. Compounding it, the GTM Factory's own audit trail is
        FALSE about this: GROWTH_STATUS.md:157 and GROWTH_MEMORY.md claim it "re-checked
        store-listing ... Pro Annual correctly omitted ... grep clean, nothing leaked" --
        directly contradicted by store-listing.md:77/152.
      gap: >-
        Either strip the $399/yr Pro Annual lines from store-listing.md until migration 021 is
        applied (or gate them behind it), AND correct the false "Pro Annual omitted / grep clean"
        learnings in GROWTH_STATUS.md:157 and GROWTH_MEMORY.md so the audit trail is truthful.
  top_gaps:
    - dimension: business_case_honesty
      grade: F
      severity: 1
      summary: >-
        floor_met_year1:true / "exceeds the $100K floor in year 1" overstates a STEADY-STATE
        ARR as a year-1 result; year-1 exit run-rate is ~$58-60K, floor reached ~year 3
        (Scenario A's own model admits "2-3 years"). Ship-critical honesty violation on the
        load-bearing floor claim.
    - dimension: artifact_freshness
      grade: B
      severity: 2
      summary: >-
        store-listing.md sells Pro Annual ($399/yr) but migration 021 is unapplied so the
        annual checkout would fail; and the Factory's own learnings falsely claim the tier is
        "correctly omitted / grep clean." Advertises a non-transactable plan + false self-report.
  notes: >-
    First GTM Auditor run (bootstrap): created GTM_RUBRIC.md, this scorecard, and
    GTM_AUDIT_MEMORY.md. Graded by four fresh, independent, adversarial per-dimension graders
    (each told to REFUTE the GTM Factory's claims), then reconciled. The GTM Factory's overall
    honesty discipline is genuinely strong (6/8 dimensions A/A+ -- metric integrity, roadmap
    restraint, self-validation sources, PMF read, compliance, experiment validity), which is
    why overall is C not lower. Ship gate fails on the one ship-critical F (business-case
    year-1 floor claim). Both top gaps are specific and fixable.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline; `ship_gate_met:false` means at least one
  ship-critical dimension is below A (here: business-case honesty = F).
- `top_gaps` is ordered by severity — the GTM Factory should fix #1 (business-case honesty)
  before new GTM work, exactly as the Product Factory drives a sub-A quality dimension to A.
- Each dimension's `evidence` cites what the Auditor actually checked; `gap` names the
  specific fix to raise it to A.
