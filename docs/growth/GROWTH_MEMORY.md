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
