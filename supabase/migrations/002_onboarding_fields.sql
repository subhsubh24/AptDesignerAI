-- Add onboarding fields to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bedrooms integer DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bathrooms integer DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS neighborhood text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS building_name text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS building_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS building_research jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS apartment_analysis jsonb;

-- Allow more room types for multi-bedroom apartments
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_room_type_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_room_type_check
  CHECK (room_type IN (
    'living_room', 'dining_area', 'kitchen',
    'bedroom', 'bedroom_2', 'bedroom_3',
    'bathroom', 'bathroom_2', 'bathroom_3',
    'main_room'
  ));
