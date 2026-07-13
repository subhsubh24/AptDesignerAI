# GTM Scorecard — AptDesignerAI

The independent GTM Auditor's grade of the GTM Factory's revenue/go-to-market work, graded
against `docs/growth/GTM_RUBRIC.md`. Written ONLY by the Auditor (maker ≠ checker); the GTM
Factory consumes this as a data signal and fixes the named gaps — it never writes this file.
The dashboard reads the fenced `GTM_SCORECARD` block below.

```yaml
GTM_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-07-13
  auditor_run: 2
  overall: B
  ship_gate_met: false          # requires A/A+ on every ship_critical dim AND >= B elsewhere
  ship_critical_dimensions: [metric_integrity, business_case_honesty, roadmap_steer_justification, self_validation_honesty]
  dimensions:
    metric_integrity:
      grade: A+
      ship_critical: true
      evidence: >-
        Went line by line: channels_connected [] (GROWTH_STATUS.md:26), awaiting_connect true (:27),
        every external source unavailable/degraded (validation: block :30-47). With NO connected
        source, every product metric is 0/null and every one is -- funnel visitors/waitlist/trial/
        paid/subs/mrr all 0, rates null (:49-59); acquisition all null (:60-64); pmf all null,
        signal none (:65-71); email list_size 0 (:152-157); content 0 (:158-161); outreach 0,
        signal none (:162-166). Zero fabricated or unsourced non-zero metrics. Every demand_signal
        external number passes the two-part test -- named-source attributed AND framed as
        qualitative pain-signal, never laundered into funnel/pmf/acquisition: eMarketer "9hrs/13
        tabs" (:115), Baymard 87% (:127), the 2.8/5-on-3-reviews and $511-vs-$265 both explicitly
        fenced as "WebSearch-synthesized only" (:119,:123). Confidence held at "emerging" (:107)
        rather than raised to "strong" despite going 2-of-4 -> 4-of-4 verbatim-verified, on the
        honest gate of per-theme source COUNT -- genuine self-restraint, the opposite of flattery.
      gap: null
    business_case_honesty:
      grade: B
      ship_critical: true
      evidence: >-
        The Run-1 F (floor_met_year1:true overstating a steady-state ARR as a year-1 result) is
        GENUINELY FIXED and re-derived independently: summary now floor_met_year1:false with an
        honest time_to_floor naming $122.9K as STEADY-STATE, year-1 exit ~$58-60K, floor ~year 3
        (BUSINESS_CASE.md:12-13); the body relabels $122.9K as steady-state at every load-bearing
        spot (:242-247, :263-266, :381-386) and now AGREES with Scenario A's "2-3 years to compound
        to $100K" (:214) instead of contradicting it. Math checks: base steady-state 4,000 x 0.25 x
        0.04 = 40 paid -> MRR $10,247 -> ARR $122,966 (:230-239); accumulating the pools over 12
        months (monthly 12/mo @ 7% churn -> ~99.7 subs; annual 4/mo @ 2.4% -> ~42.1 subs) gives
        month-12 MRR $4,887 -> ARR $58,644, matching "~$58-60K"; 0%-annual steady-state 16/0.07 x
        $34.30 + $487 = ~$99.9K, matching "~$100K baseline" (:366). Summary YAML reconciles to the
        body on all fields (floor_met_year1, time_to_floor, arr tiers, planning_case, floor_usd).
        Benchmarks sit within cited ranges; the 15% Apple SBP upside is correctly excluded from the
        headline (:298, anti-gaming).
      gap: >-
        Real named gap (why B, not A): the planning case attributes ~$3,880/mo = 37.9% of total MRR
        to the Pro Annual tier, which is CURRENTLY NON-TRANSACTABLE -- migration 021 is unapplied
        and ANNUAL_BILLING_ENABLED defaults OFF (PENDING_OPS.md:63-69 apply-migration-021 status:open;
        checkout route refuses pro_annual per #597). Line 67 ("Pro Annual was added in PR #98 /
        migration 021") and the whole "Pro Annual tier economics" section (:71-84) read as if annual
        is LIVE, with no disclosure that it is gated off pre-launch -- the same defect already fixed
        for store-listing.md under artifact_freshness, still present in the business case. Not F
        because the anti-gaming test passes: :366 discloses the floor essentially clears WITHOUT
        annual (~$99.9K, at the floor), so no number is gamed to clear the floor. Fix to reach A:
        add one sentence at line 67 / in the annual-economics section disclosing annual billing is
        gated OFF pending migration 021 + ANNUAL_BILLING_ENABLED (per PENDING_OPS.md), and tighten
        :366 to state the without-annual steady-state is ~$99.9K (at, not over, the floor). That
        converts the load-bearing annual assumption from "implied live" to "disclosed future lever,"
        matching the honesty already applied to the year-1 timing claim.
    experiment_validity:
      grade: A
      ship_critical: false
      evidence: >-
        experiments: [] is correct pre-launch with no funnel; learnings state it plainly ("Funnel
        remains 0/null ... no fabrication", :174). No experiment claims a lift with zero N.
        demand_signal is handled to spec: explicitly qualitative, respects correlation != causation,
        carries a real disconfirming[] section (:130-134) including the free-substitute ChatGPT
        threat and category-fatigue signal, and self-corrected a mis-cited Hacker News item id
        across runs. This run all 4 themes reached verbatim-verified (2->4 of 4) yet confidence was
        HELD at emerging rather than raised -- addressing Run 1's nit about a confidence bump leaning
        on unverified carried-over themes.
      gap: >-
        Nit (why A not A+): per-theme independent source COUNT is still thin (1-3/theme, mostly one
        per publisher); Reddit + Trustpilot remain structurally unreachable, so two themes still
        rest partly on WebSearch-synthesized (not independently re-fetched) citations.
    roadmap_steer_justification:
      grade: A+
      ship_critical: true
      evidence: >-
        Git-confirmed no GTM/Growth steer ever reached the guarded files: git log -- ROADMAP.md
        VISION.md docs/BUSINESS_CASE.md shows only Product-Factory / doc-loop commits; the only
        growth-prefixed commit in history touches STORE_GROWTH, not ROADMAP/VISION/BUSINESS_CASE.
        The recent BUSINESS_CASE edits (floor-timing recompute -> false, organic-share 50%->40%,
        lever crediting) are honesty CORRECTIONS making the case MORE conservative, landed by the
        Product Factory (PR #508 per GROWTH_MEMORY.md), not GTM steers. demand_signal.positioning_
        implication states outright it is "NOWHERE NEAR the S3 bar ... stays qualitative pain-signal
        ... not actioned now" (:135-149); the multi-retailer angle is reserved for a FUTURE copy
        pass. Emerging, qualitative signal correctly held recommend-only -- the exemplary no-steer
        outcome.
      gap: null
    self_validation_honesty:
      grade: A
      ship_critical: true
      evidence: >-
        The validation: block declares all six sources with status + a concrete fail-closed reason
        (:30-47); channels_connected [] is truthful; none is claimed connected. The Run-1-ADJACENT
        false-self-report pattern is GENUINELY RESOLVED -- the prior run had falsely claimed "Pro
        Annual omitted / grep clean" while store-listing.md still advertised it; this run's learnings
        claims ("store-listing.md/press-kit.md still carry the dated Pro-Annual-omitted notes,
        re-grepped"; "BUSINESS_CASE.md still reads floor_met_year1:false"; "no out-of-schema
        priority:low in PENDING_OPS.md") were each spot-checked against the actual files and ALL
        hold. The web_research:degraded structured entry was added (:45-47), addressing Run 1's A->A+
        nit. Fail-closed sandbox posture is honest: the site_gate/metrics reasons note the agent's
        own sandbox carries SITE_GATE_PASSWORD/CRON_SECRET-named values but refuse to infer prod
        config ("not used, not inferred as connected", :41,:177). Every unavailable source
        cross-checks to an open PENDING_OPS item + next_actions/owner_blockers.
      gap: >-
        Trivial nit (why A not A+): stripe_reporting (:36-38) is honestly marked unavailable but,
        unlike the other five, is not surfaced as its own dedicated owner action / PENDING_OPS item
        in next_actions/owner_blockers (only indirectly via the metrics-token path). No dishonesty --
        an incompletely-surfaced source.
    pmf_read_accuracy:
      grade: A+
      ship_critical: false
      evidence: >-
        pmf block all null, signal none (:65-71) -- accurate (no real users pre-launch).
        Recommendation is correctly product/retention-focused, not acquisition. phase correctly held
        pre_launch; the run even reads the independent QUALITY_SCORECARD B->C drop (data layer is a
        non-persistent in-memory mock) as reinforcing pre_launch and HARDENING the outreach bar, not
        loosening it (:170). demand_signal is labeled "leading indicator, NOT PMF" and kept
        rigorously distinct from pmf.signal -- no "PMF confirmed" claimed from demand signal.
      gap: null
    compliance:
      grade: A
      ship_critical: false
      evidence: >-
        Outreach is genuinely draft-only with honest zeros (outreach drafted/sent/replies 0,
        signal none, :162-166); no drafts queued this run, correct. Outbound hard-off: site_gate_up
        false, awaiting_connect true, channels_connected [], both S6 lanes gated (:175). No
        MARKETING_HOLD kill-switch and no MARKETING_APPROVED record -- consistent with PREPARE-only.
        No fabricated live metrics/social proof (all funnel 0/null). No fake accounts/reviews/
        engagement/auto-send anywhere.
      gap: >-
        Nit (carried from Run 1, why A not A+): staged email bodies carry reply-to opt-out language
        but the templates do not render a full CAN-SPAM footer (physical postal address + one-click
        unsubscribe); the backing exists in code (migration 027 / /account opt-out) but the block
        should be visible in the template. Draft-only + hard-off means zero live exposure today.
    artifact_freshness:
      grade: A
      ship_critical: false
      evidence: >-
        Run 1's B gap is FIXED. store-listing.md:84-92 and press-kit.md:162-165 now carry dated
        (2026-07-09) "Pro Annual ($399/yr) intentionally omitted" notes; the actual PRICING blocks
        advertise ONLY Apartment $29 + Pro $49/mo -- the only "$399" is inside the omission note
        describing what to re-add once migration 021 lands, NOT an advertised plan (verified via
        grep). PR #597 additionally closed the product-side risk (annual checkout was serving while
        021 was unapplied -> would charge then fail the webhook upsert; now gated behind
        ANNUAL_BILLING_ENABLED, default OFF). The false "Pro Annual omitted / grep clean" learnings
        are corrected. Core pricing ($29 one-time / $49-mo Pro) consistent across all GTM assets;
        domain clean (aptdesignerai.com throughout).
      gap: >-
        Nit (why A not A+): the docs/BUSINESS_CASE.md annual-tier wording still implies annual is
        live -- that finding is graded under business_case_honesty (top gap) to avoid
        double-counting; the customer-facing marketing assets themselves are clean.
  top_gaps:
    - dimension: business_case_honesty
      grade: B
      severity: 1
      summary: >-
        The planning case models ~37.9% of total MRR on the Pro Annual tier while annual is
        currently NON-transactable (migration 021 unapplied, ANNUAL_BILLING_ENABLED off); line 67
        + the annual-economics section imply the tier is live with no "gated off pre-launch"
        disclosure. Not F (the floor is disclosed to clear ~$99.9K WITHOUT annual, so no number is
        gamed), but a real disclosure gap on a ship-critical dimension -- the only thing keeping the
        ship gate closed. Fix: disclose annual is gated off pending 021 + the flag, and state the
        without-annual steady-state is ~$99.9K (at, not over, the floor).
  notes: >-
    Run 2 (2026-07-13). Major improvement over Run 1's overall C: both Run-1 top gaps are genuinely
    fixed -- business-case honesty's year-1 floor-timing violation (was F, issue #486 closed) and
    artifact freshness's non-transactable Pro Annual store listing + false self-report (was B, issue
    #487 -> now A). Graded by four fresh, independent, adversarial per-dimension graders on the
    ship-critical dimensions (each told to REFUTE the Factory's claims and re-derive the math), plus
    evidence-backed grading of the four non-critical dimensions. 7 of 8 dimensions are now A/A+.
    Ship gate still fails on ONE ship-critical dimension: business-case honesty holds at B because
    the business case models ~38% of planning-case MRR on the currently-gated Pro Annual tier and
    implies it is live -- a disclosure gap (NOT a gamed number; the floor clears without annual).
    Closing that single disclosure gap raises business_case_honesty to A and, with every other
    ship-critical dim at A/A+ and all non-critical dims >= A, would meet the ship gate.
```

## How to read it (owner)

- `overall` + `ship_gate_met` are the headline; `ship_gate_met:false` means at least one
  ship-critical dimension is below A (here: business-case honesty = B, the annual-tier disclosure
  gap).
- `top_gaps` is ordered by severity — the GTM Factory should fix #1 (business-case honesty)
  before new GTM work, exactly as the Product Factory drives a sub-A quality dimension to A.
- Each dimension's `evidence` cites what the Auditor actually checked; `gap` names the
  specific fix to raise it to A.
