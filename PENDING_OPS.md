# Pending Operations

Operations that require manual action at deploy time.
The code is merged but these have NOT been applied yet.

---

## 2026-06-23 — Public share links for saved designs

**Migration file**: `supabase/migrations/015_saved_designs_sharing.sql`

**What it does**:
- Adds `share_token TEXT UNIQUE` column to `saved_designs`
- Adds `is_public BOOLEAN NOT NULL DEFAULT false` column to `saved_designs`
- Adds unique index on `share_token` (where not null)
- Adds RLS policy allowing anonymous reads of rows where `is_public = true`

**Apply when**: deploying to a real Supabase instance (the app currently uses the in-memory store, so the feature works in dev without this migration).

**Note on RLS policy**: The migration adds `USING (is_public = true)` which allows reading all public designs via the Supabase REST API — not just via the share token. If enumeration of public designs is a concern before launch, tighten the policy or leave it as-is (public designs are intentionally public content).

**To apply**:
```sql
-- Run via Supabase dashboard → SQL editor, or via `supabase db push`
-- File: supabase/migrations/015_saved_designs_sharing.sql
```

---

## 2026-06-23 — Enable RLS on Computer-Use tables (close anon-key exposure)

**Migration file**: `supabase/migrations/016_rls_computer_use_tables.sql`

**What it does**:
- Enables row-level security on `computer_use_verified_products` and `computer_use_agent_logs`, which shipped in migration 009 without RLS and were therefore exposed to the public `anon`/`authenticated` roles via the Supabase REST API (Security Advisor: "RLS Disabled in Public").
- Adds **no policy** by design: both tables are shared, non-tenant, and accessed only by the service-role admin client (which bypasses RLS), so RLS-with-no-policy denies anon/authenticated entirely while leaving the app unaffected. Idempotent.

**Apply when**: deploying to a real Supabase instance.

**To apply**:
```sql
-- Run via Supabase dashboard → SQL editor, or via `supabase db push`
-- File: supabase/migrations/016_rls_computer_use_tables.sql
```

**Verify after applying**: re-run the Security Advisor (`type: security`) and confirm the two "RLS Disabled in Public" errors are gone and `relrowsecurity = true` for both tables.
