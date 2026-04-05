import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getMockupPrompt } from "@/lib/prompts/mockup";
import { extractJsonObject } from "@/lib/ai/extract-json";
import type { AgentResult } from "./types";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { CandidateProduct } from "@/lib/types/database";

interface MockupPromptResult {
  prompt: string;
  negative_prompt: string;
  style_notes: string;
}

interface MockupGenerationResult {
  image_url: string;
  image_mime_type?: string;
  prompt_used: string;
  provider: string;
}

export interface MockupContext {
  roomType: string;
  diagnosisSummary: string;
  existingItems?: string[];
  designDirection?: string;
  buildingResearch?: Record<string, unknown>;
  palette?: string[];
  materials?: string[];
  textures?: string[];
  spatialLayout?: string;
  placementMap?: Record<string, string>;
  lightingConditions?: string;
  windowDoorPositions?: string;
  priorities?: string[];
  userContext?: string;
  iterationNotes?: string;
}

/**
 * Generate an image generation prompt from room context + selected products.
 */
export async function generateMockupPrompt(
  roomType: string,
  diagnosisSummary: string,
  products: CandidateProduct[],
  existingItems?: string[],
  designDirection?: string,
  buildingResearch?: Record<string, unknown>,
  mockupContext?: MockupContext,
): Promise<AgentResult<MockupPromptResult>> {
  const model = selectModel("mockup_prompt");
  const system = getSystemPrompt();

  const productDescriptions = products.map(
    (p) => {
      const parts = [`${p.category}: ${p.title || "Unknown"}`];
      if (p.colors?.length) parts.push(`colors: ${p.colors.join("/")}`);
      if (p.materials?.length) parts.push(`materials: ${p.materials.join("/")}`);
      if (p.dimensions) parts.push(`dimensions: ${p.dimensions}`);
      // Include placement info if available from context
      if (mockupContext?.placementMap?.[p.category || ""]) {
        parts.push(`placement: ${mockupContext.placementMap[p.category || ""]}`);
      }
      return parts.join(" — ");
    }
  );

  const prompt = getMockupPrompt(roomType, diagnosisSummary, productDescriptions, existingItems, designDirection, buildingResearch, mockupContext);

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      temperature: 0.4,
      responseMimeType: "application/json",
    });

    const parsed = extractJsonObject<MockupPromptResult>(response.content);
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Mockup prompt generation failed",
    };
  }
}

/**
 * Generate a mockup image using Gemini native image generation.
 * Supports optional room photos as visual reference so the generated
 * image actually resembles the real apartment.
 */
export async function generateMockupImage(
  prompt: string,
  roomImageUrls?: string[],
): Promise<AgentResult<MockupGenerationResult>> {
  try {
    // Build content blocks: room photos first (if any), then prompt text
    const content: AIContentBlock[] = [];

    if (roomImageUrls && roomImageUrls.length > 0) {
      content.push({
        type: "text",
        text: `REFERENCE PHOTOS OF THE ACTUAL ROOM — study these carefully:
These are real photos of the apartment. Your generated image MUST match:
- Same room shape, proportions, and ceiling height
- Same flooring (exact color, material, plank/tile pattern)
- Same wall color and texture
- Same window positions, sizes, shapes, and trim
- Same built-in features (closets, shelves, outlets, molding)
- Same natural light direction and quality
The room architecture must be IDENTICAL. Only change the furniture and decor.`,
      });
      for (const url of roomImageUrls) {
        content.push({
          type: "image",
          source: { type: "url", url },
        });
      }
    }

    content.push({
      type: "text",
      text: prompt,
    });

    const imageSystemPrompt = `You are a photorealistic interior design visualization specialist.

ABSOLUTE RULE: The generated room must look like the SAME PHYSICAL ROOM shown in the reference photos. Match the exact:
- Wall color and finish
- Floor material, color, and pattern (e.g. light oak hardwood, gray tile, dark walnut planks)
- Window positions, sizes, and style (the room's natural light comes from these exact windows)
- Room dimensions and proportions (narrow vs wide, ceiling height)
- Architectural features (crown molding, baseboards, built-ins, radiators)

You are ONLY replacing/adding furniture and decor items. The room shell (walls, floors, ceiling, windows, doors) must be identical to the reference photos.

Generate images in a photorealistic, editorial interior photography style — warm natural light, slight depth of field, as if shot with a professional camera for Architectural Digest.`;

    const response = await geminiProvider.chat({
      model: selectModel("image_generation"),
      system: imageSystemPrompt,
      messages: [{ role: "user", content }],
      temperature: 0.4,
      responseModalities: ["Text", "Image"],
    });

    if (response.imageData) {
      return {
        success: true,
        data: {
          image_url: response.imageData.data,
          image_mime_type: response.imageData.mimeType,
          prompt_used: prompt,
          provider: "gemini-image",
        },
      };
    }

    return { success: false, error: "No image generated in response" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Image generation failed",
    };
  }
}
