// Formatter: converts an ExtractedFloorPlan into a concise text block for
// injection into agent prompts.
//
// Used by all agents that don't receive images (fit-scorer, bundle-optimizer,
// greedy-decorator, search-brief, product-eval, bundle-eval). Vision agents
// (diagnostician, mockup, validation) additionally receive the raw image.
//
// When roomType is provided the target room's data is shown first and in full;
// other rooms are summarised as one-liners for cross-room context.
import type { ExtractedFloorPlan, FloorPlanRoom } from "@/lib/types/database";

/** Format a single wall's features as a compact string, e.g. "2 windows (center, right); 1 door (left)" */
function formatWallFeatures(room: FloorPlanRoom): string {
  const wallLines: string[] = [];
  for (const wall of room.walls) {
    if (wall.features.length === 0) continue;
    const featsByType = wall.features.reduce<Record<string, string[]>>((acc, f) => {
      const key = f.type;
      acc[key] = acc[key] || [];
      acc[key].push(f.position_on_wall + (f.width_ft ? ` (${f.width_ft}ft wide)` : ""));
      return acc;
    }, {});
    const featStr = Object.entries(featsByType)
      .map(([type, positions]) => `${positions.length} ${type}${positions.length > 1 ? "s" : ""} (${positions.join(", ")})`)
      .join("; ");
    wallLines.push(`    ${wall.direction} wall${wall.length_ft ? ` (${wall.length_ft}ft)` : ""}: ${featStr}`);
  }
  return wallLines.join("\n") || "    (no features noted)";
}

/** Compact one-liner for non-primary rooms */
function formatRoomSummary(room: FloorPlanRoom): string {
  const dim = room.dimensions_text ? `~${room.dimensions_text}` : room.sqft ? `~${room.sqft} sqft` : "";
  const windows = room.walls
    .flatMap(w => w.features.filter(f => f.type === "window").map(() => w.direction))
    .join("/");
  const parts = [dim, windows ? `windows on ${windows} wall` : ""].filter(Boolean);
  return `  ${room.label} (${room.room_type})${parts.length ? " — " + parts.join("; ") : ""}`;
}

/**
 * Render an `ExtractedFloorPlan` as a structured text block for injection
 * into agent prompts.
 *
 * @param plan      The extracted floor plan.
 * @param roomType  If supplied, the matching room is shown in full detail first.
 *                  Other rooms follow as brief one-liners.
 * @returns         Ready-to-inject text block, or empty string when plan is nullish.
 */
export function formatExtractedFloorPlanForPrompt(
  plan: ExtractedFloorPlan | null | undefined,
  roomType?: string,
): string {
  if (!plan) return "";

  const lines: string[] = [];
  lines.push("## FLOOR PLAN (authoritative — do not infer dimensions from photos)");
  lines.push(`Confidence: ${plan.confidence}${plan.scale_note ? ` | Scale: ${plan.scale_note}` : ""}`);
  if (plan.building_orientation) lines.push(`Orientation: ${plan.building_orientation}`);
  if (plan.total_sqft) lines.push(`Total apartment: ~${plan.total_sqft} sqft`);

  // Find the primary room — exact match, else a prefix match, and only when
  // either picks out exactly ONE room. See matchSingleRoom: two bedrooms in
  // the plan cannot answer "which bedroom is this?", and this block is
  // labelled authoritative to the model.
  const primaryRoom = roomType ? matchSingleRoom(plan.rooms, roomType) : undefined;

  if (primaryRoom) {
    lines.push("");
    const dimPart = primaryRoom.dimensions_text
      ? `~${primaryRoom.dimensions_text}`
      : primaryRoom.sqft
        ? `~${primaryRoom.sqft} sqft`
        : primaryRoom.width_ft && primaryRoom.depth_ft
          ? `~${primaryRoom.width_ft} × ${primaryRoom.depth_ft} ft`
          : "";
    lines.push(`This ${primaryRoom.room_type} (${primaryRoom.label})${dimPart ? " — " + dimPart : ""}:`);
    lines.push(`  Shape: ${primaryRoom.shape} | Natural light: ${primaryRoom.natural_light}`);
    if (primaryRoom.traffic_notes) lines.push(`  Traffic: ${primaryRoom.traffic_notes}`);
    lines.push("  Walls:");
    lines.push(formatWallFeatures(primaryRoom));
    if (primaryRoom.notes) lines.push(`  Notes: ${primaryRoom.notes}`);
  }

  const otherRooms = primaryRoom
    ? plan.rooms.filter(r => r !== primaryRoom)
    : plan.rooms;

  if (otherRooms.length > 0) {
    lines.push("");
    lines.push("Other rooms:");
    for (const room of otherRooms) {
      lines.push(formatRoomSummary(room));
    }
  }

  if (plan.overall_notes) {
    lines.push("");
    lines.push(`Notes: ${plan.overall_notes}`);
  }

  return lines.join("\n");
}

/**
 * Extract the matching room from an extracted floor plan, normalising
 * `room_type` so callers don't have to handle the lookup themselves.
 * Returns undefined when no floor plan exists or no room matches — and, just
 * as importantly, when MORE THAN ONE room matches.
 *
 * The ambiguity is routine, not exotic. A user's rooms are typed
 * `bedroom`/`bedroom_2`/`bedroom_3` (app/api/rooms/[roomId]/route.ts), while
 * the extractor's schema has only a generic `bedroom` bucket
 * (lib/prompts/floor-plan-extractor-prompt.ts), so a two-bedroom plan
 * legitimately carries two rooms of type `bedroom`. `find()` answered every
 * such lookup with the FIRST one, so diagnosing, sourcing, evaluating or
 * rendering Bedroom 2 was handed Bedroom 1's shape, wall features, light and
 * traffic notes — under a prompt header that calls the block AUTHORITATIVE.
 *
 * The prefix step is still a useful normalisation ("bedroom_2" → "bedroom")
 * and is kept; it is only refused when it cannot pick out a single room. Same
 * rule as lib/floor-plan/room-dimensions: an omitted floor-plan block makes
 * the model reason from the photos, which is honest; a confidently wrong one
 * it cannot detect.
 */
export function getRoomFromFloorPlan(
  plan: ExtractedFloorPlan | null | undefined,
  roomType: string,
): FloorPlanRoom | undefined {
  if (!plan) return undefined;
  return matchSingleRoom(plan.rooms, roomType);
}

/** The one room of this type, or undefined when there are none or several. */
function matchSingleRoom(
  rooms: readonly FloorPlanRoom[],
  roomType: string,
): FloorPlanRoom | undefined {
  const exact = rooms.filter(r => r.room_type === roomType);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;
  const prefix = roomType.split("_")[0];
  const partial = rooms.filter(r => r.room_type.startsWith(prefix));
  return partial.length === 1 ? partial[0] : undefined;
}
