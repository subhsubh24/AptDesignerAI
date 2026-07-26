/**
 * Deterministic ordering for a room's embedded `room_images`.
 *
 * GET /api/rooms embeds `room_images(*)` so listing a project is one request
 * rather than 1 + N. Neither backend promises an order for an embedded
 * relation: PostgREST does not order embedded rows at all, and the in-memory
 * store returns them in insertion order. The dashboard renders `images[0]` as a
 * room's primary thumbnail, so an unordered array means the thumbnail a user
 * sees can change between two reads of unchanged data.
 *
 * `created_at` is the primary key of the order (oldest first — what the old
 * per-room images endpoint returned, so this is a behaviour-preserving move,
 * not a new choice). `id` is the final tiebreaker that
 * `.claude/rules/determinism.md` requires: two images uploaded inside the same
 * timestamp granularity would otherwise tie and be left in arrival order.
 *
 * Extracted from the dashboard rather than inlined so the ordering is reachable
 * by a test — inlined in a client component it was provably unguarded (removing
 * the sort left all 2319 tests green).
 */

/** A room_images row as embedded by GET /api/rooms. */
export interface EmbeddedRoomImage {
  id: string;
  image_url: string;
  storage_path: string;
  created_at?: string;
}

/** The shape the dashboard renders. */
export interface OrderedRoomImage {
  id: string;
  url: string;
  path: string;
}

export function orderRoomImages(
  images: EmbeddedRoomImage[] | undefined | null,
): OrderedRoomImage[] {
  return [...(images ?? [])]
    .sort(
      (a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id),
    )
    .map((img) => ({ id: img.id, url: img.image_url, path: img.storage_path }));
}
