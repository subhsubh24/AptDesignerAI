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
