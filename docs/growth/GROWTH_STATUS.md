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
  as_of: 2026-07-03
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
  validation:                    # GTM_STANDARD S4 self-validation -- every external source this agent depends on; fail-closed
    - source: internal_metrics_api
      status: unavailable
      reason: "INTERNAL_METRICS_TOKEN not set on the deployment (owner action pending). Separately, this agent's own runtime has no outbound network path to aptdesignerai.com -- a direct connection attempt on 2026-07-01 was rejected by the environment's egress policy (403, policy denial), and a repeat attempt on 2026-07-03 again failed to reach the host at all (connection error). Setting the token alone will not let this agent read live metrics; the environment's network policy would also need to allow the production domain, or metrics need to reach the agent another way (e.g. a committed CI snapshot)."
    - source: resend_email
      status: unavailable
      reason: "RESEND_API_KEY / RESEND_FROM_EMAIL not set; the email lifecycle runs in dry-run (nothing sent)."
    - source: stripe_reporting
      status: unavailable
      reason: "No Stripe reporting credential is connected to this agent; trial/paid/MRR/churn metrics stay 0/null."
    - source: site_gate
      status: unavailable
      reason: "SITE_GATE_PASSWORD not set; site_gate_up stays false, hard-blocking pre-launch execute-mode outreach."
    - source: social_channels
      status: unavailable
      reason: "No social platform credentials connected (X / Instagram / TikTok / Reddit); the publishing queue stays dry-run."
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
  demand_signal:                 # GTM_STANDARD S10 -- pre-launch demand validation (leading indicator, NOT PMF)
    as_of: 2026-07-03
    method_note: >-
      WebSearch-based synthesis only, first attempt at this block. This session's network egress
      policy blocks WebFetch and direct fetch to reddit.com, apps.apple.com, play.google.com,
      trustpilot.com, and news.ycombinator.com (confirmed via curl through the proxy and 5 parallel
      research agents -- 403 policy-denial on all of them, including neutral control URLs) -- so no
      page was hand-opened and no quote below is independently verbatim-verified against its source
      page; each is WebSearch's own synthesized summary of the page instead. Zero citable Reddit
      posts were returned across roughly 20 query variations -- Reddit results appear suppressed
      from this search backend entirely, not merely under-populated. This falls SHORT of the
      GTM_STANDARD S10 "URL + verbatim quote" bar. Confidence below is capped at weak for this
      reason (a tooling gap, not a finding that the pain is absent) -- treat every theme as
      directional, not evidentiary, until a future run can fetch pages directly.
    confidence: weak             # capped by the tooling gap above, not by the themes' plausibility
    themes:
      - theme: "Furniture-shopping choice paralysis (multi-hour, no clear starting point)"
        sources: "eMarketer (furniture.com CMO cites ~9hrs/13 tabs per purchase journey); Baymard Institute independent UX research (87% of users avoid AR view-in-room, fall back to manual measuring); Hacker News thread 'Why buying furniture is so miserable' (news.ycombinator.com/item?id=35266271, 2023)"
        solved_by_product: "yes -- sourcing real, budget-fit products directly cuts the multi-tab search cost"
        recency: "durable -- backed by ongoing academic/UX research, not a spike"
      - theme: "AI room-render tools generate furniture that isn't real or buyable"
        sources: "RoomGPT / Interior AI App Store + Trustpilot reviews (around 2.8/5, 'edit features do not work', no real product links); Business of Home trade press, 2025 (the 2023 wave of AI interior-design apps has produced no clear winner)"
        solved_by_product: "yes -- closest to this product's core differentiator (real purchasable products vs. hallucinated furniture)"
        recency: "durable pain, but a crowded and actively contested gap -- new 2025-2026 entrants (Presti, Mattoboard) are explicitly launching to fix the same thing"
      - theme: "Prior full-service e-design (Havenly, Modsy) is expensive and/or fails on delivery"
        sources: "TechCrunch on Modsy's 2022 shutdown mid-refund (techcrunch.com/2022/07/17); Havenly Trustpilot pricing-markup and late-delivery complaints"
        solved_by_product: "partially -- self-serve software at the existing 29-dollar one-time tier undercuts concierge pricing and sidesteps the delivery/refund failure mode, but does not remove retailer-side fulfillment risk"
        recency: "Modsy's collapse reads as capital/M&A-driven per trade press, not a demand verdict -- does not disconfirm the underlying need, but flags the human-concierge business model as fragile; does not apply to a software-only product"
      - theme: "AR 'view in room' has not solved the visualize-before-buying trust gap"
        sources: "Baymard Institute (87% avoidance, independent research, not vendor-sourced); IKEA Place review aggregation (confusing placement UX, objects reading as illustrations)"
        solved_by_product: "yes, via a different mechanism -- a considered AI mockup of the user's actual photographed room rather than a live AR camera overlay"
        recency: "durable, ongoing UX problem, not a fad"
    disconfirming:
      - "Business of Home (2025): the 2023 wave of AI interior-design apps has produced no clear winner; some entrants described as lightly scammy cash grabs -- a real category-fatigue signal"
      - "A cited survey found consumers rating general-purpose ChatGPT as a better design-consultation experience than dedicated apps -- a free-substitute threat to any positioning that is just 'AI gives you design ideas'"
      - "AR view-in-room already had a large, well-resourced attempt (IKEA/Wayfair/Amazon) that is independently shown to be avoided by most users -- confirms the visualize-before-buying job is unsolved but shows that adding visualization alone is not sufficient"
      - "Zero Reddit evidence was obtained -- an explicit tooling gap (see method_note above), not a checked-and-absent finding; do not read this as disconfirming"
    positioning_implication: >-
      Directional only -- weak confidence, no business-case number change, no roadmap steer (well
      below the S3 bar for either). Suggests leading with "real, buyable, budget-fit furniture for
      your actual room" over an undifferentiated "AI design ideas" claim (which a free chatbot can
      now credibly substitute), and keeping entry pricing low relative to Havenly/Modsy-style
      concierge pricing (a recurring complaint in the research). store-listing.md and press-kit.md
      already lead with real sourced products and the one-time-price framing, so no copy change is
      needed this run -- recorded here to sharpen future ICP/positioning work and as a baseline to
      re-verify once direct fetch access exists.
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
    - "CIRCUIT BREAKER (Run 5, still fired): same 3 core owner blockers unresolved for a 5th consecutive run (SITE_GATE_PASSWORD, RESEND_API_KEY+RESEND_FROM_EMAIL, INTERNAL_METRICS_TOKEN). PENDING_OPS.md's own as_of is still 2026-06-29 -- unchanged since Run 3 -- confirming no owner action has landed in the ~5 days since. No growth-engine code work was needed (engine remains complete at 100%); correct output stays a quiet, honest no-op on execution, not busywork."
    - "NEW (Run 5): re-confirmed Run 4's network finding -- a repeat attempt to reach aptdesignerai.com on 2026-07-03 again failed to connect (this time a connection error rather than an HTTP 403, but the practical result is identical: no reachable path). No change to the validation block's conclusion."
    - "NEW (Run 5): filled the previously-missing GTM_STANDARD S10 demand_signal block for the first time (see the new `demand_signal` block above). In doing so, discovered this session's research tooling is ALSO network-restricted for EXTERNAL sources, not just aptdesignerai.com -- WebFetch and direct fetch to Reddit/App Store/Trustpilot/Hacker News all hit the same policy-denial pattern. The only available signal was WebSearch's own synthesized summaries, which are NOT independently verbatim-verified quotes -- short of the S10 citation bar. Recorded the themes honestly at `confidence: weak` with the tooling gap stated explicitly, rather than presenting search-engine paraphrase as verified evidence. This is the correct call per the anti-gaming rule: a capped-confidence finding beats an overstated one."
    - "NEW (Run 5): this session's own environment has a SITE_GATE_PASSWORD value set, unlike Runs 1-4 which found none. Investigated before use: VALIDATOR_APT_EMAIL/VALIDATOR_APT_PASSWORD are also present with the same naming pattern, indicating this is credential scaffolding for the SEPARATE computer-use/Quality-Auditor validator routine (which needs to log into and bypass the gate on the deployed app to test it), not evidence that the production Vercel deployment has SITE_GATE_PASSWORD configured. Per S4 fail-closed, did NOT use it and did NOT flip `site_gate_up` -- an env var in this agent's own sandbox says nothing about the deployed app's actual config, and this agent still has no network path to verify production directly (see above)."
    - "Funnel remains 0/null across every metric -- no connected source has reported numbers. Correct and honest: no fabrication."
    - "docs/quality/QUALITY_SCORECARD.md (independent Quality Auditor, not GTM-owned) is still as_of 2026-07-01, overall C, ship_gate_met false, despite the Product Factory shipping through PR #377 since. Read as DATA only, not re-graded here; phase correctly stays pre_launch (marketing maturity gate, ANALYSIS_PLAYBOOK.md)."
    - "Reviewed all marketing docs (store-listing, press-kit, email-lifecycle, social-drafts, content-calendar) for consistency with the live product: pricing/tiers are consistent everywhere ($29 Apartment, $49/mo Pro). None mention the Pro Annual ($399/yr) tier from docs/BUSINESS_CASE.md -- correctly so, since migration 021 (the DB constraint pro_annual needs) is still unapplied to prod per PENDING_OPS.md, so marketing that tier would point users at a checkout path that isn't live yet. Not a staleness bug; no edit made."
    - "ASO keyword research from Run 3 remains blocked: competition estimates are not verifiable via App Store Connect Search Ads from this agent. No new attempt this run -- still owner-gated."
  next_actions:
    - "CIRCUIT BREAKER -- Owner: set SITE_GATE_PASSWORD in Vercel (2-min setup) to enable execute-mode + flip site_gate_up to true in GROWTH_STATUS"
    - "CIRCUIT BREAKER -- Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL (15-min setup) to activate all lifecycle email sends"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API (currently 503)"
    - "Owner: check whether this Claude Code environment's network policy allows outbound HTTPS to aptdesignerai.com AND to reddit.com/apps.apple.com/play.google.com/trustpilot.com/news.ycombinator.com; without the former this agent cannot self-verify live metrics/sends even once credentials are set, and without the latter the S10 demand_signal block cannot clear the verbatim-quote citation bar (it stays at the current weak, search-synthesized confidence)"
    - "Recommend (not built by this agent -- .github/workflows is out of the loop's blast radius): a scheduled CI job that calls GET /api/internal/growth-metrics and commits a small JSON snapshot into the repo would let this agent read real numbers without needing outbound network access itself"
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron"
    - "Next run: re-attempt the S10 demand_signal research if/when direct fetch access to Reddit/App Store/Trustpilot exists, to replace the current search-synthesized themes with hand-verified verbatim quotes and raise confidence above weak"
    - "Next run: verify ASO keyword competition claims via App Store Connect Search Ads before landing keyword change"
  owner_blockers:
    - "PRIORITY 1 -- Set SITE_GATE_PASSWORD in Vercel (2 min): gates app pre-launch, unblocks execute-mode outreach -- PENDING_OPS.md item set-site-gate-password"
    - "PRIORITY 2 -- Set RESEND_API_KEY + RESEND_FROM_EMAIL (verified domain, 15 min): unblocks ALL lifecycle email sends -- docs/growth/CONNECT.md Step 1"
    - "PRIORITY 3 -- Set INTERNAL_METRICS_TOKEN: opens funnel metrics pull API (currently 503) -- docs/growth/CONNECT.md Step 2"
    - "PRIORITY 4 -- Confirm this environment's network policy allows outbound HTTPS to aptdesignerai.com (see the Claude Code on the web environment-config docs) -- without it, PRIORITY 3 alone will not let this agent self-verify"
    - "PRIORITY 5 -- Set CRON_SECRET + apply migration 025: activates daily activation email cron -- PENDING_OPS.md"
    - "PRIORITY 6 -- Apply DB migrations 021/022/023/026/027 to prod -- PENDING_OPS.md"
    - "PRIORITY 7 -- Connect/authorize social accounts -- docs/growth/CONNECT.md Step 4"
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
