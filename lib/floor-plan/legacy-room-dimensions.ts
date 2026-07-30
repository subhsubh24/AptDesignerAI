/**
 * The legacy `building_research.floor_plan.room_dimensions` map — and why it
 * must refuse to answer for an ambiguous room type.
 *
 * Every reader of this map looks a room up BY ITS TYPE:
 *   - app/api/mockups/route.ts (render prompt + building context)
 *   - app/api/search/route.ts, app/api/search/stream/route.ts (sizing hints)
 *   - the focus page's "This room: ~12 × 15 ft" line
 * The mockup reader even states the invariant out loud: "Prefer the exact
 * room's dimension; do NOT fall back to another room's dims."
 *
 * A type-keyed map cannot honour that invariant for an apartment with two
 * bedrooms. Building it with a plain `map[room.room_type] = dimensions_text`
 * loop lets the LAST bedroom win, so the FIRST bedroom is silently told it is
 * the size of a different room — wrong furniture scale in its mockup, wrong
 * sizing in its product search, and a confidently wrong number on screen.
 *
 * The exact per-room data lives in `extracted_floor_plan.rooms` and every
 * reader prefers it; this map is only the fallback. So the fix is not a new
 * key shape (that would break all four readers) — it is for the fallback to
 * stay SILENT where it cannot be attributed. Omitting a type costs a hint;
 * keeping it costs a wrong answer presented as a fact.
 */

export interface LegacyDimensionsSource {
  room_type: string;
  dimensions_text?: string;
}

export interface LegacyRoomDimensions {
  /** Types that resolve to exactly one dimension string. */
  dimensions: Record<string, string>;
  /**
   * Types carrying two or more DIFFERENT dimension strings. Deliberately
   * excluded from `dimensions` — and removed from any previously stored map,
   * since a stale value for a now-ambiguous type is just as unattributable.
   */
  ambiguousTypes: string[];
}

/**
 * Collapse extracted rooms into the legacy type-keyed map, dropping any type
 * whose rooms disagree about their size.
 *
 * Two rooms of the same type that report the SAME dimensions are not
 * ambiguous — collapsing them loses nothing, so the hint is kept.
 */
export function buildLegacyRoomDimensions(
  rooms: ReadonlyArray<LegacyDimensionsSource> | undefined | null,
): LegacyRoomDimensions {
  const distinctByType = new Map<string, Set<string>>();

  for (const room of rooms ?? []) {
    const text = room?.dimensions_text?.trim();
    if (!text) continue;
    const type = room.room_type?.trim();
    if (!type) continue;
    const seen = distinctByType.get(type);
    if (seen) seen.add(text);
    else distinctByType.set(type, new Set([text]));
  }

  const dimensions: Record<string, string> = {};
  const ambiguousTypes: string[] = [];

  for (const [type, values] of distinctByType) {
    if (values.size === 1) {
      dimensions[type] = [...values][0];
    } else {
      ambiguousTypes.push(type);
    }
  }

  return { dimensions, ambiguousTypes };
}

/**
 * Merge a freshly extracted floor plan into the stored legacy map.
 *
 * Existing entries are preserved (a re-upload that no longer sees a room
 * should not erase what we knew about it), newly resolved types overwrite,
 * and ambiguous types are REMOVED — including one a previous single-room
 * extraction had stored, which would otherwise keep answering for every room
 * of that type.
 */
export function mergeLegacyRoomDimensions(
  existing: Record<string, unknown> | undefined | null,
  rooms: ReadonlyArray<LegacyDimensionsSource> | undefined | null,
): Record<string, unknown> {
  const { dimensions, ambiguousTypes } = buildLegacyRoomDimensions(rooms);
  const merged: Record<string, unknown> = { ...(existing ?? {}), ...dimensions };
  for (const type of ambiguousTypes) delete merged[type];
  return merged;
}
