-- Fix migration 019's RLS policy to match the app's column-filter approach.
--
-- Migration 019 applied a policy that checks for the share_token in the JWT
-- claims (current_setting('request.jwt.claims')). However, the app's share
-- route (app/api/shared/[token]/route.ts) passes the token as a PostgREST
-- column filter (.eq("share_token", token)) — it does NOT embed the token in
-- the JWT. Under the JWT-claim policy, every share link returns 0 rows.
--
-- The simpler column-filter policy is correct here: because share_token has a
-- UNIQUE constraint (migration 015), a caller who knows the token can retrieve
-- exactly one row. Enumeration is still impossible — a SELECT without the
-- share_token filter matches 0 rows because is_public alone is insufficient
-- to satisfy the USING clause.
--
-- How to apply:
--   psql $DATABASE_URL -f supabase/migrations/020_fix_saved_designs_rls_column_filter.sql
--
-- How to verify (anon role, no filter — must return 0 rows):
--   SELECT id FROM saved_designs WHERE is_public = true LIMIT 5;
--   -- Expected: 0 rows
--
-- Verify with token (must return exactly 1 row for a valid token):
--   SELECT id FROM saved_designs WHERE share_token = '<valid-token>' AND is_public = true;
--   -- Expected: 1 row

-- Drop the JWT-claim policy installed by migration 019.
DROP POLICY IF EXISTS "Public can view shared designs via token" ON saved_designs;

-- Replacement: token knowledge is proved by the unique column filter.
-- The UNIQUE constraint on share_token (migration 015) ensures a query that
-- includes ?share_token=eq.<token> can only match the row the caller already
-- knows about — no enumeration is possible without the token.
CREATE POLICY "Public can view shared designs via token"
  ON saved_designs FOR SELECT
  USING (
    is_public = true
    AND share_token IS NOT NULL
  );
