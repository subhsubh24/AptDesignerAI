-- Waitlist email capture for iOS/Android launch.
-- Accessed ONLY via the service-role admin client (getAdminClient),
-- which bypasses RLS. Enabling RLS with no policy denies anon/auth
-- access entirely — intentional (no user should be able to read the list).
CREATE TABLE IF NOT EXISTS waitlist_emails (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  source      text        NOT NULL DEFAULT 'waitlist',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_emails_email_unique UNIQUE (email)
);

ALTER TABLE waitlist_emails ENABLE ROW LEVEL SECURITY;
-- No policy: anon and authenticated roles cannot read or write.
-- Service role (admin client) bypasses RLS and handles all inserts.
