-- Add pro_annual to the tier CHECK constraint on stripe_customers.
-- Required for the annual billing tier ($399/yr) added in the feat/run29-annual-billing branch.
-- Apply via: supabase db push  (or paste into Supabase SQL editor)

ALTER TABLE stripe_customers
  DROP CONSTRAINT IF EXISTS stripe_customers_tier_check;

ALTER TABLE stripe_customers
  ADD CONSTRAINT stripe_customers_tier_check
    CHECK (tier IN ('apartment', 'pro', 'pro_annual'));
