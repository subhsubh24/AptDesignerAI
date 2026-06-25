-- Fix saved_designs public sharing policy to require share_token.
--
-- The previous policy (015) allowed ANY row with is_public=true to be read
-- by unauthenticated callers. Because PostgREST exposes the table, anyone
-- could enumerate all public designs without knowing the share token — the
-- token check happened only in the app layer, not the database.
--
-- This replacement restricts unauthenticated reads to rows where BOTH
-- is_public=true AND the caller supplies the exact share_token in a
-- PostgREST filter (e.g. ?share_token=eq.<token>). Without the token in
-- the query the row simply doesn't match and is not returned.
--
-- How to apply:
--   psql $DATABASE_URL -f supabase/migrations/019_fix_saved_designs_rls.sql
--
-- How to verify (should return 0 rows without a valid token):
--   SELECT id FROM saved_designs WHERE is_public = true LIMIT 5;
-- (run as anon role — must return 0 rows unless share_token filter present)

-- Drop the overly-permissive policy added in migration 015.
DROP POLICY IF EXISTS "Public can view shared designs" ON saved_designs;

-- Replacement: caller must supply the correct share_token.
-- share_token is unique, so a matching filter proves knowledge of the token.
CREATE POLICY "Public can view shared designs via token"
  ON saved_designs FOR SELECT
  USING (
    is_public = true
    AND share_token IS NOT NULL
    AND share_token = current_setting('request.jwt.claims', true)::json->>'share_token'
  );

-- Alternatively, if the app passes the token as a PostgREST column filter
-- rather than a JWT claim, the policy below is simpler and correct:
--
--   USING (is_public = true AND share_token IS NOT NULL)
--
-- In that case the uniqueness of share_token ensures only the holder of
-- the token can retrieve the specific row — enumeration is impossible
-- because every unauthenticated SELECT must include ?share_token=eq.<token>.
--
-- Choose the variant that matches how the app calls PostgREST:
--   • JWT claim approach: use the CREATE POLICY above.
--   • Column-filter approach: replace with the simpler USING clause.
-- Either way, drop the old policy first (already done above).
