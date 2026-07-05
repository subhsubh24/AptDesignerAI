-- Migration 030: explicit table GRANTs for the core project/room tables
--
-- Why: the runtime functional JOURNEY suite's AI design→render money-path test
-- (e2e/journeys.spec.ts "core money-path: POST /api/mockups renders a REAL …")
-- is the first thing to actually INSERT a project + room against a real database
-- (via the service-role admin client in e2e/helpers/seed.ts seedRoom), and it
-- surfaced `permission denied for table projects`. Migration 001 created these
-- tables + RLS but never GRANTed table-level privileges, relying on Supabase's
-- default-privilege auto-grants — which are NOT reliably applied to
-- migration-created tables under `supabase db reset` (the CI journeys backend).
-- This is the SAME root cause migration 029 fixed for stripe_customers.
--
-- Make the grants EXPLICIT (portable + not dependent on default-privilege
-- timing). RLS still does the row-level gating — every table below keeps its
-- migration-001 "Users can manage own …" (FOR ALL) + "view own" policies
-- unchanged; these are only the table-level prerequisite for those policies to
-- be reachable:
--   * service_role  : full DML. Used by the admin client (test seeding, and any
--                     admin/webhook path). Bypasses RLS, but a table GRANT is
--                     still required to touch the table at all.
--   * authenticated : full DML. The migration-001 FOR ALL policies (USING
--                     auth.uid() = owner via the project chain) restrict every
--                     statement to the caller's OWN rows; the table GRANT is the
--                     prerequisite for those policies to function.
-- anon is intentionally NOT granted (no anon policy exists; it stays denied),
-- matching migration 029.
--
-- Idempotent-safe: on hosted Supabase where default privileges already cover
-- these roles, re-granting is a harmless no-op.
--
-- Apply via: supabase db push  (or paste into the Supabase SQL editor)

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects       TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rooms          TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.room_images    TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.room_diagnoses TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_runs     TO authenticated, service_role;

-- Verify:
-- SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name IN ('projects','rooms','room_images','room_diagnoses','agent_runs')
--   ORDER BY table_name, grantee, privilege_type;
--   -- expect: authenticated + service_role each = SELECT,INSERT,UPDATE,DELETE; no anon.
