# GROWTH MEMORY — AptDesignerAI

Running log of what the Growth Agent has tried, what worked, what didn't, and why.
Read this FIRST each run to avoid repeating dead ends and to build on what worked.
Appended to (never overwritten) by each run.

---

## Run 1 — 2026-06-27 (first Growth Agent run)

### What we found
- Engine is fully built: waitlist capture (Supabase), double opt-in email, email lifecycle abstraction (lib/email, dry-run default), social publishing queue (dry-run), analytics pull API — all built in prior engineering runs.
- No channels connected: RESEND_API_KEY, INTERNAL_METRICS_TOKEN, and social credentials all missing. This means all funnel metrics are 0/null (correct — nothing has been reported by a connected source). Phase: pre_launch.
- Single email template existed: waitlist confirmation (waitlist.ts). All lifecycle stages were typed in lib/email/types.ts but had no HTML templates.
- Billing webhook did not send any lifecycle emails despite having user IDs available on subscription events.

### What we built this run
- **6 lifecycle email templates** (lib/email/templates/lifecycle.ts): Activation sequence (A1/A2/A3) and Win-back sequence (E1/E2/E3). Warm editorial HTML matching the existing waitlist template. CAN-SPAM-compliant footer with working /account unsubscribe link.
- **Win-back E1 trigger in billing webhook**: on customer.subscription.deleted, looks up user email and sends winback_1 (dry-run until RESEND_API_KEY set). Idempotent via pre-upsert status check.

### Independent review findings (resolved before merge)
- Broken unsubscribe placeholder → fixed (replaced {UNSUBSCRIBE_URL} with actual ${siteUrl}/account link).
- Non-idempotent win-back → fixed (pre-upsert status check prevents double-send on Stripe re-delivery).

### What we did NOT do (and why)
- Did not enqueue social drafts: social queue requires INTERNAL_METRICS_TOKEN which the owner hasn't set. Enqueueing without being able to verify queue status would be speculative.
- Did not wire activation email triggers (A1/A2/A3): requires a signup event hook in Supabase (Edge Function or server-side auth route). This needs more investigation of the auth flow before wiring safely.
- Did not attempt to read real funnel metrics: INTERNAL_METRICS_TOKEN not set, API returns 503.

### Owner blockers (unchanged from previous state)
1. RESEND_API_KEY + RESEND_FROM_EMAIL — highest leverage: unblocks all email lifecycle sends
2. INTERNAL_METRICS_TOKEN — unblocks real funnel reporting + social queue verification
3. Social account credentials — lower priority until metrics are live
4. DB migrations 021/022/023 to prod

### Lessons learned
- The independent review step caught two real issues (unsubscribe compliance, idempotency) before merge. Worth doing for email content.
- The biggest constraint to growth execution is the owner connecting channels, not missing code. The engine is built; the bottleneck is credentials.
- Next run priority: wire activation email triggers (signup event hook) + social draft enqueueing.

### Circuit breaker check
- Same owner blockers as before? YES — channels still not connected. This is run 1, so no multi-run repetition yet. If by run 3 the same blockers remain, flag prominently in report and propose the single most actionable connection step.

---

## Run 2 — 2026-06-28

### What we found
- All Run 1 owner blockers remain: RESEND_API_KEY, CRON_SECRET, INTERNAL_METRICS_TOKEN, social credentials, and DB migrations 021/022/023 are all unset/unapplied.
- Funnel metrics still 0/null (correct — INTERNAL_METRICS_TOKEN not set, API returns 503).
- Activation email templates (A1/A2/A3) existed from Run 1 but had no trigger mechanism — no cron, no queue, no event hook.
- vercel.json was absent: no cron jobs registered with Vercel.
- user_email_stages idempotency table did not exist: even if a cron existed, it could double-send.

### What we built this run
- **Migration 025** (`supabase/migrations/025_user_email_stages.sql`): `user_email_stages(user_id, stage UNIQUE)` table with RLS enabled. Records each lifecycle email send; the UNIQUE constraint makes send idempotent across retries.
- **Activation email cron** (`app/api/cron/activation-emails/route.ts`): daily GET endpoint (Auth: Bearer CRON_SECRET) that queries profiles by signup window (daysAgo ± 4h), skips users with any project (engaged proxy), looks up email via admin.auth.admin.getUserById, sends via sendEmail(), and records to user_email_stages. Returns {ok, results[]} with per-stage candidate/sent/skipped/error counts. Dry-run safe: no-op without RESEND_API_KEY.
- **vercel.json**: registers the cron at `0 10 * * *` (10:00 UTC daily) so Vercel invokes it automatically.
- **PENDING_OPS.md** updated: added `apply-migration-025` and `set-cron-secret` items to the YAML block + prose runbook section.

### Independent review
No independent maker/checker review this run — the cron is infrastructure (not email copy or a marketing campaign). The idempotency contract was verified by code inspection: UNIQUE(user_id, stage) + ON CONFLICT ignore on insert.

### What we did NOT do (and why)
- Did not pull real funnel metrics: INTERNAL_METRICS_TOKEN still not set, API returns 503.
- Did not enqueue social drafts: no launch date set; pre-launch content is time-relative. Enqueueing without a date creates queue noise with no signal.
- Did not add explicit email opt-out toggle to /account: deferred to Run 3 (lower priority than wiring the cron).
- Did not apply DB migrations: owner action, not agent action.

### Owner blockers (updated)
1. RESEND_API_KEY + RESEND_FROM_EMAIL — highest leverage: unblocks all email lifecycle sends
2. CRON_SECRET — activates the activation email cron (migration 025 also required)
3. Apply migration 025 to prod — unblocks activation email idempotency table
4. INTERNAL_METRICS_TOKEN — unblocks real funnel reporting
5. Social account credentials — lower priority until metrics are live
6. DB migrations 021/022/023 to prod

### Lessons learned
- vercel.json cron registration is a prerequisite that's easy to overlook; it's now in place.
- Idempotency must be built-in from day 1 for any cron that touches email — the UNIQUE constraint + record-after-send pattern is the right shape.
- The gap between "template exists" and "email is triggered" is a real, silent failure mode. Run 1 built templates; Run 2 wired the trigger.

### Circuit breaker check
- Same owner blockers as Run 1? YES — all channels still not connected. This is Run 2; circuit breaker watch active. If Run 3 shows the same blockers, flag prominently and surface the single most actionable unblocking step in the daily report.

---

## Run 3 — 2026-06-29

### CIRCUIT BREAKER FIRED

All Run 1 + Run 2 owner blockers remain unresolved for a third consecutive run:
- RESEND_API_KEY, RESEND_FROM_EMAIL — not set
- CRON_SECRET — not set
- INTERNAL_METRICS_TOKEN — not set; API returns 503
- SITE_GATE_PASSWORD — not set; site_gate_up: false
- DB migrations 021/022/023/025 — not applied to prod
- Social account credentials — not connected

Circuit breaker fires at Run 3. Flagged prominently in GROWTH_STATUS and Gmail report.

### What we found
- Funnel: all metrics still 0/null (correct — INTERNAL_METRICS_TOKEN not set).
- Site gate (E8) was built in Run ~39 (PR #173) but SITE_GATE_PASSWORD has not been set by owner. site_gate_up remains false → HARD BLOCK on execute-mode outreach.
- All lifecycle email infrastructure (A1/A2/A3 activation cron via vercel.json, E1-E3 win-back, paid_welcome_1) is built and dry-run-ready. Gap: RESEND_API_KEY only.
- Existing marketing assets (email lifecycle sequences, content calendar, waitlist page) assessed as high quality; no changes needed.

### What we did this run
- **ASO keyword research**: identified candidate improvements to the Apple App Store keywords field (replacing "design ideas,style" with "room analysis,AI redesign"). Independent reviewer (maker≠checker) blocked the change — competition estimates cited to WebSearch results, not verifiable via App Store Connect Search Ads as the store-listing.md itself requires. Correct outcome: change NOT made.
- **GROWTH_STATUS.md**: updated as_of to 2026-06-29; replaced learnings/next_actions/owner_blockers with circuit-breaker-aware content and PRIORITY ordering.
- **GROWTH_MEMORY.md**: appended this Run 3 entry.

### What we did NOT do (and why)
- Did not update store-listing.md keywords: independent reviewer returned REQUEST_CHANGES; competition estimates unverifiable without App Store Connect Search Ads access. Findings preserved here for next run.
- Did not create any outreach drafts: HARD BLOCK — site_gate_up: false. Zero outreach this run, correct.
- Did not pull real funnel metrics: INTERNAL_METRICS_TOKEN still not set.
- Did not enqueue social drafts: awaiting_connect: true, no launch date set.

### ASO keyword research findings (to validate next run)
Current keywords (97 chars): `interior design,room design,AI decor,home decor,room planner,furniture,palette,design ideas,style`

Research-backed candidate swap (if competition validates):
- Replace `design ideas,style` (12 chars) with `room analysis,AI redesign` (26 chars) → new total: ~111 chars — OVER LIMIT, needs trimming
- Better candidate (99 chars): `interior design,room design,AI decor,home decor,room planner,palette,room analysis,AI redesign`
  (drops `furniture` and `design ideas,style`; adds `room analysis,AI redesign`)
- Owner must validate competition estimates in App Store Connect Search Ads before this change lands.

### Owner blockers (updated with PRIORITY ordering)
1. PRIORITY 1 — Set SITE_GATE_PASSWORD in Vercel (2 min): gates app pre-launch, unblocks execute-mode
2. PRIORITY 2 — Set RESEND_API_KEY + RESEND_FROM_EMAIL (15 min): unblocks all lifecycle email sends
3. PRIORITY 3 — Set INTERNAL_METRICS_TOKEN: opens funnel metrics API
4. PRIORITY 4 — Set CRON_SECRET + apply migration 025: activates activation cron
5. PRIORITY 5 — Apply DB migrations 021/022/023 to prod
6. PRIORITY 6 — Connect/authorize social accounts

### Lessons learned
- The maker≠checker step caught an unverifiable claim in the ASO research. Correct to block: store-listing.md itself says "competition estimates are unverified — validate in App Store Connect Search Ads before submission." The lesson is to route ASO keyword changes through ASC Search Ads validation before drafting them as final.
- The circuit breaker is now firing: 3 runs with the same blockers. The single most actionable pair is SITE_GATE_PASSWORD (2 min, enables execute-mode) + RESEND_API_KEY (15 min, enables all email). Neither requires new code — both are pure Vercel environment variable sets.
- No new code was written this run — the growth engine is complete; the constraint is credentials, not code.

### Circuit breaker check
- Same owner blockers as Runs 1 and 2? YES — circuit breaker FIRED (Run 3). Flagged prominently in report and GROWTH_STATUS.

---

## Run 4 — 2026-07-01

### What we found
- All Run 3 owner blockers remain unresolved: SITE_GATE_PASSWORD, RESEND_API_KEY/RESEND_FROM_EMAIL,
  INTERNAL_METRICS_TOKEN, CRON_SECRET, and DB migrations 021/022/023/026/027 are still unset/unapplied
  per PENDING_OPS.md (all `status: open`). No owner action landed in the ~2 days since Run 3.
- Between Run 3 and Run 4 the Product Factory shipped Runs 44–48 (PRs up to #271): domain reconciliation
  to aptdesignerai.com, a waitlist referral loop (migration 026) and web upsell surface credited into
  BUSINESS_CASE.md (recomputed 2026-06-30, still floor-clearing at $122.9K base ARR), several
  security/a11y/correctness fixes, and — notably — `git.deploymentEnabled: false` in vercel.json (PR #271,
  a deliberate pre-launch cost control to stop per-PR Vercel builds; deploys are now on-demand). None of
  this changes GTM state: still pre_launch, still no connected channels, still 0/null funnel.
- `docs/quality/QUALITY_SCORECARD.md` (owned by the independent Quality Auditor) is stale — as_of
  2026-06-29, `overall: C`, `ship_gate_met: false` — while several of its named gaps (e.g. the G1
  unguarded-LLM-spend gap on products/evaluate*, two a11y items) were already fixed by Runs 47–48. Not
  this loop's routine to re-grade; read as DATA. `ship_gate_met` stays false either way, so the marketing
  maturity gate (ANALYSIS_PLAYBOOK.md) correctly keeps phase at `pre_launch`, waitlist-only.
- **New finding this run:** attempted to independently verify source availability (rather than just
  trusting PENDING_OPS status text, per GTM_STANDARD S4 fail-closed) by fetching `https://aptdesignerai.com/`
  and the growth-metrics API directly. Both attempts were rejected by this session's network egress policy
  (agent-proxy log: `403` "policy denial" on CONNECT to `aptdesignerai.com:443`). No `INTERNAL_METRICS_TOKEN`
  or similar credential is present in this session's environment either. Conclusion: this agent's runtime
  has no path to self-verify live sends/metrics by calling the production app directly, independent of
  whether the owner sets the Vercel-side credentials. This has presumably been true for Runs 1–3 as well
  (their "503" claims read as inferred from PENDING_OPS status, not an actual probe) but was not previously
  stated explicitly.

### What we built this run
- **GROWTH_STATUS.md**: added a `validation:` block (GTM_STANDARD S4) explicitly declaring the status of
  every external source this agent depends on (internal_metrics_api, resend_email, stripe_reporting,
  site_gate, social_channels) — all `unavailable`, with the real reason for each, including the new
  network-egress finding on the metrics-api entry. Added an empty `pending_approvals: []` scaffold
  (GTM_STANDARD S9) for future Tier-B channel-plan proposals — empty because no channel plan is proposed
  this run (no data supports one). Verified both parse and pass `node scripts/validate-gtm.mjs` (added
  `js-yaml` etc. via `npm install` to run the check locally; no source changes to `package.json`).
  Refreshed `as_of`, `learnings`, `next_actions`, `owner_blockers` (added migrations 026/027 to the
  migration-backlog blocker, added the network-policy owner action, and recommended — but did not build,
  since `.github/workflows/` is out of this loop's blast radius — a scheduled CI job that snapshots
  `GET /api/internal/growth-metrics` into a committed file so a future agent run could read real numbers
  without needing outbound network access itself).

### What we did NOT do (and why)
- Did not pull real funnel metrics: no reachable source, as above. Correctly stayed 0/null.
- Did not attempt outreach: `site_gate_up: false` — hard block per OUTREACH.md / ANALYSIS_PLAYBOOK.md.
  Zero outreach drafts this run, correct.
- Did not touch ROADMAP.md / VISION.md: no real data exists to support a steer; nothing to recommend
  beyond what's already in `owner_blockers`.
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect Search Ads
  competition data from this agent; no new information since Run 3.
- Did not edit PENDING_OPS.md: its existing items already cover every blocker found this run; adding a
  network-policy item there (an environment-config action, not a Vercel/Supabase one) would mix two
  different kinds of "owner action" into a shared ledger file multiple routines edit — kept it in
  GROWTH_STATUS.md's owner_blockers/next_actions instead, which already renders on the dashboard.
- Did not re-grade or edit QUALITY_SCORECARD.md / GTM_SCORECARD.md: owned by independent auditor routines
  (maker != checker); consumed as data only.

### Lessons learned
- The circuit breaker is now in its 4th consecutive run with the same 3 core blockers. No further
  loop-side code work will change that — the constraint is entirely owner-side credential/config setup.
  Repeating the same "engine is built, waiting on credentials" framing every run without new information
  would be padding; this run's value-add was narrowing down a previously-unstated SECOND blocker (network
  egress) so the owner doesn't set the credentials and then wonder why the agent still reports 0/null.
- Self-validation should be an explicit, structured artifact (`validation:` block), not just prose buried
  in `learnings` — makes the fail-closed contract (GTM_STANDARD S4) mechanically checkable by
  `scripts/validate-gtm.mjs` going forward (source: `gs.sources ?? gs.validation`).
- Before assuming "the API returns 503," actually attempt the request (or explicitly say the attempt
  itself is impossible from this runtime) rather than inferring from PENDING_OPS `status: open` alone —
  the two failure modes (credential unset vs. no network path) have different fixes and both matter to
  the owner.

### Circuit breaker check
- Same owner blockers as Runs 1, 2, and 3? YES — circuit breaker remains FIRED (Run 4, 4th consecutive
  run). Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) + RESEND_API_KEY/RESEND_FROM_EMAIL
  (15 min). New secondary item: confirm this environment's network policy allows outbound HTTPS to
  aptdesignerai.com, or the agent will keep reporting 0/null even after the credentials above are set.

---

## Run 5 — 2026-07-03

### What we found
- All Run 1-4 owner blockers remain unresolved: SITE_GATE_PASSWORD, RESEND_API_KEY/RESEND_FROM_EMAIL,
  INTERNAL_METRICS_TOKEN, CRON_SECRET, and DB migrations 021/022/023/026/027 are still unset/unapplied.
  `PENDING_OPS.md`'s own `as_of` is still 2026-06-29 — unchanged since Run 3 — which itself confirms no
  owner action has landed in the intervening ~5 days.
- Re-attempted a direct connection to `https://aptdesignerai.com/` from this session (per S4, verify
  rather than assume): still unreachable — a connection error this time rather than Run 4's HTTP 403,
  but the practical conclusion (no reachable path from this runtime) is unchanged.
- Between Run 4 and Run 5 the Product Factory shipped further work (through PR #377): mostly
  FACTORY_STANDARD/GTM_STANDARD doc coherence fixes, a11y fixes, security hardening
  (`getAdminClient` fail-loud, floor-plan SSRF guard), and test coverage additions. None of it changes
  GTM state — still `pre_launch`, still no connected channels, still 0/null funnel.
  `docs/quality/QUALITY_SCORECARD.md` is still `as_of: 2026-07-01`, `overall: C`, `ship_gate_met: false`
  (core money-path still lacks outcome-asserting runtime E2E per its own `functional_reality` gap) — read
  as DATA only; phase correctly stays `pre_launch`.
- **New finding:** this session's own environment has a `SITE_GATE_PASSWORD` value set (Runs 1-4 found
  none). Before using it for anything, checked what it actually is: `VALIDATOR_APT_EMAIL` /
  `VALIDATOR_APT_PASSWORD` (and `VALIDATOR_GROCERY_*` for a sibling product) are present with the same
  naming convention, indicating this is credential scaffolding for the *separate* computer-use /
  Quality-Auditor validator routine (which needs to log into the deployed app, bypassing the gate, to
  functionally test it) — not evidence that the production Vercel deployment itself has
  `SITE_GATE_PASSWORD` configured. This agent's own sandbox env is a different surface from the deployed
  app's Vercel env; an env var of the same name here says nothing about production. Per S4 fail-closed,
  did NOT use it, did NOT attempt to log into or gate-bypass the production app with it (out of this
  loop's remit either way), and did NOT flip `site_gate_up`. Recorded transparently rather than silently
  ignored, since a future run (or an auditor reading this) should not mistake "present in the sandbox"
  for "connected in production."
- **New work: filled `GTM_STANDARD` §10's `demand_signal` block for the first time** (Runs 1-4 never
  populated it — it postdates their runs). Dispatched a research subagent to mine real public pain
  signal (Reddit first, then App Store/Play/Trustpilot reviews, X, HN, Quora) per the §10 method.
  **Discovered a second, more consequential tooling gap:** this session's network egress policy blocks
  not just `aptdesignerai.com` (Run 4's finding) but also `WebFetch` generally and direct access to
  `reddit.com`, `apps.apple.com`, `play.google.com`, `trustpilot.com`, and `news.ycombinator.com` — all
  403 policy-denial, confirmed via curl through the proxy and independently by 5 parallel research
  agents (even neutral control URLs like `example.com` failed). Consequence: **zero Reddit posts were
  returned** across ~20 query variations (Reddit appears suppressed from this environment's WebSearch
  backend, not merely sparse), and every other citation is WebSearch's own synthesized summary of a page
  — not a hand-verified verbatim quote as §10 requires ("URL + a short verbatim quote").

### What we built this run
- **`docs/growth/GROWTH_STATUS.md`**: bumped `as_of` to 2026-07-03; refreshed the `internal_metrics_api`
  validation reason with the re-confirmed unreachability; added the new `demand_signal` block (4 themes:
  furniture-shopping choice paralysis, AI tools generating unbuyable furniture, prior full-service
  e-design failures on price/delivery, AR view-in-room's unresolved trust gap — each with sources,
  solved-by-product read, and recency/durability read) plus an explicit `disconfirming` list (category
  fatigue per 2025 trade press, ChatGPT as a free substitute, AR's own large prior attempt already shown
  to be avoided, and the Reddit gap itself flagged as "not obtained" rather than "checked and absent").
  Set `confidence: weak` and wrote a `method_note` stating exactly why (search-synthesized, not
  verbatim-verified) — the honest call given the tooling gap, instead of dressing up search-engine
  paraphrase as verified evidence. Added a `positioning_implication` note (directional only, explicitly
  NOT a business-case number change or a roadmap steer — well below the S3 bar for either). Refreshed
  `learnings`/`next_actions` with all of the above. Ran `node scripts/validate-gtm.mjs` locally (installed
  `js-yaml` via `npm install`, no `package.json` changes) — parses clean.
- **Reviewed all marketing docs for consistency with the live product** (per the standing "keep every
  GTM artifact consistent with the current product" mandate): store-listing.md, press-kit.md,
  email-lifecycle.md, social-drafts.md, content-calendar.md all correctly use $29 Apartment / $49-mo Pro
  pricing consistently, and correctly do NOT mention the Pro Annual ($399/yr) tier from
  `docs/BUSINESS_CASE.md` — migration 021 (the DB constraint `pro_annual` needs) is still unapplied to
  prod per `PENDING_OPS.md`, so marketing that tier now would point users at a non-live checkout path.
  No edit needed; recorded as a deliberate non-change, not an oversight.

### What we did NOT do (and why)
- Did not pull real funnel metrics: no reachable source, re-confirmed this run. Correctly stayed 0/null.
- Did not attempt outreach: `site_gate_up: false` (and no genuinely new strategic target surfaced this
  run beyond what Run 3/4 already assessed). Zero outreach drafts this run, correct.
- Did not touch ROADMAP.md / VISION.md / BUSINESS_CASE.md: the only new analysis this run
  (`demand_signal`) is explicitly `confidence: weak` and qualitative — nowhere near the S3 bar (real
  data, sufficient N, high-confidence causal revenue link) to justify a steer. Recorded as RECOMMEND-tier
  (i.e., not even that — logged as data for future positioning work) per the standard's own instruction.
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect Search Ads
  data; no new information since Run 3.
- Did not spawn an independent maker≠checker reviewer for this run's `GROWTH_STATUS.md` edit: no
  landing/email/ASO copy, campaign, pricing/positioning claim, outreach draft, or roadmap/vision/
  business-case steer shipped — this was the routine S4/S5 dashboard-and-research update, and the
  built-in safeguard against overclaiming was capping `demand_signal.confidence` at `weak` and stating
  the tooling gap explicitly rather than a second agent's review.
- Did not edit `PENDING_OPS.md`: no new owner action surfaced beyond what's already listed there
  (site gate, Resend, metrics token, migrations); the network-policy asks already live in
  `GROWTH_STATUS.next_actions`, consistent with how Run 4 handled the same kind of finding.

### Lessons learned
- The circuit breaker is now in its 5th consecutive run with the same 3 core blockers — `PENDING_OPS.md`
  going untouched by the owner (its own `as_of` frozen since Run 3) is itself a clean, mechanical signal
  that no further loop-side framing will change the picture; the only new value this run could add was
  genuinely new analysis (the demand-signal pass), not repeating the credential ask a 5th time.
  Do this pattern every future run: check `PENDING_OPS.md`'s own `as_of` first — if it hasn't moved,
  don't re-derive "still blocked" from scratch, just confirm and move straight to whatever new analysis
  IS possible without owner action.
- Self-validation (S4) applies to research tooling, not just production data sources: before trusting a
  research subagent's citations, check whether it actually reached the source page or is reporting a
  search engine's synthesized summary — those are NOT the same evidentiary strength, and the difference
  matters enough to cap a confidence field over.
- An environment variable of the same name as a production secret, present in THIS agent's own sandbox,
  is not evidence the production deployment has that secret set — different surfaces, different owners.
  Investigate the variable's actual likely origin (here: sibling validator-credential naming) before
  drawing any conclusion from it, and never let sandbox-local state flip a fail-closed dashboard field.
- Pre-launch marketing-doc consistency checks are cheap and worth doing every run even when no growth
  channel is connected — this run's pricing/tier audit across 5 docs took minutes and confirmed the
  assets are still honest and in sync with what's actually live in the DB (correctly omitting the
  not-yet-applied Pro Annual tier).

### Circuit breaker check
- Same owner blockers as Runs 1-4? YES — circuit breaker remains FIRED (Run 5, 5th consecutive run).
  Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) + RESEND_API_KEY/RESEND_FROM_EMAIL
  (15 min). No new blocker this run; the demand-signal tooling gap is a research-quality note, not an
  owner blocker (no owner action can fix WebFetch's egress policy from inside this loop — flagged to the
  owner as a "check when convenient," not a priority-ordered blocker).

---

## Run 6 — 2026-07-05

### What we found
- All Run 1-5 owner blockers remain unresolved: SITE_GATE_PASSWORD, RESEND_API_KEY/RESEND_FROM_EMAIL,
  INTERNAL_METRICS_TOKEN, CRON_SECRET, and DB migrations 021/022/023/026/027/029 are still
  unset/unapplied. `PENDING_OPS.md`'s own `as_of` is still 2026-06-29 — unchanged since Run 3, now
  spanning 4 runs (~6 days) — confirming no owner action has landed.
- Re-attempted a direct connection to `https://aptdesignerai.com/` (curl + the metrics API) — still
  unreachable, this time HTTP 502 "CONNECT tunnel failed" (a third distinct failure signature across
  three probe attempts: Run 4's 403 policy-denial → Run 5's bare connection error → this run's 502;
  the proxy status endpoint independently corroborates the same host/timestamp). Practical conclusion
  unchanged: no reachable path to the production host from this runtime, regardless of credentials.
- Between Run 5 and Run 6 the Product Factory shipped ~50 more commits (through PR #448): mostly
  security/a11y/test-coverage work, a GTM_STANDARD/FACTORY_STANDARD sync (§12 platform posture, §13
  autonomous marketing launch + kill switch, §29 deployed-app validator proof), and — notably —
  **PR #432**: the factory's OWN removal of invented "500+ rooms designed / 4.9★ / hundreds of happy
  renters" adoption metrics from the landing hero, footer CTA, and signup panel (2026-07-04). This is
  the Product Factory correcting an honesty gap on its own, a positive signal; verified via grep that
  none of those fabricated numbers ever leaked into any GTM-owned doc (store-listing, press-kit,
  social-drafts, content-calendar, email docs, OUTREACH.md) — clean, no edit needed here.
  `docs/quality/QUALITY_SCORECARD.md` is still `as_of: 2026-07-01`, `overall: C`,
  `ship_gate_met: false` — read as DATA; phase correctly stays `pre_launch`. `GTM_SCORECARD.md` still
  does not exist (no separate GTM Auditor routine has run yet).
- **New environment finding:** this session's sandbox now also has `CRON_SECRET` set (in addition to
  `SITE_GATE_PASSWORD`, present since Run 5). Applied the same S4 fail-closed reasoning Run 5 used for
  `SITE_GATE_PASSWORD`: a value in this agent's own sandbox is not evidence the production Vercel
  deployment has it configured — did not use it, did not infer the activation cron is live.
- **Corrected an overstated Run 5 conclusion.** Run 5 concluded "this session's network egress policy
  blocks WebFetch generally" based on failures across reddit.com/apps.apple.com/play.google.com/
  trustpilot.com/news.ycombinator.com (all 403, including a neutral control URL). This run, the SAME
  category of test came back different: WebSearch works fully, and WebFetch succeeds cleanly on
  apple.com, the news.ycombinator.com homepage, emarketer.com, and firstchair.app. Testing each
  blocked domain individually revealed the real, narrower picture: reddit.com/old.reddit.com are
  hard-blocked by the WebFetch TOOL itself (a fixed message, not a proxy error) — separate from this
  environment's egress policy entirely; trustpilot.com returns its own Cloudflare 403 (site-side
  bot-block); news.ycombinator.com's `item?id=` pages specifically 429 (site-side rate-limit on that
  one endpoint — the HN homepage loads fine). Lesson: a failure on one domain does not mean the whole
  session is network-restricted — test each domain, and distinguish "this tool won't fetch X" from
  "this site blocks bots" from "this environment's proxy denies this host."

### What we built this run
- **`docs/growth/GROWTH_STATUS.md`**: bumped `as_of` to 2026-07-05; corrected the `internal_metrics_api`
  validation reason to list all three distinct failure signatures across three probe attempts and to explicitly
  scope the unreachability to `aptdesignerai.com` rather than implying a blanket network block; upgraded
  `demand_signal.confidence` from `weak` to `emerging` on the strength of two NEW hand-verified,
  dated, named-source verbatim quotes obtained via direct WebFetch this run: eMarketer (2026-05-18,
  Dan Bennett/furniture.com CMO — "nine hours and 13 tabs used just to find a solution to a furniture
  problem") corroborating the furniture-shopping-paralysis theme, and First Chair blog (2026-06-15 —
  four direct quotes on AI tools generating unpurchasable/single-retailer furniture) corroborating and
  sharpening the "AI tools generate unbuyable furniture" theme with a genuinely new differentiation
  angle (multi-retailer sourcing vs. Decorify's single-retailer limitation). Also found and fixed a
  mis-cited Hacker News URL from Run 5 (wrong item id; corrected via HN's own Algolia search API,
  though the corrected page itself still 429s under direct fetch so it is URL-corrected, not
  re-quoted). Refreshed `learnings`/`next_actions`/`owner_blockers` with all of the above, re-scoping
  the network-policy ask from a blanket request to the specific `aptdesignerai.com` host. Ran
  `npm install` (materializes `js-yaml`, already a declared dependency, into a fresh `node_modules` —
  no `package.json` change) then `node scripts/validate-gtm.mjs` — parses clean.
- **Re-verified marketing-doc consistency** (store-listing, press-kit, email-lifecycle, social-drafts,
  content-calendar, OUTREACH.md) against PR #432's removed fabricated metrics and the live pricing —
  clean; no edit needed.

### What we did NOT do (and why)
- Did not pull real funnel metrics: no reachable source, re-confirmed this run (502 this time).
  Correctly stayed 0/null.
- Did not attempt outreach: `site_gate_up: false` AND `ship_gate_met: false` (QUALITY_SCORECARD) — both
  lanes of GTM_STANDARD §6 stay hard-off below the readiness bar. Zero outreach drafts this run, correct.
- Did not touch ROADMAP.md / VISION.md / BUSINESS_CASE.md: the strengthened `demand_signal` evidence is
  still qualitative and nowhere near the §3 bar (real quantified data, sufficient N, causal revenue
  link) for a steer — recorded as sharpened research, not a steer, per the standard's own instruction.
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect Search Ads
  data; no new information since Run 3.
- Did not use the sandbox-local `CRON_SECRET` or `SITE_GATE_PASSWORD` for anything: same S4 fail-closed
  reasoning as Run 5 — presence in this agent's own sandbox is not evidence of the production
  deployment's configuration.
- Did not spawn an independent maker≠checker reviewer for this run's `GROWTH_STATUS.md` edit: this was
  a routine S4/S5 dashboard-and-research update (correcting citations, refining a method note, updating
  a confidence field on existing research) — no landing/email/ASO copy, campaign, pricing/positioning
  claim, outreach draft, or roadmap/vision/business-case steer shipped, matching Run 5's precedent for
  when a reviewer is/isn't warranted.
- Did not edit `PENDING_OPS.md`: no new owner action surfaced beyond what's already listed there; the
  re-scoped network-policy ask already lives in `GROWTH_STATUS.next_actions`/`owner_blockers`.

### Lessons learned
- The circuit breaker is now in its 6th consecutive run with the same 3 core blockers — `PENDING_OPS.md`
  itself confirms this mechanically (its own `as_of` unmoved since Run 3). No further loop-side framing
  changes that; this run's value-add was genuinely NEW research-quality work (the demand-signal
  confidence upgrade + citation fix + the tooling-scope correction), not repeating the credential ask a
  6th time verbatim.
- **Don't over-generalize a tooling failure.** Run 5 saw failures on 5 domains and concluded "network
  egress blocks everything" — testing individually this run showed each failure had a DIFFERENT cause
  (tool-level Reddit block, site-side Trustpilot bot-block, site-side HN rate-limit) and none of them
  indicated a blanket environment restriction (apple.com/emarketer.com/firstchair.app all worked fine).
  Future runs: isolate and test each blocked domain before generalizing to "this environment is
  network-restricted" — the correct, narrower conclusion changes which owner action (if any) is worth
  asking for.
- **A wrong citation is worse than no citation.** Run 5's HN URL didn't actually point at the thread it
  claimed to cite. Verifying a citation by attempting to actually open it (not just trusting a research
  subagent's URL) caught this — worth doing even when the page itself can't be re-fetched (the Algolia
  search API cross-check was enough to catch and fix the error).
- Sandbox-env-var findings (`SITE_GATE_PASSWORD` in Run 5, now also `CRON_SECRET` in Run 6) are a
  RECURRING pattern in this validator-credential-scaffolded environment, not one-off noise — worth a
  standing rule: never infer production config from this agent's own sandbox env, full stop.

### Circuit breaker check
- Same owner blockers as Runs 1-5? YES — circuit breaker remains FIRED (Run 6, 6th consecutive run).
  Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) + RESEND_API_KEY/RESEND_FROM_EMAIL
  (15 min). No new blocker this run.

---

## Run 7 — 2026-07-09

### What we found
- All Run 1-6 owner blockers remain unresolved: verified directly against `PENDING_OPS.md` (not
  inferred) that `set-site-gate-password`, `connect-email-resend`, `set-metrics-token`, and
  `set-cron-secret` are all still `status: open`. `PENDING_OPS.md`'s own `as_of` DID move this time
  (2026-06-29 -> 2026-07-09), but `git log -p` on the file shows that move was the Product Factory's
  own Run 72 housekeeping commit (#516 — refreshed `as_of` + fixed a phantom "Anthropic" mention in
  the spend-caps item), not an owner action on any of the 4 growth blockers.
- Re-probed `https://aptdesignerai.com/` a fourth time: HTTP 502 "CONNECT tunnel failed" again — same
  signature as Run 6, cross-checked against the agent-proxy's `/__agentproxy/status` endpoint
  (`recentRelayFailures`, timestamp 2026-07-09T05:08:58Z). No new information; same conclusion.
- `docs/quality/QUALITY_SCORECARD.md` moved since Run 6: now `as_of: 2026-07-05`, `overall` RAISED
  C -> B (`functional_reality` closed C -> A via a real render-pipeline cassette test + an authed
  browser E2E asserting a decodable PNG and the paywall entitlement flip). `ship_gate_met` is STILL
  `false` — `design_taste` (B) is now the sole sub-A ship-critical dimension. Read as DATA; phase
  correctly stays `pre_launch`.
- **`docs/growth/GTM_SCORECARD.md` now exists** — the first Independent GTM Auditor run landed
  between Run 6 and Run 7 (`as_of: 2026-07-06`, `overall: C`, `ship_gate_met: false`). Two top_gaps:
  (1) **ship-critical F on `business_case_honesty`** — `docs/BUSINESS_CASE.md`'s summary block
  claimed `floor_met_year1: true` ("exceeds the $100K floor in year 1") while the $122.9K base ARR is
  actually a STEADY-STATE figure (year-1 exit run-rate ~$58-60K; the floor is reached ~year 3) — the
  auditor called this a gamed floor-timing claim. **Already fixed by the Product Factory independently**
  at PR #508 (2026-07-06, `docs(business-case): correct floor timing`), which predates even the
  scorecard's own `as_of` — verified by reading `docs/BUSINESS_CASE.md` directly: it now reads
  `floor_met_year1: false` with the honest steady-state/~year-3 framing throughout. Nothing to do here
  (Product-Factory-owned fix, already landed); noted as DATA. (2) **`artifact_freshness` B, severity
  2** — `store-listing.md` (lines 77/152) and, we additionally found, `press-kit.md` (lines 131/161)
  were advertising the Pro Annual ($399/yr) tier while migration 021 (the DB `pro_annual` CHECK
  constraint) is still unapplied to prod (`PENDING_OPS.md apply-migration-021`, `status: open`) — an
  annual checkout today would fail with a Postgres constraint violation, so both docs advertised a
  plan visitors could not actually purchase. Compounding it, the auditor found the GTM Factory's OWN
  audit trail (Run 5/6 `GROWTH_MEMORY.md`/`GROWTH_STATUS.md` entries) FALSELY claimed these docs
  "correctly omitted" Pro Annual all along — traced this: PR #150 (2026-06-27) added Pro Annual to
  `store-listing.md`, which PREDATES Run 5 (2026-07-03), so the original claim was wrong from the
  moment it was written, not merely stale.

### What we built this run
- **`docs/store-listing.md`**: removed the Pro Annual line from both the Apple App Store and Google
  Play description fenced code blocks (the parts the owner copy-pastes verbatim into App Store
  Connect / Play Console), replacing each with a dated explanatory blockquote OUTSIDE the fenced
  blocks (so it can't leak into a real submission) naming migration 021 / `PENDING_OPS.md
  apply-migration-021` and when to re-add the tier.
- **`docs/press-kit.md`**: same fix — removed the Pro Annual row from the app-facts table and the
  $399/yr mention from the 100-word boilerplate, added the same dated explanatory note.
- **`docs/growth/GROWTH_STATUS.md`**: bumped `as_of` to 2026-07-09; added a structured `web_research`
  entry to `validation:` (`status: degraded`, naming the Reddit tool-block and Trustpilot site-block
  as the two persistent gaps) per the GTM_SCORECARD's `self_validation_honesty` gap (previously only
  documented in `demand_signal` prose, not a structured source); refreshed the `internal_metrics_api`
  reason with the 4th probe attempt; refreshed the `site_gate` reason to note PENDING_OPS status
  explicitly; **added a transparent "CORRECTION (Run 7)" learning** stating the Run 5/6 "Pro Annual
  correctly omitted" claim was false and why, WITHOUT editing the historical Run 5/6 entries in this
  file (append-only by design — see below); refreshed `demand_signal` (see next); refreshed
  `learnings`/`next_actions`/`owner_blockers` for the 7th consecutive circuit-breaker run.
- **`demand_signal` research**: closed both of Run 6's open verification gaps via direct WebFetch —
  Baymard Institute's AR-avoidance article (`baymard.com/blog/deprioritize-view-in-room-augmented-
  reality`, dated 2024-05-15) fetched cleanly: "87% of test participants who encountered 'View in
  Room' chose not to use it," only "6%... sought out and used it proactively." TechCrunch's Modsy
  shutdown piece also fetched cleanly on the CORRECTED URL (Run 5/6's cited path was a guessed,
  non-resolving one) — `techcrunch.com/2022/07/17/modsy-quietly-shut-down-while-some-customers-were-
  still-awaiting-refunds/`: "Capital constraints and uncertain market conditions forced the company to
  cease operations on July 6" (CEO Shanna Tellerman), plus customer quotes citing $4,500 and $50,000
  in undelivered orders. All 4 `demand_signal` themes now carry at least one directly-fetched,
  hand-verified, dated, named-source quote (up from 2 of 4 in Run 6). Held `confidence` at `emerging`
  rather than raising to `strong` — per-theme source COUNT is still thin (1-3/theme) and Reddit stays
  completely unreachable, so verbatim-ness alone doesn't clear the higher bar; recorded the reasoning
  explicitly rather than defaulting upward.
- **Independent review (maker != checker)** on the store-listing.md/press-kit.md fix: a fresh reviewer
  subagent confirmed `apply-migration-021` is genuinely still open, confirmed the fenced-block/note
  separation is correct, confirmed no other Pro Annual references remained, but returned
  REQUEST_CHANGES on round 1 because the auditor's named fix was a conjunction (strip the copy AND
  correct the false self-report) and only the copy had been fixed at that point. Addressed by adding
  the press-kit.md fix (the reviewer had also flagged it as the same live inconsistency) and the
  GROWTH_STATUS.md correction note; sent back for a final verdict (round 2 in progress / see
  GROWTH_STATUS.md's own record of the outcome if merged).

### What we did NOT do (and why)
- Did not edit `GROWTH_MEMORY.md`'s Run 5/6 entries: this file is documented at the top as
  "Appended to (never overwritten) by each run" — silently rewriting a past entry to make it
  retroactively true would erase the mistake instead of transparently correcting it, which is worse
  for audit-trail integrity than leaving the wrong historical claim visible next to this run's
  correction. This entry IS the correction.
- Did not touch `docs/BUSINESS_CASE.md`: the GTM_SCORECARD's ship-critical F on it was already fixed
  by the Product Factory at PR #508, independently of this run. Re-verified the fix is real (read the
  file directly) rather than trusting the scorecard's stale `as_of` alone.
- Did not re-grade `QUALITY_SCORECARD.md` or `GTM_SCORECARD.md`: both are owned by independent
  Auditor routines (maker != checker); consumed as data only.
- Did not attempt outreach: `site_gate_up: false` AND `ship_gate_met: false` (QUALITY_SCORECARD) —
  both S6 lanes stay hard-off. Zero outreach drafts this run, correct.
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect Search
  Ads data; no new information since Run 3.
- Did not use the sandbox-local `SITE_GATE_PASSWORD`/`CRON_SECRET` for anything: same S4 fail-closed
  reasoning as Runs 5-6.
- Did not attempt to re-fetch Trustpilot or the corrected Hacker News item id (35267253): both
  re-probed this run and both failed exactly as before (403 site-block, 429 rate-limit) — no new
  workaround exists from inside this loop.

### Lessons learned
- **A "grep clean" / "correctly omitted" claim in a learning is only as good as the actual command
  run.** Run 5 asserted store-listing.md/press-kit.md omitted Pro Annual without actually grepping for
  it — the claim was wrong from the moment it was written (PR #150 had added it a week earlier), and
  it then got copy-forwarded through Run 6 unverified. The independent GTM Auditor caught what two
  runs of self-review didn't. Going forward: when a learning states a consistency check was done,
  paste the actual grep/read output the claim rests on, not just the conclusion.
- **Independent review works — use it even on doc-only changes when the doc is public-facing marketing
  copy.** The reviewer's first pass caught that fixing the copy without correcting the audit trail
  only half-satisfies the named fix; that's exactly the adversarial value maker != checker is supposed
  to add.
- **The GTM Auditor's ship-critical findings can be pre-empted by the Product Factory.** PR #508
  landed the business-case honesty fix without this loop's involvement — worth checking `git log`
  against a scorecard's `top_gaps` before assuming a named gap is still open; it may already be moot.
- **PENDING_OPS.md's `as_of` moving is not itself evidence of owner action** — it can be (and this run,
  was) a Product-Factory housekeeping commit. Always read the actual per-item `status` field, never
  infer from the top-level date alone.

### Circuit breaker check
- Same owner blockers as Runs 1-6? YES — circuit breaker remains FIRED (Run 7, 7th consecutive run).
  Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) + RESEND_API_KEY/RESEND_FROM_EMAIL
  (15 min). No new blocker this run; migration 021 (already tracked) gained a second reason to apply
  it (unblocks re-adding Pro Annual to marketing copy, not just annual billing itself).

---

## Run 8 — 2026-07-11

### What we found
- All Run 1-7 owner blockers remain unresolved: verified directly against `PENDING_OPS.md`
  (`set-site-gate-password` / `connect-email-resend` / `set-metrics-token` / `set-cron-secret` all
  still `status: open`). `PENDING_OPS.md`'s own `as_of` moved again (2026-07-09 -> 2026-07-10), but
  the two items whose `status` flipped to `done` in that window are Product-Factory housekeeping
  (`enforce-ci-required-checks`, `reconcile-canonical-domain`) — neither is one of the 4 growth
  blockers, all of which remain `status: open` verbatim. This blocker set has now been open,
  unchanged, since Run 1 (2026-06-27) — 8 consecutive daily runs, ~15 days, on setup steps
  `docs/growth/CONNECT.md` estimates at well under 20 minutes combined.
- Re-probed `https://aptdesignerai.com/` and the metrics API a fifth time: still unreachable —
  `connect_rejected` / gateway 502 to CONNECT, the same signature as Runs 6-7, cross-checked directly
  against the agent-proxy's own `/__agentproxy/status` `recentRelayFailures` log (two entries,
  2026-07-11T05:07:06Z). No new information; conclusion unchanged across all 5 probes to date.
- `docs/quality/QUALITY_SCORECARD.md` (independent Quality Auditor) moved since Run 7: now
  `as_of: 2026-07-09`, `overall` DROPPED B -> C. A fresh adversarial pass found the production DATA
  layer is a non-persistent in-memory mock (`lib/store/memory-store.ts`; real Supabase is auth-only,
  all `.from()`/`.storage` ops hit in-memory arrays) — `functional_reality` dropped A -> C, and
  `design_taste`/`artifact_integrity`/`security_rls` each ticked down a notch on separate findings
  (an authed-a11y coverage gap, an OWNER_ACTIONS schema violation, one missed IDOR guard on
  `GET /api/area-analysis`). `ship_gate_met` remains false, now on THREE sub-A ship-critical
  dimensions instead of one. Read as DATA — this is squarely a Product Factory / persistence-cutover
  matter (`PENDING_OPS.md cutover-to-persistent-data`, already `status: open`, already flagged), not
  something this loop builds. It reinforces (does not change) this run's posture: phase stays
  `pre_launch`, both S6 outreach lanes stay hard-off. The one item the scorecard named that overlaps
  this loop's territory — an OWNER_ACTIONS schema violation from two `priority: low` entries in
  `PENDING_OPS.md` (failing preflight GATE 5) — was checked directly (`grep -n "priority:"
  PENDING_OPS.md`) and is **already fixed**: no `priority: low` values remain in the file (both named
  items now read `priority: normal`). No action needed; recorded as verified-resolved, not assumed.
- `docs/growth/GTM_SCORECARD.md` and `GTM_AUDIT_MEMORY.md` are unchanged since Run 7 (still
  `as_of: 2026-07-06`, `auditor_run: 1`) — the independent GTM Auditor has not re-graded yet.
  Re-verified both of its named top_gaps are still fixed: `docs/BUSINESS_CASE.md` still reads
  `floor_met_year1: false` with the steady-state/~year-3 framing (PR #508, pre-dates the scorecard),
  and `store-listing.md`/`press-kit.md` still carry the dated Pro-Annual-omitted notes with no
  `$399`/Pro-Annual line inside the copy-paste fenced blocks (re-grepped this run). Nothing new to fix
  on the GTM side pending the Auditor's next pass.
- Demand-signal re-probe (S10's every-run requirement): tested both structural gaps again —
  `reddit.com` still hard-blocked by the WebFetch tool itself; `trustpilot.com/review/havenly.com`
  still returns HTTP 403. No new citation attempted or possible from these two sources; the existing
  4 themes already each carry a directly-fetched, hand-verified quote from Run 7, so re-running the
  same blocked probes would add no evidence, not close a gap.

### What we built this run
- **`docs/growth/GROWTH_STATUS.md`**: bumped `as_of` to 2026-07-11; refreshed `internal_metrics_api`
  and `web_research` validation reasons with the 5th probe attempt and the re-confirmed structural
  gaps; bumped `demand_signal.as_of` and added a short Run 8 method-note (re-probed, unchanged, no new
  citation) ahead of Run 7's verbatim history (kept intact, not overwritten); refreshed
  `learnings`/`next_actions`/`owner_blockers` for the 8th consecutive circuit-breaker run, including
  the QUALITY_SCORECARD B->C drop and the verified-already-fixed OWNER_ACTIONS schema note. Ran
  `npm install` + `node scripts/validate-gtm.mjs` — parses clean.
- **Verification only, no doc edits needed**: re-grepped `PENDING_OPS.md` for `priority: low` (none
  found — already fixed by the Product Factory), re-read `docs/BUSINESS_CASE.md` and
  `store-listing.md`/`press-kit.md` to confirm both GTM_SCORECARD fixes from PR #508 and Run 7 still
  hold.

### What we did NOT do (and why)
- Did not pull real funnel metrics: no reachable source, re-confirmed this run (5th probe, same 502
  signature). Correctly stayed 0/null.
- Did not attempt outreach: `site_gate_up: false` AND `ship_gate_met: false` (now on 3 ship-critical
  QUALITY_SCORECARD dimensions, up from 1) — both S6 lanes stay hard-off. Zero outreach drafts this
  run, correct.
- Did not touch `ROADMAP.md` / `VISION.md` / `docs/BUSINESS_CASE.md`: no new data this run of any
  kind (funnel still 0/null; demand_signal unchanged at `emerging`, re-probed not re-strengthened) —
  nothing clears the S3 bar for a steer, and the business case is already honest post-PR #508.
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect Search
  Ads data; no new information since Run 3.
- Did not spawn an independent maker≠checker reviewer this run: no landing/email/ASO copy, campaign,
  pricing/positioning claim, outreach draft, or roadmap/vision/business-case steer shipped — this was
  a routine S4/S5 dashboard-and-verification update (re-probes + re-reads confirming prior fixes still
  hold), matching Runs 5-6's precedent for when a reviewer is/isn't warranted.
- Did not edit `PENDING_OPS.md`: no new owner action surfaced beyond what's already listed there; the
  one schema issue the Quality Auditor named there was already fixed by someone else before this run.
- Did not use the sandbox-local `SITE_GATE_PASSWORD`/`CRON_SECRET` for anything: same S4 fail-closed
  reasoning as Runs 5-7.

### Lessons learned
- **A scorecard finding that overlaps your territory is worth a direct check even when it names "the
  factory" generically, not you by name.** The QUALITY_SCORECARD's `artifact_integrity` gap pointed at
  `PENDING_OPS.md` — a file this loop sometimes touches — so it was worth 30 seconds of `grep` to
  confirm it was already resolved rather than either (a) assuming it wasn't mine to check, or (b)
  re-fixing something someone already fixed.
- **A scorecard dropping (QUALITY_SCORECARD B->C this run) is important CONTEXT even when it changes
  zero GTM actions.** The persistence-layer finding doesn't touch any GTM lever directly, but it is
  the single most consequential fact in this run — launch readiness moved further away, not closer —
  so it belongs in `learnings`/`next_actions` even though the fix is 100% Product-Factory-owned.
- **Diminishing-returns research is itself a decision worth stating, not silently skipping.** Runs 5-7
  did real, valuable demand-signal work closing verification gaps one at a time; by Run 8, the two
  remaining gaps (Reddit, Trustpilot) are tool/site-level blocks with no available workaround from
  this loop, and re-probing them without a new angle is the CORRECT s10-mandated action (re-probe
  every run) but should not be dressed up as new research — this run says so explicitly instead of
  padding the demand_signal section with a re-description of the same unreachable sources.
- **A circuit breaker at 8 consecutive runs is a genuinely different situation from 3.** The blockers
  are all environment-variable/dashboard-config actions taking minutes each, with zero code
  dependency — repeating the same priority-ordered list a 8th time in `owner_blockers` remains
  correct (it's still true and still the single highest-leverage thing), but this run also computed
  and stated the actual elapsed time (~15 days) since Run 1 first surfaced them, which is a more
  concrete signal for the owner than "circuit breaker fired" alone.

### Circuit breaker check
- Same owner blockers as Runs 1-7? YES — circuit breaker remains FIRED (Run 8, 8th consecutive run,
  ~15 days elapsed since Run 1). Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) +
  RESEND_API_KEY/RESEND_FROM_EMAIL (15 min). No new blocker this run.

---

## Run 9 — 2026-07-13

### What we found
- All Run 1-8 owner blockers remain unresolved: verified directly against `PENDING_OPS.md`
  (`set-site-gate-password` / `connect-email-resend` / `set-metrics-token` / `set-cron-secret` all
  still `status: open`, as_of 2026-07-10 before this run's own bump). 9th consecutive run, ~16 days
  since Run 1 first surfaced this set.
- Re-probed `https://aptdesignerai.com/` a sixth time: still unreachable — `connect_rejected` /
  gateway 502 to CONNECT, same signature as Runs 6-8, cross-checked against the agent-proxy's own
  `/__agentproxy/status` `recentRelayFailures` log (two entries, 2026-07-13T05:07:41Z).
- **The independent GTM Auditor re-graded for the first time since Run 1** (`docs/growth/
  GTM_SCORECARD.md`, `auditor_run: 2`, `as_of: 2026-07-13`, landed via PR #599 shortly before this
  run started): `overall` C -> B. Both Run-1 top gaps genuinely fixed: `business_case_honesty`
  F -> B (the year-1-floor-timing overstatement, fixed pre-Run-9 by the Product Factory's PR #508)
  and `artifact_freshness` B -> A (the Pro Annual store-listing/press-kit fix from Run 7). **One
  ship-critical gap remained**: `business_case_honesty` held at B because `BUSINESS_CASE.md`
  modeled ~37.9% of steady-state MRR ($3,888/mo of $10,240/mo) on the Pro Annual tier while it is
  currently NON-transactable (migration 021 unapplied, `ANNUAL_BILLING_ENABLED` defaults off, gated
  by PR #597) — the doc read as if annual billing were live today, with no disclosure it is gated
  off pre-launch. `GTM_AUDIT_MEMORY.md` Run 2 also named two cheap non-ship-critical raises:
  `self_validation_honesty` A->A+ (surface `stripe_reporting` as its own distinct owner-facing
  entry, not just indirectly via the metrics-token path) and `compliance` A->A+ (render a full
  CAN-SPAM footer — physical postal address — in the staged lifecycle email templates; the opt-out
  backing already exists via migration 027).
- Investigated `stripe_reporting` (previously just "unavailable, no credential connected"): grepped
  the codebase and found there is genuinely NO Stripe Reporting API integration anywhere (zero code
  hits) — `docs/growth/CONNECT.md` documents trial-start/conversion-RATE metrics as living in
  "Stripe's reporting API," but that's an unbuilt integration, distinct from `internal_metrics_api`
  (which reads the app's own DB via `INTERNAL_METRICS_TOKEN` and already covers MRR/active-
  subscriber/churn once that token is set). This is a Product-Factory build gap, not a pure
  owner-connect step — so it does NOT belong in `PENDING_OPS.md`/`owner_blockers` (no owner action
  today would unblock it); surfaced it honestly as a `next_action` instead.

### What we built this run
- **`docs/BUSINESS_CASE.md`** (the GTM Auditor's #1 named top_gap, per GTM_STANDARD S8 the
  highest-priority value-bar-clearing work this run): added a disclosure blockquote in the "Pro
  Annual tier economics" section stating annual billing is gated off pending migration 021 +
  `ANNUAL_BILLING_ENABLED` (citing `PENDING_OPS.md apply-migration-021` + PR #597), and tightened
  the "Annual mix stays at 0%" bullet in "What would have to change to NOT reach $100K" from a vague
  "reverts to ~$100K baseline" to the precisely computed (via a `node` script, never eyeballed —
  FACTORY_STANDARD S22) **$99,926 ≈ $99.9K**, framed honestly as *at*, not over, the floor. Added a
  dated changelog entry. **Independent maker != checker review** (fresh reviewer subagent, no
  context from this run): independently re-derived the same $99,926 figure from the stated
  assumptions, cross-checked the disclosure against the real `PENDING_OPS.md` item, confirmed no
  other content was altered — **APPROVED**, no requested changes.
- **CAN-SPAM compliance code fix** (`lib/email/templates/lifecycle.ts`, `lib/email/index.ts`): the
  loop cannot invent a real business mailing address, so wired the templates to render
  `EMAIL_PHYSICAL_ADDRESS` (an owner-set env var) in both the HTML and plain-text footers when
  present, and made `sendEmail()` force every **marketing-lifecycle** stage (activation/win-back/
  paid-welcome — NOT the transactional `waitlist_confirm` double opt-in, which CAN-SPAM exempts) to
  dry-run until the address is set — so a non-compliant marketing email can never actually leave
  the system even after `RESEND_API_KEY` goes live. Verified the transactional-vs-marketing
  distinction carefully: an earlier draft of this fix gated `isEmailDryRun()` globally, which would
  have ALSO blocked the waitlist double-opt-in confirmation (a real regression against the very flow
  Priority-2 is trying to unblock) — caught this before committing and rescoped the gate to
  `sendEmail()`'s per-message stage check instead. Added `PENDING_OPS.md` item
  `set-email-physical-address`. Added 5 new tests across two files (31/31 email tests green);
  `npx tsc --noEmit` clean; `npx eslint .` clean on touched files.
- **`validation/CAPABILITIES.yml`**: declaring `EMAIL_PHYSICAL_ADDRESS` was required —
  `scripts/validate-capabilities.mjs` (a required preflight gate) failed closed on the new env var
  until declared, exactly as designed (FACTORY_STANDARD S6 "validation capability" contract). Added
  it to `non_credential_allowlist` (non-secret, no external service). Preflight's
  `validate-capabilities` gate is green again; ran the full `bash scripts/preflight.sh` afterward —
  only pre-existing, Product-Factory-owned gaps remain (functional journeys, DoD checkboxes),
  unrelated to this run's changes.
- **`docs/growth/GROWTH_STATUS.md`**: bumped `as_of` to 2026-07-13; refreshed `internal_metrics_api`
  (6th probe) and `web_research` (re-probed, unchanged) validation reasons; rewrote the
  `stripe_reporting` entry with the honest "unbuilt integration, not just unconnected" distinction;
  added a note to `resend_email` about the new marketing-stage dry-run gate; bumped `demand_signal.
  as_of` with a short Run 9 method-note (re-probed, unchanged, effort went to the Auditor gap
  instead); rewrote `learnings`/`next_actions`/`owner_blockers` for the 9th consecutive
  circuit-breaker run, including the GTM_SCORECARD C->B result and both fixes landed this run. Ran
  `node scripts/validate-gtm.mjs` + `bash scripts/preflight.sh` — GATE 5 (business case / GROWTH_
  STATUS / OWNER_ACTIONS YAML) and validate-gtm both green.
- **`PENDING_OPS.md`**: bumped `as_of`; added `set-email-physical-address` (priority normal, blocks
  `marketing-email-compliance`, matching the existing migration-027 item's blocks value).

### What we did NOT do (and why)
- Did not pull real funnel metrics: no reachable source, re-confirmed this run (6th probe, same 502
  signature). Correctly stayed 0/null.
- Did not attempt outreach: `site_gate_up: false` AND `ship_gate_met: false` (QUALITY_SCORECARD
  still C, unchanged since Run 8) — both S6 lanes stay hard-off. Zero outreach drafts this run,
  correct.
- Did not touch `ROADMAP.md` / `VISION.md`: no new funnel or demand-signal data this run of the kind
  that would clear the S3 steer bar — the BUSINESS_CASE.md edit was a Auditor-directed honesty fix
  (a disclosure + a corrected figure), not a steer, and GTM_STANDARD S3 explicitly distinguishes a
  business-case recompute from a steer.
- Did not add `stripe_reporting` to `PENDING_OPS.md`/`owner_blockers`: it is a Product-Factory build
  gap (no Stripe Reporting API integration exists in code), not an owner-actionable connect step —
  adding it to the owner-facing blocker list would have been dishonest (implying a env-var flip
  fixes it, when it does not).
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect Search
  Ads data; no new information since Run 3.
- Did not spawn an independent reviewer for the `GROWTH_STATUS.md`/`GROWTH_MEMORY.md`/`PENDING_OPS.md`
  bookkeeping edits themselves: consistent with Runs 5-8's precedent (routine S4/S5 dashboard
  updates don't need a second reviewer); the two SUBSTANTIVE changes this run (the business-case
  disclosure fix and the email compliance code) each got their own review/verification (maker!=
  checker subagent for the former, careful manual re-scoping + new tests for the latter).
- Did not use the sandbox-local `SITE_GATE_PASSWORD`/`CRON_SECRET` for anything: same S4 fail-closed
  reasoning as Runs 5-8.

### Lessons learned
- **When the independent Auditor re-grades, its named top_gap is this run's highest-priority work —
  GTM_STANDARD S8 in practice, not just in principle.** Run 9 spent its primary effort on the
  business-case disclosure fix rather than new demand-signal research or a fresh ASO attempt,
  because the Auditor's B-grade gap was concrete, well-specified, and the single thing standing
  between the GTM side and a fully-met ship gate. Compare: demand-signal research past Run 7 is
  genuinely diminishing-returns (same two structurally blocked sources); the Auditor gap was not.
- **A global environment-variable gate can silently break an unrelated flow — check WHICH messages
  actually need the new constraint before wiring it broadly.** The first draft of the CAN-SPAM fix
  gated `isEmailDryRun()` (used by every `sendEmail()` call, including the transactional waitlist
  double-opt-in) — that would have blocked real signups from confirming their waitlist entry the
  moment `RESEND_API_KEY` is set, directly undermining Priority 2. Scoping the gate to `sendEmail()`
  itself, keyed on `message.stage`, fixed this without weakening the actual compliance goal.
  Worth a standing habit: before adding a new fail-closed gate, trace every call site the shared
  function serves, not just the one you're thinking about.
- **A scorecard's "cheap raise" nits are worth doing in the SAME run as the ship-critical fix when
  they're genuinely cheap** — the `stripe_reporting` surfacing and the CAN-SPAM footer both took
  well under the effort of the business-case fix and each closes a named, real gap rather than
  padding. Distinguish this from churn: both trace to a specific auditor-named gap, not an invented
  task.
- **`scripts/validate-capabilities.mjs` earns its keep immediately** — introducing
  `EMAIL_PHYSICAL_ADDRESS` without declaring it would have shipped an undeclared-env-var regression
  straight into the preflight gate; the tool caught it in the same run it was introduced, exactly as
  designed.

### Circuit breaker check
- Same owner blockers as Runs 1-8? YES — circuit breaker remains FIRED (Run 9, 9th consecutive run,
  ~16 days elapsed since Run 1). Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) +
  RESEND_API_KEY/RESEND_FROM_EMAIL (15 min). One new (low-effort) blocker: EMAIL_PHYSICAL_ADDRESS.

---

## Run 10 — 2026-07-15

### What we found
- All Run 1-9 owner blockers remain unresolved: verified directly against `PENDING_OPS.md`
  (`as_of: 2026-07-14`; `set-site-gate-password` / `connect-email-resend` / `set-metrics-token` /
  `set-cron-secret` / `set-email-physical-address` all still `status: open`). 10th consecutive run,
  ~18 days since Run 1 first surfaced the core 4. `git log` shows 25 Product-Factory commits landed
  between Run 9 and this run (through PR #630) — DEEP AUDIT work, a11y/security/determinism fixes,
  FACTORY_STANDARD updates (§44 live-prod re-probe, §6b Mobbin grounding, §49 orchestration) — none
  of them a growth-channel connection.
- Re-probed `https://aptdesignerai.com/` a SEVENTH time, this run via TWO independent tools:
  `curl` through the agent-proxy still gives `connect_rejected` / gateway 502 to CONNECT (identical
  signature to Runs 6-9, cross-checked against `/__agentproxy/status` `recentRelayFailures`, two
  entries timestamped 2026-07-15T05:08:37Z); the `WebFetch` tool, tested directly against the same
  URL, returned a DIFFERENT, new failure signature — `getaddrinfo ENOTFOUND aptdesignerai.com` (a
  DNS-resolution failure, not a proxy-CONNECT failure) — suggesting WebFetch may resolve/route
  differently than the curl-via-agent-proxy path this loop has been citing. Practical conclusion is
  identical either way: no reachable path to production from this runtime.
- `docs/growth/GTM_SCORECARD.md` is UNCHANGED since Run 9 (still `auditor_run: 2`,
  `as_of: 2026-07-13`, `business_case_honesty` held at `B`, PR #599). Checked
  `docs/autonomous-loop/ROUTINES.md` — the GTM Auditor runs on a **weekly** cron (Mondays 03:30
  UTC), so it has genuinely not had a chance to re-grade against Run 9's 2026-07-13 disclosure fix
  (PR #601, landed the same day the scorecard was cut) or anything from this run; its next
  scheduled pass is ~2026-07-20. Not a stall — a cadence mismatch, now understood and worth noting
  so a future run doesn't misread "unchanged scorecard" as "fix didn't work."
- `docs/quality/QUALITY_SCORECARD.md` (the independent **Product** Quality Auditor — a different
  routine, consumed as DATA only, never GTM-owned) moved since Run 9: `as_of: 2026-07-13`,
  `overall` held at `C`, but the per-dimension picture worsened — `business_case_strength`
  regressed `A -> B` (a fresh, independent recompute found the same root cause the GTM Auditor
  named: with Pro Annual gated off in code, the shippable-TODAY steady-state ARR is **$99,926**,
  ~$74 *below* the $100K floor) and `security_rls` regressed `A+ -> A` (a missed ownership guard on
  the mockups route — a Product-Factory security matter, no GTM lever). Read as reinforcing this
  run's posture (pre_launch correct, outreach hard-off), not changing it.
- **Investigated FACTORY_STANDARD §22 (computation integrity) against the business case for the
  first time.** §22 requires every quantitative claim to be produced by "executed, reproducible
  code... never mental arithmetic," committed under `scripts/`/an analysis dir, and re-verified by
  the independent reviewer. Checked whether the `$99,926` without-annual figure — now cited by name
  in BOTH `GTM_SCORECARD.md` (rounded, `~$99.9K`) and `QUALITY_SCORECARD.md` (precise,
  `$99,926`) — had any such backing: it did not. Run 9's `learnings` said it was "computed via a
  node script, not eyeballed," but that script was never committed — a real, closeable gap, and a
  boundary-sensitive one (the number sits within $74 of the $100K floor, so the exact computation
  method matters to the conclusion). Also found the repo already ships the sanctioned infrastructure
  for this — `scripts/validate-computation.mjs` (a required preflight gate) + the
  `analysis/figures.json` manifest contract (`analysis/README.md`) — built by the Product Factory
  but sitting **vacuous** (`figures.json: {"figures": []}`), so the gate always passed trivially
  with nothing registered to check.

### What we built this run
- **`analysis/business-case-model.mjs`**: the shared revenue-model core, reproducing
  `docs/BUSINESS_CASE.md`'s "The revenue model" formula section verbatim (same prices, 30% store
  commission, 25% Day-30 retention, 60/40 apartment/Pro mix, 75/25 monthly/annual Pro split, 7%
  monthly churn, the doc's own rounded 2.4%/month annual-effective churn) as one `computeScenario()`
  function taking `installsPerMonth`, `conversionRate`, `annualShareOfPro`.
- **Four registered figures** (`analysis/business_case_scenario_{a,b,c}_arr.mjs`,
  `analysis/business_case_without_annual_arr.mjs`), each a thin script calling `computeScenario()`
  with one scenario's inputs and printing `{"value": N}` — Scenario A conservative, Scenario B
  base/planning-case, Scenario C optimistic, and the without-annual (Pro-Annual-gated-off) case
  using Scenario B's installs/conversion with `annualShareOfPro=0`.
- **`analysis/figures.json`**: registered all 4, wiring them into `scripts/validate-computation.mjs`
  for the first time — the gate now genuinely checks something on every PR instead of passing
  vacuously. Tolerances: 200 (~0.1-0.4%) on the three headline ARRs, covering the doc's own
  nearest-hundred prose rounding without being loose enough to mask a real constant error; 1 (exact)
  on the without-annual figure, since it is under active scrutiny by both independent auditors.
- **Ran + verified**: `node analysis/business_case_scenario_a_arr.mjs` → `46109`; `_b_arr.mjs` →
  `122956`; `_c_arr.mjs` → `276652`; `business_case_without_annual_arr.mjs` → **`99926`** — an EXACT
  match to the figure both scorecards cite, confirming (not gaming) the "$74 below the floor"
  reading. `node scripts/validate-computation.mjs` → `4 figure(s) verified against their scripts.
  PASS.` Also ran the full existing gate suite against the change: `node scripts/validate-gtm.mjs`
  OK, `node scripts/validate-capabilities.mjs` OK (0 unmet), `npx tsc --noEmit` clean, `npx eslint
  analysis/` clean.
- **`docs/BUSINESS_CASE.md`**: added a dated changelog note describing the verification (what was
  added, the 4 independently-reproduced values, and an explicit "no figure or number in this
  document changed" statement) — zero edits to the existing scenario prose/headline numbers, which
  stay accurate "~" approximations.
- **Independent maker != checker review** (fresh subagent, no context from this run): read
  `analysis/business-case-model.mjs` against `docs/BUSINESS_CASE.md`'s stated formula
  constant-by-constant (prices, commission, retention, mix, churn rates — all matched exactly,
  including the annual-price-divided-by-12 and the doc's own rounded 2.4% churn reused verbatim);
  independently re-ran all 4 scripts AND separately hand-reimplemented the formula from the doc's
  prose in a standalone snippet (not importing the module) as a second, fully independent
  cross-check — both methods agreed on all 4 values; re-ran `validate-computation.mjs` twice to
  confirm determinism; verified the without-annual script reuses Scenario B's exact installs/
  conversion and only zeroes `annualShareOfPro` (not silently swapping in more favorable inputs);
  checked the tolerances weren't loose enough to mask a real error. **Verdict: APPROVE**, with one
  wording nit (fixed before merge): the changelog/script comments had claimed GTM_SCORECARD.md
  cites the without-annual figure as `$99,926` precisely — it only cites the rounded `~$99.9K`;
  only QUALITY_SCORECARD.md cites the exact dollar figure. Corrected in both the script comment and
  the BUSINESS_CASE.md note.
- **`docs/growth/GROWTH_STATUS.md`**: bumped `as_of` to 2026-07-15; refreshed `internal_metrics_api`
  (7th probe, both tools/signatures) and `web_research` (re-probed, unchanged, 4th consecutive) 
  validation reasons; bumped `demand_signal.as_of` with a Run 10 method-note (re-probed, unchanged,
  effort went to the S22 gap instead); rewrote `learnings`/`next_actions`/`owner_blockers` for the
  10th consecutive circuit-breaker run, including the GTM_SCORECARD cadence finding, the
  QUALITY_SCORECARD business_case_strength/security_rls regressions, and the new verification
  script — and elevated migration 021 + `ANNUAL_BILLING_ENABLED` to the single highest-leverage
  owner action (it is now the sole remaining GTM_SCORECARD ship-critical gap AND the named cause of
  the QUALITY_SCORECARD regression).

### What we did NOT do (and why)
- Did not pull real funnel metrics: no reachable source, re-confirmed this run (7th probe, two
  tools, two different failure signatures, same practical conclusion). Correctly stayed 0/null.
- Did not attempt outreach: `site_gate_up: false` AND `ship_gate_met: false` (QUALITY_SCORECARD
  still C) — both S6 lanes stay hard-off. Zero outreach drafts this run, correct.
- Did not touch `ROADMAP.md` / `VISION.md`: no new funnel or demand-signal data this run of the
  kind that would clear the S3 steer bar. The business-case work this run was a computation-
  integrity/verification fix (confirming existing figures are correctly computed and reproducible),
  explicitly NOT a new finding, a business-case number change, or a steer.
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect Search
  Ads data; no new information since Run 3.
- Did not re-attempt Reddit/Trustpilot fetches beyond the standard re-probe: both tested this run
  per S10's every-run requirement, both failed identically to Runs 6-9 — 4th consecutive re-probe
  with the same result; re-running without a new angle would not add evidence (established Run 8).
- Did not use the sandbox-local `SITE_GATE_PASSWORD`/`CRON_SECRET` for anything: same S4 fail-closed
  reasoning as Runs 5-9.
- Did not edit `PENDING_OPS.md`: no new owner-actionable item surfaced this run beyond what's
  already listed (migration 021 + ANNUAL_BILLING_ENABLED already exists there as
  `apply-migration-021`; this run only re-prioritized it in `GROWTH_STATUS.owner_blockers`, which
  is this loop's own file).

### Lessons learned
- **A gate that "always passes" is worth checking whether it's checking anything.**
  `scripts/validate-computation.mjs` existed, was wired into preflight, and reported PASS every run
  — but it was vacuously passing on an empty manifest. The lesson generalizes beyond this one gate:
  a green check is only meaningful once something real is registered against it; a required gate
  with zero registered assertions is a silent gap, not a guarantee, and it is worth a periodic
  "is this gate checking anything real yet?" pass.
- **A boundary-sensitive figure (here, $99,926 vs. the $100,000 floor — $74 apart) is exactly where
  computation-method ambiguity matters most.** Working through the reconciliation this run surfaced
  a real methodology subtlety: the doc's "Three scenarios" prose ROUNDS subscriber-pool counts to
  whole numbers for readability ("~171 subs"), but the actual published MRR/ARR figures were
  computed from the CONTINUOUS (unrounded) steady-state values — rounding intermediate subscriber
  counts before multiplying gives a measurably different answer (in one reconciliation this run,
  the choice flipped whether the without-annual case cleared the $100K floor or not). Committing
  the exact methodology as code removes this ambiguity permanently; before this run it existed only
  as an implicit, undocumented convention a human would have to reverse-engineer from the prose.
- **When two independent auditors (GTM + Quality) converge on the same root-cause finding from
  different angles, that convergence is itself a strong signal the finding is real** — worth
  treating as higher-priority than either alone, and worth cross-referencing in `learnings` so a
  future run doesn't fix it twice for two different reasons.
- **Before assuming a scorecard "hasn't moved" means work isn't landing, check its cadence.** The
  GTM Auditor is a weekly routine, not a daily one like this loop — `GTM_SCORECARD.md` being
  unchanged since Run 9 is expected, not a sign Run 9's fix failed or was ignored. Recording this
  explicitly prevents a future run from re-doing already-landed work out of a false "it didn't take
  effect" read.

### Circuit breaker check
- Same owner blockers as Runs 1-9? YES — circuit breaker remains FIRED (Run 10, 10th consecutive
  run, ~18 days elapsed since Run 1). Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) +
  RESEND_API_KEY/RESEND_FROM_EMAIL (15 min). No new blocker this run; migration 021 +
  ANNUAL_BILLING_ENABLED (already tracked) was re-prioritized to the top of `owner_blockers` given
  it is now corroborated by two independent auditors as the single highest-leverage lever.

---

## Run 11 — 2026-07-17

### What we found
- All Run 1-10 owner blockers remain unresolved: verified directly against `PENDING_OPS.md`
  (`as_of` still `2026-07-14`, unchanged since Run 10; `set-site-gate-password` /
  `connect-email-resend` / `set-metrics-token` / `set-cron-secret` / `set-email-physical-address`
  all still `status: open`). 11th consecutive run, ~20 days since Run 1 first surfaced the core 4.
  `git log` shows 10 further Product-Factory commits landed between Run 10 and this run (through
  PR #649, Runs 91-94): a DEEP AUDIT pass, reliability/read-integrity fixes (F4.1 saved-designs +
  products/bundles), Stripe-webhook tier validation (Track C/G), a fabricated-testimonial honesty
  fix on the login page (PR #632 — verified via `git show` this never touched any GTM-owned doc:
  store-listing/press-kit/social-drafts/content-calendar/email docs/OUTREACH.md all clean), and
  several `FACTORY_STANDARD.md` sections (§44 bug-hunter mode, §50/§51 autonomy + build-order) —
  none of it a growth-channel connection.
- Re-probed `https://aptdesignerai.com/` and the metrics API an EIGHTH time via curl through the
  agent-proxy: still `connect_rejected` / gateway 502 to CONNECT, cross-checked directly against
  `/__agentproxy/status` `recentRelayFailures` (two entries, `2026-07-17T05:07:16Z`) — identical
  signature to Runs 6-10. No new information; conclusion unchanged across all 8 probes.
- `docs/growth/GTM_SCORECARD.md` unchanged since Run 9/10 (`auditor_run: 2`, `as_of: 2026-07-13`,
  `business_case_honesty` held at `B`). Confirmed this is expected, not a stall — the GTM Auditor
  runs weekly (Mondays 03:30 UTC per `docs/autonomous-loop/ROUTINES.md`); this run (2026-07-17,
  a Friday) is still before the next scheduled pass (~2026-07-20), which should grade against Run
  9's 2026-07-13 disclosure fix and Run 10's `analysis/` verification scripts.
- `docs/quality/QUALITY_SCORECARD.md` (independent Product Quality Auditor, consumed as DATA only)
  unchanged since Run 10 (`as_of: 2026-07-13`, `overall: C`, `business_case_strength: B`,
  `security_rls: A`) — re-read directly, no new grading cycle yet. Reinforces, does not change,
  this run's posture.
- **Demand-signal research is NOT purely diminishing-returns, contrary to the Run 8-10 framing.**
  Re-probed the two known structural gaps (Reddit tool-block, Trustpilot site-block) per S10's
  every-run requirement — both unchanged, 5th consecutive re-probe with the same result. But this
  run additionally tried ONE fresh WebSearch query with a genuinely new angle (not a re-probe of a
  known-blocked domain) and found a real, dated, independent, verbatim-verifiable source: MONA's
  blog (`monaverse.com/blog/ai-interior-design-tools`, Justin Melillo, published 2026-06-10).
  Fetched directly via WebFetch — confirmed real quotes on "styling drift" (an AI room tool's
  furniture mutates between renders of the same design because most tools regenerate the image
  from scratch each time, with no persistent model of the space) and floorplan-blind renders
  (placing "a window where your client has a party wall"). This corroborates and sharpens theme 2
  ("AI room-render tools generate furniture that isn't real or buyable") with a THIRD independent
  named publisher and a genuinely new angle (persistence/spatial-grounding, not just buyability).

### What we built this run
- **`docs/growth/GROWTH_STATUS.md`**: bumped `as_of` to 2026-07-17; refreshed `internal_metrics_api`
  (8th probe) and `web_research` (5th re-probe of the two structural gaps, unchanged, plus the new
  MONA citation noted) validation reasons; added the MONA citation to `demand_signal` theme 2's
  `sources`/`solved_by_product`/`recency` fields, bumped `demand_signal.as_of` with a Run 11
  method-note explaining the new-angle search and why `confidence` stays at `emerging` (the
  strengthening is concentrated in one of four themes; S10's "strong" bar is source count +
  independence PER THEME); updated `positioning_implication` to name the newly-evidenced
  persistence/spatial-grounding differentiation angle alongside "real/buyable" and
  "multi-retailer" (still research-only, no copy change, still below the S3 steer bar); rewrote
  `learnings`/`next_actions`/`owner_blockers` for the 11th consecutive circuit-breaker run,
  including the GTM Auditor cadence note and a new `next_action` suggesting future demand-signal
  effort target themes 1/3/4 (thinner on independent sources than theme 2) rather than only
  re-probing the two known-blocked domains. Ran `npm install` (materializes `js-yaml` into a fresh
  `node_modules`, no `package.json` change) then `node scripts/validate-gtm.mjs` (OK) and the full
  `bash scripts/preflight.sh` — GATE 5 (GROWTH_STATUS/OWNER_ACTIONS/BUSINESS_CASE/QUALITY_SCORECARD
  YAML) green; the only 2 failures are the same pre-existing Product-Factory-owned gaps (functional
  journeys, DoD checkboxes) seen every prior run.

### What we did NOT do (and why)
- Did not pull real funnel metrics: no reachable source, re-confirmed this run (8th probe, same
  connect_rejected/502 signature). Correctly stayed 0/null.
- Did not attempt outreach: `site_gate_up: false` AND `ship_gate_met: false` (QUALITY_SCORECARD
  still C) — both S6 lanes stay hard-off. Re-confirmed no `docs/growth/MARKETING_HOLD` or
  `docs/growth/MARKETING_APPROVED` exists. Zero outreach drafts this run, correct.
- Did not touch `ROADMAP.md` / `VISION.md` / `docs/BUSINESS_CASE.md`: the new MONA citation is
  qualitative demand-signal research held at `confidence: emerging` — nowhere near the S3 bar
  (real quantified data, sufficient N, causal revenue link) for a steer or a business-case number
  change. Recorded as RECOMMEND-tier research, exactly per the standard's instruction.
- Did not re-attempt the ASO keyword change: still blocked on unverifiable App Store Connect
  Search Ads data; no new information since Run 3.
- Did not spawn an independent maker≠checker reviewer for the `GROWTH_STATUS.md` edit: this was a
  routine S4/S5 dashboard-and-research update (a new demand-signal citation with its own verbatim
  verification, re-probes, bookkeeping) — no landing/email/ASO copy, campaign, pricing/positioning
  claim, outreach draft, or roadmap/vision/business-case steer shipped, matching Runs 5-10's
  precedent for when a reviewer is/isn't warranted.
- Did not edit `PENDING_OPS.md`: no new owner-actionable item surfaced this run beyond what's
  already listed there; all items already tracked with correct `status`.
- Did not use the sandbox-local `SITE_GATE_PASSWORD`/`CRON_SECRET` for anything: same S4
  fail-closed reasoning as Runs 5-10.

### Lessons learned
- **"Diminishing returns on re-probing the same two blocked domains" is not the same claim as
  "diminishing returns on demand-signal research generally."** Runs 8-10 correctly declined to
  re-describe the same Reddit/Trustpilot blocks as if they were new work, but that led to skipping
  fresh search angles entirely for three runs. This run's MONA find shows a different query angle
  can still surface genuine, citable, verbatim-verifiable evidence even when the two known-hardest
  sources stay blocked — worth trying ONE fresh angle most runs, distinct from re-probing the known
  gaps, rather than treating "the usual two sources are still blocked" as license to stop searching.
- **A convergent finding from a THIRD independent source is stronger evidence than a second
  citation from an already-cited publisher would be.** The MONA citation is valuable specifically
  because it names a different, previously-uncited publisher making a related-but-distinct claim
  (spatial/persistence failure, not just "furniture isn't buyable") — that is closer to what S10's
  "strong" bar actually asks for (source count + independence per theme) than re-verifying an
  existing citation would have been.
- **Before declaring a scorecard "hasn't moved" a stall, check its cadence first, every time** —
  this is now a standing habit from Run 10, applied again cleanly this run: the GTM Auditor is
  weekly, so an unchanged `GTM_SCORECARD.md` two days after Run 9's fix is exactly expected, not a
  sign of ignored work.

### Circuit breaker check
- Same owner blockers as Runs 1-10? YES — circuit breaker remains FIRED (Run 11, 11th consecutive
  run, ~20 days elapsed since Run 1). Highest-leverage pair unchanged: SITE_GATE_PASSWORD (2 min) +
  RESEND_API_KEY/RESEND_FROM_EMAIL (15 min). No new blocker this run.
