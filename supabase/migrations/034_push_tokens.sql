-- Store mobile Expo push tokens so a future sender can reach a device.
--
-- BACKGROUND
--
-- mobile/src/hooks/use-push-notifications.ts already registers for push
-- notifications and obtains an Expo push token, but until now nothing
-- persisted it server-side — there was no receiver endpoint and no table.
-- (See APT-67.) This migration adds the table only; a server route
-- (app/api/mobile/push-tokens/route.ts) upserts into it. Sending push
-- notifications is explicitly out of scope here — this is collection +
-- storage only.
--
-- push_tokens is a TENANT table (has user_id), so per CLAUDE.md's RLS bar it
-- gets RLS enabled with a USING + WITH CHECK policy keyed on auth.uid(),
-- matching the design_profiles / saved_items pattern (001_initial_schema.sql,
-- with the explicit WITH CHECK convention established in
-- 033_design_profiles_saved_items_with_check.sql).
--
-- `(user_id, token)` is UNIQUE as a PAIR, not `token` alone — deliberately.
-- Expo push tokens are tied to the device+app install, not the account, so a
-- shared/family device is a real path: user A registers a token, logs out,
-- user B logs in on the SAME device and registers the SAME token. A
-- table-wide `unique(token)` plus the RLS policy above would make that
-- upsert conflict on A's existing row while B's session can't see or update
-- it (USING fails: that row's user_id is A, not auth.uid()) — the write
-- fails, and since the mobile caller treats registration as best-effort
-- (swallows the error), it fails SILENTLY and PERMANENTLY for B with no
-- retry path. Keying the uniqueness on the pair instead makes a reinstall or
-- a second device for the SAME user an idempotent no-op (the intended
-- behavior), while two different users on one physical device get two
-- independent rows instead of a cross-tenant write conflict.
--
-- HOW TO APPLY:
--   psql $DATABASE_URL -f supabase/migrations/034_push_tokens.sql
--
-- HOW TO VERIFY:
--   select relrowsecurity from pg_class where relname = 'push_tokens';
--   -- expect: t
--   select polname, pg_get_expr(polqual, polrelid) as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as with_check
--   from pg_policy where polrelid = 'push_tokens'::regclass;
--   -- expect one row, both expressions "(user_id = auth.uid())"

create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  token text not null,
  platform text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_id_idx on push_tokens(user_id);

alter table push_tokens enable row level security;

drop policy if exists "Users can manage own push tokens" on push_tokens;
create policy "Users can manage own push tokens" on push_tokens
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
