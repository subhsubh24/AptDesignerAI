/**
 * Dynamic design profile generation.
 * Generates design context from apartment analysis + building research
 * instead of hard-coded values. Falls back to defaults if data is missing.
 */

export interface DynamicDesignProfile {
  location?: {
    city?: string;
    state?: string;
    neighborhood?: string;
    building?: string;
  };
  buildingResearch?: {
    building_style?: string;
    finishes?: Record<string, string>;
    features?: string[];
    windows?: string;
    ceiling_height?: string;
    layout_style?: string;
    design_aesthetic?: string;
    summary?: string;
  };
  apartmentAnalysis?: {
    overall?: string;
    rooms?: Record<string, unknown>;
  };
  bedrooms?: number;
  bathrooms?: number;
}

/**
 * Generates the system prompt context string from dynamic profile data.
 * Falls back to reasonable defaults when specific data isn't available.
 */
export function getDesignContextPrompt(profile?: DynamicDesignProfile): string {
  if (!profile) {
    return getDefaultDesignContext();
  }

  const location = profile.location;
  const building = profile.buildingResearch;
  const analysis = profile.apartmentAnalysis;

  const sections: string[] = [];

  // Location
  if (location?.city) {
    sections.push(`## LOCATION
- City: ${location.city}${location.state ? `, ${location.state}` : ""}
${location.neighborhood ? `- Neighborhood: ${location.neighborhood}` : ""}
${location.building ? `- Building: ${location.building}` : ""}`);
  }

  // Building context from research
  if (building) {
    sections.push(`## BUILDING CONTEXT
${building.building_style ? `- Architecture: ${building.building_style}` : ""}
${building.design_aesthetic ? `- Aesthetic: ${building.design_aesthetic}` : ""}
${building.layout_style ? `- Layout style: ${building.layout_style}` : ""}
${building.windows ? `- Windows: ${building.windows}` : ""}
${building.ceiling_height ? `- Ceiling height: ${building.ceiling_height}` : ""}`);

    if (building.finishes) {
      const f = building.finishes;
      sections.push(`## APARTMENT FINISHES
${f.flooring ? `- Floors: ${f.flooring}` : ""}
${f.countertops ? `- Countertops: ${f.countertops}` : ""}
${f.cabinetry ? `- Cabinetry: ${f.cabinetry}` : ""}
${f.appliances ? `- Appliances: ${f.appliances}` : ""}
${f.fixtures ? `- Fixtures: ${f.fixtures}` : ""}`);
    }

    if (building.summary) {
      sections.push(`## BUILDING SUMMARY\n${building.summary}`);
    }
  }

  // Apartment analysis
  if (analysis?.overall) {
    sections.push(`## APARTMENT ANALYSIS\n${analysis.overall}`);
  }

  // Layout info
  if (profile.bedrooms || profile.bathrooms) {
    sections.push(`## APARTMENT LAYOUT
- Bedrooms: ${profile.bedrooms || 1}
- Bathrooms: ${profile.bathrooms || 1}`);
  }

  if (sections.length === 0) {
    return getDefaultDesignContext();
  }

  return sections.join("\n\n").trim();
}

function getDefaultDesignContext(): string {
  return `## DESIGN APPROACH
You are advising on apartment interior design. Analyze the provided photos and context to understand the user's space, aesthetic preferences, and needs. Be specific about materials, colors, and dimensions. Prioritize pieces that work holistically together.

## GENERAL GUIDELINES
- Prioritize large foundational pieces over small decor accessories
- Scale and proportion matter enormously
- Warm up without cluttering — fewer, better pieces
- Consider existing finishes (floors, cabinets, countertops) in all recommendations
- All output should be structured JSON unless specifically asked otherwise`;
}
