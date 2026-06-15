-- Persist the search loop's "working memory" so re-runs and refine-chat
-- iterations don't cold-start. Previously every run rebuilt tried-queries and
-- the audit-alignment trend from scratch, so the loop could re-issue queries it
-- already tried last time and never saw whether alignment was trending up or
-- down across runs. Seeding the next run from the most recent completed session
-- is what makes the loop-engineering tactics compound across turns.

-- All queries the loop tried last run, keyed by category. Seeds the new run's
-- dedup set so already-attempted queries are skipped.
alter table search_sessions
  add column if not exists tried_queries_json jsonb;

-- Alignment/coverage/diagnosis-solving trend across audits. Seeds the new run's
-- trend detection so the coordinator can reason about cross-run progress.
alter table search_sessions
  add column if not exists audit_history_json jsonb;
