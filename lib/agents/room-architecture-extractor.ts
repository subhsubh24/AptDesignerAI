// Room architecture extractor — a vision pass that runs before mockup generation.
//
// Problem: the image model (Gemini Nano Banana Pro) generates NEW images rather
// than inpainting, so the only way to anchor the output to the actual apartment
// is through the text prompt. Generic "match the reference photos" instructions
// are ignored when they conflict with the model's priors (e.g., it defaults to
// white walls and light oak floors unless told otherwise with specific values).
//
// Solution: a dedicated vision call that extracts precise architectural details
// from the room photos — exact wall color with undertone, floor material + plank
// width + sheen, window count + positions + frame style, ceiling height — and
// returns them as structured fields that are injected verbatim into the mockup
// prompt. The image generator then has specific values to lock onto ("warm
// greige walls, flat matte finish") rather than a vague directive.
//
// Non-fatal: returns null on any failure so the mockup still generates (just
// without the extra anchor). Runs in parallel with analyzePhotoOrientations
// to avoid adding latency to the mockup pipeline.
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";

const log = createLogger("room-architecture-extractor");

export interface RoomArchitecture {
  // Floor
  floor_material: string;      // e.g. "hardwood" | "tile" | "concrete" | "carpet"
  floor_color: string;         // e.g. "warm honey/medium oak" | "cool grey-white"
  floor_plank_or_tile: string; // e.g. "~4 inch planks running east-west" | "12x24 inch tiles"
  floor_sheen: string;         // e.g. "matte" | "satin" | "high gloss"

  // Walls
  wall_color: string;          // e.g. "warm off-white with greige undertone"
  wall_finish: string;         // e.g. "flat matte paint" | "eggshell" | "exposed brick"
  accent_wall: string;         // e.g. "none" | "north wall: exposed brick"

  // Ceiling
  ceiling_height: string;      // e.g. "~9 feet" | "standard ~8 feet" | "vaulted ~12 feet"
  ceiling_color: string;       // e.g. "white" | "warm cream"
  ceiling_features: string;    // e.g. "flat, no molding" | "coffered" | "exposed wood beams"

  // Windows
  window_count: number;
  window_descriptions: string[]; // one entry per window/group, e.g. ["south wall: two double-hung windows ~5ft wide, white wood frames"]
  dominant_light_direction: string; // e.g. "strong southwest afternoon light" | "north-facing, diffuse"

  // Doors and built-ins
  door_descriptions: string[];   // e.g. ["north wall: solid panel entry door, white painted"]
  built_ins: string[];           // e.g. ["west wall: built-in floor-to-ceiling bookshelf"] or []

  // Trim and detail
  baseboards: string;            // e.g. "white painted wood, ~4 inch" | "none visible"
  crown_molding: string;         // e.g. "none" | "simple 3-inch white cove molding"
  other_features: string[];      // e.g. ["exposed radiator on east wall", "brick fireplace on south wall"]

  // Spatial summary
  room_shape_notes: string;      // e.g. "rectangular, ~12×18 ft; kitchen passage visible on right"
}

const EXTRACTOR_SYSTEM = `You are an architectural analyst who studies interior photographs to extract precise, measurable surface and spatial details.

Your output feeds a downstream AI image generator that must reproduce THIS EXACT ROOM from scratch. Every field you return will be injected verbatim into the image generation prompt as a hard constraint. Precision matters — vague answers like "medium brown floor" are useless. Specific answers like "warm honey/medium oak hardwood, ~4 inch planks, satin sheen" give the generator a precise target.

Rules:
- Describe what you SEE in the photos. If a feature is not visible, write "not visible".
- For colors: describe hue, undertone, and lightness. "Off-white with a warm greige undertone" is better than "white".
- For floors: estimate plank/tile width from the photos. Note running direction if visible.
- For windows: count each window opening individually. Describe frame color/material and approximate size.
- Never guess features that are not visible in the photos. Never invent architectural details.`;

/**
 * Extract precise room architecture details from reference photos.
 *
 * Runs a single vision LLM call and returns structured fields describing the
 * room's permanent architectural features (floor, walls, ceiling, windows,
 * doors, trim). These values are injected verbatim into the mockup prompt so
 * the image generator has specific values to lock onto instead of generic
 * "match the photos" directives.
 *
 * @param roomImageUrls  Up to 4 URLs of room reference photos.
 * @param roomType       e.g. "living_room", "bedroom".
 * @param floorPlanImageUrl  Optional floor plan URL for spatial grounding.
 * @returns Structured architecture or null if extraction fails.
 */
export async function extractRoomArchitecture(
  roomImageUrls: string[],
  roomType: string,
  floorPlanImageUrl?: string,
): Promise<RoomArchitecture | null> {
  if (!roomImageUrls || roomImageUrls.length === 0) return null;

  const photos = roomImageUrls.slice(0, 4);

  const content: AIContentBlock[] = [];

  if (floorPlanImageUrl) {
    content.push({
      type: "text",
      text: "FLOOR PLAN — use this for spatial orientation (which walls have windows/doors) but prioritize the photos for surface finish details:",
    });
    content.push({ type: "image", source: { type: "url", url: floorPlanImageUrl } });
  }

  content.push({
    type: "text",
    text: `Study the following ${photos.length} photo${photos.length === 1 ? "" : "s"} of a ${roomType}. Extract precise architectural details as described below.`,
  });

  photos.forEach((url, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` });
    content.push({ type: "image", source: { type: "url", url } });
  });

  content.push({
    type: "text",
    text: `Return a single JSON object with exactly these fields (all required, use "not visible" when a feature is not in the photos):

{
  "floor_material": "exact material — hardwood / tile / concrete / carpet / vinyl / stone",
  "floor_color": "hue + undertone + lightness, e.g. warm honey/medium oak or cool grey-white marble",
  "floor_plank_or_tile": "estimated width/size and pattern/direction if visible",
  "floor_sheen": "matte / satin / semi-gloss / high gloss",

  "wall_color": "hue + undertone + lightness, e.g. warm off-white with greige undertone",
  "wall_finish": "flat matte / eggshell / satin / exposed brick / wallpaper / etc.",
  "accent_wall": "none OR description of accent wall, e.g. north wall: exposed brick",

  "ceiling_height": "estimated height, e.g. ~9 feet or vaulted ~14 feet",
  "ceiling_color": "color",
  "ceiling_features": "flat no molding / coffered / exposed beams / recessed lights / etc.",

  "window_count": <number>,
  "window_descriptions": ["one string per window or window group — wall it's on, approximate size, frame material and color"],
  "dominant_light_direction": "cardinal direction + quality, e.g. strong southwest afternoon light",

  "door_descriptions": ["one string per door — wall, style, color"],
  "built_ins": ["built-in features like shelving, closets, fireplace surrounds — or empty array []"],

  "baseboards": "material, color, and approximate height or not visible",
  "crown_molding": "description or none",
  "other_features": ["any other fixed architectural elements — radiators, columns, arches, etc."],

  "room_shape_notes": "overall shape and any notable spatial relationships visible in the photos"
}`,
  });

  const model = selectModel("diagnosis");
  try {
    const response = await geminiProvider.chat({
      model,
      system: EXTRACTOR_SYSTEM,
      messages: [{ role: "user", content }],
      max_tokens: 3000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      tools: [
        { googleSearch: {} as Record<string, never> },
        { codeExecution: {} as Record<string, never> },
      ],
    });

    const parsed = extractJsonObject<RoomArchitecture>(response.content);
    if (!parsed || typeof parsed.wall_color !== "string") {
      log.warn("extractor returned unexpected shape", { preview: response.content.slice(0, 200) });
      return null;
    }

    log.info("room architecture extracted", {
      floor: parsed.floor_material,
      walls: parsed.wall_color,
      windows: parsed.window_count,
    });

    return parsed;
  } catch (err) {
    log.warn("room architecture extraction failed — continuing without it", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Format extracted architecture into a verbatim prompt block that constrains
 * the image generator to match the actual room.
 *
 * Each line is a hard constraint — specific enough that the model can't fall
 * back to generic priors (white walls, light floors) without explicitly
 * violating the instruction.
 */
export function formatArchitectureForPrompt(arch: RoomArchitecture): string {
  const lines: string[] = [
    "EXACT ROOM ARCHITECTURE — extracted from reference photos. Reproduce each detail precisely:",
    `- Floor: ${arch.floor_material}, ${arch.floor_color}${arch.floor_plank_or_tile !== "not visible" ? `, ${arch.floor_plank_or_tile}` : ""}, ${arch.floor_sheen} sheen`,
    `- Walls: ${arch.wall_color}, ${arch.wall_finish}`,
  ];

  if (arch.accent_wall && arch.accent_wall.toLowerCase() !== "none") {
    lines.push(`- Accent wall: ${arch.accent_wall}`);
  }

  lines.push(`- Ceiling: ${arch.ceiling_height}, ${arch.ceiling_color}, ${arch.ceiling_features}`);

  if (arch.window_count > 0) {
    lines.push(`- Windows: ${arch.window_count} total`);
    for (const wd of arch.window_descriptions) {
      lines.push(`  • ${wd}`);
    }
  }

  lines.push(`- Natural light: ${arch.dominant_light_direction}`);

  if (arch.door_descriptions.length > 0) {
    for (const dd of arch.door_descriptions) {
      lines.push(`- Door: ${dd}`);
    }
  }

  if (arch.built_ins.length > 0) {
    for (const bi of arch.built_ins) {
      lines.push(`- Built-in: ${bi}`);
    }
  }

  if (arch.baseboards && arch.baseboards.toLowerCase() !== "not visible") {
    lines.push(`- Baseboards: ${arch.baseboards}`);
  }

  if (arch.crown_molding && arch.crown_molding.toLowerCase() !== "none") {
    lines.push(`- Crown molding: ${arch.crown_molding}`);
  }

  for (const feat of arch.other_features) {
    lines.push(`- Feature: ${feat}`);
  }

  if (arch.room_shape_notes) {
    lines.push(`- Room shape: ${arch.room_shape_notes}`);
  }

  lines.push(
    "",
    "CRITICAL: Do NOT change any architectural feature above. The floor color, wall color, window count and positions, ceiling height, and all trim must be IDENTICAL to the reference photos. Only the furniture and decor change.",
  );

  return lines.join("\n");
}
