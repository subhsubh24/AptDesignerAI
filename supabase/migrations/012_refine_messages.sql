-- Refine messages: chat-style conversation history for iterative analysis refinement
-- Each user message + assistant response is one row pair. Patches are stored as
-- structured JSON so the UI can replay history and the LLM can reference prior
-- decisions without re-tokenizing the full analysis.
create table if not exists refine_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Patch applied by this assistant message (null for user messages)
  patch_json jsonb,
  -- Designer-style warnings for this patch (null for user messages, [] when none)
  warnings_json jsonb,
  -- Snapshot of the analysis after this patch was applied (null for user messages)
  analysis_snapshot jsonb,
  tokens_used integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_refine_messages_room
  on refine_messages (room_id, created_at asc);

create index if not exists idx_refine_messages_user
  on refine_messages (user_id, created_at desc);

alter table refine_messages enable row level security;

create policy "Users can view own refine messages"
  on refine_messages for select
  using (auth.uid() = user_id);

create policy "Users can insert own refine messages"
  on refine_messages for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own refine messages"
  on refine_messages for delete
  using (auth.uid() = user_id);
