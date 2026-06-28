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
  as_of: 2026-06-28
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
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
  learnings:
    - "All funnel metrics are 0/null — INTERNAL_METRICS_TOKEN not yet set; no connected source has reported numbers. This is day 2 of the same blocker; circuit breaker watch active."
    - "Engine is built and all code ships dry-run; the owner connecting Resend + setting INTERNAL_METRICS_TOKEN are the two highest-leverage unblocking actions."
    - "Activation email cron (A1/A2/A3) now wired: vercel.json daily at 10:00 UTC, /api/cron/activation-emails, idempotent via user_email_stages (migration 025). Fires dry-run until RESEND_API_KEY + CRON_SECRET are set."
    - "Win-back E1 email fires on subscription cancellation; paid_welcome_1 fires on free->paid conversion. Both dry-run until RESEND_API_KEY is set."
  next_actions:
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron (see PENDING_OPS.md)"
    - "Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL to send any lifecycle email (highest leverage)"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API (currently 503)"
    - "Next run: enqueue pre-launch social draft schedule for launch week once owner sets a launch date"
    - "Next run: upgrade /account to add explicit email opt-out toggle (strengthens CAN-SPAM compliance)"
  owner_blockers:
    - "Set RESEND_API_KEY + RESEND_FROM_EMAIL (verified domain) to send lifecycle email — docs/growth/CONNECT.md Step 1"
    - "Set INTERNAL_METRICS_TOKEN to open the funnel-metrics pull API (currently 503) — docs/growth/CONNECT.md Step 2"
    - "Set CRON_SECRET to activate activation email cron + apply migration 025 — PENDING_OPS.md"
    - "Connect/authorize social accounts (publishing queue built + dry-run; live per-channel API client is a follow-on) — docs/growth/CONNECT.md Step 4"
    - "Apply DB migrations 021/022/023/025 to prod (see PENDING_OPS.md)"
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
