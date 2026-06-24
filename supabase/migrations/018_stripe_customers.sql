-- Migration 018: stripe_customers table for web billing
-- Stores the mapping between Supabase auth users and Stripe customers/subscriptions.
-- Written by Stripe webhook handler; read by hasProEntitlementWeb() on every web save.
-- Apply via: supabase db push
-- See PENDING_OPS.md for required Stripe secrets and webhook registration.

CREATE TABLE stripe_customers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text NOT NULL UNIQUE,
  stripe_subscription_id text,              -- null for one-time Apartment purchases
  tier                   text NOT NULL CHECK (tier IN ('apartment', 'pro')),
  status                 text NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid')),
  current_period_end     timestamptz,       -- null for one-time purchases (no expiry)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Index for fast webhook upserts (by stripe_customer_id) and for entitlement checks (by user_id).
CREATE INDEX stripe_customers_stripe_customer_id_idx ON stripe_customers (stripe_customer_id);

-- RLS: users can only read their own row; all writes go through the service-role webhook handler.
ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own billing record"
  ON stripe_customers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for authenticated users — writes are service-role only (webhook).
-- Service-role bypasses RLS, so no additional policy is needed for the webhook handler.

-- Verify:
-- \d stripe_customers
-- SELECT count(*) FROM pg_policies WHERE tablename = 'stripe_customers'; -- should be 1
