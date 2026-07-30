/**
 * Single source of truth for reading and writing the legacy
 * `building_research.floor_plan.room_dimensions` map.
 *
 * That map is keyed by `room_type` ("bedroom", "living_room"), so it can hold
 * at most ONE entry per type. Two consequences follow, and until this module
 * existed every consumer improvised its own answer to both — in four different
 * syntactic shapes, each of which could attribute one room's size to another:
 *
 *   1. ABSENT type. A room whose type has no entry has no known dimensions.
 *      Substituting a different room's — `dims[roomType] || dims.living_room`
 *      — puts a number on screen, into search sizing hints, into the mockup
 *      render prompt and into the deterministic math layer's veto, and every
 *      one of those treats it as authoritative. A home office is not the
 *      living room.
 *   2. DUPLICATE type. A two-bedroom apartment has two rooms of type
 *      "bedroom". Building the map with a plain assignment means the room
 *      written LAST silently answers for both, so the smaller bedroom is
 *      furnished to the larger one's floor area.
 *
 * Both are answered the same way here: when we cannot say WHICH room a number
 * belongs to, we say nothing. Callers already degrade well on a missing
 * dimension — the prompt builders omit the hint, `spatial-math` falls through
 * to its `estimated: true` sqft-ratio path — whereas a wrong dimension is a
 * lie the rest of the pipeline has no way to detect.
 *
 * Exact per-room dimensions ARE available on the structured
 * `extracted_floor_plan.rooms[]` (each row is a distinct room, not a type
 * bucket). Consumers that can reach that should prefer it; this module is for
 * the legacy map that the apartment-research path still produces.
 */

/** Normalise a room type to the map's key convention ("Living Room" → "living_room"). */
export function normalizeRoomTypeKey(roomType: string): string {
  return roomType.toLowerCase().trim().replace(/[\s-]+/g, "_");
}

/**
 * This room's dimension text, or `undefined` when the map cannot say.
 *
 * Exact-key only: never falls back to another room's entry. `undefined` means
 * "unknown", which every caller must render as an omission, not a guess.
 */
export function lookupRoomDimension(
  dims: Record<string, unknown> | null | undefined,
  roomType: string | null | undefined,
): string | undefined {
  if (!dims || !roomType) return undefined;
  const value = dims[normalizeRoomTypeKey(roomType)];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** A room as it appears on the structured extracted floor plan. */
export interface RoomDimensionSource {
  room_type?: string | null;
  dimensions_text?: string | null;
  sqft?: number | string | null;
}

/**
 * Build the legacy type-keyed map from the structured room list.
 *
 * A room type contributed by two or more rooms is AMBIGUOUS — the map has no
 * way to say which one a later lookup means — so it is omitted entirely rather
 * than resolved last-write-wins. Two rooms of the same type that report the
 * SAME text are not ambiguous (they agree), so that entry is kept.
 *
 * Deterministic: input order decides nothing except which duplicates are
 * compared, and the ambiguity rule is order-independent.
 */
export function buildRoomDimensionMap(
  rooms: readonly RoomDimensionSource[] | null | undefined,
  /** How to render a room that reports `sqft` but no `dimensions_text`. */
  formatSqft: (sqft: number | string) => string = (sqft) => `${sqft} sqft`,
): Record<string, string> {
  const byKey = new Map<string, string | null>(); // null marks an ambiguous key

  for (const room of rooms ?? []) {
    if (!room?.room_type) continue;
    const text =
      room.dimensions_text != null && String(room.dimensions_text).trim() !== ""
        ? String(room.dimensions_text)
        : room.sqft != null && String(room.sqft).trim() !== ""
          ? formatSqft(room.sqft)
          : null;
    if (text == null) continue;

    const key = normalizeRoomTypeKey(room.room_type);
    if (!byKey.has(key)) {
      byKey.set(key, text);
      continue;
    }
    const seen = byKey.get(key);
    // Already ambiguous, or a second room of this type disagrees → no claim.
    if (seen !== text) byKey.set(key, null);
  }

  const map: Record<string, string> = {};
  for (const [key, text] of byKey) {
    if (text != null) map[key] = text;
  }
  return map;
}
