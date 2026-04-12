-- User's apartment sqft (for matching against building floor-plan variants)
-- and the identified unit plan name (denormalized from building_research.floor_plan.matched_unit
-- for fast access across agents that don't need the full research blob).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS apartment_sqft integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS unit_plan_name text;
