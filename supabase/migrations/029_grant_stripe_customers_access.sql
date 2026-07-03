-- Migration 029: explicit table GRANTs for stripe_customers
--
-- Why: the runtime functional JOURNEY suite (paywall→entitlement-unlock) is the
-- first thing to actually query stripe_customers against a real database, and it
-- surfaced `permission denied for table stripe_customers` for BOTH the seed
-- helper AND the app's own getWebBillingStatus/hasProEntitlementWeb (the
-- service-role admin client). Migration 018 created the table + RLS but never
-- GRANTed table-level privileges, relying on Supabase's default-privilege
-- auto-grants — which are NOT reliably applied to migration-created tables under
-- `supabase db reset` (the CI journeys backend), so the entitlement read fails
-- closed-open and the paywall gate can't be verified.
--
-- Make the grants EXPLICIT (portable + not dependent on default-privilege
-- timing). RLS still does the row-level gating — these are only the table-level
-- prerequisite for the policy to function:
--   * service_role : full DML. Used by the Stripe webhook handler + the
--                     entitlement reads (getAdminClient). Bypasses RLS, but a
--                     table GRANT is still required to touch the table at all.
--   * authenticated : SELECT only. The existing migration-018 policy
--                     "Users can read their own billing record"
--                     (USING auth.uid() = user_id) restricts this to the caller's
--                     own row; the table GRANT is the prerequisite for that
--                     policy to be reachable.
-- anon is intentionally NOT granted (no anon policy exists; it stays denied).
--
-- Idempotent-safe: on hosted Supabase where default privileges already cover
-- these roles, re-granting is a harmless no-op.
--
-- Apply via: supabase db push  (or paste into the Supabase SQL editor)

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_customers TO service_role;
GRANT SELECT ON TABLE public.stripe_customers TO authenticated;

-- Verify:
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'stripe_customers' ORDER BY grantee, privilege_type;
--   -- expect: authenticated=SELECT; service_role=SELECT,INSERT,UPDATE,DELETE; no anon.
