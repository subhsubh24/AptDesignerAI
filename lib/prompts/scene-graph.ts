/**
 * Prompt for multi-view room scene assembly.
 *
 * The model receives EVERY photo of one room at once (indexed 0..N-1, plus an
 * optional authoritative floor plan) and must produce ONE canonical object per
 * real object — explicitly merging the same piece seen from different angles —
 * along with the room's spatial layout and how well the photos cover the space.
 *
 * Deterministic reconciliation runs on top of this (scene-reconciliation.ts), so
 * the prompt asks the model to merge but the system never relies on it doing so
 * perfectly.
 */

export function getSceneAssemblyPrompt(
  roomType: string,
  photoCount: number,
  hasFloorPlan: boolean,
  keepItems: string[],
  replaceItems: string[],
  userContext?: string | null,
): string {
  const floorPlanNote = hasFloorPlan
    ? `The FIRST image is an authoritative floor plan — use it as ground truth for room shape, wall directions, and dimensions. The remaining ${photoCount} images are photos of the room.`
    : `All ${photoCount} images are photos of the same room, taken from different angles.`;

  const keepNote = keepItems.length
    ? `\nThe user wants to KEEP: ${keepItems.join(", ")}. Mark matching objects disposition="keep".`
    : "";
  const replaceNote = replaceItems.length
    ? `\nThe user wants to REPLACE: ${replaceItems.join(", ")}. Mark matching objects disposition="replace".`
    : "";
  const ctxNote = userContext?.trim()
    ? `\nUser notes about these photos: "${userContext.trim()}" — respect them (e.g. ignore items they say to ignore).`
    : "";

  return `You are assembling a single holistic understanding of one ${roomType.replace(/_/g, " ")} from multiple photographs.

${floorPlanNote}

These photos OVERLAP — the same wall, corner, and furniture appear in several shots from different angles, distances, and lighting. Your job is to reconstruct the room as ONE coherent space, not to describe each photo separately.

CRITICAL RULES:
1. **One object, not one-per-angle.** If the same sofa appears in photos 0, 2, and 4, output it ONCE as a single object whose "observed_in" lists image_index 0, 2, and 4. Never emit the same physical object multiple times.
2. **Reconcile across views.** Use the clearest angle for each attribute: read color/material from the close, well-lit shot; read placement and scale from the wide shot. If lighting makes a color look different across angles, pick the most neutral one.
3. **Localize when you can.** For each observation, give a normalized bounding box {x,y,w,h} in 0..1 for where the object sits in THAT photo. Omit (null) if you can't.
4. **Spatial layout.** In "relations", capture how objects sit relative to each other and the walls ("left_of", "facing", "adjacent_to", "in_corner", "on"). Use object categories or wall directions (north/south/east/west) as endpoints.
5. **Coverage honesty.** In "coverage", list which walls/areas the photos actually show ("walls_observed") and which are never visible ("gaps"). If a wall or corner is never shown, say so — do not invent what's there.
6. **Holistic summary.** Write a one-paragraph "summary" describing the whole space as a person standing in it would experience it, integrating all angles.${keepNote}${replaceNote}${ctxNote}

Return ONLY a JSON object with this exact shape:
{
  "summary": "<one paragraph integrating all angles>",
  "objects": [
    {
      "category": "<slug e.g. sofa, kitchen_island, pendant_light>",
      "label": "<short human label e.g. 'grey 3-seat sectional'>",
      "observed_in": [{ "image_index": <int>, "view": "<e.g. wide from doorway>", "bounding_box": {"x":0,"y":0,"w":0,"h":0} }],
      "materials": ["..."],
      "colors": ["..."],
      "dimensions": { "width_in": <num>, "depth_in": <num>, "height_in": <num> },
      "placement": "<e.g. against north wall, left of window>",
      "disposition": "keep" | "replace" | "unknown",
      "condition": "<optional>",
      "confidence": <0..1>
    }
  ],
  "relations": [{ "subject": "<category or wall>", "relation": "<left_of|facing|...>", "object": "<category or wall>" }],
  "coverage": {
    "walls_observed": ["north", "east"],
    "gaps": ["south wall", "ceiling"],
    "estimated_coverage": <0..1>,
    "suggested_shots": ["Add a photo of the south wall"]
  }
}`;
}
