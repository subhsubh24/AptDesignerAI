# Product Signals → Work Playbook (post-launch pre-triage)

Shared, product-agnostic playbook. Product/growth-specific, so per FACTORY_STANDARD §19 it lives here
(the product repo), NOT in FACTORY_STANDARD. This is the PRE-TRIAGE half of the factory: it turns REAL
production + customer signals into prioritized WORK, filed into our tracker — **GitHub issues + ROADMAP
steers** (we do not use a separate board). The build loops (product / GTM factory) then COMPLETE that work
through the normal gates. INERT until the owner connects each source (fail-closed; re-probe every run per
§28). Real data ONLY — never fabricate a bug, review, complaint, churn reason, or metric; "insufficient
data" over noise; privacy-safe AGGREGATES only (never commit raw PII or session recordings).

Ownership: the **product factory** owns production-health signals (Loop A — extends DEEP_DIAGNOSIS from
reactive to a standing scan); the **GTM factory** owns customer/business signals (Loops B + C — it already
does funnel/PMF analytics).

## Loop A — System Health / Bug-Finder (product factory; standing scan)
Runs each run (or a daily pass) IF error-tracking + host logs are connected.
- **Sources:** error tracking (Sentry / PostHog) + host/function logs (Vercel / Supabase) — owner-connected
  READ access.
- **Do:** scan new errors / regressions / spikes since the last run; cluster by ROOT CAUSE (not the surface
  string). For each real, reproducible cluster, FILE a bug issue — title = the failing behavior; body = the
  terminal cause + affected route + first-seen + frequency + a repro. CRITICAL clusters (crash / data-loss /
  security / wallet-drain) → label urgent, JUMP THE QUEUE. Dedup against open issues (never refile).
- **Honesty:** only file a bug backed by real telemetry; a spike with no repro is an "investigate" note, not
  a fabricated fix.

## Loop B — UX / Feedback (GTM factory)
Runs weekly (or each GTM run) IF session-replay / support / feedback are connected.
- **Sources:** session replays (PostHog — rage clicks, dead clicks, drop-off), support inbox (Intercom/Fin/
  email), in-app feedback, app-store reviews.
- **Do:** analyze privacy-safe AGGREGATES; find the top friction patterns (where users rage-click, abandon,
  get confused, or complain most). For each real pattern, FILE a UX issue (the friction + where + evidence:
  N sessions / N tickets); if high-confidence + revenue-linked, open a ROADMAP steer (§3). Weight the
  onboarding / paywall / core-loop surfaces first (highest conversion impact; see ONBOARDING_CONVERSION_PLAYBOOK).
- **Honesty:** real patterns only, N stated; never invent a complaint or a review; never store raw session
  data / PII in the repo.

## Loop C — Churn Analysis (GTM factory)
Runs daily (or each GTM run) IF billing + usage are connected.
- **Sources:** billing (Stripe / StoreKit / RevenueCat — cancels in the last window + plan/tenure), usage
  (Supabase / analytics), the pre-cancel session replay.
- **Do:** for each cancel, classify the likely cause from REAL data — wrong-ICP / never-hit-the-aha (low
  activation) / hit-a-bug / price / value-gap — using aggregates + the pre-cancel behavior. Roll up a
  churn-reason breakdown; FILE or COMMENT on issues to BUMP PRIORITY on the reasons that actually drive
  churn (e.g. "activation gap in onboarding" → bump the onboarding fix). Feed the churn rate + reasons into
  docs/BUSINESS_CASE.md (real cohort data WINS over assumptions). Report the churn digest to the DASHBOARD
  (GROWTH_STATUS), never email.
- **Honesty:** a churn reason must be grounded in that customer's real data; small N → "insufficient data,"
  never over-fit; never fabricate.

## How it files work (our tracker = GitHub issues + ROADMAP)
- Each finding → a GitHub issue: clear label (`bug` / `ux` / `churn`), a priority, the evidence, and a dedup
  check. Critical bugs jump the queue.
- High-confidence + real-data + revenue-linked patterns → a ROADMAP steer (§3), so the build loop tackles the
  fix next.
- The existing SELECT (value bar + lowest-incomplete + the binding constraint) then picks these up — filed
  signal competes on the value bar like all work.
- Human-in-the-loop: SELECTION stays autonomous (the factory decides), but the owner can reprioritize from the
  dashboard at any time, and the human gate still applies to anything irreversible/outward.

## Activation (inert until connected — fail-closed, §28)
Each loop runs ONLY when its sources are connected (owner secrets), re-probed every run. A disconnected source
→ the loop is a NO-OP and surfaces an OWNER_ACTION `connect-<source>` (so it shows on the dashboard). NEVER
fabricate signal from a disconnected source. Owner connects, as they exist: error tracking (Sentry/PostHog),
host logs, session replay, support inbox, billing (Stripe/StoreKit/RevenueCat), usage/analytics.

## Boundaries (reaffirmed)
Real data only — never fabricate. Privacy-safe aggregates; never commit raw PII / session recordings.
"Insufficient data" over noise. Honesty enforced; the dashboard (not email) is the report. Pre-launch this is
LATENT (0 users → no signal) — do not invent it; it activates as real usage + connected sources arrive.
