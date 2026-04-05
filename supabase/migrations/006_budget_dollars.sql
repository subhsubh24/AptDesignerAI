-- Add optional dollar budget to rooms
-- This allows users to set a total budget in dollars (e.g., $3000)
-- in addition to the existing budget_mode (budget/balanced/best_possible).
alter table rooms add column if not exists budget_dollars integer;

-- Add a comment for clarity
comment on column rooms.budget_dollars is 'Optional total budget in dollars for this room. Used for budget tracking and bundle cost totals.';
