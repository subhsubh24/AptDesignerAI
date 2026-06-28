-- ============================================================
-- 025 — User lifecycle email send log
-- ============================================================
--
-- Tracks which lifecycle email stages have been sent to which users so the
-- activation email cron (app/api/cron/activation-emails) can fire each stage
-- at most once per user, even across multiple cron invocations.
--
-- Also used by any future lifecycle send that needs idempotency beyond what
-- the Stripe webhook (winback/paid_welcome) already provides via stripe_customers.
--
-- Owned by the Growth Agent infrastructure. Service-role only.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS user_email_stages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- EmailStage value from lib/email/types.ts. Keep in sync (LIVING ARTIFACTS).
  stage      text        NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  -- True when the dry-run provider handled the send (no live provider configured).
  dry_run    boolean     NOT NULL DEFAULT false,
  -- Each stage fires at most once per user.
  UNIQUE (user_id, stage)
);

-- Allow the cron to quickly answer "has this stage been sent to this user?"
CREATE INDEX IF NOT EXISTS user_email_stages_user_stage_idx
  ON user_email_stages (user_id, stage);

ALTER TABLE user_email_stages ENABLE ROW LEVEL SECURITY;
-- No policy: service_role bypasses RLS; anon/authenticated roles denied.
