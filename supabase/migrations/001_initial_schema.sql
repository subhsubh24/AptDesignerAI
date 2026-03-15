-- AptDesignerAI Initial Schema

-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================
-- DESIGN PROFILES
-- ============================================
create table design_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  profile_data jsonb not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- PROJECTS
-- ============================================
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  description text,
  status text default 'active' check (status in ('active', 'archived', 'completed')),
  cover_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- ROOMS
-- ============================================
create table rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  room_type text not null check (room_type in ('living_room', 'dining_area', 'kitchen', 'bedroom', 'bathroom')),
  budget_mode text default 'balanced' check (budget_mode in ('budget', 'balanced', 'best_possible')),
  sourcing_mode text default 'manual' check (sourcing_mode in ('manual', 'agentic', 'hybrid')),
  priorities jsonb default '[]',
  keep_items jsonb default '[]',
  replace_items jsonb default '[]',
  status text default 'setup' check (status in ('setup', 'diagnosed', 'sourcing', 'bundled', 'completed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- ROOM IMAGES
-- ============================================
create table room_images (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  image_url text not null,
  image_type text default 'room' check (image_type in ('room', 'apartment_context', 'detail')),
  storage_path text,
  caption text,
  created_at timestamptz default now()
);

-- ============================================
-- ROOM DIAGNOSES
-- ============================================
create table room_diagnoses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  diagnosis_json jsonb not null,
  design_direction_json jsonb,
  missing_categories jsonb,
  action_list jsonb,
  model_used text,
  created_at timestamptz default now()
);

-- ============================================
-- SEARCH SESSIONS (created before candidate_products for FK)
-- ============================================
create table search_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  mode text not null check (mode in ('manual', 'agentic', 'hybrid')),
  status text default 'active' check (status in ('active', 'paused', 'completed', 'cancelled')),
  search_brief_json jsonb,
  categories_to_search jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- CANDIDATE PRODUCTS
-- ============================================
create table candidate_products (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  search_session_id uuid references search_sessions(id) on delete set null,
  title text,
  category text,
  retailer text,
  product_url text,
  image_url text,
  local_image_path text,
  price numeric,
  dimensions jsonb,
  materials text[],
  colors text[],
  description text,
  source_type text check (source_type in ('manual_url', 'manual_upload', 'agentic_search', 'screenshot')),
  metadata jsonb,
  status text default 'pending' check (status in ('pending', 'evaluated', 'shortlisted', 'rejected', 'accepted')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- PRODUCT EVALUATIONS
-- ============================================
create table product_evaluations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references candidate_products(id) on delete cascade not null,
  room_id uuid references rooms(id) on delete cascade not null,
  style_fit_score numeric(3,1) check (style_fit_score between 0 and 10),
  palette_fit_score numeric(3,1) check (palette_fit_score between 0 and 10),
  material_fit_score numeric(3,1) check (material_fit_score between 0 and 10),
  scale_fit_score numeric(3,1) check (scale_fit_score between 0 and 10),
  function_fit_score numeric(3,1) check (function_fit_score between 0 and 10),
  cohesion_fit_score numeric(3,1) check (cohesion_fit_score between 0 and 10),
  value_fit_score numeric(3,1) check (value_fit_score between 0 and 10),
  confidence_score numeric(3,1) check (confidence_score between 0 and 10),
  final_item_score numeric(4,2),
  verdict text check (verdict in ('strong_yes', 'yes', 'maybe', 'no')),
  reasoning jsonb,
  model_used text,
  created_at timestamptz default now()
);

-- ============================================
-- PRODUCT BUNDLES
-- ============================================
create table product_bundles (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  name text,
  description text,
  status text default 'draft' check (status in ('draft', 'evaluated', 'accepted', 'rejected')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- PRODUCT BUNDLE ITEMS
-- ============================================
create table product_bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references product_bundles(id) on delete cascade not null,
  product_id uuid references candidate_products(id) on delete cascade not null,
  category text,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- ============================================
-- BUNDLE EVALUATIONS
-- ============================================
create table bundle_evaluations (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references product_bundles(id) on delete cascade not null,
  palette_harmony_score numeric(3,1),
  material_balance_score numeric(3,1),
  scale_balance_score numeric(3,1),
  style_consistency_score numeric(3,1),
  room_completion_score numeric(3,1),
  practicality_score numeric(3,1),
  final_bundle_score numeric(4,2),
  verdict text,
  analysis jsonb,
  model_used text,
  created_at timestamptz default now()
);

-- ============================================
-- MOCKUP JOBS
-- ============================================
create table mockup_jobs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  bundle_id uuid references product_bundles(id) on delete set null,
  prompt text,
  selected_products jsonb,
  generation_provider text,
  generation_metadata jsonb,
  result_image_url text,
  storage_path text,
  status text default 'pending' check (status in ('pending', 'generating', 'completed', 'failed')),
  error_message text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- ============================================
-- SAVED ITEMS
-- ============================================
create table saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  product_id uuid references candidate_products(id) on delete cascade not null,
  room_id uuid references rooms(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

-- ============================================
-- AGENT RUNS
-- ============================================
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  search_session_id uuid references search_sessions(id) on delete set null,
  agent_type text not null,
  status text default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  input_json jsonb,
  output_json jsonb,
  error_message text,
  tokens_used integer,
  cost_estimate numeric,
  started_at timestamptz default now(),
  finished_at timestamptz
);

-- ============================================
-- AGENT STEPS
-- ============================================
create table agent_steps (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid references agent_runs(id) on delete cascade not null,
  step_number integer not null,
  step_type text not null,
  step_status text default 'running',
  step_input_json jsonb,
  step_output_json jsonb,
  started_at timestamptz default now(),
  finished_at timestamptz
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_projects_user on projects(user_id);
create index idx_rooms_project on rooms(project_id);
create index idx_room_images_room on room_images(room_id);
create index idx_diagnoses_room on room_diagnoses(room_id);
create index idx_products_room on candidate_products(room_id);
create index idx_products_status on candidate_products(status);
create index idx_products_category on candidate_products(category);
create index idx_evaluations_product on product_evaluations(product_id);
create index idx_bundle_items_bundle on product_bundle_items(bundle_id);
create index idx_bundle_evals_bundle on bundle_evaluations(bundle_id);
create index idx_mockups_room on mockup_jobs(room_id);
create index idx_saved_items_user on saved_items(user_id);
create index idx_agent_runs_room on agent_runs(room_id);
create index idx_agent_steps_run on agent_steps(agent_run_id);
create index idx_search_sessions_room on search_sessions(room_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table profiles enable row level security;
alter table design_profiles enable row level security;
alter table projects enable row level security;
alter table rooms enable row level security;
alter table room_images enable row level security;
alter table room_diagnoses enable row level security;
alter table candidate_products enable row level security;
alter table product_evaluations enable row level security;
alter table search_sessions enable row level security;
alter table product_bundles enable row level security;
alter table product_bundle_items enable row level security;
alter table bundle_evaluations enable row level security;
alter table mockup_jobs enable row level security;
alter table saved_items enable row level security;
alter table agent_runs enable row level security;
alter table agent_steps enable row level security;

-- Profiles
create policy "Users can view own profile" on profiles for select using (id = auth.uid());
create policy "Users can update own profile" on profiles for update using (id = auth.uid());

-- Design Profiles
create policy "Users can view own design profiles" on design_profiles for select using (user_id = auth.uid());
create policy "Users can manage own design profiles" on design_profiles for all using (user_id = auth.uid());

-- Projects
create policy "Users can view own projects" on projects for select using (user_id = auth.uid());
create policy "Users can create projects" on projects for insert with check (user_id = auth.uid());
create policy "Users can update own projects" on projects for update using (user_id = auth.uid());
create policy "Users can delete own projects" on projects for delete using (user_id = auth.uid());

-- Rooms (via project)
create policy "Users can view own rooms" on rooms for select
  using (project_id in (select id from projects where user_id = auth.uid()));
create policy "Users can create rooms" on rooms for insert
  with check (project_id in (select id from projects where user_id = auth.uid()));
create policy "Users can update own rooms" on rooms for update
  using (project_id in (select id from projects where user_id = auth.uid()));
create policy "Users can delete own rooms" on rooms for delete
  using (project_id in (select id from projects where user_id = auth.uid()));

-- Room Images (via room -> project)
create policy "Users can view own room images" on room_images for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own room images" on room_images for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Room Diagnoses
create policy "Users can view own diagnoses" on room_diagnoses for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own diagnoses" on room_diagnoses for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Search Sessions
create policy "Users can view own search sessions" on search_sessions for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own search sessions" on search_sessions for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Candidate Products
create policy "Users can view own products" on candidate_products for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own products" on candidate_products for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Product Evaluations
create policy "Users can view own evaluations" on product_evaluations for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own evaluations" on product_evaluations for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Product Bundles
create policy "Users can view own bundles" on product_bundles for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own bundles" on product_bundles for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Bundle Items
create policy "Users can view own bundle items" on product_bundle_items for select
  using (bundle_id in (select pb.id from product_bundles pb join rooms r on pb.room_id = r.id join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own bundle items" on product_bundle_items for all
  using (bundle_id in (select pb.id from product_bundles pb join rooms r on pb.room_id = r.id join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Bundle Evaluations
create policy "Users can view own bundle evals" on bundle_evaluations for select
  using (bundle_id in (select pb.id from product_bundles pb join rooms r on pb.room_id = r.id join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own bundle evals" on bundle_evaluations for all
  using (bundle_id in (select pb.id from product_bundles pb join rooms r on pb.room_id = r.id join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Mockup Jobs
create policy "Users can view own mockups" on mockup_jobs for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own mockups" on mockup_jobs for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Saved Items
create policy "Users can view own saved items" on saved_items for select using (user_id = auth.uid());
create policy "Users can manage own saved items" on saved_items for all using (user_id = auth.uid());

-- Agent Runs
create policy "Users can view own agent runs" on agent_runs for select
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own agent runs" on agent_runs for all
  using (room_id in (select r.id from rooms r join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- Agent Steps
create policy "Users can view own agent steps" on agent_steps for select
  using (agent_run_id in (select ar.id from agent_runs ar join rooms r on ar.room_id = r.id join projects p on r.project_id = p.id where p.user_id = auth.uid()));
create policy "Users can manage own agent steps" on agent_steps for all
  using (agent_run_id in (select ar.id from agent_runs ar join rooms r on ar.room_id = r.id join projects p on r.project_id = p.id where p.user_id = auth.uid()));

-- ============================================
-- STORAGE BUCKETS
-- ============================================
insert into storage.buckets (id, name, public) values ('room-images', 'room-images', true);
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true);
insert into storage.buckets (id, name, public) values ('mockups', 'mockups', true);

-- Storage policies
create policy "Authenticated users can upload room images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'room-images');

create policy "Anyone can view room images"
  on storage.objects for select
  using (bucket_id = 'room-images');

create policy "Authenticated users can upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

create policy "Anyone can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "Authenticated users can upload mockups"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'mockups');

create policy "Anyone can view mockups"
  on storage.objects for select
  using (bucket_id = 'mockups');
