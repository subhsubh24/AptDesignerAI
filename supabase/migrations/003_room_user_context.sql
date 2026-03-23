-- Add user_context column to rooms for user notes about photos
-- e.g. "ignore the yoga pad, it won't be there" or "assume clutter is cleaned up"
alter table rooms add column if not exists user_context text;
