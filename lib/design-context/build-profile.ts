import type { DynamicDesignProfile } from "./user-profile";

/**
 * Build a DynamicDesignProfile from a project record.
 * This ensures the system prompt is personalized with building research,
 * apartment analysis, and location data when available.
 */
export function buildDesignProfile(
  project?: Record<string, unknown> | null,
): DynamicDesignProfile | undefined {
  if (!project) return undefined;

  const profile: DynamicDesignProfile = {};

  // Location
  if (project.city || project.neighborhood || project.building_name) {
    profile.location = {
      city: project.city as string | undefined,
      state: project.state as string | undefined,
      neighborhood: project.neighborhood as string | undefined,
      building: project.building_name as string | undefined,
    };
  }

  // Building research
  if (project.building_research) {
    const br = project.building_research as Record<string, unknown>;
    profile.buildingResearch = {
      building_style: br.building_style as string | undefined,
      finishes: br.finishes as Record<string, string> | undefined,
      features: br.features as string[] | undefined,
      windows: br.windows as string | undefined,
      ceiling_height: br.ceiling_height as string | undefined,
      layout_style: br.layout_style as string | undefined,
      design_aesthetic: br.design_aesthetic as string | undefined,
      summary: br.summary as string | undefined,
      floor_plan: br.floor_plan as Record<string, unknown> | undefined,
    };
  }

  // Apartment analysis
  if (project.apartment_analysis) {
    const aa = project.apartment_analysis as Record<string, unknown>;
    profile.apartmentAnalysis = {
      overall: aa.overall as string | undefined,
      rooms: aa.rooms as Record<string, unknown> | undefined,
    };
  }

  // Layout
  if (project.bedrooms != null) profile.bedrooms = project.bedrooms as number;
  if (project.bathrooms != null) profile.bathrooms = project.bathrooms as number;

  // Return undefined if nothing was populated
  const hasData = profile.location || profile.buildingResearch || profile.apartmentAnalysis || profile.bedrooms;
  return hasData ? profile : undefined;
}
