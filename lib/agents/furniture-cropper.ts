/**
 * Furniture cropper — vision-only pass that produces bounding boxes for
 * significant furniture in a room photo. Output feeds the identifier, which
 * then tries to put brand/model to each crop.
 *
 * We intentionally over-produce here (let the model list everything it sees)
 * and let the downstream identifier / verifier discard uncertain pieces. The
 * alternative — trying to ID + crop in one shot — leaves the model "stuck"
 * on its first guess and prevents a clean retrieval step.
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import {
  FurnitureCropsResponseSchema,
  type BoundingBox,
} from "@/lib/types/schemas";

const log = createLogger("furniture-cropper");

const FURNITURE_CROPS_SCHEMA = zodToGeminiSchema(FurnitureCropsResponseSchema);

export interface FurnitureCrop {
  /** Which image this crop came from (URL from imageUrls). */
  source_image_url: string;
  /** Rough vision label, e.g. "sofa", "coffee table", "floor lamp". */
  label: string;
  /** Normalized (0..1) top-left-origin box. */
  box: BoundingBox;
}

export interface CropperResult {
  crops: FurnitureCrop[];
  tokensUsed: number;
  model: string;
}

/**
 * Hints for each room type so the cropper prioritizes pieces the identifier
 * can actually match. For living rooms the dominant pieces are seating +
 * tables; for bedrooms it's beds + nightstands + dressers; etc. When the
 * room type is unknown we emit no hint and fall back to the generic list.
 *
 * Not an allow-list — the model is still free to emit anything from the
 * full label vocabulary — just a soft bias so we don't waste crops on a
 * bedroom's desk chair when the bed is the high-value target.
 */
const ROOM_PRIORITY_HINTS: Record<string, string> = {
  living_room: "sofa, sectional, armchair, coffee_table, side_table, media_console, floor_lamp, area_rug, artwork",
  bedroom: "bed, nightstand, dresser, armchair, floor_lamp, table_lamp, area_rug, artwork, mirror",
  dining_room: "dining_table, dining_chair, console_table, pendant, area_rug, artwork, bar_cart",
  kitchen: "pendant, bar_cart, dining_chair, artwork",
  home_office: "desk, office_chair, bookshelf, floor_lamp, table_lamp, area_rug, artwork",
  office: "desk, office_chair, bookshelf, floor_lamp, table_lamp, area_rug, artwork",
  bathroom: "mirror, sconce, artwork, planter",
  entryway: "console_table, mirror, pendant, area_rug, artwork",
  hallway: "console_table, mirror, pendant, area_rug, artwork",
  nursery: "bed, dresser, armchair, floor_lamp, area_rug, artwork",
  kids_room: "bed, dresser, bookshelf, table_lamp, area_rug, artwork",
  playroom: "bookshelf, area_rug, armchair, artwork",
  study: "desk, office_chair, bookshelf, floor_lamp, table_lamp, area_rug, artwork",
};

function buildCropPrompt(roomType?: string): string {
  const hintKey = (roomType || "").toLowerCase().replace(/\s+/g, "_");
  const hint = hintKey ? ROOM_PRIORITY_HINTS[hintKey] : undefined;

  const roomSection = roomType
    ? `\nROOM TYPE: ${roomType}${hint ? `\nTypical high-value pieces in this room type: ${hint}. Prioritize these when the photo contains several candidates; de-prioritize items that look out of place for the room (e.g., a desk in a bedroom may be a workspace, but the bed + nightstands are the identification targets).` : ""}\n`
    : "";

  return `You are analyzing room photos to locate every major piece
of furniture and lighting that is visible AND in good enough view to identify
(roughly 30% or more of the piece visible, not heavily occluded).
${roomSection}
For EACH such piece, emit one entry in \`crops\`:
  - \`label\`: one of
      sofa | sectional | armchair | dining_chair | office_chair
      coffee_table | side_table | dining_table | console_table | desk
      bed | nightstand | dresser | bookshelf | media_console | bar_cart
      floor_lamp | table_lamp | pendant | sconce
      area_rug | artwork | mirror | planter | other
    (use "other" only if none fit)
  - \`box\`: normalized bounding box in [0, 1], top-left origin:
      { x, y, w, h } — x+w <= 1, y+h <= 1

CRITICAL RULES:
- DO NOT list built-ins (fitted kitchens, radiators, windows, doors, outlets).
- DO NOT list items smaller than a toaster (candles, books, small decor).
- DO NOT list duplicates of the same piece across angles — pick the clearest.
- If the photo is too cluttered or low-quality to reliably locate a piece,
  OMIT it. An empty \`crops\` array is acceptable.

Return ONLY JSON matching the schema.`;
}

/**
 * Produce bounding boxes across one or more photos of the same room. We make
 * one call per photo so the normalized coords stay unambiguous — batching all
 * photos into one call led the model to return boxes in "collage" coordinates.
 *
 * `roomType` (optional) biases the cropper toward pieces that are typical for
 * the room — a bedroom's bed + nightstand are more valuable identification
 * targets than a stray desk chair. See ROOM_PRIORITY_HINTS.
 */
export async function runFurnitureCropper(
  imageUrls: string[],
  roomType?: string,
): Promise<CropperResult> {
  const model = selectModel("extraction"); // vision-only, cheap
  const system = getSystemPrompt();

  const allCrops: FurnitureCrop[] = [];
  let totalTokens = 0;

  const cropPrompt = buildCropPrompt(roomType);

  for (const url of imageUrls) {
    try {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url } },
              { type: "text", text: cropPrompt },
            ],
          },
        ],
        max_tokens: 8000,
        seed: DETERMINISTIC_SEED,
        responseSchema: FURNITURE_CROPS_SCHEMA,
        mediaResolution: "ultra_high",
        tools: [{ codeExecution: {} as Record<string, never> }],
      });

      totalTokens +=
        response.usage.input_tokens +
        response.usage.output_tokens +
        response.usage.thinking_tokens;

      const raw = extractJsonObject(response.content);
      const parsed = FurnitureCropsResponseSchema.parse(raw);
      for (const c of parsed.crops) {
        // Clamp boxes defensively — the identifier crops against these later.
        const x = Math.max(0, Math.min(1, c.box.x));
        const y = Math.max(0, Math.min(1, c.box.y));
        const w = Math.max(0, Math.min(1 - x, c.box.w));
        const h = Math.max(0, Math.min(1 - y, c.box.h));
        if (w <= 0.02 || h <= 0.02) continue; // tiny boxes = noise
        allCrops.push({
          source_image_url: url,
          label: c.label || "other",
          box: { x, y, w, h },
        });
      }
    } catch (error) {
      // Cropping one photo failing shouldn't kill the whole pipeline — the
      // identifier still has the other photos to work from.
      log.warn("cropper failed for one photo, skipping", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info("furniture cropper complete", {
    photos: imageUrls.length,
    crops: allCrops.length,
    tokens: { total: totalTokens },
  });

  return { crops: allCrops, tokensUsed: totalTokens, model };
}
