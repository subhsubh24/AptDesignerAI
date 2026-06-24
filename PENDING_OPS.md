# Pending Operations

Operations that require manual (human) action at deploy time — migrations, live
secrets, billing config. The loop never runs these; it records them here and the
owner applies them. The daily digest reads this file.

## Pending

### Stripe web billing — secrets + webhook + Price IDs (added 2026-06-24, PR #50 — set before enabling paid web purchases)

PR #50 (C1 Stripe web billing) requires the following before live purchases work.

**Vercel env vars (Production + Preview):**
```
STRIPE_SECRET_KEY=<sk_live_...>
STRIPE_WEBHOOK_SECRET=<whsec_...>
STRIPE_PRICE_ID_APARTMENT=<price_...>     # one-time $29 product
STRIPE_PRICE_ID_PRO_MONTHLY=<price_...>  # recurring $49/month product
```

**Stripe dashboard steps:**
1. Create two Products in the Stripe dashboard:
   - "AptDesigner Apartment" — one-time price of $29.00 USD
   - "AptDesigner Pro" — recurring monthly price of $49.00 USD
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
