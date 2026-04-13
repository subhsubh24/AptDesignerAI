import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getMockupPrompt } from "@/lib/prompts/mockup";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { IMAGE_GENERATION_CONFIG } from "@/lib/config/pipeline";
import { createLogger } from "@/lib/logging/logger";
import type { AgentResult } from "./types";
import type {
  AIContentBlock,
  ImageSize,
  ImageAspectRatio,
  GroundingSource,
} from "@/lib/ai/provider";
import type { CandidateProduct } from "@/lib/types/database";

const log = createLogger("mockup-agent");

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
  /** Web sources consulted via Image Search Grounding, if enabled. */
  groundingSources?: GroundingSource[];
}

/**
 * Options for {@link generateMockupImage}. All fields optional — sensible
 * defaults come from {@link IMAGE_GENERATION_CONFIG}.
 */
export interface MockupImageOptions {
  /**
   * Output resolution for Nano Banana 2. 1K is the default (fast, good
   * quality); 2K/4K are higher fidelity at higher cost; 0.5K is for
   * thumbnail previews.
   */
  imageSize?: ImageSize;
  /**
   * Aspect ratio for the generated image. Defaults to 16:9 for landscape
   * room shots. The wide/tall ratios (1:4, 4:1, 1:8, 8:1) are useful for
   * elevation views and panoramas.
   */
  aspectRatio?: ImageAspectRatio;
  /**
   * When true, enable Google Search (Image Search Grounding) so Nano
   * Banana 2 can consult real-time web text + image results while
   * generating — useful for rendering real branded products or current
   * architectural styles with accuracy. Defaults to the pipeline config.
   */
  imageSearchGrounding?: boolean;
  /**
   * Optional style/product reference queries to nudge the grounded image
   * search toward specific products, materials, or aesthetic references
   * (e.g. "West Elm Harmony sofa", "Japandi oak dining table").
   */
  groundingReferences?: string[];
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
  roomImageUrls?: string[],
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

  // Attach room photos so the prompt-writer describes THIS room (walls,
  // floor, windows, light) rather than a generic version — the downstream
  // image generator will see the same photos and must render the same room.
  let content: string | AIContentBlock[] = prompt;
  if (roomImageUrls && roomImageUrls.length > 0) {
    const blocks: AIContentBlock[] = [
      {
        type: "text",
        text: "REFERENCE PHOTOS OF THE ACTUAL ROOM — the prompt you write will be fed to an image generator that MUST render this exact room. Describe the wall color, floor, windows, trim, ceiling, and light direction precisely from these photos so the generator matches them:",
      },
    ];
    for (const url of roomImageUrls.slice(0, 4)) {
      blocks.push({ type: "image", source: { type: "url", url } });
    }
    blocks.push({ type: "text", text: prompt });
    content = blocks;
  }

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 2000,
      seed: DETERMINISTIC_SEED,
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
 * Generate a mockup image using Gemini 3.1 Flash Image Preview ("Nano
 * Banana 2") native image generation.
 *
 * Supports optional room photos as visual reference so the generated
 * image actually resembles the real apartment. Exposes Nano Banana 2's
 * new capabilities:
 *  - Output resolution: 0.5K / 1K / 2K / 4K (default 1K)
 *  - Extended aspect ratios (incl. 1:4, 4:1, 1:8, 8:1)
 *  - Image Search Grounding — consult real-time web text + image results
 *    during generation for accurate rendering of real products and styles
 */
export async function generateMockupImage(
  prompt: string,
  roomImageUrls?: string[],
  options: MockupImageOptions = {},
): Promise<AgentResult<MockupGenerationResult>> {
  const imageSize = options.imageSize ?? (IMAGE_GENERATION_CONFIG.defaultImageSize as ImageSize);
  const aspectRatio = options.aspectRatio ?? (IMAGE_GENERATION_CONFIG.defaultAspectRatio as ImageAspectRatio);
  const useGrounding = options.imageSearchGrounding ?? IMAGE_GENERATION_CONFIG.imageSearchGroundingDefault;

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

    // When grounded, nudge the image model toward specific real-world
    // references so its web search retrieves the right products/styles.
    if (useGrounding && options.groundingReferences && options.groundingReferences.length > 0) {
      content.push({
        type: "text",
        text: `WEB REFERENCES — search the web for current product photos and style references that match:
${options.groundingReferences.map((r, i) => `${i + 1}. ${r}`).join("\n")}
Use these real-world references to render furniture and materials accurately (correct proportions, current colorways, actual silhouettes). Do not copy the reference photos 1:1 — adapt them to this specific room.`,
      });
    }

    content.push({
      type: "text",
      text: prompt,
    });

    const groundingSystemNote = useGrounding
      ? `\n\nYou have access to real-time Google Search (including image results). When a real product, brand, or named style is referenced, look up current reference imagery and match its actual silhouette, proportions, material, and finish. Never invent branded products — verify them via search.`
      : "";

    const imageSystemPrompt = `You are a photorealistic interior design visualization specialist.

ABSOLUTE RULE: The generated room must look like the SAME PHYSICAL ROOM shown in the reference photos. Match the exact:
- Wall color and finish
- Floor material, color, and pattern (e.g. light oak hardwood, gray tile, dark walnut planks)
- Window positions, sizes, and style (the room's natural light comes from these exact windows)
- Room dimensions and proportions (narrow vs wide, ceiling height)
- Architectural features (crown molding, baseboards, built-ins, radiators)

You are ONLY replacing/adding furniture and decor items. The room shell (walls, floors, ceiling, windows, doors) must be identical to the reference photos.

Generate images in a photorealistic, editorial interior photography style — warm natural light, slight depth of field, as if shot with a professional camera for Architectural Digest.${groundingSystemNote}`;

    // Image generation benefits from some stochasticity — we keep a moderate
    // temperature but add seed for best-effort reproducibility. Full
    // byte-identical reproducibility is handled at the route level by
    // caching rendered images keyed on (room image hash + product set).
    const response = await geminiProvider.chat({
      model: selectModel("image_generation"),
      system: imageSystemPrompt,
      messages: [{ role: "user", content }],
      temperature: 0.4,
      seed: DETERMINISTIC_SEED,
      responseModalities: ["Text", "Image"],
      imageConfig: { imageSize, aspectRatio },
      ...(useGrounding ? { tools: [{ googleSearch: {} as Record<string, never> }] } : {}),
    });

    if (response.imageData) {
      if (useGrounding && response.groundingMetadata?.sources?.length) {
        log.info(`mockup grounded on ${response.groundingMetadata.sources.length} web sources`, {
          sources: response.groundingMetadata.sources.slice(0, 3).map((s) => s.uri),
        });
      }
      return {
        success: true,
        data: {
          image_url: response.imageData.data,
          image_mime_type: response.imageData.mimeType,
          prompt_used: prompt,
          provider: "gemini-image",
          groundingSources: response.groundingMetadata?.sources,
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
