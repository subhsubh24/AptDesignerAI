import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  revisedAnalysis?: Record<string, unknown>;
  /** Per-product harmony scores — returned by validateProductSet */
  product_flags?: Array<{
    title: string;
    category: string;
    harmony_score: number;
    clashes_with: string[];
    reason: string;
  }>;
}

export interface HarmonyValidationResult {
  confidence: number;
  item_scores: Array<{
    category: string;
    harmony_score: number;
    keeps_well_with: string[];
    clashes_with: string[];
    revised_search_title?: string;
    revised_specs?: string;
    revised_placement?: string;
    drop: boolean;
    reason: string;
  }>;
  overall_cohesion: number;
  palette_coherence: string;
  material_coherence: string;
  spatial_flow: string;
  issues: string[];
  revisedAnalysis?: Record<string, unknown>;
}

/**
 * Harmony validation: checks that every recommended item fits with the room's
 * existing items (what_works), the apartment aesthetic, and each other.
 * Sees the actual room photos so it can judge visually, not just from text.
 * Uses Flash with high thinking for deep design reasoning.
 */
export async function validateRoomHarmony(
  analysis: Record<string, unknown>,
  context: {
    roomType: string;
    roomName: string;
    roomImageUrls: string[];
    buildingResearch?: Record<string, unknown>;
    apartmentAnalysis?: Record<string, unknown>;
    designProfile?: DynamicDesignProfile;
    floorPlan?: Record<string, unknown>;
  }
): Promise<AgentResult<HarmonyValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(context.designProfile);

  const whatWorks = (analysis.what_works as string[]) || [];
  const whatShouldGo = (analysis.what_should_go as string[]) || [];
  const whatItNeeds = (analysis.what_it_needs as Array<Record<string, unknown>>) || [];
  const designDirection = (analysis.design_direction as string) || "";
  const spatialLayout = (analysis.spatial_layout as string) || "";

  // Build the content with room images for visual validation
  const content: AIContentBlock[] = [];

  // Send room photos so the model can SEE what's already there
  for (const url of context.roomImageUrls.slice(0, 4)) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  const buildingCtx = context.buildingResearch
    ? `\nBuilding: ${JSON.stringify({
        style: (context.buildingResearch as Record<string, unknown>).building_style,
        finishes: (context.buildingResearch as Record<string, unknown>).finishes,
        aesthetic: (context.buildingResearch as Record<string, unknown>).design_aesthetic,
      })}`
    : "";

  const apartmentCtx = context.apartmentAnalysis
    ? `\nApartment overview: ${(context.apartmentAnalysis as Record<string, unknown>).overall || ""}`
    : "";

  // Floor plan context for spatial validation
  const floorPlanCtx = context.floorPlan
    ? `\n\n## FLOOR PLAN / ROOM DIMENSIONS
Total sqft: ${context.floorPlan.total_sqft || "unknown"}
Room dimensions: ${JSON.stringify(context.floorPlan.room_dimensions || {})}
Room layout: ${context.floorPlan.room_layout || "unknown"}
Living/dining combined: ${context.floorPlan.living_dining_combined ?? "unknown"}
Spatial features: ${Array.isArray(context.floorPlan.notable_spatial_features) ? context.floorPlan.notable_spatial_features.join(", ") : "unknown"}`
    : "";

  content.push({
    type: "text",
    text: `You are a senior interior designer doing a HARMONY + SPATIAL CHECK on recommended items before they go to product search.

## ROOM
${context.roomName} (${context.roomType})${buildingCtx}${apartmentCtx}${floorPlanCtx}

## DESIGN DIRECTION
${designDirection}

## SPATIAL LAYOUT PLAN
${spatialLayout || "Not specified — you should infer from the room photos"}

## ITEMS TO KEEP (already in the room — note their CURRENT POSITIONS)
${whatWorks.length > 0 ? whatWorks.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None specified"}

## ITEMS BEING REMOVED
${whatShouldGo.length > 0 ? whatShouldGo.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None"}

## RECOMMENDED NEW ITEMS (to validate)
${whatItNeeds.map((item, i) => `${i + 1}. [${item.category}] ${item.search_title}
   Specs: ${item.specs}
   Placement: ${item.placement || "not specified"}
   Priority: ${item.priority}
   Why: ${item.description}`).join("\n\n")}

## YOUR JOB
Look at the room photos carefully. Estimate the room's dimensions and layout. Note where existing items sit. Now evaluate EACH recommended item on BOTH harmony AND spatial fit:

### HARMONY CHECKS
1. **Harmony with keeps**: Does this item's material, color, and style work with the existing items staying in the room? A walnut coffee table next to existing oak furniture = clash. A brass lamp with existing chrome fixtures = clash.

2. **Harmony with other recommendations**: Do ALL the new items work together as a set? If you're recommending a warm cream rug AND cool gray throw pillows, that's a palette conflict.

3. **Apartment coherence**: Does this fit the overall apartment aesthetic and building finishes?

4. **Specificity check**: Is the search_title specific enough to find the RIGHT product? Does it include material, color, size, and style?

### SPATIAL CHECKS — CRITICAL
5. **Placement validity**: Does the recommended placement make physical sense? Is there actually wall space, floor space, or clearance for this item where it's supposed to go? Look at the photos — if a floor lamp is supposed to go "next to the sofa" but there's no space between the sofa and the wall, that's a problem.

6. **Scale/proportion**: Based on room photos (and floor plan dimensions if available), will this item be the right size? An 8x10 rug in a 9x10 room leaves no border. A 60-inch console on a 48-inch wall won't fit.

7. **Traffic flow**: Does the placement of all items together create clear walkways? Can people move through the room naturally? Standard clearances: 36" main paths, 18" between coffee table and sofa, 24" behind dining chairs, 30" next to beds.

8. **Spatial relationships**: Do items that belong together actually end up near each other? The floor lamp should be near the reading chair. Side tables should flank the sofa. The rug should anchor the seating area, not float randomly.

9. **Orientation & sightlines**: Are items oriented to create natural conversation areas? Do they face logical focal points (TV, fireplace, window view)? Is there a clear visual anchor point when you enter the room?

10. **Zone definition**: In multi-function rooms, do the items clearly define distinct zones (living vs dining, work vs relaxation) without blocking flow between them?

### ENVIRONMENTAL CHECKS
11. **Lighting adequacy**: Look at the room photos — which direction do windows face? How much natural light is there? Do the recommended items include sufficient lighting for dark areas? If the room is north-facing with limited light, it needs MORE light sources. Are any glossy/reflective items placed where they'd create glare from windows?

12. **Window & door clearance**: From the photos, identify all windows and doors. Do any recommended items block windows (reducing natural light)? Do any obstruct door swings or crowd doorways? A tall bookshelf in front of a window or a console table blocking a closet door = must revise placement or drop.

13. **Acoustic balance**: Look at the room's surfaces — hardwood floors, concrete walls, large windows. Is there enough soft material in the recommendation set (rug, curtains, upholstered furniture, throw pillows) to create acoustic comfort? An open floor plan with all hard surfaces needs textile elements. If the set lacks soft materials, flag it.

14. **Durability & maintenance**: Consider the client's lifestyle (pets, kids, hosting, daily use). Are the recommended materials practical? White boucle with pets, glass with toddlers, delicate silk in high-traffic areas = flag as impractical.

15. **Outlet access for powered items**: If recommending lamps, media consoles, or other powered items — is there likely an outlet near the intended placement? A floor lamp in the center of the room with no nearby wall = impractical placement.

## SCORING (per item)
- **harmony_score** (1-10): Combined harmony + spatial + environmental fit score
  - 9-10: Perfect — harmonizes beautifully, placement/size makes perfect spatial sense, lighting/acoustics/durability all good
  - 7-8: Good — works well aesthetically, placement is reasonable, no major environmental issues
  - 5-6: Acceptable aesthetically but has issues (wrong size, blocks window/door, impractical material, creates acoustic harshness, no outlet access)
  - 3-4: Conflict — clashes with keeps OR serious spatial problem (won't fit, blocks doorway) OR fundamentally impractical (wrong material for lifestyle)
  - 1-2: Wrong — completely out of place aesthetically AND spatially AND environmentally

- **drop**: true if harmony_score ≤ 3

- If score 4-6, provide **revised_search_title**, **revised_specs**, AND **revised_placement** that fix the issues

## OUTPUT FORMAT
Return JSON:
{
  "confidence": 0-10 (overall confidence in this recommendation set),
  "item_scores": [
    {
      "category": "the category slug",
      "harmony_score": number,
      "keeps_well_with": ["which existing items it pairs well with"],
      "clashes_with": ["which existing items or other recommendations it conflicts with — include spatial conflicts like 'blocks path to dining area', environmental issues like 'blocks south window', 'no outlet nearby for floor lamp', 'adds more hard surface to acoustically harsh room'"],
      "revised_search_title": "only if score 4-6, a better search title",
      "revised_specs": "only if score 4-6, revised specs (may include different dimensions)",
      "revised_placement": "only if score 4-6, a better placement that works spatially",
      "drop": true/false,
      "reason": "1-2 sentence explanation covering BOTH aesthetic and spatial reasoning"
    }
  ],
  "overall_cohesion": 0-10 (do ALL items work together as a complete room?),
  "palette_coherence": "1 sentence: does the color palette across all items + keeps make sense?",
  "material_coherence": "1 sentence: do the materials across all items + keeps create a cohesive texture story?",
  "spatial_flow": "2-3 sentences: How does the overall furniture arrangement work? Are there clear pathways? Do the zones make sense? Is there a logical flow from entry to seating to dining? Any bottlenecks or dead zones?",
  "issues": ["any cross-cutting problems — aesthetic OR spatial. E.g. 'traffic bottleneck between coffee table and TV console', 'no clear entry path', 'dining zone too cramped for chair pullback'"],
  "revisedAnalysis": null or { the full revised analysis if confidence < 7 — with corrected placements }
}

BE STRICT. A professional designer would walk the room mentally, placing each item, checking clearances, testing sightlines, verifying outlet access, ensuring nothing blocks windows or doors, and confirming the acoustic and lighting balance works. Don't let a beautiful palette pass if the furniture arrangement doesn't work physically or the materials are impractical for the client's lifestyle.`,
  });

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 16000,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as HarmonyValidationResult;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Harmony validation failed",
    };
  }
}

/**
 * Validate a set of product search results holistically.
 * Checks that all items work together across tiers.
 * Now includes product images and visual metadata for visual coherence checks.
 */
export async function validateProductSet(
  products: Array<{
    title: string;
    category: string;
    tier: string;
    materials?: string[];
    colors?: string[];
    price?: number;
    description?: string;
    image_url?: string | null;
    visual_style_tags?: string[];
  }>,
  roomContext: {
    roomType: string;
    designDirection: string;
    existingItems: string[];
    roomImageUrls?: string[];
    designProfile?: DynamicDesignProfile;
  }
): Promise<AgentResult<ValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(roomContext.designProfile);

  const promptText = `Validate this set of product search results AS A COLLECTIVE SET. You have room photos and product images — use them to verify visual coherence.

## VALIDATION CHECKLIST
1. **Visual cohesion**: Do the product images ACTUALLY look like they belong together? Check real colors, textures, and styles in the images — not just text descriptions.
2. Every item description is detailed enough (specific materials, exact colors with undertones, dimensions)
3. All items within each tier work together aesthetically
4. Items match the room's design direction and existing furniture visible in room photos
5. Budget/Middle/Luxury tiers have appropriate price differentiation
6. No duplicate or near-duplicate products across tiers
7. Scale and proportion: Do these items look like they'd work at the right scale for the room shown?
8. **Harmony with existing items**: Do the products work with the items being KEPT in the room?
9. **Material durability**: Are materials practical for daily use? (White boucle + pets = problem, glass + kids = risk, delicate fabrics in high-traffic areas = impractical)
10. **Acoustic balance**: Does the set include enough soft materials (rugs, curtains, upholstery) for rooms with hard surfaces?
11. **Lighting coverage**: Does the set adequately address the room's lighting needs? Dark corners should have light sources.

## ROOM CONTEXT
- Room type: ${roomContext.roomType}
- Design direction: ${roomContext.designDirection}
- Existing items to keep: ${roomContext.existingItems.length > 0 ? roomContext.existingItems.join(", ") : "none specified"}

## PRODUCTS TO VALIDATE
${JSON.stringify(products.map(({ image_url: _img, ...rest }) => rest), null, 2)}

## PER-PRODUCT SCORING
For EACH product, score its harmony with the rest of the set AND the existing items:
- 8-10: Excellent fit — works beautifully with the set and room
- 6-7: Good fit — works well, no real issues
- 4-5: Questionable — might clash with something or feel slightly off
- 1-3: Poor fit — actively clashes with existing items or other products in the set

Return JSON:
{
  "isValid": true/false,
  "confidence": 0-10 (overall set confidence),
  "issues": ["specific problems — reference what you SEE in the images"],
  "suggestions": ["specific improvements"],
  "product_flags": [
    {
      "title": "product title",
      "category": "category slug",
      "harmony_score": number (1-10),
      "clashes_with": ["names of items it clashes with — existing or other products"],
      "reason": "why it fits or doesn't fit"
    }
  ]
}`;

  const content: AIContentBlock[] = [];

  // Add room images for context
  if (roomContext.roomImageUrls) {
    for (const url of roomContext.roomImageUrls.slice(0, 2)) {
      content.push({ type: "image", source: { type: "url", url } });
    }
  }

  // Add product images (up to 10 to stay within limits)
  const productsWithImages = products.filter((p) => p.image_url);
  for (const p of productsWithImages.slice(0, 10)) {
    content.push({ type: "image", source: { type: "url", url: p.image_url! } });
  }

  content.push({ type: "text", text: promptText });

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 16000,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as ValidationResult;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Product set validation failed",
    };
  }
}
