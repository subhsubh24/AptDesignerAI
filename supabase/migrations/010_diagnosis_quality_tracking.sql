-- ============================================================
-- Quality tracking for room_diagnoses + search_sessions
-- ============================================================
--
-- Adds columns that enable:
--   1. DB-backed few-shot example retrieval for the diagnosis Pass 2
--      prompt — pulled by (room_type, design_direction_label) so
--      examples match the current room's context.
--   2. Search session performance tracking — products found, evaluated,
--      and selected give a conversion funnel for prompt A/B testing.
--
-- All new columns are nullable so the migration is fully backward-
-- compatible; existing rows remain valid.

-- ── room_diagnoses additions ──────────────────────────────────────

-- Denormalised room_type from rooms (avoids join on every few-shot
-- query). Populated at insert time by the diagnosis API route.
alter table room_diagnoses
  add column if not exists room_type text;

-- Normalised design direction label (e.g. "Coastal", "Japandi") pulled
-- from design_direction_json.design_direction at insert time. Allows
-- indexed equality filtering without JSONB extraction in the WHERE clause.
alter table room_diagnoses
  add column if not exists design_direction_label text;

-- Integer count of items in action_list — cheap quality proxy. A
-- diagnosis with fewer than 6 items is probably incomplete; ≥ 10 is
-- healthy for most rooms. Computed at insert time.
alter table room_diagnoses
  add column if not exists action_list_count integer;

-- Manual override: set to false to exclude a specific diagnosis from
-- future few-shot retrieval (e.g. if a user complained about it).
-- Defaults to true so all new diagnoses are eligible.
alter table room_diagnoses
  add column if not exists few_shot_eligible boolean not null default true;

-- Primary few-shot lookup index: equality on room_type + direction,
-- ordered by recency so the freshest examples bubble to the top.
create index if not exists idx_rd_few_shot
  on room_diagnoses (room_type, design_direction_label, created_at desc)
  where few_shot_eligible = true and action_list_count >= 8;

-- ── search_sessions additions ─────────────────────────────────────

-- Products discovered by the search funnel.
alter table search_sessions
  add column if not exists products_found_count integer;

-- Products that received an evaluation score.
alter table search_sessions
  add column if not exists products_evaluated_count integer;

-- Timestamp when the session reached "completed" status.
alter table search_sessions
  add column if not exists completed_at timestamptz;

-- JSON blob for arbitrary telemetry (token usage, trace summary, etc.)
-- Replaces the inline metadata previously stored only in agent_runs.
alter table search_sessions
  add column if not exists stats_json jsonb;
