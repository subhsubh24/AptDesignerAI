-- Backfill WITH CHECK onto UPDATE policies that only had USING.
--
-- THE GAP
--
-- `projects`, `rooms`, and `saved_designs` (001_initial_schema.sql,
-- 011_saved_designs.sql) each define an UPDATE policy with a USING clause
-- only, e.g.:
--
--     create policy "Users can update own projects" on projects for update
--       using (user_id = auth.uid());
--
-- For UPDATE, Postgres RLS evaluates USING against the OLD row (which rows
-- the caller may touch) but — with no WITH CHECK — never validates the NEW
-- row. A caller who already owns a row could issue an UPDATE that rewrites
-- its ownership column (`user_id` on projects/saved_designs, or repointing
-- `rooms.project_id` at a project it doesn't own) and the policy alone would
-- not stop it. A newer table already carries this shape (see
-- 027_user_email_preferences.sql's UPDATE policy, which pairs USING with
-- WITH CHECK) — this migration backfills the same shape onto the three
-- tables from the initial schema that predate the convention.
--
-- App code today never lets a client set these columns directly (whitelisted
-- update fields, no user_id/project_id in any PATCH body), so this is
-- defense-in-depth, not a live exploit — but RLS, not the app layer, is the
-- documented security boundary (see AGENTS.md), so the policy should enforce
-- it on its own.
--
-- THE FIX
--
-- `ALTER POLICY ... WITH CHECK (...)` sets the check clause on the existing
-- policy in place (no DROP/CREATE, so grants and policy identity are
-- untouched). Idempotent: re-running sets the same expression again.
--
-- HOW TO APPLY:
--   psql $DATABASE_URL -f supabase/migrations/032_backfill_update_with_check.sql
--
-- HOW TO VERIFY:
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check
--   from pg_policy
--   where polname in (
--     'Users can update own projects',
--     'Users can update own rooms',
--     'Users can update own saved designs'
--   );
--   -- Expected: all three now have a non-null with_check expression.
--
--   As an authenticated user who owns row X, attempt:
--     UPDATE projects SET user_id = '<some other uuid>' WHERE id = '<X>';
--   -- Expected: ERROR: new row violates row-level security policy for
--   -- table "projects" (a WITH CHECK failure raises a hard error, unlike a
--   -- USING mismatch, which silently matches 0 rows). Previously this
--   -- update would have succeeded.

ALTER POLICY "Users can update own projects" ON projects
  WITH CHECK (user_id = auth.uid());

ALTER POLICY "Users can update own rooms" ON rooms
  WITH CHECK (project_id in (select id from projects where user_id = auth.uid()));

ALTER POLICY "Users can update own saved designs" ON saved_designs
  WITH CHECK (auth.uid() = user_id);
