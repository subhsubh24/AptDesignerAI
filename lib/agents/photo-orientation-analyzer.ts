// Per-photo orientation analyzer for the mockup pipeline.
//
// Problem: the image generator sees multiple reference photos but no metadata
// telling it which photo shows which part of the room. Without that anchor, it
// can pick the wrong "canonical" viewpoint and flip the room's layout — windows
// end up on the wrong wall, doors on the wrong side.
//
// Solution: a single vision call that labels each photo with a structured
// caption (camera position, facing wall, visible features, light direction).
// These captions are then interleaved with the image blocks in both prompt
// generation and image generation, so the model associates each description
// with the specific photo it describes.
//
// One batched Gemini call per mockup — cheap, and its output is carried inside
// the existing mockup cache via the design-direction hash, so cache hits skip
// it entirely.
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { FloorPlanRoom } from "@/lib/types/database";

const log = createLogger("photo-orientation-analyzer");

export interface PhotoOrientation {
  /** 1-indexed position in the input array. Matches "Photo 1", "Photo 2"… */
  index: number;
  /** Where the photographer was standing, e.g. "near the doorway" / "opposite the window". */
  camera_position: string;
  /** Which wall the camera is pointed at, e.g. "window wall" / "entry wall" / "closet wall". */
  facing: string;
  /** Architectural features visible in this shot, e.g. ["two windows on far wall", "radiator on right"]. */
  visible_features: string[];
  /** Direction daylight appears to enter from in this shot, e.g. "from left", "backlit from window ahead". */
  light_direction: string;
  /** One-sentence human-readable summary used as the caption injected next to the image block. */
  caption: string;
}

interface AnalyzerRawResponse {
  photos: Array<{
    index?: number;
    camera_position?: string;
    facing?: string;
    visible_features?: string[];
    light_direction?: string;
    caption?: string;
  }>;
}

const MAX_ANALYZED_PHOTOS = 6;

const ANALYZER_SYSTEM_PROMPT = `You are a spatial analyst who studies interior photographs to extract camera-viewpoint metadata that a downstream image generator will use to reconstruct the same room from scratch.

For each photo provided, identify:
1. Where the photographer was standing (camera_position).
2. Which wall the camera is pointing at (facing).
3. The architectural features visible in the shot — windows, doors, radiators, built-ins, closets, fireplaces — and their approximate position within the frame (left/right/center/far wall).
4. The apparent direction of daylight in this specific shot.
5. A single-sentence caption that summarizes this viewpoint.

Be precise and consistent. If two photos show the same wall from different angles, say so. If a feature appears in multiple photos at different positions, treat that as a strong orientation signal.

Output ONLY valid JSON — no prose, no markdown fences.`;

/**
 * Run a single batched vision call that returns a per-photo orientation
 * caption for every image in {@link roomImageUrls}.
 *
 * Only analyzes photos of the specific room being rendered — callers must
 * pre-filter to `room_images` for that room before calling this function.
 *
 * @param roomImageUrls  URLs from `room_images` for this room only.
 * @param roomType       Room label, e.g. "living_room", "bedroom".
 * @param roomDimensions Optional known dimensions of this room (e.g. "12 × 15 ft" or "~180 sqft").
 *                       Superseded by extractedRoom when both are provided.
 * @param extractedRoom  Optional room data from an uploaded floor plan — provides exact wall
 *                       feature positions so the analyzer knows which walls have windows BEFORE
 *                       looking at photos, dramatically improving orientation accuracy.
 *
 * Cheap and non-fatal: if analysis fails (network, parse error, empty
 * response), returns an empty array. Callers must handle that gracefully
 * — the mockup still generates, just without the extra orientation anchor.
 */
export async function analyzePhotoOrientations(
  roomImageUrls: string[],
  roomType: string,
  roomDimensions?: string,
  extractedRoom?: FloorPlanRoom,
): Promise<PhotoOrientation[]> {
  if (!roomImageUrls || roomImageUrls.length === 0) return [];

  // Cap the number of photos we analyze — more than 6 is diminishing returns
  // and adds latency/cost. The first N are typically the most representative.
  const photos = roomImageUrls.slice(0, MAX_ANALYZED_PHOTOS);

  // Build dimension/layout context hint — prefer extracted floor plan data
  const dimHint = extractedRoom?.dimensions_text
    ? ` (~${extractedRoom.dimensions_text})`
    : roomDimensions
      ? ` (~${roomDimensions})`
      : "";

  // Build a wall-feature summary from extracted floor plan so the model knows
  // exactly which walls have windows/doors before it even looks at the photos.
  let floorPlanWallHint = "";
  if (extractedRoom && extractedRoom.walls.length > 0) {
    const wallLines = extractedRoom.walls
      .filter(w => w.features.length > 0)
      .map(w => {
        const feats = w.features.map(f => `${f.type} (${f.position_on_wall})`).join(", ");
        return `${w.direction} wall: ${feats}`;
      });
    if (wallLines.length > 0) {
      floorPlanWallHint = `\n\nFLOOR PLAN WALL DATA (authoritative — use to identify which wall is which in photos):\n${wallLines.join("\n")}`;
    }
  }

  const content: AIContentBlock[] = [
    {
      type: "text",
      text: `You will see ${photos.length} photo${photos.length === 1 ? "" : "s"} of a ${roomType}${dimHint}, numbered in the order shown. Analyze each one and return a JSON object.${floorPlanWallHint}`,
    },
  ];

  // Interleave "Photo N:" text before each image so the model reliably knows
  // which index it's looking at when it produces the output array.
  photos.forEach((url, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` });
    content.push({ type: "image", source: { type: "url", url } });
  });

  content.push({
    type: "text",
    text: `Return exactly this JSON schema (no extra keys, no commentary):

{
  "photos": [
    {
      "index": 1,
      "camera_position": "short phrase — where the photographer stood",
      "facing": "short phrase — which wall the camera points at",
      "visible_features": ["feature with position", "feature with position"],
      "light_direction": "short phrase — where daylight enters from in THIS shot",
      "caption": "one sentence summary of this viewpoint"
    }
  ]
}

Emit one entry per photo, in order. Index must match the photo number you were shown (1-based).`,
  });

  const model = selectModel("diagnosis");
  try {
    const response = await geminiProvider.chat({
      model,
      system: ANALYZER_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      max_tokens: 8000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
    });

    const parsed = extractJsonObject<AnalyzerRawResponse>(response.content);
    if (!parsed?.photos || !Array.isArray(parsed.photos)) {
      log.warn("analyzer returned no photos array", { content: response.content.slice(0, 200) });
      return [];
    }

    // Normalize — ensure every entry has usable strings, default missing
    // indices to their position in the array, and cap at the number of photos
    // we actually sent (in case the model hallucinated extras).
    const normalized: PhotoOrientation[] = parsed.photos
      .slice(0, photos.length)
      .map((p, i) => ({
        index: typeof p.index === "number" && p.index > 0 ? p.index : i + 1,
        camera_position: (p.camera_position || "").trim() || "unspecified",
        facing: (p.facing || "").trim() || "unspecified",
        visible_features: Array.isArray(p.visible_features)
          ? p.visible_features.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
          : [],
        light_direction: (p.light_direction || "").trim() || "unspecified",
        caption: (p.caption || "").trim() || `View ${i + 1} of the ${roomType}`,
      }));

    return normalized;
  } catch (err) {
    log.warn("photo orientation analysis failed — continuing without captions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Build a short text block that describes every photo's viewpoint in one
 * place. Used as a preface in prompts that also include the photos
 * interleaved separately — it gives the model an at-a-glance orientation
 * map it can refer back to while generating.
 */
export function formatOrientationSummary(orientations: PhotoOrientation[]): string {
  if (!orientations || orientations.length === 0) return "";

  const lines: string[] = ["Reference photo orientation map:"];
  for (const o of orientations) {
    const features = o.visible_features.length > 0 ? ` — ${o.visible_features.join("; ")}` : "";
    lines.push(`- Photo ${o.index}: ${o.camera_position}, facing ${o.facing}; light ${o.light_direction}${features}.`);
  }
  lines.push(
    "",
    "Use this map to place windows, doors, and features on the correct walls in the generated image. Do not flip or rotate the room.",
  );
  return lines.join("\n");
}
