-- Pin an explicit WITH CHECK onto the design_profiles / saved_items "manage" policies.
--
-- BACKGROUND
--
-- `design_profiles` and `saved_items` (001_initial_schema.sql) each define a
-- FOR ALL policy with a USING clause only, e.g.:
--
--     create policy "Users can manage own design profiles" on design_profiles
--       for all using (user_id = auth.uid());
--
-- Per Postgres' documented RLS behavior (see "sql-createpolicy.html" and
-- "ddl-rowsecurity.html"), a FOR ALL or UPDATE policy that omits WITH CHECK
-- automatically reuses its USING expression as the WITH CHECK expression.
-- So these policies were already validating INSERT/UPDATE new-row values
-- against `user_id = auth.uid()` — there is no unvalidated-write gap here,
-- and there never was one.
--
-- THE VALUE OF THIS MIGRATION
--
-- This is not closing a live vulnerability; it's making an already-enforced
-- check explicit in the policy catalog. The concrete benefit: today, because
-- WITH CHECK is implicit, a future `ALTER POLICY ... USING (...)` that only
-- intends to change row *visibility* would silently change the write-time
-- check along with it (the implicit WITH CHECK always mirrors USING). Once
-- WITH CHECK is pinned explicitly, changing USING alone can no longer
-- silently change the check too — the two clauses become independently
-- visible and independently changeable, which is a small but real
-- maintainability/robustness win.
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
--   -- Before this migration: with_check is already effectively
--   -- `(user_id = auth.uid())` at enforcement time (implicit reuse of
--   -- USING), but the catalog reports it as null/absent since no WITH
--   -- CHECK was ever set explicitly.
--   -- Expected after this migration: both rows now show an explicit,
--   -- non-null with_check expression of `(user_id = auth.uid())` in
--   -- pg_policy itself.

ALTER POLICY "Users can manage own design profiles" ON design_profiles
  WITH CHECK (user_id = auth.uid());

ALTER POLICY "Users can manage own saved items" ON saved_items
  WITH CHECK (user_id = auth.uid());
