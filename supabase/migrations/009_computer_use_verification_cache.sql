-- ============================================================
-- computer_use_verified_products — cache table for CU product verification
-- ============================================================
--
-- Stores the result of a Computer Use agent visit to a retailer URL so
-- that the same URL is never re-verified within the TTL window. The
-- verifier checks this table first; a cache HIT returns the stored data
-- immediately (no Browserbase session). A cache MISS runs the agent and
-- writes the result here.
--
-- TTL is enforced at query time (WHERE verified_at > now() - interval '24h').
-- There is no background purge — stale rows are simply never returned and
-- are cheap to keep. A periodic cron (optional) can DELETE WHERE verified_at
-- < now() - interval '7 days' if the table grows large.
--
-- `product_url` is the canonical key. We strip query-string params that are
-- tracking-only (utm_*, gclid, etc.) before writing so minor URL variants
-- hit the same cache row.

create table if not exists computer_use_verified_products (
  id                    uuid primary key default gen_random_uuid(),
  product_url           text not null,
  -- Normalised URL (query params stripped) used as the cache key
  product_url_key       text not null,

  -- Core verified fields (mirrors VerifiedProduct interface)
  title                 text,
  price                 numeric,
  currency              text,
  in_stock              boolean,
  dimensions            jsonb,     -- { width_in, depth_in, height_in }
  materials             text[],
  available_colors      text[],
  available_sizes       text[],
  shipping_estimate     text,
  return_policy_summary text,
  caveats               text[],

  -- Agent run metadata
  agent_status          text not null,   -- completed | max_turns | safety_blocked | ...
  turns_used            integer not null default 0,
  agent_notes           text,
  agent_steps           jsonb,           -- full step log for debugging

  -- Provenance
  verified_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

-- Primary lookup: canonical URL key → latest verified row
create index if not exists idx_cu_verified_products_url_key
  on computer_use_verified_products (product_url_key, verified_at desc);

-- ============================================================
-- computer_use_agent_logs — step-level trace for every agent run
-- ============================================================
--
-- Every turn of the Computer Use agent loop is appended here. Used for:
--   - Debugging why the agent got stuck or took wrong actions
--   - Prompt improvement by reviewing which actions led to bad outcomes
--   - Cost tracking (turns_used × model cost)
--
-- `context_type` + `context_id` link the run to what triggered it:
--   context_type = 'product_search'  → context_id = search_session_id
--   context_type = 'product_verify'  → context_id = candidate_product.id
--   context_type = 'manual'          → context_id = null (dashboard call)

create table if not exists computer_use_agent_logs (
  id            uuid primary key default gen_random_uuid(),
  context_type  text not null,
  context_id    uuid,
  product_url   text,
  agent_status  text not null,
  total_turns   integer not null default 0,
  steps         jsonb not null default '[]'::jsonb,  -- AgentStepLog[]
  error_message text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists idx_cu_agent_logs_context
  on computer_use_agent_logs (context_type, context_id, started_at desc);
