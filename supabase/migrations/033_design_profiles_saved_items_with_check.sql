-- Backfill WITH CHECK onto the design_profiles / saved_items "manage" policies.
--
-- THE GAP
--
-- `design_profiles` and `saved_items` (001_initial_schema.sql) each define a
-- FOR ALL policy with a USING clause only, e.g.:
--
--     create policy "Users can manage own design profiles" on design_profiles
--       for all using (user_id = auth.uid());
--
-- A FOR ALL policy's USING clause governs SELECT/UPDATE/DELETE row
-- visibility; WITH CHECK governs INSERT/UPDATE new-row values. With no
-- WITH CHECK, the NEW row on an INSERT or UPDATE is never validated against
-- ownership — this is the exact same gap 032_backfill_update_with_check.sql
-- closed for `projects`, `rooms`, and `saved_designs` (the initial schema's
-- UPDATE-only policies), just on the two remaining USING-only policies from
-- the same original migration.
--
-- Neither table has a live API endpoint touching it today (design_profiles
-- and saved_items are unused by any current route), so this is
-- defense-in-depth, not a live exploit — but RLS, not the app layer, is the
-- documented security boundary (see AGENTS.md), so the policy should enforce
-- it on its own regardless of current app-code usage.
--
-- THE FIX
--
-- `ALTER POLICY ... WITH CHECK (...)` sets the check clause on the existing
-- policy in place (no DROP/CREATE, so grants and policy identity are
-- untouched). Idempotent: re-running sets the same expression again.
--
-- HOW TO APPLY:
--   psql $DATABASE_URL -f supabase/migrations/033_design_profiles_saved_items_with_check.sql
--
-- HOW TO VERIFY:
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check
--   from pg_policy
--   where polname in (
--     'Users can manage own design profiles',
--     'Users can manage own saved items'
--   );
--   -- Expected: both now have a non-null with_check expression.
--
--   As an authenticated user who owns row X, attempt:
--     UPDATE design_profiles SET user_id = '<some other uuid>' WHERE id = '<X>';
--   -- Expected: ERROR: new row violates row-level security policy for
--   -- table "design_profiles" (a WITH CHECK failure raises a hard error,
--   -- unlike a USING mismatch, which silently matches 0 rows). Previously
--   -- this update would have succeeded. Same for saved_items.

ALTER POLICY "Users can manage own design profiles" ON design_profiles
  WITH CHECK (user_id = auth.uid());

ALTER POLICY "Users can manage own saved items" ON saved_items
  WITH CHECK (user_id = auth.uid());
