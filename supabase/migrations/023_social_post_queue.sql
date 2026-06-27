-- ============================================================
-- 023 — Social publishing queue (E7.3)
-- ============================================================
--
-- The growth engine stages social creative in docs/ (social-drafts.md,
-- content-calendar.md). This table is the server-side PUBLISHING QUEUE that
-- turns that creative into demand-gen once the owner connects channel
-- credentials: the daily Growth Agent writes drafts INTO the queue (via the
-- internal API), and the deployed app — which holds the secrets — flushes due
-- posts through the per-platform providers. Until a channel's credentials are
-- present the provider runs in dry-run, so nothing is published.
--
-- social_post_queue is a SHARED, NON-TENANT table read/written ONLY by the
-- service-role admin client (lib/social/queue.ts). It has no user_id; following
-- the established pattern (migrations 016, 017) we ENABLE RLS with NO policy:
-- the service role bypasses RLS, while anon/authenticated get no policy and are
-- therefore denied through PostgREST. Do NOT add a permissive policy (it would
-- expose unpublished marketing copy) and do NOT use FORCE ROW LEVEL SECURITY.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS social_post_queue (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Target channel. CHECK keeps it aligned with lib/social SOCIAL_PLATFORMS.
  platform      text        NOT NULL CHECK (platform IN ('x', 'instagram', 'tiktok', 'reddit')),
  -- The post text. Length is also validated in lib/social before enqueue.
  body          text        NOT NULL,
  -- Optional media/link references (URLs), as a JSON array. Empty by default.
  media_urls    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Optional earliest send time. NULL = send on the next flush.
  scheduled_for timestamptz,
  -- Lifecycle: pending -> publishing -> published | failed | skipped.
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped')),
  -- True when the post was handled by the dry-run provider (no real send).
  dry_run       boolean     NOT NULL DEFAULT false,
  -- Provider message id once published (when the provider returns one).
  provider_post_id text,
  -- Short error summary on failure (never the raw provider payload).
  error         text,
  -- Idempotency key so the same draft isn't enqueued twice by the agent.
  dedupe_key    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);

-- Flush query reads pending rows whose schedule is due, oldest first.
CREATE INDEX IF NOT EXISTS social_post_queue_due_idx
  ON social_post_queue (status, scheduled_for, created_at);

-- Idempotency: at most one row per dedupe_key (when supplied).
CREATE UNIQUE INDEX IF NOT EXISTS social_post_queue_dedupe_key_idx
  ON social_post_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE social_post_queue ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policy: service_role bypasses RLS; anon/authenticated denied.
