import type { ExtractedFloorPlan } from "@/lib/types/database";
import type { PreferenceSignals } from "./infer-preferences";
import { formatPreferencesForPrompt } from "./infer-preferences";

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
    floor_plan?: Record<string, unknown>;
  };
  apartmentAnalysis?: {
    overall?: string;
    rooms?: Record<string, unknown>;
  };
  bedrooms?: number;
  bathrooms?: number;
  /** Client lifestyle context — pets, kids, hosting habits, daily routines */
  lifestyle?: {
    pets?: string;
    kids?: string;
    hosting?: string;
    work_from_home?: boolean;
    notes?: string;
  };
  /** URL of the uploaded floor plan image — passed to vision agents as first block */
  floorPlanImageUrl?: string;
  /** Structured spatial data extracted from the floor plan image */
  extractedFloorPlan?: ExtractedFloorPlan;
  /**
   * Preferences inferred from the user's prior rooms in this apartment.
   * Soft guidance — the LLM weighs it against the current room's specifics.
   * See lib/design-context/infer-preferences.ts.
   */
  inferredPreferences?: PreferenceSignals;
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

    if (building.floor_plan) {
      const fp = building.floor_plan;

      // Prefer the matched_unit when available — it represents the user's
      // *actual* apartment, so downstream agents should focus on that single
      // layout rather than iterating every variant in the building.
      const matched = fp.matched_unit as
        | { variant?: Record<string, unknown> | null; match_method?: string; confidence?: string; match_notes?: string }
        | undefined;
      const matchedVariant = matched?.variant ?? null;

      const fpLines: string[] = [];
      if (fp.unit_type_searched) fpLines.push(`- Unit type: ${fp.unit_type_searched}`);

      if (matchedVariant && matched?.match_method !== "no_match") {
        // Use the matched variant as the authoritative layout
        const v = matchedVariant;
        if (v.name) fpLines.push(`- User's unit plan: "${v.name as string}" (${matched?.confidence ?? "medium"} confidence, matched via ${matched?.match_method ?? "sqft"})`);
        if (v.sqft) fpLines.push(`- Total: ~${v.sqft} sqft`);
        if (v.room_layout) fpLines.push(`- Layout: ${v.room_layout}`);
        if (v.living_dining_combined) fpLines.push(`- Living/dining: combined open space`);
        if (v.kitchen_style) fpLines.push(`- Kitchen: ${v.kitchen_style}`);
        if (v.room_dimensions) {
          const dims = v.room_dimensions as Record<string, string>;
          for (const [room, dim] of Object.entries(dims)) {
            if (dim) fpLines.push(`- ${room}: ~${dim}`);
          }
        }
        if (Array.isArray(v.notable_spatial_features) && (v.notable_spatial_features as string[]).length > 0) {
          fpLines.push(`- Spatial notes: ${(v.notable_spatial_features as string[]).join(", ")}`);
        }
      } else {
        // No confident match — fall back to the building-wide summary
        if (fp.total_sqft) fpLines.push(`- Total: ~${fp.total_sqft} sqft`);
        if (fp.room_layout) fpLines.push(`- Layout: ${fp.room_layout}`);
        if (fp.living_dining_combined) fpLines.push(`- Living/dining: combined open space`);
        if (fp.kitchen_style) fpLines.push(`- Kitchen: ${fp.kitchen_style}`);
        if (fp.room_dimensions) {
          const dims = fp.room_dimensions as Record<string, string>;
          for (const [room, dim] of Object.entries(dims)) {
            if (dim) fpLines.push(`- ${room}: ~${dim}`);
          }
        }
        const variants = fp.unit_variants as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(variants) && variants.length > 0) {
          const names = variants
            .map((v) => {
              const parts: string[] = [];
              if (v.name) parts.push(v.name as string);
              if (v.sqft) parts.push(`${v.sqft} sqft`);
              return parts.join(" — ");
            })
            .filter(Boolean);
          if (names.length > 0) fpLines.push(`- Possible variants (unit not yet matched): ${names.join("; ")}`);
        }
        if (Array.isArray(fp.notable_spatial_features) && fp.notable_spatial_features.length > 0) {
          fpLines.push(`- Spatial notes: ${fp.notable_spatial_features.join(", ")}`);
        }
      }

      if (fpLines.length > 0) {
        sections.push(`## FLOOR PLAN\n${fpLines.join("\n")}`);
      }
    }

    if (building.summary) {
      sections.push(`## BUILDING SUMMARY\n${building.summary}`);
    }
  }

  // Extracted floor plan — shown in system prompt as reference so all agents
  // are aware of the ground-truth spatial data before they see any photos
  if (profile.extractedFloorPlan) {
    const efp = profile.extractedFloorPlan;
    const efpLines: string[] = [];
    if (efp.building_orientation) efpLines.push(`- Orientation: ${efp.building_orientation}`);
    if (efp.total_sqft) efpLines.push(`- Total: ~${efp.total_sqft} sqft`);
    if (efp.scale_note) efpLines.push(`- Scale: ${efp.scale_note}`);
    efpLines.push(`- Confidence: ${efp.confidence}`);
    for (const room of efp.rooms) {
      const parts: string[] = [`- ${room.label} (${room.room_type})`];
      if (room.dimensions_text) parts.push(`~${room.dimensions_text}`);
      else if (room.sqft) parts.push(`~${room.sqft} sqft`);
      const windowWalls = room.walls
        .filter(w => w.features.some(f => f.type === "window"))
        .map(w => w.direction);
      if (windowWalls.length) parts.push(`windows: ${windowWalls.join(", ")} wall`);
      efpLines.push(parts.join(" — "));
    }
    sections.push(`## UPLOADED FLOOR PLAN (authoritative spatial data)\n${efpLines.join("\n")}\nUse these exact dimensions and wall layouts. Do not infer or contradict this data from photos.`);
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

  // Inferred user preferences from prior rooms
  if (profile.inferredPreferences) {
    const prefBlock = formatPreferencesForPrompt(profile.inferredPreferences);
    if (prefBlock) sections.push(prefBlock);
  }

  // Lifestyle context
  if (profile.lifestyle) {
    const ls = profile.lifestyle;
    const lifestyleLines: string[] = [];
    if (ls.pets) lifestyleLines.push(`- Pets: ${ls.pets} — choose durable, easy-to-clean materials. Avoid delicate fabrics like white bouclé or silk.`);
    if (ls.kids) lifestyleLines.push(`- Children: ${ls.kids} — prioritize safety (rounded corners, stable furniture), durability, and stain-resistant materials.`);
    if (ls.hosting) lifestyleLines.push(`- Hosting/entertaining: ${ls.hosting} — ensure sufficient seating capacity, dining space, and drink surfaces.`);
    if (ls.work_from_home) lifestyleLines.push(`- Works from home — consider a dedicated work zone, good task lighting, and ergonomic seating.`);
    if (ls.notes) lifestyleLines.push(`- Additional: ${ls.notes}`);
    if (lifestyleLines.length > 0) {
      sections.push(`## CLIENT LIFESTYLE\n${lifestyleLines.join("\n")}\nIMPORTANT: Every recommendation must be practical for this client's actual daily life. Beauty that isn't livable is bad design.`);
    }
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
