-- ============================================================
-- 022 — Double opt-in for the waitlist (E7.1)
-- ============================================================
--
-- GROWTH_STATUS.md advertises `double_opt_in: true`, but until now the waitlist
-- captured an address and immediately treated it as subscribed. Real double
-- opt-in requires the subscriber to click a confirmation link before we count
-- them as a confirmed lead (and before any launch email may be sent to them).
-- This is both a deliverability best practice (confirmed lists have far lower
-- spam/bounce rates) and an anti-abuse measure (a bot can't sign up a third
-- party's address and have us mail them).
--
-- waitlist_emails is a SHARED, NON-TENANT table read/written ONLY by the
-- service-role admin client (see app/api/waitlist/*). RLS is already enabled
-- with no policy (migration 017) — that boundary is unchanged here.
--
-- Columns added:
--   confirmation_token — unguessable token mailed in the confirm link; cleared
--                        once confirmed so a used link can't be replayed.
--   confirmed_at       — set when the subscriber clicks the link. NULL = pending.
--   token_sent_at      — when the confirm email was last (re)sent, so a resend
--                        can be throttled and stale pending rows identified.
--
-- Idempotent: safe to re-run.

ALTER TABLE waitlist_emails
  ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS confirmed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS token_sent_at       timestamptz;

-- A partial unique index makes confirmation_token a safe lookup key (one row per
-- token) while allowing many rows to share the NULL value after confirmation.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_emails_confirmation_token_key
  ON waitlist_emails (confirmation_token)
  WHERE confirmation_token IS NOT NULL;

-- Grandfather existing sign-ups: anyone already captured under the previous
-- "you're on the list" promise stays confirmed (they predate double opt-in and
-- consented under the old flow). New rows default to pending (confirmed_at NULL).
UPDATE waitlist_emails
  SET confirmed_at = created_at
  WHERE confirmed_at IS NULL;
