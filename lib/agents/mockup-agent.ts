import crypto from "crypto";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getMockupPrompt } from "@/lib/prompts/mockup";
import { resolveImageBlock } from "@/lib/ai/resolve-image";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { IMAGE_GENERATION_CONFIG } from "@/lib/config/pipeline";
import { createLogger } from "@/lib/logging/logger";
import { formatOrientationSummary } from "./photo-orientation-analyzer";
import type { PhotoOrientation } from "./photo-orientation-analyzer";
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
 * Inputs for {@link buildMockupContext}. Lets callers pass the raw diagnosis
 * rows + project + room record without having to hand-extract every field
 * the MockupContext needs.
 */
export interface BuildMockupContextInput {
  roomType: string;
  /** `room_diagnoses.diagnosis_json` row — any shape; the helper defensively
   * extracts known fields with fallbacks for legacy key names. */
  diagnosisJson?: Record<string, unknown> | null;
  /** `room_diagnoses.design_direction_json` row — palette/materials/textures/
   * style_notes live here in the current schema. */
  designDirectionJson?: Record<string, unknown> | null;
  /** `projects.building_research` — architectural grounding (finishes, windows). */
  buildingResearch?: Record<string, unknown>;
  priorities?: string[];
  userContext?: string;
  iterationNotes?: string;
}

/**
 * Assemble a {@link MockupContext} from the raw diagnosis/design-direction
 * rows + building research + room metadata. Centralizes all the defensive
 * key-name fallbacks (e.g. `what_works` vs `what_is_working`, `style_notes`
 * vs `direction`) so individual callers — API routes, future orchestrator
 * wiring, batch jobs — don't each re-implement the same extraction.
 *
 * Returns a fully populated MockupContext; every optional field is only set
 * when the source data actually contains a usable value, so downstream prompt
 * builders stay byte-identical to their pre-feature shape when context is sparse.
 */
export function buildMockupContext(input: BuildMockupContextInput): MockupContext {
  const djson = input.diagnosisJson ?? undefined;
  const ddJson = input.designDirectionJson ?? undefined;

  const diagnosisSummary =
    (djson?.current_vibe_summary as string) ||
    (djson?.summary as string) ||
    `Modern ${input.roomType} room`;

  const designDirection =
    (ddJson?.style_notes as string) ||
    (ddJson?.direction as string) ||
    (djson?.design_direction as string) ||
    undefined;

  const existingItems: string[] =
    (djson?.what_works as string[]) ||
    (djson?.what_is_working as string[]) ||
    [];

  const palette =
    (ddJson?.recommended_palette as string[]) ||
    (djson?.recommended_palette as string[]) ||
    [];
  const materials =
    (ddJson?.recommended_materials as string[]) ||
    (djson?.recommended_materials as string[]) ||
    [];
  const textures =
    (ddJson?.recommended_textures as string[]) ||
    (djson?.recommended_textures as string[]) ||
    [];

  const spatialLayout = (djson?.spatial_layout as string) || undefined;
  const lightingConditions = (djson?.lighting_conditions as string) || undefined;
  const windowDoorPositions = (djson?.window_door_positions as string) || undefined;

  // Build placement map from action_list (diagnosis) and what_it_needs (area-analysis).
  // action_list is populated first (lower priority), then what_it_needs overwrites
  // with more specific placements when available.
  const placementMap: Record<string, string> = {};
  const actionList = djson?.action_list as Array<{ category?: string; placement?: string }> | undefined;
  if (actionList) {
    for (const item of actionList) {
      if (item.category && item.placement) {
        placementMap[item.category] = item.placement;
      }
    }
  }
  const whatItNeeds = djson?.what_it_needs as Array<{ category?: string; placement?: string }> | undefined;
  if (whatItNeeds) {
    for (const item of whatItNeeds) {
      if (item.category && item.placement) {
        placementMap[item.category] = item.placement;
      }
    }
  }

  return {
    roomType: input.roomType,
    diagnosisSummary,
    existingItems: existingItems.length > 0 ? existingItems : undefined,
    designDirection,
    buildingResearch: input.buildingResearch,
    palette: palette.length > 0 ? palette : undefined,
    materials: materials.length > 0 ? materials : undefined,
    textures: textures.length > 0 ? textures : undefined,
    spatialLayout,
    placementMap: Object.keys(placementMap).length > 0 ? placementMap : undefined,
    lightingConditions,
    windowDoorPositions,
    priorities: input.priorities && input.priorities.length > 0 ? input.priorities : undefined,
    userContext: input.userContext || undefined,
    iterationNotes: input.iterationNotes || undefined,
  };
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
  photoOrientations?: PhotoOrientation[],
  floorPlanImageUrl?: string,
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
  //
  // When photoOrientations are supplied, interleave each caption with its
  // matching image block so the prompt-writer knows *which wall is which*
  // and can say things like "the window wall is on the right". Without this
  // anchor the model sees photos in isolation and can flip the layout.
  // Separate visual blocks (cacheable) from prompt text (per-call).
  // Pre-resolve through Files API so the same images aren't re-fetched
  // when generateMockupImage runs with the same URLs shortly after.
  const cacheableBlocks: AIContentBlock[] = [];
  const promptBlocks: AIContentBlock[] = [];

  if (roomImageUrls && roomImageUrls.length > 0) {
    if (floorPlanImageUrl) {
      cacheableBlocks.push({
        type: "text",
        text: "AUTHORITATIVE FLOOR PLAN — exact room dimensions, wall positions, window and door locations. Use this as the ground truth for spatial layout. The generated image MUST match this floor plan's wall arrangement.",
      });
      cacheableBlocks.push(await resolveImageBlock(floorPlanImageUrl, { preferFilesApi: true }));
    }

    cacheableBlocks.push({
      type: "text",
      text: "REFERENCE PHOTOS OF THE ACTUAL ROOM — the prompt you write will be fed to an image generator that MUST render this exact room. Describe the wall color, floor, windows, trim, ceiling, and light direction precisely from these photos so the generator matches them:",
    });

    const usedUrls = roomImageUrls.slice(0, 4);
    const captionByIndex = new Map<number, PhotoOrientation>();
    if (photoOrientations) {
      for (const o of photoOrientations) captionByIndex.set(o.index, o);
    }

    for (let i = 0; i < usedUrls.length; i++) {
      const orient = captionByIndex.get(i + 1);
      if (orient) {
        const features = orient.visible_features.length > 0
          ? ` Features: ${orient.visible_features.join("; ")}.`
          : "";
        cacheableBlocks.push({
          type: "text",
          text: `Photo ${i + 1} — ${orient.camera_position}, facing ${orient.facing}. Light ${orient.light_direction}.${features}`,
        });
      } else {
        cacheableBlocks.push({ type: "text", text: `Photo ${i + 1}:` });
      }
      cacheableBlocks.push(await resolveImageBlock(usedUrls[i], { preferFilesApi: true }));
    }

    const summary = formatOrientationSummary(photoOrientations ?? []);
    if (summary) cacheableBlocks.push({ type: "text", text: summary });
  }

  promptBlocks.push({ type: "text", text: prompt });

  // Include floor plan URL in the hash so a floor-plan-only prompt gets a
  // stable non-empty key even when no room photos are available.
  const cacheKeyInput = [
    "mockup",
    roomType,
    ...(roomImageUrls?.slice(0, 4) ?? []),
    ...(floorPlanImageUrl ? [floorPlanImageUrl] : []),
  ].join("|");
  const mockupSessionKey = cacheKeyInput.length > "mockup|".length
    ? crypto.createHash("sha256").update(cacheKeyInput).digest("hex").slice(0, 16)
    : "";

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: promptBlocks }],
      max_tokens: 6000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      cacheScope: cacheableBlocks.length > 0
        ? { sessionKey: mockupSessionKey, content: cacheableBlocks }
        : undefined,
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
  photoOrientations?: PhotoOrientation[],
  floorPlanImageUrl?: string,
): Promise<AgentResult<MockupGenerationResult>> {
  const imageSize = options.imageSize ?? (IMAGE_GENERATION_CONFIG.defaultImageSize as ImageSize);
  const aspectRatio = options.aspectRatio ?? (IMAGE_GENERATION_CONFIG.defaultAspectRatio as ImageAspectRatio);
  const useGrounding = options.imageSearchGrounding ?? IMAGE_GENERATION_CONFIG.imageSearchGroundingDefault;

  try {
    // Build content blocks: room photos first (if any), then prompt text.
    // Pre-resolve through Files API so the image model references cached
    // uploads instead of re-fetching each URL from scratch.
    const content: AIContentBlock[] = [];

    if (floorPlanImageUrl) {
      content.push({
        type: "text",
        text: "AUTHORITATIVE FLOOR PLAN — exact room dimensions, wall layout, window and door positions. Use this as the ground truth for spatial layout. The generated image MUST match this floor plan — windows go on the walls shown here, doors open where shown. Do NOT mirror or rotate the room relative to this plan.",
      });
      content.push(await resolveImageBlock(floorPlanImageUrl, { preferFilesApi: true }));
    }

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
The room architecture must be IDENTICAL. Only change the furniture and decor.

DO NOT flip, mirror, or rotate the room. Each photo below is tagged with the
photographer's viewpoint. Use those tags to place windows, doors, and features
on the CORRECT walls — not mirrored versions of them.`,
      });

      const captionByIndex = new Map<number, PhotoOrientation>();
      if (photoOrientations) {
        for (const o of photoOrientations) captionByIndex.set(o.index, o);
      }

      for (let i = 0; i < roomImageUrls.length; i++) {
        const orient = captionByIndex.get(i + 1);
        if (orient) {
          const features = orient.visible_features.length > 0
            ? ` Visible: ${orient.visible_features.join("; ")}.`
            : "";
          content.push({
            type: "text",
            text: `Photo ${i + 1} — ${orient.camera_position}, facing ${orient.facing}. Daylight ${orient.light_direction}.${features}`,
          });
        } else {
          content.push({ type: "text", text: `Photo ${i + 1}:` });
        }
        content.push(await resolveImageBlock(roomImageUrls[i], { preferFilesApi: true }));
      }

      const summary = formatOrientationSummary(photoOrientations ?? []);
      if (summary) content.push({ type: "text", text: summary });
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

    // Nano Banana Pro has thinking always on — the system prompt focuses on
    // the visual and spatial reasoning we want it to apply during that thinking.
    const imageSystemPrompt = `You are a professional interior design photographer and visualizer producing final images for Architectural Digest.

<what_stays_fixed>
The reference photos are your STRICT architectural template. Preserve EXACTLY:
- Floor: same material, same color, same plank/tile pattern, same sheen — do NOT lighten, darken, or change the flooring
- Walls: same color, same undertone, same paint finish — if the walls are greige, keep them greige. Do NOT default to white
- Windows: same count, same walls, same size, same frame style and color
- Ceiling: same height, same color, same features (or lack of features)
- All architectural details: baseboards, crown molding, built-ins, radiators, outlets — preserve everything

These elements are LOCKED. You cannot change, improve, brighten, or "clean up" any of them.
</what_stays_fixed>

<what_changes>
You are ADDING furniture and decor to this existing room. The user prompt specifies exactly what items to place and where. Treat placement instructions as spatial constraints — place items at the described positions relative to walls, windows, and other furniture.
</what_changes>

<photography_brief>
- Shot style: editorial interior photography, as published in Architectural Digest or Elle Decor
- Lens: 24mm wide-angle, eye-level viewpoint, showing the full room depth
- Depth of field: sharp foreground and midground with gentle bokeh in the far corners
- Lighting: warm, directional natural light from the actual window positions shown in the reference photos; warm secondary light pools from any lamps in the scene
- Color grading: slightly warm, natural — not cold or clinical; not overexposed
- Mood: lived-in designer apartment — not a furniture showroom, not a staged open house
</photography_brief>

<material_fidelity>
Every material must read as physically real — the weight of natural linen, the grain of oiled oak, the matte depth of a ceramic vase. Never render materials as flat, plasticky, or CGI. If you consulted web references for a product, match its actual proportions and material texture precisely.
</material_fidelity>
${groundingSystemNote}`;

    // Nano Banana Pro (gemini-3-pro-image-preview) is the default for final
    // room mockups — thinking always on, 4K capable, professional asset
    // production quality. If Pro is unavailable, fall back to Nano Banana 2
    // with thinkingLevel: "high" to match Pro's composition reasoning.
    const imageModel = selectModel("mockup_image"); // → gemini-3-pro-image-preview
    const isProModel = imageModel.includes("pro");

    // For Nano Banana 2 (fallback): explicitly set thinking to "high" to
    // maximally improve composition quality. For Pro, thinking is always on
    // and the thinkingConfig field is ignored (no-op to pass it).
    const thinkingCfg = isProModel
      ? undefined
      : { thinkingLevel: "high" as const };

    const response = await geminiProvider.chat({
      model: imageModel,
      system: imageSystemPrompt,
      messages: [{ role: "user", content }],
      // No temperature override — Gemini 3 image models are optimized for default (1.0).
      seed: DETERMINISTIC_SEED,
      responseModalities: ["Text", "Image"],
      imageConfig: { imageSize, aspectRatio },
      ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
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
