-- ============================================================
-- 026 — Waitlist referral loop (Track E growth lever)
-- ============================================================
--
-- Turns the waitlist into a self-spreading channel: every subscriber gets a
-- short, unguessable referral code they can share, and people who arrive via
-- `?ref=<code>` are attributed back to the referrer. This is the concrete
-- "invite/reward mechanic" the business case lists as a revenue lever — the
-- organic-share assumption in docs/BUSINESS_CASE.md is only defensible once a
-- real referral path exists in the product.
--
-- waitlist_emails is a SHARED, NON-TENANT table read/written ONLY by the
-- service-role admin client (see app/api/waitlist/*). RLS is already enabled
-- with no policy (migration 017) — that boundary is unchanged here; no anon or
-- authenticated access is granted.
--
-- Columns added:
--   referral_code — this subscriber's own shareable code. Unguessable; unique.
--   referred_by   — the referral_code this subscriber arrived through (the
--                   referrer's code), or NULL for an organic/direct sign-up.
--                   Stored only after verifying the referrer code exists, so it
--                   never holds a bogus value.
--
-- Idempotent: safe to re-run.

ALTER TABLE waitlist_emails
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by   text;

-- A partial unique index makes referral_code a safe lookup + attribution key
-- (one row per code) while allowing many legacy rows to share the NULL value
-- until they are backfilled or re-issued.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_emails_referral_code_key
  ON waitlist_emails (referral_code)
  WHERE referral_code IS NOT NULL;

-- Index the attribution column so "how many sign-ups did code X drive" is a
-- cheap lookup for the Growth Agent's funnel reporting.
CREATE INDEX IF NOT EXISTS waitlist_emails_referred_by_idx
  ON waitlist_emails (referred_by)
  WHERE referred_by IS NOT NULL;
