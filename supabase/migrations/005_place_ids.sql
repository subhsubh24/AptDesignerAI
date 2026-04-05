-- Add Google Maps place IDs and coordinates for location/building
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_place_id text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS building_place_id text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS longitude double precision;
