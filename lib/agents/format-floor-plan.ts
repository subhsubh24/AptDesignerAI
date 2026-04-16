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

  // Find the primary room — prefer exact match, then fall back to partial
  const primaryRoom = roomType
    ? (plan.rooms.find(r => r.room_type === roomType) ?? plan.rooms.find(r => r.room_type.startsWith(roomType.split("_")[0])))
    : undefined;

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
 * Returns undefined when no floor plan exists or no room matches.
 */
export function getRoomFromFloorPlan(
  plan: ExtractedFloorPlan | null | undefined,
  roomType: string,
): FloorPlanRoom | undefined {
  if (!plan) return undefined;
  return (
    plan.rooms.find(r => r.room_type === roomType) ??
    plan.rooms.find(r => r.room_type.startsWith(roomType.split("_")[0]))
  );
}
