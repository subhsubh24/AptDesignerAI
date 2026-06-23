-- ============================================================
-- 015 — Close "RLS Disabled in Public" on the Computer-Use tables
-- ============================================================
--
-- Supabase exposes the entire `public` schema through its PostgREST API to
-- the `anon` and `authenticated` roles. Two tables shipped in migration 009
-- without row-level security, so the Security Advisor flags them as errors
-- ("RLS Disabled in Public") and — more importantly — anyone holding the
-- public anon key can read them straight through the REST API:
--
--   * computer_use_verified_products — URL-keyed verification cache
--   * computer_use_agent_logs        — step-level agent trace logs
--
-- Both are SHARED, NON-TENANT tables (no user_id column) and are written and
-- read ONLY by the service-role admin client (getAdminClient(), see
-- lib/agents/computer-use/verify-search-candidates.ts). The service role
-- BYPASSES RLS, so the correct, minimal fix is to ENABLE RLS with NO policy:
-- that denies the anon/authenticated API roles entirely (closing the hole and
-- the advisor finding) while leaving the app — which only touches these via
-- the service role — completely unaffected.
--
-- Do NOT add a permissive policy here: nothing legitimately reads these tables
-- via the anon key, so granting one would re-open the exposure. Do NOT use
-- FORCE ROW LEVEL SECURITY either — that would also subject the table owner and
-- break owner-run migrations/admin provisioning.
--
-- Idempotent: safe to re-run. Skips a table that does not exist yet.

do $$
declare
  t text;
  cu_tables text[] := array[
    'computer_use_verified_products',
    'computer_use_agent_logs'
  ];
begin
  foreach t in array cu_tables loop
    if to_regclass(format('public.%I', t)) is null then
      continue;  -- table absent in this environment; nothing to secure
    end if;
    execute format('alter table public.%I enable row level security', t);
    -- Intentionally NO policy: service_role bypasses RLS; anon/authenticated
    -- get no policy and are therefore denied. This is the security boundary.
  end loop;
end $$;
