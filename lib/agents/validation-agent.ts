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
    drop: boolean;
    reason: string;
  }>;
  overall_cohesion: number;
  palette_coherence: string;
  material_coherence: string;
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
  }
): Promise<AgentResult<HarmonyValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(context.designProfile);

  const whatWorks = (analysis.what_works as string[]) || [];
  const whatShouldGo = (analysis.what_should_go as string[]) || [];
  const whatItNeeds = (analysis.what_it_needs as Array<Record<string, unknown>>) || [];
  const designDirection = (analysis.design_direction as string) || "";

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

  content.push({
    type: "text",
    text: `You are a senior interior designer doing a HARMONY CHECK on recommended items before they go to product search.

## ROOM
${context.roomName} (${context.roomType})${buildingCtx}${apartmentCtx}

## DESIGN DIRECTION
${designDirection}

## ITEMS TO KEEP (already in the room — new items MUST harmonize with these)
${whatWorks.length > 0 ? whatWorks.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None specified"}

## ITEMS BEING REMOVED
${whatShouldGo.length > 0 ? whatShouldGo.map((item, i) => `${i + 1}. ${item}`).join("\n") : "None"}

## RECOMMENDED NEW ITEMS (to validate)
${whatItNeeds.map((item, i) => `${i + 1}. [${item.category}] ${item.search_title}
   Specs: ${item.specs}
   Priority: ${item.priority}
   Why: ${item.description}`).join("\n\n")}

## YOUR JOB
Look at the room photos. Look at the items being kept. Now evaluate EACH recommended item:

1. **Harmony with keeps**: Does this item's material, color, and style work with the existing items staying in the room? A walnut coffee table next to existing oak furniture = clash. A brass lamp with existing chrome fixtures = clash.

2. **Harmony with other recommendations**: Do ALL the new items work together as a set? If you're recommending a warm cream rug AND cool gray throw pillows, that's a palette conflict.

3. **Apartment coherence**: Does this fit the overall apartment aesthetic and building finishes?

4. **Specificity check**: Is the search_title specific enough to find the RIGHT product? Does it include material, color, size, and style?

5. **Scale/proportion**: Based on what you see in the photos, will this item be the right size for the space?

## SCORING (per item)
- **harmony_score** (1-10): How well does this item fit with keeps + other recommendations + apartment?
  - 9-10: Perfect harmony — same material family, complementary colors, cohesive style
  - 7-8: Good fit — works well, minor adjustments might help
  - 5-6: Acceptable but could be better — slightly off palette or material family
  - 3-4: Conflict — clashes with keeps or other recommendations
  - 1-2: Wrong — completely out of place

- **drop**: true if harmony_score ≤ 3 (remove from recommendations entirely)

- If harmony_score is 4-6, provide a **revised_search_title** and **revised_specs** that would harmonize better

## OUTPUT FORMAT
Return JSON:
{
  "confidence": 0-10 (overall confidence in this recommendation set),
  "item_scores": [
    {
      "category": "the category slug",
      "harmony_score": number,
      "keeps_well_with": ["which existing items it pairs well with"],
      "clashes_with": ["which existing items or other recommendations it conflicts with"],
      "revised_search_title": "only if score 4-6, a better search title that harmonizes",
      "revised_specs": "only if score 4-6, revised specs",
      "drop": true/false,
      "reason": "1-2 sentence explanation"
    }
  ],
  "overall_cohesion": 0-10 (do ALL items work together as a complete room?),
  "palette_coherence": "1 sentence: does the color palette across all items + keeps make sense?",
  "material_coherence": "1 sentence: do the materials across all items + keeps create a cohesive texture story?",
  "issues": ["any cross-cutting problems — e.g. too many warm tones, no contrast, missing texture variety"],
  "revisedAnalysis": null or { the full revised analysis object if confidence < 7 — with corrected what_it_needs entries }
}

BE STRICT. A professional designer would reject items that clash. Don't let mediocre harmony pass — the product search will spend real money finding these items.`,
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

  const promptText = `Validate this set of product search results. You have room photos and product images — use them to verify visual coherence.

## VALIDATION CHECKLIST
1. **Visual cohesion**: Do the product images ACTUALLY look like they belong together? Check real colors, textures, and styles in the images — not just text descriptions.
2. Every item description is detailed enough (specific materials, exact colors with undertones, dimensions)
3. All items within each tier work together aesthetically
4. Items match the room's design direction and existing furniture visible in room photos
5. Budget/Middle/Luxury tiers have appropriate price differentiation
6. No duplicate or near-duplicate products across tiers
7. Scale and proportion: Do these items look like they'd work at the right scale for the room shown?

## ROOM CONTEXT
- Room type: ${roomContext.roomType}
- Design direction: ${roomContext.designDirection}
- Existing items: ${roomContext.existingItems.join(", ")}

## PRODUCTS TO VALIDATE
${JSON.stringify(products.map(({ image_url: _img, ...rest }) => rest), null, 2)}

Return JSON:
{
  "isValid": true/false,
  "confidence": 0-10,
  "issues": ["specific problems — reference what you SEE in the images"],
  "suggestions": ["specific improvements"]
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
