# Pending Operations

Operations that require manual (human) action at deploy time — migrations, live
secrets, billing config. The loop never runs these; it records them here and the
owner applies them. The daily digest + the factory dashboard read this file (the
dashboard parses the fenced OWNER_ACTIONS YAML block below).

```yaml
OWNER_ACTIONS:
  project: AptDesignerAI
  as_of: 2026-06-27
  items:
    - id: spend-caps
      title: Set HARD daily API spend caps + alerts in every provider dashboard
      priority: urgent
      status: open
      why: "The app is live on Vercel and calls paid APIs (Gemini, Tavily, Browserbase, Stripe); an abuse spike or runaway loop can run up cost. A provider-side spend cap is the only hard backstop."
      how: "Set hard daily budgets/limits + 50%-of-cap alerts in each provider console (Google AI Studio / Gemini, Anthropic, Tavily, Browserbase), and regenerate any key you suspect is exposed."
      blocks: launch-safety
    - id: connect-channels
      title: Connect + authorize marketing channels to switch the Growth Agent into execute mode
      priority: high
      status: open
      why: "The Growth Agent stays in honest prepare-only mode until the owner connects their own authorized channels; the staged marketing engine (Track E) cannot run demand-gen otherwise."
      how: "Connect your own accounts/keys (X/Instagram/TikTok/Reddit, an email provider) to the deployed app's growth settings, server-side. The agent never holds live secrets; the deployed app sends."
      blocks: growth-execution
    - id: apply-migration-021
      title: "Apply migration 021_stripe_customers_annual_tier.sql to prod before enabling annual billing"
      priority: normal
      status: open
      why: "PR #98 added the pro_annual ($399/yr) tier; the tier CHECK constraint must be extended in the DB or annual checkouts will fail."
      how: "Run `supabase db push` (or paste supabase/migrations/021_stripe_customers_annual_tier.sql into the Supabase SQL Editor)."
      blocks: annual-billing
    - id: apply-migrations-022-023
      title: "Apply migrations 022 (waitlist double opt-in) + 023 (social publishing queue) to prod"
      priority: normal
      status: open
      why: "Run 34 added double opt-in columns to waitlist_emails (022) and the social_post_queue table (023). Until 022 is applied, waitlist sign-ups can't be stored/confirmed as pending; until 023 is applied, the social publishing queue has no table. Both are idempotent and admin-only (RLS enabled, no policy on 023; 017's boundary unchanged on 022)."
      how: "Run `supabase db push` (or paste supabase/migrations/022_waitlist_double_opt_in.sql then 023_social_post_queue.sql into the Supabase SQL Editor, in order)."
      blocks: growth-execution
    - id: rate-limit-redis
      title: "Move rate limiter state from in-memory to Upstash Redis before scaling"
      priority: normal
      status: open
      why: "The in-memory rate limiter (added Run 32, PR #111) AND the per-user/day spend limiter (added Run 33, PR #119, lib/utils/spend-limiter.ts) both reset on cold start and are per-Vercel-function-instance. On multi-instance deployments a single user can bypass per-user limits by hitting different instances. Pre-launch this is acceptable; before significant traffic the state must move to a shared store."
      how: "Install the Upstash Redis Vercel integration (1-click from Vercel dashboard → Integrations), set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars, swap lib/utils/rate-limiter.ts AND lib/utils/spend-limiter.ts to use @upstash/ratelimit (Sliding Window) / a shared Redis counter."
      blocks: rate-limiting-at-scale
    - id: connect-email-resend
      title: "Connect Resend to switch the email lifecycle from dry-run to live (E7.2)"
      priority: high
      status: open
      why: "lib/email (PR #117) ships in dry-run by default — it logs every send but transmits nothing until a provider key is present. The staged E4/E6 email lifecycle cannot actually reach users until this is connected."
      how: "Create a Resend account, verify your sending domain (SPF/DKIM DNS records), create a sending API key, then set RESEND_API_KEY + RESEND_FROM_EMAIL (an address on the verified domain) on the deployment. Leave GROWTH_EMAIL_DRY_RUN unset to go live automatically. Full runbook: docs/growth/CONNECT.md Step 1."
      blocks: growth-execution
    - id: set-metrics-token
      title: "Set INTERNAL_METRICS_TOKEN to open the growth-metrics pull API (E7.4)"
      priority: high
      status: open
      why: "GET /api/internal/growth-metrics (PR #118) is closed by default (returns 503) until the token is set. The daily Growth Agent needs it to read REAL funnel numbers (waitlist + subscriber counts) into GROWTH_STATUS instead of leaving them 0/null."
      how: "Generate a long random secret (`openssl rand -hex 32`) and set INTERNAL_METRICS_TOKEN on the deployment. Verify per docs/growth/CONNECT.md Step 2 (curl with Authorization: Bearer)."
      blocks: growth-execution
    - id: tune-daily-spend-cap
      title: "(Optional) tune DAILY_PAID_CALL_LIMIT for the paid-API spend ceiling (G7)"
      priority: low
      status: open
      why: "The per-user/day spend circuit breaker (PR #119) defaults to 60 paid calls/user/day. This is a code-level backstop; the durable protection is the provider-dashboard hard caps in the `spend-caps` item above."
      how: "Set DAILY_PAID_CALL_LIMIT (integer > 0) on the deployment only if 60/user/day is too low/high for your real usage; otherwise leave unset."
      blocks: none
```

## Pending

### Growth-engine env vars (added 2026-06-27, Run 33 — PRs #117/#118/#120) — see docs/growth/CONNECT.md

The growth execution engine ships **closed by default**; set these on the deployment (Vercel → Environment Variables) to switch each capability live. None are committed.

| Env var | Capability | Effect until set |
|---------|-----------|------------------|
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Email lifecycle sending (E7.2) | Dry-run — emails logged, not sent |
| `GROWTH_EMAIL_DRY_RUN` | Email mode override (optional) | Unset = auto-live once key present |
| `INTERNAL_METRICS_TOKEN` | Growth-metrics pull API (E7.4) + social-queue API (E7.3) | Both endpoints return 503 (closed) |
| `DAILY_PAID_CALL_LIMIT` | Paid-API spend ceiling tune (G7, optional) | Defaults to 60/user/day |
| `X_API_KEY` / `INSTAGRAM_ACCESS_TOKEN` / `TIKTOK_ACCESS_TOKEN` / `REDDIT_CLIENT_ID` (+ each provider's secret set) | Social publishing per channel (E7.3) | That channel stays dry-run — queue flush reports `dryRun: true`, nothing posts publicly |
| `GROWTH_SOCIAL_DRY_RUN` | Social mode override (optional) | `1` forces dry-run on every channel regardless of credentials |

> **Note (E7.3, Run 34):** the social publishing queue ships the safe dry-run path only; the per-channel *live API client* is a follow-on build, so setting a channel credential prepares it but does not yet post publicly this release. See docs/growth/CONNECT.md Step 4.

Full step-by-step + verify commands: **docs/growth/CONNECT.md**.

### 021_stripe_customers_annual_tier.sql — extend tier CHECK constraint for pro_annual (added 2026-06-26, PR #98 — apply before enabling annual billing)

Migration 021 extends the `stripe_customers.tier` column's CHECK constraint to include `'pro_annual'`. Without this, the Stripe webhook handler fails with a Postgres constraint violation when recording an annual subscription, preventing the customer row from being written.

**Apply via:**
```sh
supabase db push
# or paste into Supabase SQL Editor:
# supabase/migrations/021_stripe_customers_annual_tier.sql
```

**What it does:**
```sql
ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS stripe_customers_tier_check;
ALTER TABLE stripe_customers ADD CONSTRAINT stripe_customers_tier_check
  CHECK (tier IN ('apartment', 'pro', 'pro_annual'));
```

**Also set the new env var** (Vercel + Stripe dashboard):
```
STRIPE_PRICE_ID_PRO_ANNUAL=<price_...>   # recurring yearly price of $399.00 USD
```
Create the price in Stripe dashboard → Products → "AptDesigner Pro" → Add pricing → Recurring yearly → $399.00 USD. Copy the resulting `price_...` ID into the env var.

**Verify:**
```sql
-- After applying migration:
SELECT tier FROM stripe_customers LIMIT 1;   -- should not fail
-- Test upsert with pro_annual tier in Stripe test mode
```

---

### Playwright E2E CI wiring (added 2026-06-25, PR #87 — wire before F4 gate can be ticked)

PR #87 adds `playwright.config.ts`, `e2e/public-pages.spec.ts`, and `e2e/a11y.spec.ts`. The E2E suite is ready to run but is not yet wired into CI (the loop cannot write `.github/workflows/`).

**Steps:**
1. Add a Playwright job to `.github/workflows/ci.yml` (or a new `e2e.yml`):
   ```yaml
   e2e:
     runs-on: ubuntu-latest
     env:
       PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
       PLAYWRIGHT_BASE_URL: "http://localhost:3000"
       CI: "true"
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: '20'
           cache: 'npm'
       - run: npm ci
       - run: npm run build
       - run: npx playwright test
   ```
   The pre-installed Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — `playwright.config.ts` already points there via `launchOptions.executablePath`. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` prevents re-downloading.
2. Add the job as a required check in GitHub repository settings (Settings → Branches → Branch protection → Require status checks → add `e2e`).

**Why it matters:** Without this, the axe-core accessibility scans and public-pages smoke tests never run in CI. F4 cannot be ticked until the gate actually executes and passes.

---

### 020_fix_saved_designs_rls_column_filter.sql — security: fix share-link RLS policy mismatch (added 2026-06-25, PR #84)

Migration 019 (not yet applied) and migration 020 (new this run) must be applied **together, in order**, on the same deployment:

```sh
# Apply both in one session — 019 first, then 020 immediately after.
psql $DATABASE_URL -f supabase/migrations/019_fix_saved_designs_rls.sql
psql $DATABASE_URL -f supabase/migrations/020_fix_saved_designs_rls_column_filter.sql
```

**Why two migrations?** Migration 019 drops the too-permissive policy from migration 015 and adds a JWT-claim policy. Migration 020 fixes a mismatch: the app (`app/api/shared/[token]/route.ts`) uses a PostgREST column filter (`.eq("share_token", token)`) — not a JWT claim — so the 019 policy returns 0 rows for every share link. Migration 020 replaces it with the correct column-filter policy: `USING (is_public = true AND share_token IS NOT NULL)`.

**Verify (run as anon role):**
```sql
-- Must return 0 rows (no token filter provided — enumeration blocked):
SELECT id FROM saved_designs WHERE is_public = true LIMIT 5;

-- Must return exactly 1 row for a valid token:
SELECT id FROM saved_designs WHERE share_token = '<valid-token>' AND is_public = true;
```

---

### 019_fix_saved_designs_rls.sql — security: require share_token in RLS policy (added 2026-06-25, PR #78)

⚠️ **Apply 019 together with 020 (see entry above).** Do not apply 019 alone — it uses the JWT-claim approach which breaks share links; 020 fixes it immediately after.

---

### RUN_EVALS=1 CI job — wire eval suite into GitHub Actions (added 2026-06-25, Track A5)

PR #73 adds three live eval test files (`evals/__tests__/diagnosis.eval.test.ts`, `sourcing.eval.test.ts`, `grounding.eval.test.ts`) that call the real Gemini pipeline when `RUN_EVALS=1` is set. The loop cannot write `.github/workflows/` (triggers the sensitive-file permission hook in headless runs), so this job must be wired manually.

**Steps:**
1. Add a new workflow file `.github/workflows/evals.yml` (or add a job to the existing `ci.yml`):
   ```yaml
   jobs:
     evals:
       runs-on: ubuntu-latest
       if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
       env:
         GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
         RUN_EVALS: "1"
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: '20'
             cache: 'npm'
         - run: npm ci
         - run: npx vitest run evals/__tests__/diagnosis.eval.test.ts evals/__tests__/sourcing.eval.test.ts evals/__tests__/grounding.eval.test.ts
           timeout-minutes: 15
   ```
2. Add `GEMINI_API_KEY` to GitHub Actions secrets (Settings → Secrets → New secret).
3. Schedule: `cron: '0 6 * * *'` (daily at 06:00 UTC) or run on `workflow_dispatch` for manual invocation.
4. A failure in this job means a pipeline regression — investigate before merging new model/prompt changes.

**Why it matters:** Without this job, the eval suite only runs locally when a developer manually sets `RUN_EVALS=1`. The loop cannot verify pipeline quality on merge without a live eval gate.

### iOS Universal Links — Apple App Site Association file (added 2026-06-24, PR #56 — apply before App Store submission)

PR #56 adds `ios.associatedDomains: ["applinks:aptdesignerai.ai"]` to `app.json`. iOS Universal Links require a signed AASA file hosted at a specific path.

**Steps:**
1. Create the file `public/.well-known/apple-app-site-association` in your web deployment (or serve it directly) with:
   ```json
   {
     "applinks": {
       "apps": [],
       "details": [
         {
           "appID": "<TEAM_ID>.ai.aptdesigner.app",
           "paths": ["/saved/*", "/results/*", "/shared/*"]
         }
       ]
     }
   }
   ```
   Replace `<TEAM_ID>` with your 10-character Apple Developer Team ID (found in Xcode → Signing & Capabilities or developer.apple.com/account).
2. The file must be served at `https://aptdesignerai.ai/.well-known/apple-app-site-association` with `Content-Type: application/json` (no `.json` extension in the URL).
3. After EAS build: test by tapping an `https://aptdesignerai.ai/saved/...` link on a physical iPhone — it should open the app rather than Safari.

Note: Only link paths listed in `paths` will open the app. The list above restricts to in-app routes; it does NOT hijack marketing/landing pages.

### EAS project ID for push token registration (added 2026-06-24, PR #56 — set before production EAS build)

`use-push-notifications.ts` resolves the EAS project ID via `Constants.expoConfig?.extra?.eas?.projectId`. Without it, `getExpoPushTokenAsync` uses a development fallback that may not work in standalone builds.

**Steps:**
1. Create an EAS project at https://expo.dev if you haven't already:
   ```bash
   cd mobile && npx eas init
   ```
2. Add the project ID to `mobile/app.json`:
   ```json
   {
     "expo": {
       "extra": {
         "eas": {
           "projectId": "<your-eas-project-id>"
         }
       }
     }
   }
   ```
3. Also add to EAS environment variables for CI builds.

Verify: build a standalone app → install on a physical device → launch → accept notification permission → check AsyncStorage `expoPushToken` key contains a valid `ExponentPushToken[...]` string.

### Future: server-side push token storage (added 2026-06-24, PR #56 — implement when re-engagement sends are needed)

PR #56 stores the Expo push token in AsyncStorage only. For server-initiated re-engagement sends (e.g., "your design is ready" notifications), the token needs to be synced to Supabase.

**When ready to implement:**
1. Add `supabase/migrations/019_device_push_tokens.sql`:
   ```sql
   CREATE TABLE device_push_tokens (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     token text NOT NULL,
     platform text NOT NULL CHECK (platform IN ('ios', 'android')),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE(user_id, token)
   );
   ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users manage own tokens" ON device_push_tokens
     FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
   ```
2. Add `POST /api/mobile/push-token` endpoint that upserts the token (Bearer JWT auth, same pattern as `/api/mobile/saved-designs`).
3. Call the endpoint from `registerForPushNotificationsAsync` after `AsyncStorage.setItem`.

This is a future integration — the current AsyncStorage storage means the token survives app reinstalls and is available when the server-side integration is built.

### Stripe web billing — secrets + webhook + Price IDs (added 2026-06-24, PR #50; updated Run 29 — add Pro Annual)

PR #50 (C1 Stripe web billing) requires the following before live purchases work.

**Vercel env vars (Production + Preview):**
```
STRIPE_SECRET_KEY=<sk_live_...>
STRIPE_WEBHOOK_SECRET=<whsec_...>
STRIPE_PRICE_ID_APARTMENT=<price_...>     # one-time $29 product
STRIPE_PRICE_ID_PRO_MONTHLY=<price_...>  # recurring $49/month product
STRIPE_PRICE_ID_PRO_ANNUAL=<price_...>   # recurring $399/year product (added Run 29)
```

**Stripe dashboard steps:**
1. Create three Products in the Stripe dashboard:
   - "AptDesigner Apartment" — one-time price of $29.00 USD
   - "AptDesigner Pro" — recurring monthly price of $49.00 USD
   - "AptDesigner Pro Annual" — recurring yearly price of $399.00 USD
2. Copy the Price IDs (starting with `price_`) into the env vars above.
3. Register the webhook endpoint:
   - Go to Stripe → Developers → Webhooks → Add endpoint
   - URL: `https://<your-vercel-url>/api/billing/webhook`
   - Events to send: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

**Supabase migration — apply migration 018:**
```
supabase db push
```
This creates the `stripe_customers` table with RLS (file: `supabase/migrations/018_stripe_customers.sql`).

Verify:
1. Hit `/billing/upgrade?tier=apartment` — page renders with $29 price
2. POST `/api/billing/checkout` with valid auth → returns `{ sessionId, url }` pointing to Stripe
3. Complete a test purchase in Stripe test mode → stripe_customers row appears in Supabase
4. GET `/api/mobile/entitlements` (web user) → `{ tier: "apartment" }` for the buyer

Note: `hasProEntitlementWeb()` is not yet wired to web save/generation routes — that enforcement step is a follow-up PR.

### RevenueCat keys — mobile + server (added 2026-06-24, PRs #42 + #43 — set before EAS build and before production Vercel deploy)

PR #42 (C2/C3 RevenueCat mobile SDK) and PR #43 (C4 server-side entitlement check) require two separate keys.

**Mobile (EAS / local dev):** Add to `mobile/.env.local` (gitignored) and to EAS environment variables:
```
EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY=<your-rc-public-sdk-key>
```
- Find this in your RevenueCat dashboard → Project → API Keys → Public SDK keys → iOS / Android key.
- When absent: the paywall UI shows (hardcoded prices) but purchases and restore are no-ops. `isPro` is always false. Graceful degradation — safe for local dev.
- When present: live Offerings are fetched, real purchases go through the App Store / Play Store.

**Server (Vercel env vars):** Add to Vercel project environment variables (Production + Preview):
```
REVENUECAT_SECRET_KEY=<your-rc-secret-key>
```
- Find this in your RevenueCat dashboard → Project → API Keys → Secret API keys.
- This is a server-only key — **never use EXPO_PUBLIC_ prefix** or it leaks to the client bundle.
- When absent: `hasProEntitlement()` logs a console.error and returns `true` (fail-open) — free-tier save limit is not enforced. Fix by setting the key.
- When present: save limit is enforced for non-Pro users (FREE_SAVE_LIMIT = 3).

Verify:
1. Mobile: build with key set → "Start Free Trial" reaches the OS purchase dialog
2. Server: Pro subscriber with ≥3 saves → POST `/api/mobile/saved-designs` succeeds (HTTP 201)
3. Server: Free user with ≥3 saves → POST returns HTTP 403 `{ subscription_required: true }`

### Mobile env vars — Supabase + API URL (added 2026-06-24, updated PR #32 — set before EAS build or local dev on device)
PR #28 (B2 mobile auth) and PR #32 (B2 photo upload + AI analysis) require these env vars.
Create `mobile/.env.local` (gitignored) with:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
EXPO_PUBLIC_API_URL=https://<your-vercel-deployment-url>
```

For EAS Build: add these as EAS environment variables in your EAS project dashboard
(https://expo.dev/accounts/<user>/projects/aptdesignerai/environment-variables).
Use the same values as your Supabase project (same project as the web app).
`EXPO_PUBLIC_API_URL` should point to your Vercel deployment (e.g. `https://aptdesignerai.vercel.app`).

Verify: launch the mobile app → login screen should appear → select a photo → choose room type → analysis runs and shows real AI results.

### Supabase Storage bucket: room-photos (added 2026-06-24 — create before testing mobile upload)
PR #32 uploads mobile photos to a `room-photos` Supabase Storage bucket. Create it if it does not exist:

1. Go to your Supabase project dashboard → Storage → New bucket
2. Name: `room-photos`
3. Public: **Yes** (images are fetched by Gemini via their public URL)
4. Add an RLS INSERT policy so authenticated users can upload:
   ```sql
   -- Allow authenticated users to upload to their own folder
   CREATE POLICY "Authenticated users can upload room photos"
   ON storage.objects FOR INSERT
   TO authenticated
   WITH CHECK (bucket_id = 'room-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
   ```
5. Verify: upload a test image from the mobile app → confirm it appears in the bucket under `<user-id>/<timestamp>.jpg`

### 017_waitlist.sql (added 2026-06-24 — apply when PR #22 merges)
Creates the `waitlist_emails` table (email capture for iOS/Android waitlist). RLS enabled with NO policy — service-role only.

```sql
-- Already in supabase/migrations/017_waitlist.sql
-- Apply via: supabase db push
-- Verify: \d waitlist_emails  →  id, email (UNIQUE), source, created_at
--         SELECT count(*) FROM pg_policies WHERE tablename = 'waitlist_emails';  →  0 (correct)
```

## Applied

### 2026-06-24 — applied to production via `supabase db push`
- ✅ `supabase/migrations/015_saved_designs_sharing.sql` — `share_token` / `is_public`
  columns + unique index + public-read policy on `saved_designs` (share-links feature).
- ✅ `supabase/migrations/016_rls_computer_use_tables.sql` — enabled RLS (no policy) on
  `computer_use_verified_products` and `computer_use_agent_logs`, closing the anon-key
  exposure ("RLS Disabled in Public"). **Security Advisor confirmed clean.**

## Production notes (for context — not action items)
- The app is deployed on **Vercel**; production branch = `claude/ai-apartment-design-app-iHAdb`
  (the loop's default branch), so **every auto-merged PR deploys live**. CI gates
  `verify` + `build` + `mobile` are all required, so a broken build cannot ship.
- Production env vars are configured in Vercel project settings (not in the repo).
- Future migrations / live secrets / billing keys go under **Pending** above as they
  arise; apply them at the next deploy and move them to **Applied**.
