# GROWTH STATUS — AptDesignerAI

The single, machine-readable source of truth for growth & marketing progress, owned by the Growth
Agent (the daily cloud routine). The factory dashboard reads the fenced GROWTH_STATUS block below,
exactly like it reads BUSINESS_CASE_SUMMARY in docs/BUSINESS_CASE.md.

## Contract (read before editing)
- The Growth Agent updates the block below every run, in the same run it does growth work.
- Real data only — never invent numbers. A metric no connected source has reported stays 0 or null.
- The block MUST be valid, parseable YAML — no invalid escapes (write $100K, never \$100K); quote any
  value containing a colon or backtick. preflight fails on a malformed block.
- Cross-project shape: identical keys across AptDesignerAI / HighlightMagic / GroceryManager.
- phase advances pre_launch -> launching -> post_launch. Post-launch is the most important window.
- as_of is stamped every update; a stale as_of is itself a signal.
- HOW to fill funnel/experiments/learnings honestly (diagnose the binding constraint, compute
  significance, never fabricate, "insufficient data" when N is small): follow the data-science
  method in docs/growth/ANALYSIS_PLAYBOOK.md.

```yaml
GROWTH_STATUS:
  project: AptDesignerAI
  as_of: 2026-08-13
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
  validation:                    # GTM_STANDARD S4 self-validation -- every external source this agent depends on; fail-closed
    - source: internal_metrics_api
      status: unavailable
      reason: "INTERNAL_METRICS_TOKEN not set on the deployment (owner action pending, PENDING_OPS.md set-metrics-token still status:open). Separately, this agent's own runtime has no outbound network path to aptdesignerai.com -- TWENTY independent probe attempts across twenty runs have each failed (2026-07-01: HTTP 403 policy denial; 2026-07-03: bare connection error; 2026-07-05/07-09: HTTP 502 'CONNECT tunnel failed'; 2026-07-11 through 08-11: connect_rejected / gateway 502 to CONNECT, cross-checked against /__agentproxy/status recentRelayFailures each time; 2026-08-13, this run (Run 24): re-probed the root URL directly via curl through the agent-proxy -- still `connect_rejected` / gateway 502 to CONNECT ('gateway answered 502 to CONNECT (policy denial or upstream failure)'), cross-checked directly against /__agentproxy/status recentRelayFailures (2026-08-13T05:10:02.502Z), identical signature to every prior run) -- the practical conclusion is unchanged across all twenty probes: no reachable path to the production host from this runtime, independent of whether the owner sets the token. This unreachability is specific to aptdesignerai.com -- it does NOT mean this runtime's network access is blocked generally (see web_research below) -- so setting INTERNAL_METRICS_TOKEN plus resolving JUST the aptdesignerai.com egress path (not a blanket network-policy fix) would unblock this source."
    - source: resend_email
      status: unavailable
      reason: "RESEND_API_KEY / RESEND_FROM_EMAIL not set (PENDING_OPS.md connect-email-resend still status:open); the email lifecycle runs in dry-run (nothing sent). Marketing-lifecycle stages (activation/win-back/paid-welcome; NOT the transactional waitlist_confirm) additionally force dry-run until EMAIL_PHYSICAL_ADDRESS is also set (lib/email/index.ts, per the GTM Auditor's CAN-SPAM footer nit) -- re-verified this run (PENDING_OPS.md set-email-physical-address still status:open) that this fail-closed gate is unchanged."
    - source: stripe_reporting
      status: unavailable
      reason: "No Stripe Reporting API integration exists in the codebase (re-grepped app/ this run -- zero hits for a reporting.stripe.com call); trial-start/conversion-rate metrics are documented in docs/growth/CONNECT.md as living in 'Stripe's reporting API' but that integration is UNBUILT, not merely unconnected -- distinct from internal_metrics_api (which reads the app's own DB and only needs INTERNAL_METRICS_TOKEN). This is a Product-Factory build gap, not a pure owner env-var connect step, so it stays out of PENDING_OPS.md/owner_blockers (no action an owner can take today would unblock it). CORRECTION (Run 15, per GTM Auditor Run 4 self_validation_honesty finding): a prior run's reason text here claimed 'MRR/active-subscriber/churn numbers already surface via internal_metrics_api once INTERNAL_METRICS_TOKEN is set' -- FALSE, re-verified directly against lib/growth/metrics.ts this run: there is no `mrr` field anywhere in that file (grep for 'mrr' across lib/growth/ and app/api/internal/ returns zero hits), so mrr_usd has NO data path once the token is set, not just an unconnected one. What DOES surface once INTERNAL_METRICS_TOKEN is set: active_subscribers and annual_subscribers are real COUNTS (queried from stripe_customers where status=active). churn_rate_30d does NOT surface as a rate -- the only churn-adjacent field is cancelled_30d, an APPROXIMATE lifetime-cancellation COUNT keyed on updated_at (self-documented in metrics.ts as approximate, not a computed rate over an active-subscriber denominator). So trial-start/paid-conversion RATE metrics (this source's actual scope) stay unbuilt, mrr_usd stays unbuilt (a real gap, not merely unconnected), and churn_rate_30d needs a Product-Factory build step (a rate computation, not a token) even after INTERNAL_METRICS_TOKEN is set -- recorded as a next_action below since it is a real, currently-undisclosed data-path gap, not an owner env-var step."
    - source: site_gate
      status: unavailable
      reason: "SITE_GATE_PASSWORD not set on the deployment (PENDING_OPS.md set-site-gate-password still status:open); site_gate_up stays false, hard-blocking pre-launch execute-mode outreach. NOTE: this agent's own sandbox env has a SITE_GATE_PASSWORD-named value present (since Run 5) -- per S4 fail-closed and Run 5/6's established reasoning, this is validator-credential scaffolding for a DIFFERENT routine's sandbox, not evidence the production Vercel deployment has it configured; not used, not inferred as connected."
    - source: vercel_analytics
      status: unavailable
      reason: "NEW declaration (Run 15, per GTM Auditor Run 4 self_validation_honesty finding -- this was a live undeclared dependency, not a fabricated metric: no visitor/session number was ever reported, but the source itself was missing from this block, which claims to cover EVERY external source depended on). @vercel/analytics is a live package.json dependency (:31) and <Analytics /> is mounted in app/layout.tsx:63, and docs/growth/CONNECT.md:87 names Vercel Analytics as the intended source for visitor/session metrics. This agent has no Vercel Analytics API/dashboard read access from this runtime, so visitors_7d, visitor_to_waitlist_rate, and organic_sessions_7d stay 0/null (correct, fail-closed) until the owner either grants this agent a read path (a Vercel API token) or reports the numbers directly. Distinct from internal_metrics_api: this is a THIRD-PARTY analytics product, not the app's own DB."
    - source: social_channels
      status: unavailable
      reason: "No social platform credentials connected (X / Instagram / TikTok / Reddit); the publishing queue stays dry-run."
    - source: web_research
      status: degraded
      reason: "WebSearch + WebFetch work broadly (baymard.com, techcrunch.com, monaverse.com, apps.apple.com, firstchair.app, bbb.org, eightx.co, deloitte.com, aboutwayfair.com were all fetched cleanly across prior runs). This run (Run 24, 2026-08-13): re-probed trustpilot.com/review/havenly.com directly via WebFetch -- still HTTP 403 Forbidden, unchanged from Run 23's finding (the 301-to-www redirect Run 23 first observed still terminates in the same Cloudflare/PerimeterX bot-block). reddit.com stays excluded from demand-mining on GTM_STANDARD S10 Responsible Builder Policy grounds (an owner DECISION, not a reachability question, unchanged since Run 16 -- not re-probed for reachability this run since the exclusion does not turn on it). No new demand-signal citation attempted this run beyond the two structural re-probes: per Run 22/23's own assessment, every genuinely distinct research angle for theme 4 has been exhausted (research_status: structurally_hard_to_corroborate, unchanged since Run 22, zero net source-count growth since Run 12), and themes 1/2/3 each already carry a theme-specific disconfirming datum as of Run 23 -- closing the last GTM Auditor Run 5 experiment_validity gap the auditor could name. Re-running the same two structural probes is the correct S10 every-run discipline; forcing a new confirming-source search this run with no genuinely new lead would be padding, not evidence-building. This run's effort instead went into re-verifying the two independent scorecards (see gtm_scorecard entry) and confirming zero GTM-owned docs drifted from the shipped product (see learnings)."
    - source: gtm_scorecard
      status: available
      reason: "docs/growth/GTM_SCORECARD.md is UNCHANGED since Run 19-23 -- still Run 5 (as_of 2026-08-03, overall B, ship_gate_met false); this run (Run 24, 2026-08-13), re-checked via the GitHub API (mcp__github__list_commits on the file path, not local git -- this session's clone is shallow) per the standing Run-19 practice: the file's most recent touching commit is still 46f5eaa (2026-08-03, 'GTM Auditor Run 5'), no newer commit exists. This is a SEPARATE gate from the PRODUCT readiness gate: GTM_STANDARD S6's outbound-readiness precondition is the independent docs/quality/QUALITY_SCORECARD.md reporting ship_gate_met, which remains FALSE. Re-checked docs/quality/QUALITY_SCORECARD.md via the GitHub API this run: also UNCHANGED since Run 23 -- still the 11th grade (as_of 2026-08-10, commit 46bee98, #857), overall C, ship_gate_met false, still FOUR sub-A ship-critical dims (functional_reality C, security_rls B, design_taste B, artifact_integrity B). Separately verified (git log, not the scorecard) that the Product Factory's same-day IDOR fix Run 23 flagged as post-dating the 11th grade (commit 236e5a3, 'fix: cross-tenant IDOR in area-analysis (critical)') is still the most recent commit touching that code path -- no regression, but also not yet re-graded by the independent auditor, so this loop does not credit it (maker != checker); ship_gate_met stays false regardless (functional_reality alone blocks it). Both S6 outreach lanes stay hard-off, unchanged conclusion for the 24th consecutive run. Also confirmed via `git log --oneline 02d155f..HEAD -- <every GTM-owned doc + ROADMAP.md + VISION.md>` that zero commits touched any GTM-owned marketing doc or the roadmap/vision since Run 23's own commit (the only diff in range is docs/loop-memory.md, a Product-Factory-owned file, 229 insertions) -- nothing to re-fix here."
  pending_approvals: []          # GTM_STANDARD S9 Tier-B channel plans awaiting owner approval -- none proposed (no data supports one yet)
  funnel:                        # REAL numbers only; 0/null until a connected source reports them
    visitors_7d: 0
    waitlist_signups_total: 0
    waitlist_signups_7d: 0
    visitor_to_waitlist_rate: null
    trial_starts_total: 0
    paid_conversions_total: 0
    trial_to_paid_rate: null
    active_subscribers: 0
    mrr_usd: 0
    churn_rate_30d: null
  acquisition:
    cac_usd: null
    ltv_usd: null
    ltv_cac_ratio: null
    top_channel: null
  pmf:                           # LEADING indicator behind the number (FACTORY_STANDARD S9); 0/null pre-launch
    activation_rate: null        # share of new users who reach first value (room photo -> useful mockup / the "aha")
    retention_d1: null
    retention_d7: null
    retention_d30: null          # a flattening return-cohort curve is the strongest PMF signal
    organic_share_rate: null     # share of new visitors arriving via shared designs / referral (self-spread)
    signal: none                 # none | weak | emerging | strong  (pre-PMF => prioritize PRODUCT, not acquisition)
    unbuilt_disclosure: >-
      ADDED Run 19, per GTM Auditor Run 5 (pmf_read_accuracy): all 5 fields above are UNBUILT, not
      merely unconnected -- `grep -n "activation_rate\|retention_d\|organic_share_rate\|activation\|
      retention\|referral" lib/growth/metrics.ts` returns zero hits (verified this run). No activation
      event, no return-cohort query, no share/referral query exists anywhere in the codebase --
      `gatherGrowthMetrics()` exposes only the 6 fields already surfaced under funnel/acquisition
      above. `null` is honest today (no source could report these even if INTERNAL_METRICS_TOKEN
      were set), but this is a real data-path gap, not just a missing owner env var -- see
      next_actions for the instrumentation ask, mirroring the same disclosure already made for
      stripe_reporting/mrr_usd.
  demand_signal:                 # GTM_STANDARD S10 -- pre-launch demand validation (leading indicator, NOT PMF)
    as_of: 2026-08-13
    method_note: >-
      Run 24 (this run, 2026-08-13): re-probed both standing structural gaps per S10's every-run
      requirement -- reddit.com stays excluded on Responsible Builder Policy grounds (an owner
      DECISION, unchanged since Run 16); trustpilot.com/review/havenly.com re-probed directly via
      WebFetch, still HTTP 403 Forbidden, unchanged. No new demand-signal search attempted this run:
      per Run 22/23's own assessment, theme 4 (AR view-in-room) is exhausted of distinct angles
      (`research_status: structurally_hard_to_corroborate`, unchanged since Run 22, zero net
      source-count growth since Run 12), and themes 1/2/3 each already carry a theme-specific
      disconfirming datum as of Run 23, closing the last gap the GTM Auditor (Run 5) named as open.
      Held `confidence` at "emerging" (unchanged) -- no new evidence either way this run. Re-verified
      PENDING_OPS.md directly: `as_of` is still 2026-08-07, unchanged since Run 21 (now spanning Runs
      21-24), and every growth-relevant item is still `status: open`. Re-probed aptdesignerai.com a
      TWENTIETH time: still `connect_rejected`/gateway 502 to CONNECT, identical signature,
      cross-checked against /__agentproxy/status recentRelayFailures (2026-08-13T05:10:02.502Z).
      CIRCUIT BREAKER still fires (24th run): the same core owner blockers remain open, unchanged
      since Run 1 (~47 days). Also re-checked both independent scorecards via the GitHub API (not the
      shallow local clone): GTM_SCORECARD unchanged (still Run 5, 2026-08-03); QUALITY_SCORECARD
      unchanged (still the 11th grade, as_of 2026-08-10) -- see `gtm_scorecard` validation entry above
      for detail; conclusion for outreach readiness is unchanged (still hard-off). Confirmed via
      `git log --oneline 02d155f..HEAD -- <every GTM-owned doc, ROADMAP.md, VISION.md>` that no commit
      touched any of them since Run 23's own commit (the only file in that diff range is
      docs/loop-memory.md, a Product-Factory-owned file) -- no consistency fix needed this run.
      Run 23 (2026-08-11): per Run 22's next_action ("redirect fresh research effort
      toward strengthening themes 1/2/3's disconfirming coverage instead... theme 1 remains a
      genuinely open angle"), targeted theme 1 (furniture-shopping choice paralysis) for a
      theme-specific disconfirming datum -- the same gap the GTM Auditor (Run 5, experiment_validity)
      named as open for themes 1, 3, and 4 (only theme 2 had one at that time). Two neutral-org
      searches came up empty first: ACSI's specialty-retailers page (theacsi.com) does not break out
      a furniture-store category at all (confirmed via direct WebFetch -- furniture stores are not a
      listed segment), and J.D. Power's 2025/2026 retail-satisfaction studies cover home-improvement
      and appliance retail, not furniture specifically. A Home Furnishings Association blog citing a
      HomeByMe/Dassault Systèmes 9,000-consumer survey (myhfa.org) turned out on direct WebFetch to
      contain zero satisfaction/ease-of-shopping data at all (only channel-behavior and AI-adoption
      stats) -- an honest negative, not cited. Pivoted to the App-Store-review-aggregate pattern
      already used for themes 2/3's disconfirming entries (RoomGPT, Havenly) and found a genuinely
      new, directly-fetched theme-1 disconfirming datum: Wayfair's own App Store page
      (apps.apple.com/us/app/wayfair-shop-all-things-home/id836767708) -- VERBATIM-VERIFIED via direct
      WebFetch: 4.9/5 average, reported by the page itself as ~2.5M ratings (cross-checked via
      WebSearch against three independent app-data aggregators -- bitrise.io, appbrain.com,
      similarweb.com -- which report 2,325,513 / 2,239,272+ / 4.9-4.87 stars respectively, i.e. the
      WebFetch figure reproduces within normal cross-aggregator variance, not a one-off hallucination)
      -- plus a verbatim, dated, named reviewer quote specifically on ease of finding/choosing:
      Jami303 (10/24/2023) -- "Wayfair makes it easy to find, all I do is filter it to what I am
      interested in." This is the largest online furniture retailer's own review surface showing a
      near-ceiling satisfaction score despite theme 1's core claim (multi-hour, no-clear-starting-
      point choice paralysis) -- a genuine, theme-specific disconfirming datum in the same evidentiary
      class as the RoomGPT/Havenly entries already accepted for themes 2/3 (see `disconfirming`
      below). Held `confidence` at "emerging" (unchanged): this closes a real, previously-named
      auditor gap (themes 1 and 3 now both carry theme-specific disconfirming; only theme 4 still
      lacks one, and it now carries an explicit `research_status: structurally_hard_to_corroborate`
      reason why) but does not add a new CONFIRMING source to any theme, so the source-count-based
      "strong" bar is unmoved. Re-probed both standing structural gaps per S10's every-run
      requirement: reddit.com stays excluded on Responsible Builder Policy grounds (an owner
      DECISION, unchanged since Run 16); trustpilot.com/review/havenly.com now issues a 301 redirect
      to www.trustpilot.com before 403ing (a mechanical change, not a new access path -- see
      `web_research` validation entry above for the full detail). Re-verified PENDING_OPS.md
      directly: `as_of` is still 2026-08-07, unchanged since Run 21 (now spanning Runs 21-23), and
      every growth-relevant item is still `status: open`. Re-probed aptdesignerai.com a NINETEENTH
      time: still `connect_rejected`/gateway 502 to CONNECT, identical signature, cross-checked
      against /__agentproxy/status recentRelayFailures (2026-08-11T05:10:06Z). CIRCUIT BREAKER still
      fires (23rd run): the same core owner blockers remain open, unchanged since Run 1 (~45 days).
      Also checked docs/quality/QUALITY_SCORECARD.md and docs/growth/GTM_SCORECARD.md directly via the
      GitHub API (not the shallow local clone) for a new independent pass since Run 22: GTM_SCORECARD
      unchanged (still Run 5, 2026-08-03); QUALITY_SCORECARD moved (11th grade, as_of 2026-08-10,
      overall held C, ship_gate_met still false, now on FOUR sub-A ship-critical dims rather than
      three) -- see `gtm_scorecard` validation entry above for detail; conclusion for outreach
      readiness is unchanged (still hard-off). Confirmed no commit touched any GTM-owned marketing doc
      since Run 21 (`git log --oneline e5e715b..HEAD -- <every GTM-owned doc>` returns only this run's
      own prior commit, 2485c8d, Run 22's own edit).
      Run 22 (2026-08-09): no new independent QUALITY_SCORECARD or GTM_SCORECARD pass
      since Run 21 (both re-verified unchanged -- as_of 2026-08-03 on both; see the gtm_scorecard
      validation entry above). Per Run 21's own next_action, targeted theme 4's one remaining
      unexplored angle: a named furniture RETAILER's own disclosed AR feature usage/satisfaction
      metric (not a research org, not an AR vendor). Result: another HONEST NEGATIVE -- the theme's
      SIXTH consecutive dead end (Runs 14, 17, 19, 20, 21, 22) -- plus one methodologically important
      finding. WebSearch's own synthesized answer claimed "Wayfair disclosed that customers using AR
      saw a 35% reduction in buyer's remorse returns" and "customers using AR features are 11x more
      likely to complete a purchase," attributed to Wayfair specifically. Direct WebFetch of Wayfair's
      OWN official page (aboutwayfair.com/augmented-reality-with-a-purpose, confirmed genuine by
      byline + corporate branding) found ZERO quantified metrics of any kind -- no returns, purchase-
      likelihood, or satisfaction figures anywhere on the page. A further targeted search of Wayfair's
      Q1 2026 and Q2 2026 earnings-call transcripts (gurufocus.com, fool.com, stockanalysis.com,
      benzinga.com) found no AR-specific engagement metric either. Traced the "35%"/"11x" figures to
      the same set of commercial AR/3D-visualization VENDOR blogs already flagged in prior runs as
      undisclosed-competitor-promotion (cylindo.com, theplanner.studio, elsner.com, 1center.co,
      orbe3d.com, fenicher.com, gigwise.com) -- the search engine's own synthesis had attributed a
      vendor's promotional claim to Wayfair with no primary Wayfair source actually saying so.
      Correctly NOT cited. This is a standing methodological caution worth recording for every future
      run, not just theme 4: a WebSearch-synthesized figure attributed to a NAMED company must be
      checked against that company's own primary source before citing, since synthesis can misattribute
      a third party's claim to a company that never made it. Per Run 21's own next_action ("if that
      also comes up empty, theme 4 should be flagged as a structurally hard-to-corroborate theme
      rather than re-attempted with the same search shape indefinitely"), theme 4 now carries a
      `research_status: structurally_hard_to_corroborate` field (see theme entry below) -- every
      genuinely distinct angle available from this loop has now been tried at least once across Runs
      5-22 with zero net source-count growth since Run 12 (2/1 unchanged). Future runs still re-probe
      the two standing structural gaps every run per S10 (both re-probed directly this run: reddit.com
      stays excluded on Responsible Builder Policy grounds, unchanged since Run 16; trustpilot.com/
      review/havenly.com re-fetched directly -- still HTTP 403 Forbidden), but do not default to a
      fresh theme-4 search cycle absent a genuinely new lead. Held `confidence` at "emerging"
      (unchanged). Re-verified PENDING_OPS.md directly: `as_of` is still 2026-08-07, unchanged since
      Run 21, and every growth-relevant item is still `status: open`. Re-probed aptdesignerai.com an
      EIGHTEENTH time: still `connect_rejected`/gateway 502 to CONNECT, identical signature,
      cross-checked against /__agentproxy/status recentRelayFailures (2026-08-09T05:08:05Z). CIRCUIT
      BREAKER still fires (22nd run): the same core owner blockers remain open, unchanged since Run 1
      (~43 days). Also confirmed via `git log --oneline e5e715b..HEAD` that the Product Factory shipped
      Runs 148-154 (through PR #843) in the interim -- CI hardening (security-invariants gate wired
      ahead of migrate), a11y/silent-catch/test-coverage fixes, and doc-only AGENTS.md changes (a
      Linear-backed board discipline note) -- none of it touches pricing, features, or any GTM-owned
      marketing doc, so no consistency fix is needed this run.
      Run 21 (2026-08-07): a new independent QUALITY_SCORECARD pass landed since Run 20
      (commit 15007fe, #793, as_of 2026-08-03, "10th independent grade") -- overall held at C
      (still capped by functional_reality, unchanged 7 cycles) but ship-critical dims below A
      dropped from 5 to 3 (store_readiness C->A, artifact_integrity B->A, security_rls A->A+ all
      recovered); ship_gate_met stays false (functional_reality C, design_taste B,
      business_case_strength B still below A) -- both S6 outreach lanes stay hard-off, unchanged
      conclusion. GTM_SCORECARD.md itself is still Run 5 (unchanged since Run 19/20; re-verified via
      `git log`). Re-spot-checked Run 19's business_case_honesty/artifact_freshness fixes are still
      live in the actual files (docs/BUSINESS_CASE.md, docs/analytics.md's 11-member FunnelEvent
      count, docs/email-welcome-sequence.md) and confirmed no commit touched any GTM-owned marketing
      doc between Run 20 and this run (`git log --oneline 113d8a8..HEAD -- <marketing docs>` empty).
      Demand-signal research this run followed Run 20's own next_action: targeted theme 4 (AR
      view-in-room trust gap, stuck at 2 cited/1 verbatim after four prior dedicated attempts) with
      the two angles it named -- a neutral consumer-research org, and a competitor's own disclosed
      AR usage/satisfaction data. Found Deloitte's "Augmented shopping: The quiet revolution" (a
      genuinely neutral, non-vendor publisher) but it carries no quantified consumer-trust data on
      read, only an unnamed retailer's self-reported conversion stats and a promotional quote --
      correctly NOT cited (neutral publisher, promotional content). Attempted to verbatim-verify
      theme 4's existing IKEA Place citation (WebSearch-synthesized only since it first appeared) and
      found IKEA Place is now a DEAD APP (apps.apple.com id1279244498 404s) -- IKEA folded its
      "scan your room" AR feature into the main IKEA app (id1452164827: 4.8/5 across 145K ratings,
      no AR-specific complaint visible in the fetched review sample). Correctly did NOT cite the main
      app's rating as theme-4 evidence either way -- 145K ratings span the whole shopping app (search,
      delivery, click-and-collect), not the AR feature specifically, so a strong aggregate with no
      visible AR complaint is inconclusive, not a real disconfirming datum; padding the doc with a
      diluted signal would be worse than an honest negative. Recorded the dead-app finding so a future
      run does not re-probe the same 404'd ID. Theme 4 count UNCHANGED (2 cited/1 verbatim) -- the
      fifth consecutive honest negative on this theme (Runs 14, 17, 19, 20, 21). Held `confidence` at
      "emerging" (unchanged). Re-verified PENDING_OPS.md directly: `as_of` is still 2026-07-28,
      unchanged since Run 17 (now spanning Runs 17-21), and every growth-relevant item is still
      `status: open`. Re-probed aptdesignerai.com a SEVENTEENTH time: still `connect_rejected`/gateway
      502 to CONNECT, identical signature, cross-checked against /__agentproxy/status
      recentRelayFailures (2026-08-07T05:14:18Z). CIRCUIT BREAKER still fires (21st run): the same
      core owner blockers remain open, unchanged since Run 1 (~41 days).
      Run 20 (2026-08-05): re-verified GTM_SCORECARD Run 5 is still the latest independent
      GTM Auditor pass (no new pass since Run 19) and independently spot-checked Run 19's fixes are
      still present in BUSINESS_CASE.md/analytics.md/email-welcome-sequence.md (see gtm_scorecard
      validation entry) -- nothing new to fix on that front this run. Per Run 19's own next_action
      ("consider a fresh angle for theme 1 that has not yet been tried: a primary retailer-side
      source... rather than another aggregate-statistics or vendor-promotional search"), targeted
      theme 1 with exactly that angle -- a returns-cost/logistics data source, not another
      shopping-time-cost aggregate -- and found a genuinely new, directly-fetched, non-competitor,
      dated source: eightx.co (a returns-analytics vendor blog, published 2026-07-01, aggregating
      NRF/Happy Returns 2025 + YouGov 2025 + ClaimLane 2026 + public 10-K filings), VERBATIM-VERIFIED:
      "Furniture's online return rate is about 22.7%, roughly 3 points above the 19.3% all-category
      online average," with "Size/space mismatch: ~58%" as "the dominant driver" of furniture returns
      and "Color/material gap: ~44%," plus a processing-cost figure of "$55-108 all-in" per large-
      furniture return. This is the first theme-1 source to quantify the DOWNSTREAM cost of getting a
      furniture decision wrong (not just the search-time cost already covered by eMarketer/First
      Chair/Baymard/HN) -- a materially different source type (returns-analytics/logistics vendor)
      than theme 1's existing set. Theme 1 moves from cited_count 4/verbatim_count 3 to 5/4. The SAME
      fresh-angle search applied to theme 4 (does AR view-in-room measurably reduce furniture returns)
      surfaced only vendor-promotional content from companies that sell AR/3D visualization TO
      furniture retailers (cylindo.com, orbe3d.com, elsner.com, theplanner.studio, sodawebmedia.com,
      1center.co -- the identical undisclosed-competitor-promotion problem already flagged for First
      Chair/glamar.io/3dcloud.com in prior runs), plus an unverifiable WebSearch-synthesized claim
      attributed to "Snap + Publicis" (4,028 shoppers, up to 58% return reduction) that a direct
      follow-up search could not trace to a checkable primary source -- and Snap itself is a
      conflicted party (sells AR ad/lens products commercially). Per this doc's standing anti-
      fabrication practice, correctly NOT cited -- an honest negative for theme 4, not a new source.
      Held `confidence` at "emerging" (unchanged): one theme (1) gained one source; theme 4 gained
      zero after a genuine attempt; S10's "strong" bar is source count + independence PER THEME, and
      three of four themes (2, 3, 4) are unchanged since Run 16/18/19. Re-probed both standing
      structural gaps per S10's every-run requirement: reddit.com stays excluded on Responsible
      Builder Policy grounds (an owner DECISION, unchanged since Run 16); trustpilot.com/review/
      havenly.com still returns HTTP 403 to direct WebFetch, re-confirmed this run. Re-probed
      aptdesignerai.com and the metrics API a SIXTEENTH time: still `connect_rejected`/gateway 502 to
      CONNECT, identical signature, cross-checked against /__agentproxy/status recentRelayFailures
      (2026-08-05T05:14:08Z/09Z). PENDING_OPS.md re-verified directly: `as_of` is still 2026-07-28,
      unchanged since Run 17 (now spanning Runs 17-20), and every growth-relevant item is still
      `status: open` (20th consecutive run, ~39 days since Run 1).
      Run 19 (2026-08-03): fixed every GTM Auditor Run 5 top_gap. In detail: the independent GTM Auditor's Run 5 pass (docs/growth/GTM_SCORECARD.md,
      as_of 2026-08-03, overall C->B) landed since Run 18 with named, dimension-specific top_gaps --
      this run's priority per GTM_STANDARD S8 was fixing those before new demand-signal work.
      METRIC_INTEGRITY fix: the auditor found Run 16's RoomGPT App Store citation mischaracterized
      2 of 5 quoted reviewers -- Deezy16 and Leviana Grace -- as "1-star" when the live page's raw
      rating field shows both are actually 2-star; unflagged through Runs 17-18. The quoted review
      TEXT was always verbatim-accurate; only the star-count characterization was wrong. Per this
      doc's append-only practice, Run 16's method_note text below is kept VERBATIM (not rewritten) --
      this is the correction. SELF_VALIDATION_HONESTY finding INDEPENDENTLY RE-CHECKED, not
      auto-applied: the auditor also flagged this doc's `gtm_scorecard` validation entry, claiming
      its "last touch 0e0f901" citation for QUALITY_SCORECARD.md "does not reproduce" and that the
      real last touch is 38a79b5. Per maker != checker this run verified rather than trusted the
      auditor's own claim -- and it does NOT hold: this session's local git is a SHALLOW clone
      (`.git/shallow` present, 50 commits deep), so re-checked via the GitHub API
      (`mcp__github__list_commits` on the file path, then `mcp__github__get_commit` on 38a79b5)
      instead of local git. Result: commit 0e0f9017ec7e888f9c1a9a7e752fc3732e1293e0 GENUINELY EXISTS
      and IS the most recent commit touching docs/quality/QUALITY_SCORECARD.md (2026-07-27, "NINTH
      independent grade... overall HELD at C") -- exactly what this doc's validation block has said
      since Run 8. Commit 38a79b5's own file list (fetched via the API) touches docs/BUSINESS_CASE.md
      (the take-rate correction), NOT docs/quality/QUALITY_SCORECARD.md at all. So the prior
      "0e0f901" citation was CORRECT and is left unchanged; the auditor's nit on this specific point
      does not reproduce. Recorded transparently (not silently ignored) since a future run or
      auditor pass should not re-assume this nit is real without re-checking it themselves.
      BUSINESS_CASE_HONESTY (ship-critical) fix: added a "steady-state, not year-1" caveat to the
      shippable-today $121,339 (store) / $136,762 (web) figures, matching the one Scenario B already
      carries -- these are computed via the identical multi-year pool-fill formula and had been
      quoted as "over the floor" with no year-1 caveat. Rather than cite the auditor's own ad-hoc
      ~$73.5K estimate, wrote and registered two new reproducible scripts
      (`analysis/business_case_without_annual_year1_arr.mjs` -> $73,519 store,
      `..._year1_web_arr.mjs` -> $82,873 web) via a new `computeYear1ExitRunRate()` month-by-month
      pool-fill function in `analysis/business-case-model.mjs` (FACTORY_STANDARD S22: computed, not
      eyeballed). Both are BELOW the $100K floor, confirming the auditor's read exactly ($73,519 vs
      their ~$73,519 estimate). Also registered `business_case_scenario_b_year1_arr.mjs` ($71,207),
      replacing the doc's previously-uncomputed "~$70-73K" prose range for Scenario B's own existing
      disclosure box with an exact figure -- `node scripts/validate-computation.mjs` now verifies 10
      figures (up from 7), all PASS. ARTIFACT_FRESHNESS fixes: docs/analytics.md was missing
      `mockup_limit_paywall_shown` (the 11th FunnelEvent, shipped 2026-07-30) and its own footnote
      falsely claimed "covers all 10" -- added the row and corrected the footnote to 11. docs/
      email-welcome-sequence.md still told the owner "you'll need to connect a webhook" / "do not
      send until the owner connects the email platform" for ALL four emails, but Email 1's send
      engine is CODE-COMPLETE (`app/api/waitlist/confirm/route.ts` calls `sendEmail()` with stage
      `waitlist_welcome_1` directly on double-opt-in confirmation, verified by reading the route) --
      only owner-env-gated (RESEND_API_KEY), not unbuilt. Corrected the header + "Notes for owner"
      to distinguish Email 1 (built, env-gated) from Emails 2-4 (genuinely unwired -- no cron exists
      for waitlist day-N drips, verified by reading vercel.json's cron list), mirroring the
      correction docs/email-lifecycle.md already received at Run 15. ROADMAP_STEER_JUSTIFICATION
      fix: `positioning_implication` (below) called the $511-vs-$265 Havenly markup example
      "directly-quoted" while theme 3's own `sources` field three lines away has always said it
      "stays WebSearch-synthesized only" -- a self-identified contradiction that survived Runs
      15-18. Corrected the wording; the underlying positioning read is unaffected (it was never
      contingent on that one example). PMF_READ_ACCURACY fix: added an `unbuilt_disclosure` to the
      `pmf` block above (verified via grep against lib/growth/metrics.ts: zero hits for any of the
      5 field names) and a matching next_action, mirroring the disclosure already made for
      stripe_reporting/mrr_usd. DEMAND-SIGNAL research this run (implementing the experiment_validity
      gap -- theme-specific disconfirming existed only for theme 2 through Run 18): theme 3 gained a
      genuinely new source, Havenly's own App Store review page (previously 503'd twice in Run 18,
      now fetchable) -- both a disconfirming aggregate rating (4.4/5 across 4.9K, see `disconfirming`
      below) AND three new verbatim, named, dated confirming quotes from a NEW source type (App
      Store reviews). Theme 1's disconfirming attempt was an honest negative (see `disconfirming`).
      Held `confidence` at "emerging" -- the per-theme-disconfirming gap narrows (2 of 4 themes now
      have one) but themes 1 and 4 still have none, and S10's bar is source count + independence per
      theme for the CONFIRMING side, which only theme 3 gained this run. Re-verified PENDING_OPS.md
      directly: `as_of` is still 2026-07-28, unchanged since Run 17, and every growth-relevant item
      is still `status: open` (19th consecutive run, ~37 days since Run 1). Re-probed
      aptdesignerai.com and the metrics API a FIFTEENTH time: still `connect_rejected`/gateway 502 to
      CONNECT, identical signature, cross-checked against /__agentproxy/status recentRelayFailures
      (2026-08-03T05:15:32Z). trustpilot.com/review/havenly.com still 403s, re-confirmed directly.
      Run 18: per Run 17's next_action, targeted theme 3 (Havenly/Modsy pricing-and-
      delivery failures), the thinnest remaining theme after themes 1/4 hit diminishing returns
      last run. Found a genuinely NEW, directly-fetched, verbatim-verified source: Modsy's OWN BBB
      complaints page (bbb.org/us/ca/san-francisco/profile/online-shopping/modsy-1116-880030/
      complaints), distinct from the Havenly BBB page already cited and from the TechCrunch
      shutdown piece (which covers Modsy but is press, not a complaint record). A $434.25
      design-package complaint (ordered 2022-04-29) describes the post-shutdown refund channel
      (Pencil, LLC, the assignment-for-benefit-of-creditors administrator) failing outright --
      "I cannot get any reply nor a refund" -- resolved only when the customer independently
      found a Modsy co-founder on LinkedIn and messaged them personally. This is the first theme-3
      source that is both a NEW company (Modsy, previously TechCrunch-only) and an EXISTING source
      type (BBB, previously Havenly-only) -- strengthens per-source-type diversity, not just count.
      A second attempt this run (Havenly's own App Store review page, following the theme-2
      precedent of using an incumbent's App Store reviews) 503'd on WebFetch twice -- recorded
      honestly as a new structural gap (joining Trustpilot's 403 and consumeraffairs.com's 403 in
      the site-blocked-to-WebFetch category) rather than substituting the unverified WebSearch
      synthesis that surfaced in a preliminary search. Theme 3 moves from cited_count 4/
      verbatim_count 3 to cited_count 5/verbatim_count 4. Held `confidence` at "emerging"
      (unchanged): the S10 bar is source count + independence PER THEME, and only theme 3
      strengthened this run -- themes 1, 2, and 4 are unchanged since Run 16/17. Re-probed both
      structural gaps per S10's every-run requirement: reddit.com stays excluded on Responsible
      Builder Policy grounds (unchanged since Run 16); trustpilot.com/review/havenly.com still
      403s, re-confirmed directly. Neither independent scorecard (GTM_SCORECARD, QUALITY_SCORECARD)
      has been re-graded since Run 16 -- both re-verified via `git log` to be unchanged (see
      validation block). PENDING_OPS.md is also unchanged (`as_of: 2026-07-28`, every
      growth-relevant item still `status: open`) -- re-verified directly. Re-probed
      aptdesignerai.com/the metrics API a FOURTEENTH time: still `connect_rejected`/gateway 502 to
      CONNECT, identical signature to every prior probe.
      Run 17: per Run 16's next_action, targeted themes 1 and 4 (the two thinnest,
      2-4 sources each vs theme 2's 6) with the same confirmation+disconfirming pairing that
      strengthened theme 2 last run. HONEST NEGATIVE RESULT -- no new citation added to either
      theme. Theme 1 confirmation search surfaced only unattributed WebSearch-synthesized
      aggregates (73% choice-overwhelmed, 78.65% furniture cart-abandonment); the strongest
      candidate source (consumeraffairs.com) 403'd on direct WebFetch, and a second candidate
      (speakwiseapp.com) fetched cleanly but had zero furniture-specific data once actually read
      (its cited stats are e-commerce/jewelry/jam-study/Netflix research, not furniture). Theme 4
      disconfirming search surfaced a competing 71%/61% AR-adoption stat sourced only to
      glamar.io, itself a commercial AR-furniture-app vendor -- the same undisclosed-competitor-
      promotion problem already flagged for First Chair, so correctly NOT cited. Re-fetched the
      existing Baymard citation directly to confirm it contains no internal positive
      counter-finding (it does not). This is the second time this research has hit diminishing
      returns on a targeted theme pair (the first was Runs 8-10 on the original Reddit/Trustpilot
      gap) -- recorded honestly per this doc's standing norm rather than forcing a weak citation
      to show progress. Held `confidence` at "emerging" (unchanged): zero themes gained a source
      this run. Both structural web-research gaps (Reddit policy-gated, Trustpilot 403) re-probed
      and unchanged; consumeraffairs.com 403 joins Trustpilot as a second site-blocked source.
      Neither independent scorecard (GTM_SCORECARD, QUALITY_SCORECARD) has been re-graded since
      Run 16 -- both re-verified via `git log` to be unchanged (see validation block); nothing new
      to react to from either auditor this run. PENDING_OPS.md is also unchanged (`as_of:
      2026-07-28`, every growth-relevant item still `status: open`) -- re-verified directly, not
      inferred, per this doc's standing practice since Run 7.
      Run 16: per Run 15's next_action, PAIRED a confirmation-seeking search with a
      disconfirming one for the first time, per the GTM Auditor Run 4 experiment_validity finding
      that prior research had been 100% pain-seeking by construction. The confirmation-seeking
      query ("AI interior design app review not real furniture fake generated") led to a targeted
      follow-up search for RoomGPT (a distinct, non-First-Chair AI room-design app) and a direct
      WebFetch of its App Store review page (apps.apple.com, id6446314875) -- VERBATIM-VERIFIED,
      a genuinely new source for theme 2: five different 1-star reviewers (Kristen C, Jul 20;
      Deezy16, Mar 1; Leviana Grace, Apr 7; Cellicat, Apr 22; Blue ski10000, Mar 8 -- all 2026)
      describing architectural/instruction-following failures ("the app does stupid things like
      add another section to the room, eliminate a doorway, add another window randomly", "it
      sends me a picture of a completely different room", "the app returned a rendering that was
      identical to the original image" -- i.e. it silently no-ops instead of applying the
      requested change). This is a DIFFERENT failure mode than Interium's (which fabricates new
      furniture wholesale) -- both corroborate the same underlying theme (AI room tools don't
      reliably honor the user's actual room + request) from independent apps. The disconfirming
      half of the pairing genuinely mattered: re-fetching the SAME app's summary page found it
      holds a 4.6/5 average across 6,000 ratings -- so the quoted failure mode is real but likely
      affects a vocal minority, not most users. Recorded honestly in `disconfirming` rather than
      omitted, tempering theme 2's read without discarding the underlying evidence. A second
      disconfirming-angle search ("AI room design app satisfied happy customers works well")
      surfaced only unattributed promotional "best AI app" round-up blogs -- explicitly NOT cited
      (see web_research validation entry for why). Re-probed both structural gaps per S10's
      every-run requirement: trustpilot.com/review/havenly.com still 403s to WebFetch, unchanged;
      reddit.com returned HTTP 200 to a raw curl through the agent-proxy this run (a change from
      the prior WebFetch-tool-level refusal) but was deliberately NOT used for demand-mining --
      S10 gates Reddit on Reddit's own sanctioned commercial Data API approval, not on whether a
      fetch technically succeeds, so this stays an owner DECISION, not a routine connect-step.
      Held `confidence` at "emerging", NOT raised: the per-theme gate is source count +
      independence PER THEME (S10), and only theme 2 gained a source this run -- themes 1/3/4 are
      unchanged since Run 14/15.
      Run 14: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403,
      re-confirmed this run -- 8th consecutive re-probe with the same result). Per Run 13's
      next_action, targeted themes 1 and 4 (the two thinnest) with fresh angles instead of
      re-probing theme 3's already-strengthened base. Both searches surfaced genuinely new,
      directly-fetched, verbatim-verified sources: (1) theme 1 -- First Chair's OWN
      "Furniture Purchase Decision Time Statistics" page (firstchair.app/blog/furniture-
      purchase-decision-time-statistics, distinct from the Run 6-cited firstchair.app/blog/
      home-ai-alternatives), fetched cleanly: "Most shoppers spend 14-21 days selecting a
      sofa after starting their search," a single couch purchase involves "approximately
      4,000 variables across dimensions, materials, colors, and configurations," and "47% of
      shoppers say it's important not to spend much time on furniture shopping" -- a second
      independent verbatim source for theme 1 (up from the eMarketer citation alone), and the
      first to quantify the SPECIFIC decision-timeline pain (14-21 days) rather than a
      cross-tab count; (2) theme 4 -- re-fetched the SAME Baymard AR article already cited for
      its adoption-avoidance stat and found it also carries direct participant quotes on WHY
      AR fails trust, not just that it does: "I'm just not comfortable with AR [showing] it in
      a hyper-accurate way," a participant who "accidentally resized it to 79% of its true
      size, but didn't notice initially," a color-mismatch complaint ("In the AR, it's a lot
      different than how it looks right here"), and "users who experience issues are less
      likely to try it again on any site." This deepens theme 4 from "most people skip it" to
      a named, quoted failure MECHANISM (sizing/color/model-quality distrust) -- directly
      validates this product's considered-AI-mockup approach over live AR. Also WebFetched
      BBB's Decorist profile (a Havenly/Modsy competitor, following Run 13's next_action to
      check other competitors on BBB) -- cleanly reachable but returned "0 complaints," a
      genuine DISCONFIRMING data point recorded honestly rather than omitted: BBB-visible
      complaint volume does not generalize across the full-service e-design competitor set.
      Held confidence at "emerging", NOT raised to "strong": themes 1 and 4 each still carry
      only 2 independent sources (up from 1-2), and theme 2 remains the only theme with 3+;
      S10's "strong" bar is source count + independence PER THEME, so incremental progress on
      two thinner themes is real but not yet a tier jump. Prior method_note (Run 13) follows
      verbatim for the full verification history:
      Run 13: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403,
      re-confirmed this run -- 7th consecutive re-probe with the same result). Per Run 12's
      next_action, targeted the thinner themes (1/3/4) instead of only theme 2. Theme 1 (furniture
      sizing/fit frustration) surfaced only WebSearch-synthesized retailer-complaint aggregates (City
      Furniture, Jennifer Furniture, Rooms2Go -- items not fitting the room/delivery team refusing to
      place them), not independently verbatim-fetchable at the source, so no addition there. Theme 4
      (AR view-in-room) surfaced only re-paraphrased Baymard stats already cited, no new source. Theme
      3 (prior full-service e-design fails on price/delivery) DID surface a genuinely new,
      directly-fetched, verbatim-verified source: BBB's Havenly, Inc. complaints page
      (bbb.org/us/co/denver/profile/interior-designer/havenly-inc-1296-90260312/complaints) fetched
      cleanly via WebFetch (unlike trustpilot.com/review/havenly.com, which still 403s) -- a NEW
      reachable source for Havenly-specific complaints, distinct from the blocked Trustpilot source.
      Dated, verbatim complaints: a $6,772.06 charge without approval (7/24/2025); a $3,000 rug ordered
      2/17/2026, promised delivery Feb 28-Mar 4, still no ETA by 3/26/2026; an $814 discontinued-item
      charge left unrefunded after multiple requests (9/17/2025); "I cannot get someone on the phone
      and am continually connected to a bot" (6/2/2026). This corroborates the existing TechCrunch/Modsy
      citation with a SECOND independent, directly-fetched publisher for theme 3 (up from 1), and the
      dates (spanning mid-2025 through mid-2026) show the pricing/delivery/refund pain is CURRENT, not
      a one-time 2022 collapse story. Held `confidence` at "emerging", NOT raised to "strong": the
      strengthening is one new source in one of four themes -- S10's "strong" bar is source count +
      independence PER THEME, and themes 1/2/4 are unchanged since Run 12. Real, incremental progress;
      also opens BBB as a standing usable source for future Havenly/competitor-complaint research
      (recorded in web_research validation above) since it is not blocked the way Trustpilot is.
    prior_notes: >-
      Run 12: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403,
      re-confirmed this run -- 6th consecutive re-probe with the same result). Additionally ran a
      fresh WebSearch angle targeting theme 1 (furniture-shopping decision fatigue/survey data) and
      theme 2 (AI app reviews using words like "waste of money") -- theme 1's search surfaced only
      WebSearch-synthesized stats (3D Cloud, SpeakWise, First Chair aggregate blog posts), not a new
      independently-fetchable verbatim source, so theme 1 stays at its existing 3-source base (no
      regression, no addition). Theme 2's search DID surface a genuinely new, directly-fetched,
      verbatim-verified source from a NEW source type -- real paying-customer App Store reviews,
      not a blog/press citation: apps.apple.com's Interium ("AI Interior Design") review page,
      fetched cleanly via WebFetch, three 1-star reviews verbatim-quoted (see theme 2 sources). This
      is a fourth independent theme-2 source and a new specific failure mode beyond "furniture isn't
      buyable" (First Chair) and "styling drift/spatial-blindness" (MONA): the AI output does not
      honor the user's actual instruction -- one reviewer describes asking the app to "rearrange"
      existing room items and instead receiving "a whole new furnitures" restructuring "nothing like
      i asked for." This directly validates AptDesignerAI's design commitment to grounding mockups in
      the user's actual photographed room and stated intent, rather than generating a disconnected
      redesign. Held `confidence` at "emerging", NOT raised to "strong": the strengthening is again
      concentrated in theme 2 (now 4 independent sources, 3 verbatim-verified) while themes 1/3/4 are
      unchanged since Run 7/11 -- S10's "strong" bar is source count + independence PER THEME, so one
      strong theme does not lift the overall read. Real, incremental, source-type-diversifying
      progress (App Store reviews are a materially different evidentiary class than blog/press
      citations -- unmediated paying-customer language) -- not a tier jump.
      Run 11: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403,
      re-confirmed this run). Additionally ran ONE fresh WebSearch with a new query angle (not a
      re-probe of a known-blocked source) and found a genuinely NEW, dated, independent citation for
      theme 2 -- monaverse.com/blog/ai-interior-design-tools, "Most AI Interior Design Tools Were
      Built for the Wrong Room" by Justin Melillo (MONA Blog, published 2026-06-10) -- VERBATIM-VERIFIED
      via direct WebFetch this run: "The furniture changes because most AI room design tools generate
      each image from scratch, with no persistent model of the space" (the "styling drift" problem --
      a design element the owner approved in one render mutates in the next: "the bouclé is now caramel
      leather, the rug lost its border, and the pendant grew a third arm"), plus a distinct spatial-
      accuracy complaint ("Most do not" understand floorplans properly -- renders can place "a window
      where your client has a party wall"). This is a NEW angle beyond the existing "furniture isn't
      buyable" framing (First Chair, Run 6) -- it corroborates the same underlying theme (AI room tools
      fail on the physical/spatial reality of a room) from a third independent, named, dated publisher,
      raising theme 2's source count to 4 (2 now verbatim-verified: First Chair + MONA). Held
      `confidence` at "emerging", NOT raised to "strong": the strengthening is concentrated in ONE of
      four themes (S10's "strong" bar is source count + independence PER THEME, not just one theme
      improving), and Reddit stays completely unreachable across every theme. Real, incremental
      progress -- not a tier jump.
      Run 10: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403, re-confirmed
      this run). No new citation attempted -- same reasoning as Runs 8-9: the 4 themes already carry a
      directly-fetched, hand-verified quote each (Run 7), and re-running the same blocked probes adds no
      evidence. Held confidence at "emerging" (unchanged). This run's primary work was closing a real
      FACTORY_STANDARD S22 computation-integrity gap on the business case (see learnings), not new
      demand-signal research -- diminishing-returns reasoning unchanged since Run 8.
      Run 9: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403). No new
      citation attempted -- same reasoning as Run 8: the 4 themes already carry a directly-fetched,
      hand-verified quote each (Run 7), and re-running the same blocked probes adds no evidence. Held
      confidence at "emerging" (unchanged). This run's primary work was fixing the GTM Auditor's named
      business-case-honesty gap (see learnings), not demand-signal research.
      Run 8: re-probed both structural gaps per S10's every-run requirement -- unchanged. reddit.com
      is still hard-blocked by the WebFetch TOOL itself ("Claude Code is unable to fetch from
      www.reddit.com"); trustpilot.com/review/havenly.com still returns HTTP 403 (site-side
      Cloudflare bot-block). No new citation attempted this run -- the existing 4 themes already
      carry a directly-fetched, hand-verified quote each (Run 7), and re-running the same blocked
      probes without a new angle would not change the evidence base. Held confidence at Run 7's
      "emerging" (unchanged; see below for why not "strong"). Prior method_note (Run 7) follows
      verbatim for the full verification history:
      Run 7: closed out Run 6's two carried-over-but-unverified citations via direct WebFetch.
      Baymard Institute's AR-avoidance article (baymard.com/blog/deprioritize-view-in-room-
      augmented-reality) fetched cleanly -- VERBATIM-VERIFIED, dated 2024-05-15: "87% of test
      participants who encountered 'View in Room' chose not to use it" / "66% of users opted out
      of using AR and another 21% said they would but then didn't" / only "6% ... sought out and
      used it proactively." TechCrunch's Modsy piece also fetched cleanly on the CORRECTED URL
      (techcrunch.com/2022/07/17/modsy-quietly-shut-down-while-some-customers-were-still-awaiting-
      refunds/ -- Run 5/6 cited a shorter, non-resolving path guess) -- VERBATIM-VERIFIED:
      "Capital constraints and uncertain market conditions forced the company to cease operations
      on July 6" (CEO Shanna Tellerman) / a customer stating "We have $4,500 in undelivered or
      unanswered return request" / another "I had $50,000 of in-process orders that are in limbo."
      Re-probed the two known tooling gaps -- both unchanged: trustpilot.com still 403s to
      WebFetch (Havenly's own review page remains unreachable; the earlier "2.8/5 on 3 reviews"
      Interior-AI citation and the Havenly pricing-markup citation both stay WebSearch-synthesized,
      not independently re-fetched), and the corrected HN item (id=35267253) still 429s. Net: 4 of
      4 themes now carry at least one directly-fetched, hand-verified, dated, named-source verbatim
      quote (up from 2 of 4 in Run 6) -- Reddit and Trustpilot remain the only structurally
      unreachable sources, and per-theme source COUNT is still small (1-3 sources/theme, mostly one
      per publisher). Also independently found + fixed (per S4/GTM_SCORECARD artifact_freshness):
      store-listing.md and press-kit.md had been advertising the Pro Annual ($399/yr) tier since
      PR #150 (2026-06-27) despite migration 021 (the DB tier constraint it needs) still being
      unapplied -- a plan visitors could not actually purchase. Removed it from both public-facing
      docs this run (see learnings) rather than treating this as a demand-signal task; noted here
      only because it was surfaced while re-reading these same docs for the positioning check.
    confidence: emerging          # held at "emerging" since Run 6, NOT raised to "strong": the honest
                                   # gate for "strong" is source COUNT + independence per theme, not
                                   # just verbatim-ness, and that count is still thin for theme 4
                                   # (2/theme); Reddit stays excluded on policy grounds, not
                                   # reachability (Run 16); still qualitative signal, never PMF (S1/S10).
                                   # Real strengthening (theme 3 now 6 sources, Run 19; theme 1 now 5
                                   # sources incl. a new returns-cost data type, Run 20; theme 2 gained a
                                   # second independent App Store source + a genuine disconfirming
                                   # nuance, Run 16), but not yet a tier jump -- theme 4 remains the only
                                   # theme still at just 2 cited / 1 verbatim after repeated attempts.
    counting_rule: >-
      NEW (Run 15, per GTM Auditor Run 4 metric_integrity finding): theme 1's source count was
      stated four irreconcilable ways across method_note prose ("the eMarketer citation alone" /
      "only 2 independent sources" / "its existing 3-source base" / 4 named sources in the field
      itself), with no defined counting rule, making the confidence-tier gate unauditable. Defining
      it now, applied to every theme's `cited_count`/`verbatim_count` fields below: `cited_count` =
      the number of DISTINCT, NAMED, independent publishers/sources listed in that theme's `sources`
      field, counted ONCE each regardless of how many runs contributed a citation from them.
      `verbatim_count` (<= cited_count) = the subset independently confirmed by a direct WebFetch (or
      WebSearch cross-checked against an original quote), as opposed to a WebSearch-synthesized
      summary the agent could not itself re-fetch (e.g. Trustpilot, 403-blocked). A source that 429s
      or 403s on direct fetch still counts toward cited_count (it is a real, named, dated source) but
      NOT toward verbatim_count. The historical method_note/prior_notes entries above are kept
      VERBATIM as each run's own contemporaneous record (never rewritten after the fact) -- this
      rule is applied going forward from Run 15's per-theme fields, which are the authoritative count.
    themes:
      - theme: "Furniture-shopping choice paralysis (multi-hour, no clear starting point)"
        cited_count: 5   # eMarketer, First Chair decision-time page, Baymard, Hacker News item, eightx.co returns-cost -- see counting_rule
        verbatim_count: 4   # eMarketer, First Chair, Baymard, eightx.co directly re-fetched; the HN item still 429s (cited, URL-corrected, not re-quoted)
        sources: "eMarketer (Arielle Feger, published 2026-05-18, emarketer.com/content/why-furniture-shopping-broken-how-ai-starting-fix) -- VERBATIM-VERIFIED via direct fetch (Run 6): Dan Bennett (CMO, furniture.com) quoted as 'nine hours and 13 tabs used just to find a solution to a furniture problem'; First Chair 'Furniture Purchase Decision Time Statistics' (firstchair.app/blog/furniture-purchase-decision-time-statistics) -- VERBATIM-VERIFIED via direct fetch (Run 14), a SECOND independent source, distinct from the Run 6-cited firstchair.app/blog/home-ai-alternatives page: 'Most shoppers spend 14-21 days selecting a sofa after starting their search,' a single couch purchase spans 'approximately 4,000 variables across dimensions, materials, colors, and configurations,' '47% of shoppers say it's important not to spend much time on furniture shopping'; Baymard Institute independent UX research -- itself VERBATIM-VERIFIED (Run 7), not just cited as a stat; Hacker News 'Why buying furniture is so miserable' -- item?id=35267253 (found via hn.algolia.com search API; Run 5's cited id=35266271 was wrong; the corrected item page itself still 429s under direct fetch, so this one citation stays URL-corrected but not re-quoted); eightx.co 'Furniture and Home Return Rate Benchmarks' (eightx.co/blog/average-furniture-and-home-return-rate-benchmarks, published 2026-07-01, a returns-analytics/logistics vendor aggregating NRF/Happy Returns 2025 + YouGov 2025 + ClaimLane 2026 + public 10-K filings) -- VERBATIM-VERIFIED via direct fetch (Run 20), a NEW source TYPE (returns-cost data, not shopping-time-cost): 'Furniture's online return rate is about 22.7%, roughly 3 points above the 19.3% all-category online average,' 'Size/space mismatch: ~58%' is 'the dominant driver' of furniture returns, 'Color/material gap: ~44%,' and a large-furniture return costs '$55-108 all-in'"
        solved_by_product: "yes -- sourcing real, budget-fit products directly cuts the multi-tab, multi-week search cost; the First Chair 14-21-day timeline gives this theme its first quantified DURATION figure, and eightx.co's 58%-size/space-mismatch + $55-108-per-return figures give it its first quantified DOWNSTREAM-COST figure -- both are exactly the failure modes a grounded, actual-room mockup with real product dimensions is meant to prevent"
        recency: "durable AND current -- the eMarketer piece is 7 weeks old (2026-05-18) relative to this run and cites the same order-of-magnitude pain (9hrs/13 tabs) as the hand-verified version; First Chair's decision-time page carries no visible publish date but reflects current retailer-side research (hellosensible.com, myhfa.org) it cites; eightx.co is 5 weeks old (2026-07-01) and aggregates 2025-2026 industry data, the most current source in this theme"
      - theme: "AI room-render tools generate furniture that isn't real or buyable"
        cited_count: 6   # First Chair blog, MONA blog, Interium App Store reviews, RoomGPT App Store reviews, RoomGPT/Interior AI Trustpilot finding, Business of Home trade press -- see counting_rule
        verbatim_count: 4   # First Chair, MONA, Interium, RoomGPT App Store reviews directly re-fetched; Trustpilot finding stays WebSearch-synthesized (403s) and Business of Home is cited generally, not verbatim-quoted here
        sources: "First Chair blog (published 2026-06-15, firstchair.app/blog/home-ai-alternatives) -- VERBATIM-VERIFIED via direct fetch (Run 6): 'Most AI room tools generate concepts you can't purchase.' / 'The furniture in those renders doesn't exist.' / 'Decorify only shows Wayfair products, which means your room will look like it came from one store.' / 'The furniture in those images is often fabricated or impossible to source.'; MONA blog (Justin Melillo, published 2026-06-10, monaverse.com/blog/ai-interior-design-tools) -- VERBATIM-VERIFIED via direct fetch (Run 11): 'The furniture changes because most AI room design tools generate each image from scratch, with no persistent model of the space' (the 'styling drift' failure mode -- an approved design mutates between renders: 'the bouclé is now caramel leather, the rug lost its border, and the pendant grew a third arm'), plus a spatial-accuracy complaint ('Most do not' understand floorplans -- can render 'a window where your client has a party wall'); Interium ('AI Interior Design') App Store review page (apps.apple.com/us/app/ai-interior-design-interium/id6499216812) -- VERBATIM-VERIFIED via direct fetch (Run 12), a NEW source TYPE (real paying-customer reviews, not blog/press): three 1-star reviews quoted verbatim, including 'The app advertises that you can take a photo of a room and have it rearrange the furniture and items into a new design. Unfortunately, that is not how the app actually works,' and 'it still gives me an image of whole new furnitures and it restructures my whole house, nothing like i asked for'; RoomGPT ('RoomGPT : AI Interior Design') App Store review page (apps.apple.com/us/app/roomgpt-ai-interior-design/id6446314875) -- VERBATIM-VERIFIED via direct fetch (Run 16), a SECOND independent App Store review source, a different app than Interium: 'the app does stupid things like add another section to the room, eliminate a doorway, add another window randomly' (Deezy16, 2026-03-01), 'it sends me a picture of a completely different room' (Leviana Grace, 2026-04-07), 'the app returned a rendering that was identical to the original image' -- i.e. it silently no-ops (Cellicat, 2026-04-22); independently corroborates the RoomGPT/Interior AI Trustpilot finding (2.8/5 on 3 reviews, WebSearch-synthesized only -- trustpilot.com still 403s to direct WebFetch, re-confirmed this run); Business of Home trade press, 2025 (the 2023 wave of AI interior-design apps has produced no clear winner)"
        solved_by_product: "yes -- closest to this product's core differentiator (real purchasable, persistent products vs. hallucinated/drifting furniture); the First Chair critique of single-retailer tools (Decorify/Wayfair-only) validates this product's multi-retailer sourcing, the MONA 'styling drift'/spatial-accuracy critique validates grounding mockups in the user's actual photographed room rather than from-scratch generation, and the Interium + RoomGPT reviews validate a THIRD angle from TWO independent apps -- honoring the user's actual room/request (not fabricating new furniture, not silently no-oping, not deleting doorways) rather than substituting a generic AI redesign -- three distinct, product-relevant differentiation angles now evidenced, the third corroborated by two apps"
        recency: "durable AND current -- First Chair (2026-06-15) and MONA (2026-06-10) are both ~5 weeks old relative to this run, and the Interium + RoomGPT App Store reviews are live/current (RoomGPT's dated Mar-Jul 2026, spanning the months immediately before this run); now the most independently-corroborated theme across six research sessions (Run 5/6/7/11/12/16) using different source sets and source TYPES (press, blog, App Store reviews from 2 distinct apps), 4 of 6 verbatim-verified"
      - theme: "Prior full-service e-design (Havenly, Modsy) is expensive and/or fails on delivery"
        cited_count: 6   # TechCrunch (Modsy), BBB Havenly complaints, BBB Modsy complaints, Havenly Trustpilot pricing-markup, Decorist/Business of Home shutdown, Havenly's own App Store review page -- see counting_rule
        verbatim_count: 5   # TechCrunch, BBB Havenly, BBB Modsy (Run 18), the Decorist/Business of Home shutdown (Run 15), and Havenly's own App Store review page (Run 19) directly re-fetched/searched; the Trustpilot pricing-markup figure stays WebSearch-synthesized only (403s)
        sources: "TechCrunch on Modsy's 2022-07-17 shutdown -- VERBATIM-VERIFIED via direct fetch (Run 7): CEO-attributed 'capital constraints,' plus customer quotes citing $4,500 and $50,000 in undelivered orders/refunds; BBB Havenly, Inc. complaints page (bbb.org/us/co/denver/profile/interior-designer/havenly-inc-1296-90260312/complaints) -- VERBATIM-VERIFIED via direct fetch (Run 13), a SECOND independent directly-fetched publisher: a $6,772.06 charge without customer approval (7/24/2025), a $3,000 rug with no delivery ETA a month past its promised window (3/26/2026), an $814 discontinued-item charge left unrefunded after multiple requests (9/17/2025), and 'I cannot get someone on the phone and am continually connected to a bot' (6/2/2026) -- dates spanning mid-2025 to mid-2026 show this is CURRENT, ongoing pain, not a historical artifact; BBB Modsy, Inc. complaints page (bbb.org/us/ca/san-francisco/profile/online-shopping/modsy-1116-880030/complaints) -- VERBATIM-VERIFIED via direct fetch (Run 18), a THIRD independent directly-fetched publisher, and the first source covering Modsy via BBB rather than press: a $434.25 design-package complaint (ordered 2022-04-29) describing the post-shutdown refund channel (Pencil, LLC, the assignment-for-benefit-of-creditors administrator) failing outright -- 'I cannot get any reply nor a refund' -- resolved only when the customer independently found a Modsy co-founder on LinkedIn and messaged them personally, i.e. even the official wind-down refund process left a paying customer with no working channel; Havenly Trustpilot pricing-markup complaints -- still WebSearch-synthesized only (trustpilot.com 403s to direct WebFetch, re-confirmed this run): a coffee table priced '$511 versus $265 at retailers' via Havenly's concierge markup; Decorist shutdown, Business of Home (businessofhome.com/articles/decorist-shuts-down) -- VERBATIM-VERIFIED via WebSearch this run (Run 15): the Bed Bath & Beyond-owned e-design platform abruptly closed in September 2022, telling customers it would stop taking new orders and wind down existing projects by October 12, refunding unstarted bookings within 6-8 weeks, no explanation given -- a THIRD independent full-service e-design collapse alongside Modsy (CORRECTION, Run 15: Run 14 had instead WebFetched Decorist's BBB profile and found '0 complaints,' recording it in `disconfirming` as evidence theme 3 doesn't generalize past Havenly. The GTM Auditor (Run 4) flagged this as void -- a company with no customers since 2022 mechanically has zero recent complaints, and the shutdown itself is CONFIRMING for theme 3, not disconfirming. Re-verified independently this run via WebSearch, not just taking the auditor's word: confirmed via Business of Home. Moved here and the disconfirming entry removed); Havenly's OWN App Store review page (apps.apple.com/us/app/havenly-interior-design/id1149153371) -- VERBATIM-VERIFIED via direct fetch (Run 19): 4.4/5 average across 4.9K ratings (a genuine disconfirming aggregate, see `disconfirming` below), but individually-quoted reviews CORROBORATE this theme's core complaint from a NEW source type (App Store reviews, not BBB/press): Sarah Groom (2019-08-17) -- 'DO NOT USE THEIR ORDER SERVICE...littered with a lack of accountability'; Amber_Energy (2018-08-29) -- 'I'm super bummed that I was mislead on the timelines and don't have the convenience of shopping through the app'; Jclor (2022-03-24) -- 'Disappointed with this service...The 3D design didn't look like my room.' NOTE this page had 503'd twice in Run 18 and is now fetchable -- the prior structural gap is resolved, not merely re-probed."
        solved_by_product: "partially -- self-serve software at the existing 29-dollar one-time tier undercuts concierge pricing and sidesteps the delivery/refund/no-phone-support failure mode the BBB complaints document directly, but does not remove retailer-side fulfillment risk"
        recency: "Modsy's and Decorist's collapses both read as capital/business-model-driven per trade press, not a demand verdict -- does not disconfirm the underlying need, but flags the human-concierge business model as fragile (TWO independent full-service e-design shutdowns in the same year, mid-2022, now corroborated for Modsy by its own BBB complaint record showing the wind-down refund process itself failed a customer); the Havenly BBB citations are dated across mid-2025-mid-2026, showing the pricing/delivery/refund/support pain is CURRENT and recurring at a live competitor, not just at the two defunct ones -- the strongest recency evidence this theme has had to date. The App Store reviews (Run 19) are OLDER (2018-2022) than the BBB citations, so read as evidence the fulfillment/timeline pattern is LONG-RUNNING at this company, not a new development -- durable, not a recent spike."
      - theme: "AR 'view in room' has not solved the visualize-before-buying trust gap"
        research_status: structurally_hard_to_corroborate   # ADDED Run 22, per Run 21's own next_action: six consecutive dedicated attempts (Runs 14, 17, 19, 20, 21, 22) across every available angle (research orgs, AR vendors, App Store aggregates, a neutral consumer-research org, and now a named retailer's own primary disclosure) produced zero net source-count growth since Run 12. Future runs still re-probe Reddit/Trustpilot every run per S10, but do not default to a fresh theme-4 search cycle absent a genuinely new lead.
        cited_count: 2   # Baymard Institute, IKEA Place review aggregation -- see counting_rule
        verbatim_count: 1   # Baymard directly re-fetched (twice, Run 7 and Run 14); IKEA Place stays WebSearch-synthesized, not independently re-fetched
        sources: "Baymard Institute (baymard.com/blog/deprioritize-view-in-room-augmented-reality, dated 2024-05-15) -- VERBATIM-VERIFIED via direct fetch (Run 7): '87% of test participants who encountered View in Room chose not to use it', only '6%... sought out and used it proactively', top cited reasons 'negative prior experiences, real-life space constraints, insufficient instructions, clunky controls, low-quality 3D models'. Re-fetched (Run 14) and pulled the SAME article's participant-quoted failure MECHANISM, not previously cited: 'I'm just not comfortable with AR [showing] it in a hyper-accurate way and sometimes furniture needs that precision'; a participant who 'accidentally resized it to 79% of its true size, but didn't notice initially'; a color-mismatch complaint ('In the AR, it's a lot different than how it looks right here'); and 'When users make the effort to try AR and fail to get sufficient (or any) value out of the experience, they are less likely to try it again on any site' (CORRECTED Run 15, per GTM Auditor Run 4 metric_integrity finding -- re-verified directly against the live article via WebFetch: a prior version of this line quoted only the tail, 'users who experience issues are less likely to try it again on any site', presenting a paraphrase as verbatim with no ellipsis; this is now the actual full sentence) -- explains WHY the 87% avoidance happens (sizing/color/model-quality distrust), not just that it does; IKEA Place review aggregation (confusing placement UX, objects reading as illustrations) -- still WebSearch-synthesized, not independently re-fetched; NOTE (Run 21): the standalone IKEA Place app (apps.apple.com id1279244498) is now DEAD (404) -- IKEA folded its AR 'scan your room' feature into the main IKEA app (id1452164827), which holds 4.8/5 across 145K ratings with no AR-specific complaint visible in a fetched review sample, but that rating spans the whole shopping app (search/delivery/click-and-collect) and is too diluted to cite as theme-4 evidence either way -- do not re-probe the dead id1279244498 in future runs"
        solved_by_product: "yes, via a different mechanism -- a considered AI mockup of the user's actual photographed room rather than a live AR camera overlay; the Run 14 sizing/color-mismatch quotes directly validate grounding renders in the user's real photographed room + stated dimensions instead of a live camera guess"
        recency: "the Baymard article is 2024-05-15 -- older than the other themes' sources, so read as DURABLE ongoing UX research rather than a current spike; no evidence the finding has reversed since (First Chair's 2026-06-15 piece, verified Run 6, independently corroborates the same underlying trust gap from a different angle)"
    disconfirming:
      - "Business of Home (2025): the 2023 wave of AI interior-design apps has produced no clear winner; some entrants described as lightly scammy cash grabs -- a real category-fatigue signal (carried over from Run 5)"
      - "A cited survey found consumers rating general-purpose ChatGPT as a better design-consultation experience than dedicated apps -- a free-substitute threat to any positioning that is just 'AI gives you design ideas' (carried over from Run 5)"
      - "AR view-in-room already had a large, well-resourced attempt (IKEA/Wayfair/Amazon) that is independently shown to be avoided by most users -- confirms the visualize-before-buying job is unsolved but shows that adding visualization alone is not sufficient (verbatim-verified via the Baymard source itself)"
      - "Reddit stays excluded from demand-mining across every run to date (S10's TOS-gated-for-commercial-mining source) -- but the REASON changed this run (Run 16): a direct curl through the agent-proxy returned HTTP 200 for reddit.com, so the prior TOOL-level refusal this doc previously cited as the blocker is no longer reproducible as stated. The exclusion is NOT a tooling gap -- it is S10's Responsible Builder Policy requirement (sanctioned commercial Data API approval before programmatic mining), which is independent of whether a fetch technically succeeds. Recorded honestly here so the doc does not misrepresent an access-policy choice as a broken tool."
      - "First Chair (firstchair.app), cited 16x and load-bearing for themes 1 and 2, is itself a COMPETING commercial AI interior-design app -- its 'statistics' blog posts are promotional content for its own product, not neutral third-party research (flagged by the GTM Auditor Run 4, experiment_validity). Recorded honestly here rather than removing the citations outright (the underlying facts it reports -- e.g. the 14-21-day sofa-decision timeline -- are independently plausible and consistent with the non-competitor eMarketer/Baymard sources) but the positioning_implication below should be read as corroborated primarily by the NON-competitor sources (eMarketer, Baymard, MONA, Business of Home, BBB, TechCrunch, and now RoomGPT's App Store reviews), not by First Chair alone."
      - "NEW (Run 16): RoomGPT (a theme-2 source, apps.apple.com id6446314875) holds a 4.6/5 average across 6,000 ratings despite the quoted architectural/instruction-following failure complaints -- the failure mode is real and verbatim-quoted, but a strong aggregate rating means it likely affects a vocal minority of sessions, not most users. Tempers theme 2's severity without contradicting its existence: the product-fit read (ground mockups in the user's actual room + honor the actual request) still holds, it is just not evidence that most users of competing apps are dissatisfied overall."
      - "NEW (Run 19, closing the GTM Auditor Run 5 experiment_validity gap -- theme-specific disconfirming existed only for theme 2 through Run 18): Havenly (a theme-3 source, apps.apple.com id1149153371) holds a 4.4/5 average across 4.9K ratings despite the quoted order-service/timeline/rendering-mismatch complaints -- same 'real complaint, strong aggregate' pattern as RoomGPT's theme-2 disconfirming entry above. Tempers theme 3's severity (most Havenly App users are not dissatisfied overall) without contradicting the BBB-documented pattern, which concerns the order-fulfillment/refund process specifically, not general app satisfaction. Theme 1 disconfirming attempt this run (WebSearch for furniture-shopping-is-easy survey data) surfaced only vendor-promotional content (3dcloud.com, a visualization-tool vendor arguing FOR its own product category -- the same undisclosed-competitor-promotion problem already flagged for First Chair) with no independent disconfirming finding; recorded as an honest negative, not cited. Themes 1 and 4 still carry no theme-specific disconfirming datum after two dedicated attempts each (Run 17, Run 19)."
      - "NEW (Run 23, closing the last open Run-19-era theme-1 gap): Wayfair -- the largest online furniture retailer, and a direct-relevance competitor to theme 1's 'multi-hour, no-clear-starting-point' choice-paralysis claim -- holds a 4.9/5 average across ~2.5M App Store ratings (apps.apple.com/us/app/wayfair-shop-all-things-home/id836767708, VERBATIM-VERIFIED via direct WebFetch, cross-checked against three independent app-data aggregators for the rating count), with a verbatim, dated reviewer quote (Jami303, 10/24/2023) specifically crediting the app's filtering for making it 'easy to find' products. Same 'real complaint elsewhere, strong aggregate here' pattern as the RoomGPT/Havenly disconfirming entries: does not contradict the eMarketer/First-Chair/Baymard/eightx.co evidence that furniture DECISIONS take 14-21 days and generate real downstream cost, but shows that at least one major retailer's own shopping/discovery TOOLING is rated as easy-to-use by its own users at scale -- tempers a reading of theme 1 as 'furniture retailers have failed to solve findability' specifically, without undermining the decision-TIME/cost evidence itself (Wayfair's rating is about finding/browsing within its own catalog, not about the cross-retailer, budget-fit, actually-buyable-in-MY-room decision this product targets). Two neutral-org searches (ACSI specialty-retailers page, J.D. Power 2025/2026 retail-satisfaction studies) came up empty first -- neither breaks out a furniture-specific satisfaction score -- an honest negative recorded in the method_note, not padded into a citation. Theme 3 now also carries the Havenly entry above; theme 4 remains the only theme with no theme-specific disconfirming datum, and per Run 22 carries an explicit structural reason why (see its `research_status` field)."
    positioning_implication: >-
      Still directional -- confidence held at emerging, NOWHERE NEAR the S3 bar for a business-case
      number change or a roadmap steer (that needs quantified, statistically significant,
      causally revenue-linked evidence; this stays qualitative pain-signal, exactly what S10 says
      never becomes a hard number). The verbatim-verified evidence base sharpens the SAME
      positioning read prior runs reached directionally: lead with "real, buyable, budget-fit
      furniture sourced from multiple retailers for your actual room" over an undifferentiated
      "AI design ideas" claim, and keep entry pricing low relative to Havenly/Modsy-style concierge
      pricing (backed by a WebSearch-synthesized-only $511-vs-$265 markup example -- CORRECTED
      Run 19, per GTM Auditor Run 5 roadmap_steer_justification: this line previously called the
      markup example "directly-quoted," contradicting theme 3's own `sources` text three lines
      away, which states plainly it "stays WebSearch-synthesized only (trustpilot.com 403s)" and
      has never been independently re-fetched; a self-identified contradiction that survived Runs
      15-18 despite each claiming to re-verify prior work -- and a directly-quoted, verbatim-
      verified Modsy collapse). Run 11 adds a THIRD evidence-backed differentiation angle alongside "real/buyable"
      and "multi-retailer": persistent, spatially-grounded mockups (the MONA citation's "styling
      drift" and floorplan-blind-render complaints are a named, dated, real problem this product's
      actual-photographed-room approach directly answers). store-listing.md and press-kit.md lead
      with real sourced products and the one-time-price framing -- consistent, no copy change
      needed this run (research-only addition). All three angles (real/buyable, multi-retailer,
      persistent-spatial-grounding) remain worth surfacing together in a FUTURE ASO/copy pass
      closer to launch (still not actioned now).
  channels: []                   # [{name, status, reach_7d, clicks_7d, signups_7d, ctr, notes}]
  experiments: []                # [{id, hypothesis, status, result, lift_pct, started, decided}]
  email:
    list_size: 0
    double_opt_in: true
    last_stage_sent: null
    open_rate: null
    click_rate: null
  content:
    published_7d: 0
    scheduled_next_7d: 0
    organic_sessions_7d: 0
  outreach:                      # curated 1:1 strategic email DRAFTS for the owner to send (docs/growth/OUTREACH.md); real numbers only
    drafted_7d: 0                # high-confidence outreach drafts the agent queued for owner review
    owner_sent_7d: 0             # owner-reported sends (the agent never sends)
    replies_7d: 0                # owner-reported replies; never fabricate
    signal: none                 # none | weak | emerging | strong
  learnings:
    - "This run (24) started with a clean git baseline: the designated branch (claude/beautiful-cori-742d4t) is freshly cut from the current default branch with no divergence -- no reset needed."
    - "Neither independent scorecard moved since Run 23: GTM_SCORECARD.md is still Run 5 (2026-08-03); QUALITY_SCORECARD.md is still the 11th grade (2026-08-10, overall C, ship_gate_met false, four sub-A ship-critical dims) -- both re-verified via the GitHub API (mcp__github__list_commits on each file's path), not the shallow local clone. Both S6 outreach lanes stay hard-off for the 24th consecutive run."
    - "Confirmed zero GTM-owned marketing docs (or ROADMAP.md/VISION.md) drifted from the shipped product since Run 23: `git log --oneline 02d155f..HEAD -- <every GTM-owned doc + ROADMAP.md + VISION.md>` returns nothing; the 9 Product-Factory commits in that range (harmony_score=0 coercion fix, a fetch-timeout fix, dependency bumps, test-coverage additions, housekeeping ledgers) touch code/tests/docs/loop-memory.md only, none of it pricing, features, or positioning-relevant."
    - "Demand-signal research this run was a deliberate no-op beyond the two mandatory structural re-probes (Reddit policy exclusion unchanged, Trustpilot still 403): per Run 22/23's own assessment, theme 4 is genuinely exhausted of distinct angles and themes 1-3 each already carry a theme-specific disconfirming datum, closing the last gap the GTM Auditor named as open. Forcing a new search this run with no genuinely new lead would be padding, not evidence -- correctly declined per this doc's own standing anti-padding practice (see Runs 9, 10, 17)."
    - "Re-verified PENDING_OPS.md directly: as_of is still 2026-08-07, unchanged since Run 21 (now spanning Runs 21-24), and every growth-relevant item is still `status: open`."
    - "Re-probed aptdesignerai.com a TWENTIETH time (2026-08-13): still `connect_rejected`/gateway 502 to CONNECT, identical signature to every prior probe, cross-checked against /__agentproxy/status recentRelayFailures. Funnel remains 0/null across every metric. CIRCUIT BREAKER still fires (24th run): the same core owner blockers remain open, unchanged since Run 1 (~47 days)."
    - "No maker != checker reviewer spawned this run: every edit is research/validation (two scorecard data-reads via the GitHub API, a re-verified marketing-consistency spot-check, two structural-gap re-probes) -- no landing/email/ASO copy, campaign, pricing/positioning claim, outreach draft, or ROADMAP/VISION/BUSINESS_CASE steer shipped, consistent with this doc's own precedent (Runs 5, 8, 16, 19, 23) for when a routine S4/S5 update does and doesn't warrant one."
    - "A NEW independent QUALITY_SCORECARD pass landed since Run 22 (as_of 2026-08-10, commit 46bee98, #857, '11th independent grade', confirmed via the GitHub API rather than the shallow local clone): overall held C, ship_gate_met still false, but sub-A ship-critical dims moved from three to FOUR -- functional_reality C (unchanged, 8th cycle), a new security_rls A+->B (fresh cross-tenant IDOR in POST /api/area-analysis), design_taste B (unchanged), and a new artifact_integrity A->B (a ROADMAP.md test-count overclaim), partially offset by business_case_strength recovering B->A. Noted for completeness (Product-Factory territory, not re-graded here); both new findings were graded before a same-day fix landed for the named IDOR (commit 236e5a3, ~14.5h later) -- so the B may already be stale-low, but the conclusion for GTM purposes is unaffected: functional_reality alone keeps ship_gate_met false, so both S6 outreach lanes stay hard-off regardless. GTM_SCORECARD.md itself is UNCHANGED since Run 5 (2026-08-03) -- re-verified via the GitHub API (mcp__github__list_commits on the file path), not local git, since this session's clone is shallow."
    - "Re-spot-checked (not re-assumed) that every prior GTM Auditor fix still holds: docs/BUSINESS_CASE.md still carries the '$73,519 store / $82,873 web' year-1 caveat; no commit touched any GTM-owned marketing doc since Run 21/22 (the only commit in the diff range is Run 22's own GROWTH_STATUS/GROWTH_MEMORY edit, 2485c8d). Nothing to re-fix here."
    - "Demand-signal research this run followed Run 22's next_action exactly: targeted theme 1's still-open theme-specific-disconfirming gap (the GTM Auditor Run 5 experiment_validity finding named themes 1, 3, and 4 as lacking one -- theme 3 gained Havenly's App Store disconfirming entry at Run 19; theme 1 remained open until this run). Two neutral-research-org searches (ACSI specialty-retailers, J.D. Power 2025/2026 retail-satisfaction studies) were honest negatives -- neither breaks out a furniture-specific category. Found a genuine new datum via the same App-Store-aggregate pattern that worked for themes 2/3: Wayfair's own App Store page, 4.9/5 across ~2.5M ratings (VERBATIM-VERIFIED, cross-checked against 3 independent app-data aggregators for the rating-count magnitude, not just trusted from one WebFetch), plus a verbatim dated reviewer quote crediting the app's filtering for ease-of-finding. This closes the last theme-1/3/4 gap the auditor could name as generically open -- theme 4 alone remains without one, and it carries an explicit structural reason (`research_status: structurally_hard_to_corroborate`, set Run 22) rather than an unaddressed gap."
    - "Trustpilot's block mechanism changed shape without changing substance: the bare hostname now 301-redirects to www.trustpilot.com before 403ing (previously a direct 403 at the bare host) -- worth recording explicitly since a future run seeing a 301 instead of a 403 could mistake it for progress; following the redirect still terminates in the identical bot-block JSON body."
    - "Re-verified PENDING_OPS.md directly: as_of is still 2026-08-07, unchanged since Run 21 (now spanning Runs 21-23), and every growth-relevant item is still `status: open`."
    - "Re-probed aptdesignerai.com a NINETEENTH time (2026-08-11): still `connect_rejected`/gateway 502 to CONNECT, identical signature to every prior probe, cross-checked against /__agentproxy/status recentRelayFailures. Funnel remains 0/null across every metric. CIRCUIT BREAKER still fires (23rd run): the same core owner blockers remain open, unchanged since Run 1 (~45 days)."
    - "No maker != checker reviewer spawned this run: every edit is research/validation (two scorecard data-reads via the GitHub API, a re-verified marketing-consistency spot-check, and a genuine demand-signal disconfirming-evidence addition) -- no landing/email/ASO copy, campaign, pricing/positioning claim, outreach draft, or ROADMAP/VISION/BUSINESS_CASE steer shipped, consistent with this doc's own precedent (Runs 5, 16, 19) for when a routine S4/S5 update does and doesn't warrant one."
  next_actions:
    - "CIRCUIT BREAKER (24th run) -- Owner: set SITE_GATE_PASSWORD in Vercel (2-min setup) to enable execute-mode + flip site_gate_up to true in GROWTH_STATUS"
    - "CIRCUIT BREAKER (24th run) -- Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL (15-min setup) to activate all lifecycle email sends"
    - "Owner: apply migration 031 (waitlist_emails.unsubscribed_at) -- required before the waitlist welcome email's real no-login unsubscribe link can actually record an opt-out; see PENDING_OPS.md apply-migration-031"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API -- this runtime's network restriction is scoped to aptdesignerai.com specifically, not general egress (see validation block)"
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron"
    - "Owner: enrol in the Apple Small Business Program (PENDING_OPS.md enroll-apple-small-business-program) -- the business case's shippable-today floor-clearing figure prices the 15% rate this enrolment step actually grants -- un-enrolled, the real rate is 30% and the store-channel figure needs re-deriving downward"
    - "Owner: apply migration 021 + set ANNUAL_BILLING_ENABLED=true -- no longer needed to clear the floor, but still unblocks the higher steady-state $149.3K figure and re-adding Pro Annual to marketing copy"
    - "Owner: set EMAIL_PHYSICAL_ADDRESS on the deployment so marketing-lifecycle emails (including waitlist_welcome_1) clear the CAN-SPAM footer requirement -- code + tests already ship; zero action needed beyond the env var"
    - "Owner: decide the real waitlist early-access discount (or decide not to offer one) and build/apply the Stripe coupon -- see PENDING_OPS.md waitlist-early-discount-coupon. Live copy is honest in the meantime (no specific number promised)."
    - "Next run: re-check whether the independent Product Quality Auditor's next pass moves functional_reality/security_rls/design_taste/artifact_integrity off their current sub-A grades -- THIS is the gate that unlocks outreach, so it is the single most important scorecard to watch now. Still worth checking whether the same-day IDOR fix (236e5a3) that post-dated the 11th grade shows up as recovered in the next pass (unchanged ask, Run 23 -> 24, since no new pass has landed yet)."
    - "Next run: re-check for a new GTM Auditor pass beyond Run 5 (as_of 2026-08-03, unchanged since Run 19-24)."
    - "Next run (demand-signal): theme 4 stays flagged structurally_hard_to_corroborate -- default to re-probing only the two standing structural gaps (Reddit, Trustpilot) unless a genuinely new lead surfaces. Themes 1, 2, and 3 each carry a theme-specific disconfirming datum; theme 4 is the only one without, for a stated structural reason. No further auditor-named demand-signal gap remains open -- redirect research effort toward strengthening CONFIRMING source count/diversity on the thinner themes only if a genuinely new angle surfaces, or toward other GTM work (a fresh ASO/positioning pass, a strategic-outreach target search) if research effort is better spent elsewhere given 24 runs of unmoved owner blockers."
    - "Next run: verify ASO keyword competition claims via App Store Connect Search Ads before landing keyword change (still owner-gated)"
    - "Product-Factory build note (not owner-actionable today): a real Stripe Reporting API integration would let trial-start/paid-conversion RATE metrics surface distinctly from the DB-derived subscriber counts already unlocked by INTERNAL_METRICS_TOKEN -- see the stripe_reporting validation entry. Similarly, an actual MRR computation (price x active_subscribers) and a true churn RATE (not just an approximate 30d count) are unbuilt in lib/growth/metrics.ts."
    - "Product-Factory build note (per GTM Auditor Run 5 pmf_read_accuracy, still open): activation_rate/retention_d1/d7/d30/organic_share_rate have ZERO code path in lib/growth/metrics.ts -- an activation event, a return-cohort query, and a share/referral query (migration 026 exists but is unqueried) are all unbuilt. This is pre-PMF's single highest-leverage growth-owned ask per GTM_STANDARD S1 -- without it, PMF stays unmeasurable even once users exist post-launch."
  owner_blockers:
    - "PRIORITY 1 -- Set SITE_GATE_PASSWORD in Vercel (2 min): gates app pre-launch, unblocks execute-mode outreach -- PENDING_OPS.md item set-site-gate-password (open 24 consecutive runs / ~47 days)"
    - "PRIORITY 2 -- Set RESEND_API_KEY + RESEND_FROM_EMAIL (verified domain, 15 min): unblocks ALL lifecycle email sends -- docs/growth/CONNECT.md Step 1 (open 24 consecutive runs / ~47 days)"
    - "PRIORITY 3 -- Apply migration 031 (waitlist_emails.unsubscribed_at): required for the waitlist welcome email's real no-login unsubscribe link to work -- PENDING_OPS.md apply-migration-031"
    - "PRIORITY 4 -- Set INTERNAL_METRICS_TOKEN: opens funnel metrics pull API -- docs/growth/CONNECT.md Step 2"
    - "PRIORITY 5 -- Set CRON_SECRET + apply migration 025: activates daily activation email cron -- PENDING_OPS.md"
    - "PRIORITY 6 -- Enrol in the Apple Small Business Program (PENDING_OPS.md enroll-apple-small-business-program): the business case's shippable-today floor-clearing figure prices the 15% rate this enrolment step actually grants -- un-enrolled, the real rate is 30% and the store-channel figure needs re-deriving downward"
    - "PRIORITY 7 -- Apply migration 021 + set ANNUAL_BILLING_ENABLED=true (also unblocks re-adding Pro Annual to marketing copy): no longer needed to clear the $100K floor (the 2026-07-28 take-rate correction did that), but still the gap between today's $121,339 store-channel steady-state figure and the $149.3K annual-tier steady-state planning case"
    - "PRIORITY 8 -- Apply remaining DB migrations 022/023/026/027/029/030 to prod -- PENDING_OPS.md"
    - "PRIORITY 9 -- Set EMAIL_PHYSICAL_ADDRESS: unblocks CAN-SPAM-compliant marketing-lifecycle sends (including waitlist_welcome_1) once RESEND_API_KEY also lands -- PENDING_OPS.md set-email-physical-address"
    - "PRIORITY 10 -- Connect/authorize social accounts -- docs/growth/CONNECT.md Step 4"
  links:
    in_app_analytics: null
    owner_doc: docs/growth/GROWTH_STATUS.md
```

## How to read it (owner)

- awaiting_connect: true + engine_built: true => engine code is live but channels not yet connected; agent prepares creative, takes no external action; see owner_blockers.
- funnel is the headline: waitlist signups pre-launch, then trial->paid + MRR + churn post-launch.
- experiments is where compounding happens post-launch; learnings is the data-grounded read.

## Phase notes

- Pre-launch: the number that matters is waitlist signups; most of the block is 0/null (correct/honest).
- Launching: trial starts + first conversions appear; experiments run on paywall + onboarding.
- Post-launch: ground every assumption on REAL conversion/retention/CAC data; run continuous
  experiments; double down on what converts; feed winners back into the business case.
