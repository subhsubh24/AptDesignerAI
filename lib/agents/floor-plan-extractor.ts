// Floor plan extraction agent.
//
// Takes a floor plan image URL and returns a strongly-typed ExtractedFloorPlan
// that every downstream agent uses as the authoritative source of spatial data:
// exact room dimensions, wall features (windows/doors/built-ins), building
// orientation, and traffic notes.
//
// Replaces all "infer from photos" guesswork about dimensions in the pipeline.
// When extraction succeeds, agents receive ground-truth geometry; when it fails
// (bad image, parse error, network) they fall back to existing behavior.
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { thinkingFor } from "@/lib/ai/thinking";
import { resolveImageBlock } from "@/lib/ai/resolve-image";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import {
  FLOOR_PLAN_EXTRACTOR_SYSTEM_PROMPT,
  buildFloorPlanExtractorPrompt,
} from "@/lib/prompts/floor-plan-extractor-prompt";
import type { AgentResult } from "./types";
import type { ExtractedFloorPlan, FloorPlanRoom, FloorPlanWall, WallFeature } from "@/lib/types/database";

const log = createLogger("floor-plan-extractor");

// Raw shape the LLM returns before we normalize it
interface RawFloorPlan {
  confidence?: string;
  total_sqft?: number | string | null;
  building_orientation?: string | null;
  scale_note?: string | null;
  overall_notes?: string | null;
  rooms?: Array<{
    room_type?: string;
    label?: string;
    sqft?: number | string | null;
    dimensions_text?: string | null;
    width_ft?: number | string | null;
    depth_ft?: number | string | null;
    shape?: string;
    natural_light?: string;
    traffic_notes?: string | null;
    notes?: string | null;
    walls?: Array<{
      direction?: string;
      length_ft?: number | string | null;
      features?: Array<{
        type?: string;
        position_on_wall?: string;
        width_ft?: number | string | null;
        notes?: string | null;
      }>;
    }>;
  }>;
}

const VALID_ROOM_TYPES = new Set([
  "living_room", "dining_area", "kitchen", "bedroom", "bathroom",
  "home_office", "hallway", "closet", "laundry", "balcony", "other",
]);

const VALID_WALL_POSITIONS = new Set(["left", "left-center", "center", "right-center", "right"]);
const VALID_FEATURE_TYPES = new Set(["window", "door", "closet", "built_in", "opening", "radiator"]);

function toNum(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

type RawFeature = { type?: string; position_on_wall?: string; width_ft?: number | string | null; notes?: string | null };
type RawWall = { direction?: string; length_ft?: number | string | null; features?: RawFeature[] };
type RawRoom = NonNullable<RawFloorPlan["rooms"]>[number];

function normalizeFeature(f: RawFeature): WallFeature {
  return {
    type: (VALID_FEATURE_TYPES.has(f.type ?? "") ? f.type : "window") as WallFeature["type"],
    position_on_wall: (VALID_WALL_POSITIONS.has(f.position_on_wall ?? "") ? f.position_on_wall : "center") as WallFeature["position_on_wall"],
    width_ft: toNum(f.width_ft),
    notes: f.notes?.trim() || undefined,
  };
}

function normalizeWall(w: RawWall, idx: number): FloorPlanWall {
  return {
    direction: (w.direction || `wall_${idx + 1}`).trim(),
    length_ft: toNum(w.length_ft),
    features: Array.isArray(w.features)
      ? w.features.map(normalizeFeature)
      : [],
  };
}

function normalizeRoom(r: RawRoom): FloorPlanRoom {
  return {
    room_type: VALID_ROOM_TYPES.has(r.room_type ?? "") ? (r.room_type as string) : "other",
    label: (r.label || r.room_type || "room").trim(),
    sqft: toNum(r.sqft),
    dimensions_text: r.dimensions_text?.trim() || undefined,
    width_ft: toNum(r.width_ft),
    depth_ft: toNum(r.depth_ft),
    shape: (["rectangular", "L-shaped", "irregular"].includes(r.shape ?? "") ? r.shape : "rectangular") as FloorPlanRoom["shape"],
    walls: Array.isArray(r.walls)
      ? r.walls.map((w, i) => normalizeWall(w, i))
      : [],
    natural_light: (["high", "medium", "low"].includes(r.natural_light ?? "") ? r.natural_light : "medium") as FloorPlanRoom["natural_light"],
    traffic_notes: r.traffic_notes?.trim() || undefined,
    notes: r.notes?.trim() || undefined,
  };
}

function normalizeRaw(raw: RawFloorPlan, imageUrl: string): ExtractedFloorPlan {
  return {
    image_url: imageUrl,
    extracted_at: new Date().toISOString(),
    confidence: (["high", "medium", "low"].includes(raw.confidence ?? "") ? raw.confidence : "low") as ExtractedFloorPlan["confidence"],
    total_sqft: toNum(raw.total_sqft),
    building_orientation: raw.building_orientation?.trim() || undefined,
    scale_note: raw.scale_note?.trim() || undefined,
    overall_notes: raw.overall_notes?.trim() || undefined,
    rooms: Array.isArray(raw.rooms) ? raw.rooms.map(normalizeRoom) : [],
  };
}

/**
 * Extract spatial data from a floor plan image.
 *
 * @param imageUrl  Publicly accessible URL of the floor plan image.
 * @param imageDescription  Optional hint about the image (e.g. "developer PDF for a 2BR unit").
 *
 * Returns the extracted floor plan on success, or `{ success: false }` on any
 * failure — callers must handle gracefully (fall back to building_research data).
 */
export async function runFloorPlanExtraction(
  imageUrl: string,
  imageDescription?: string,
): Promise<AgentResult<ExtractedFloorPlan>> {
  const model = selectModel("diagnosis"); // reasoning model for accurate extraction
  try {
    // Floor plans may be PDFs (developer marketing plans, CAD exports) — those
    // must go through the Files API. preferFilesApi uploads once and returns
    // a file_uri block with the correct mimeType (application/pdf), bypassing
    // the image-only URL fetch path.
    const imageBlock = await resolveImageBlock(imageUrl, { preferFilesApi: true });

    const response = await geminiProvider.chat({
      model,
      system: FLOOR_PLAN_EXTRACTOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            imageBlock,
            { type: "text", text: buildFloorPlanExtractorPrompt(imageDescription) },
          ],
        },
      ],
      max_tokens: 64000,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: thinkingFor("diagnosis"),
    });

    const raw = extractJsonObject<RawFloorPlan>(response.content);

    if (!raw || !Array.isArray(raw.rooms)) {
      log.warn("floor plan extractor returned unexpected shape", {
        preview: response.content.slice(0, 300),
      });
      return { success: false, error: "Floor plan extraction returned unexpected shape" };
    }

    const extracted = normalizeRaw(raw, imageUrl);
    return {
      success: true,
      data: extracted,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
      model: response.model,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("floor plan extraction failed", { error: msg });
    return { success: false, error: msg };
  }
}
