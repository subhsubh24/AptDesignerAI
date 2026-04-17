-- Saved designs: users can save design assessments and full product search results
create table if not exists saved_designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  title text not null,
  room_type text,
  stage text not null check (stage in ('assessment', 'full')),
  snapshot jsonb not null default '{}'::jsonb,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saved_designs_user on saved_designs (user_id, created_at desc);

-- RLS policies
alter table saved_designs enable row level security;

create policy "Users can view own saved designs"
  on saved_designs for select
  using (auth.uid() = user_id);

create policy "Users can insert own saved designs"
  on saved_designs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own saved designs"
  on saved_designs for update
  using (auth.uid() = user_id);

create policy "Users can delete own saved designs"
  on saved_designs for delete
  using (auth.uid() = user_id);
