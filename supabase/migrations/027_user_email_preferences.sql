-- ============================================================
-- 027 — Per-user email preferences (CAN-SPAM opt-out)
-- ============================================================
--
-- The lifecycle emails (activation, win-back) are MARKETING messages, and every
-- one already footer-links to /account as "Manage email preferences" — but until
-- now there was no backing store or UI, so the opt-out promise was hollow.
-- CAN-SPAM requires a working opt-out before marketing email goes live. This
-- table holds the per-user preference; the send paths check it and skip
-- suppressed users. Transactional mail (waitlist confirm, password reset, the
-- purchase receipt) is unaffected — only marketing sends consult this.
--
-- TENANT table: keyed on the user. RLS lets a user read + change ONLY their own
-- row (auth.uid() = user_id). The marketing send paths read it via the
-- service-role admin client, which bypasses RLS.
--
-- Default: marketing_emails = true (subscribed). A missing row therefore means
-- "subscribed", so existing users are opted-in by default and only suppressed
-- once they explicitly toggle off.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS user_email_preferences (
  user_id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  marketing_emails boolean     NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_email_preferences ENABLE ROW LEVEL SECURITY;

-- A user may read their own preference row.
DROP POLICY IF EXISTS "Users can read own email preferences" ON user_email_preferences;
CREATE POLICY "Users can read own email preferences"
  ON user_email_preferences FOR SELECT
  USING (auth.uid() = user_id);

-- A user may create their own preference row (WITH CHECK pins it to themselves).
DROP POLICY IF EXISTS "Users can insert own email preferences" ON user_email_preferences;
CREATE POLICY "Users can insert own email preferences"
  ON user_email_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- A user may update their own preference row.
DROP POLICY IF EXISTS "Users can update own email preferences" ON user_email_preferences;
CREATE POLICY "Users can update own email preferences"
  ON user_email_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
