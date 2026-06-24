# Pending Operations

Operations that require manual (human) action at deploy time — migrations, live
secrets, billing config. The loop never runs these; it records them here and the
owner applies them. The daily digest reads this file.

## Pending

### RevenueCat setup — required before Track C Phase 2 (added 2026-06-24 — set before wiring purchase flow)
PR #40 introduces the paywall UI and entitlements stub. Phase 2 wires the real purchase flow.

1. Create a RevenueCat account at https://app.revenuecat.com/ → new project for AptDesignerAI
2. Add iOS app (bundle ID: `ai.aptdesigner.app`) + Android app (package: `ai.aptdesigner.app`)
3. Configure subscription products in App Store Connect + Google Play Console:
   - Annual: $79.99/yr with 7-day free trial
   - Monthly: $9.99/mo with 7-day free trial
4. Import products into RevenueCat → create Entitlement named `pro` → attach both products
5. Get the RevenueCat **Public SDK Key** (Project Settings → API Keys → Public):
   ```
   EXPO_PUBLIC_REVENUECAT_API_KEY=<your-public-sdk-key>
   ```
   Add to `mobile/.env.local` and EAS secrets.
6. Get the RevenueCat **Secret API Key** (Project Settings → API Keys → Secret):
   ```
   REVENUECAT_API_KEY=<your-secret-api-key>
   ```
   Add to Vercel environment variables (**NOT** `NEXT_PUBLIC_`-prefixed — server-side only).

Verify: after Phase 2 implementation — tap "Start Free Trial" in paywall → RevenueCat purchase sheet appears → purchase completes → `GET /api/mobile/entitlements` returns `{tier:"pro", canSaveDesigns:true}`.

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
