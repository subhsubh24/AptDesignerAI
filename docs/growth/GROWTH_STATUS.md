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
  as_of: 2026-07-01
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
  validation:                    # GTM_STANDARD S4 self-validation -- every external source this agent depends on; fail-closed
    - source: internal_metrics_api
      status: unavailable
      reason: "INTERNAL_METRICS_TOKEN not set on the deployment (owner action pending). Separately, this agent's own runtime has no outbound network path to aptdesignerai.com -- a direct connection attempt on 2026-07-01 was rejected by the environment's egress policy (403, policy denial). Setting the token alone will not let this agent read live metrics; the environment's network policy would also need to allow the production domain, or metrics need to reach the agent another way (e.g. a committed CI snapshot)."
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
    - "CIRCUIT BREAKER (Run 4, still fired): same 3 core owner blockers unresolved for a 4th consecutive run (SITE_GATE_PASSWORD, RESEND_API_KEY+RESEND_FROM_EMAIL, INTERNAL_METRICS_TOKEN). No owner action landed since Run 3 (2026-06-29); no growth-engine code work was needed this run (engine is complete at 100%) -- correct output is a quiet, honest no-op, not busywork."
    - "NEW (Run 4): this agent's own runtime has no outbound network path to aptdesignerai.com -- a direct request was rejected by the environment's egress policy (403, policy denial) via the agent proxy, and no INTERNAL_METRICS_TOKEN is present in this session. This means even after the owner sets the credentials, THIS agent still cannot self-verify live sends/metrics by curling the site directly -- verification will keep relying on the owner marking PENDING_OPS items done, unless the environment's network policy is widened or metrics reach the repo another way (see next_actions). Recorded honestly in the new `validation` block per GTM_STANDARD S4 rather than silently assumed."
    - "Funnel remains 0/null across every metric -- no connected source has reported numbers. Correct and honest: no fabrication."
    - "docs/quality/QUALITY_SCORECARD.md (independent Quality Auditor, not GTM-owned) is stale as_of 2026-06-29 vs product commits through 2026-06-30 (Runs 47-48 fixed some named gaps, e.g. the G1 LLM spend-guard and two a11y items) -- read as DATA only, not re-graded here. ship_gate_met is false regardless, so phase correctly stays pre_launch (marketing maturity gate, ANALYSIS_PLAYBOOK.md)."
    - "ASO keyword research from Run 3 remains blocked: competition estimates are not verifiable via App Store Connect Search Ads from this agent. No new attempt this run -- still owner-gated."
  next_actions:
    - "CIRCUIT BREAKER -- Owner: set SITE_GATE_PASSWORD in Vercel (2-min setup) to enable execute-mode + flip site_gate_up to true in GROWTH_STATUS"
    - "CIRCUIT BREAKER -- Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL (15-min setup) to activate all lifecycle email sends"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API (currently 503)"
    - "NEW -- Owner: check whether this Claude Code environment's network policy allows outbound HTTPS to aptdesignerai.com; without it, this agent cannot self-verify live metrics/sends even once credentials are set"
    - "Recommend (not built by this agent -- .github/workflows is out of the loop's blast radius): a scheduled CI job that calls GET /api/internal/growth-metrics and commits a small JSON snapshot into the repo would let this agent read real numbers without needing outbound network access itself"
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron"
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
