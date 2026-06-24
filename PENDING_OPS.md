# Pending Operations

Operations that require manual (human) action at deploy time — migrations, live
secrets, billing config. The loop never runs these; it records them here and the
owner applies them. The daily digest reads this file.

## Pending

_None queued._

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
