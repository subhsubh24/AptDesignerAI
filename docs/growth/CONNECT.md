# CONNECT — owner setup runbook for the growth execution engine

This is the ~20-minute runbook that turns the **staged** growth engine into a
**live** one. The engine ships **closed by default**: every external action is
in dry-run / disabled until you supply the matching credential below, so the app
is safe to deploy before any channel is connected.

- The **deployed app** holds the secrets and does the sending/reading.
- The **daily Growth Agent** (the cloud routine) only prepares creative and
  reads metrics through the app — it never holds credentials.
- Until a capability's credential is set, `GROWTH_STATUS.md` reports
  `awaiting_connect: true` for it and the agent takes no external action.

All secrets are set as environment variables on the deployment (Vercel project
settings → Environment Variables). Never commit them. The corresponding
machine-readable owner action list is in `PENDING_OPS.md` (`OWNER_ACTIONS`).

---

## Capability status (what's built vs. what's pending)

| Capability | Status | Credential to connect |
|---|---|---|
| Waitlist capture → Supabase | **Live** (no secret beyond Supabase) | already wired (`SUPABASE_SERVICE_ROLE_KEY`) |
| Funnel-metrics pull API | **Built**, closed until token set | `INTERNAL_METRICS_TOKEN` |
| Email lifecycle sending | **Built**, dry-run until key set | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Paid-API spend ceiling (G7) | **Live** (default cap) | optional: `DAILY_PAID_CALL_LIMIT` |
| Social publishing queue | **Built**, dry-run until a channel's key is set | per channel — see Step 4 |

> Social publishing (X / Instagram / TikTok / Reddit) now has a **server-side
> queue** (ROADMAP E7.3): the Growth Agent enqueues drafts and the app flushes
> them through per-platform providers. Every channel ships in **dry-run** until
> you set its credential (Step 4) — nothing is posted publicly before then. The
> creative is staged in `docs/social-drafts.md` and `docs/content-calendar.md`.

---

## Step 1 — Email sending (Resend) · ~10 min

The email lifecycle (`docs/email-welcome-sequence.md` + `docs/email-lifecycle.md`)
sends through one abstraction (`lib/email`). Until you connect Resend it runs in
**dry-run**: every send is logged (`[email:dry-run] would send …`) and nothing
leaves the system.

1. Create an account at <https://resend.com>.
2. **Add and verify your sending domain** (Resend → Domains). Add the DNS
   records they show (SPF/DKIM) at your DNS host and wait for "Verified".
3. Create an API key (Resend → API Keys), scoped to "Sending access".
4. Set on the deployment:
   - `RESEND_API_KEY` = the key (starts with `re_`).
   - `RESEND_FROM_EMAIL` = a from-address on your verified domain, e.g.
     `AptDesignerAI <hello@yourdomain.com>`.
5. Leave `GROWTH_EMAIL_DRY_RUN` **unset** to go live automatically once the key
   is present (set it to `1` to keep forcing dry-run, `0` to force live).

**Verify:** trigger any lifecycle email (or call `sendEmail()` from a one-off
script). A live send returns `{ delivered: true }`; dry-run returns
`{ dryRun: true }`. Check the Resend dashboard "Emails" log for delivery.

---

## Step 2 — Funnel-metrics pull API · ~5 min

`GET /api/internal/growth-metrics` returns **real** funnel numbers
(`waitlist_signups_total`, `waitlist_signups_7d`, `active_subscribers` — active
recurring subscribers across the pro + pro_annual tiers, excluding the one-time
apartment tier — and `annual_subscribers`) so the Growth Agent can populate
`GROWTH_STATUS.md` from data that actually happened. It is **closed by default**
(returns `503` until the token is set) and rate-limited by IP.

1. Generate a long random secret: `openssl rand -hex 32`.
2. Set `INTERNAL_METRICS_TOKEN` to that value on the deployment.

**Verify:**

```bash
curl -s https://YOUR_DOMAIN/api/internal/growth-metrics \
  -H "Authorization: Bearer $INTERNAL_METRICS_TOKEN" | jq
```

Expected: a JSON body with `funnel.waitlist_signups_total` etc. A missing/wrong
token returns `401`; an unset token returns `503`.

> Visitor, trial-start and conversion-rate metrics are **not** in this response
> — they live in Vercel Analytics and Stripe's reporting API and stay `null` in
> `GROWTH_STATUS.md` until those sources are separately wired (planned E7.4 work).

---

## Step 3 — Spend ceiling (optional tune) · ~1 min

A per-user/day circuit breaker (G7) caps how many paid-API calls
(Gemini/Tavily/Browserbase/Maps) a single user can trigger across all expensive
endpoints, on top of the per-route rate limits. Default is **60/user/day**.

- Set `DAILY_PAID_CALL_LIMIT` to override (integer > 0).
- This is a code-level backstop. The **durable** spend protection is the
  human-only hard caps + 50%-of-cap billing alerts you set in each provider
  dashboard — see `PENDING_OPS.md`.

---

## Step 4 — Social publishing queue (per channel) · ~10 min each

The queue (`/api/internal/social-queue`) is closed by default (returns `503`
until `INTERNAL_METRICS_TOKEN` from Step 2 is set) and posts in **dry-run** until
a channel's primary credential is present. The Growth Agent enqueues drafts with
`POST { action: "enqueue", platform, body, ... }`; the app flushes due posts with
`POST { action: "flush" }`. `GROWTH_SOCIAL_DRY_RUN=1` forces dry-run on every
channel regardless of credentials.

Each channel's primary credential is the env var that *gates* live publishing for
it (no credential ⇒ that channel can never leave dry-run). Set it on the
deployment and complete that provider's full OAuth/app-review as the platform
requires:

| Channel | Primary credential (gates live publishing) |
|---|---|
| X (Twitter) | `X_API_KEY` (plus the v2 app's secret/token set) |
| Instagram | `INSTAGRAM_ACCESS_TOKEN` (Graph API business account) |
| TikTok | `TIKTOK_ACCESS_TOKEN` (TikTok for Developers) |
| Reddit | `REDDIT_CLIENT_ID` (plus the script-app secret) |

> **This release ships the queue + the safe dry-run path only.** The per-channel
> *live API client* is added in a follow-on change. Until then, a flush still
> reports `dryRun: true` even with a credential set — setting the credential
> prepares the channel but does not yet post publicly. (This is intentional: the
> queue and provider seam are proven first; the live send is wired per channel as
> each account is connected and approved.)

**Verify (safe, no public post):** with only `INTERNAL_METRICS_TOKEN` set,

```bash
curl -s https://YOUR_DOMAIN/api/internal/social-queue \
  -H "Authorization: Bearer $INTERNAL_METRICS_TOKEN" | jq   # queue status counts
```

Enqueue a draft, then flush — the response reports `dryRun` until a credential is
set, confirming nothing was posted publicly.

> Connecting + authorizing the social accounts (and passing each platform's API
> app review) is owner work — the queue is built and safe; only the credentials
> and account approvals are human-applied.

---

## What stays human-only

These cannot be done by the loop and are tracked in `PENDING_OPS.md`:

- Supplying the live secrets above.
- Domain DNS verification for email.
- Provider-dashboard hard spend caps + billing alerts.
- Connecting/funding/authorizing social + ad accounts and passing each
  platform's API app review (the publishing queue is built; see Step 4).

Once Steps 1–2 are done, `awaiting_connect` flips to `false` for email and
metrics, and the Growth Agent can begin executing the staged lifecycle and
reporting real funnel numbers.
