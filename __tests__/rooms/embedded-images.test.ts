import { describe, expect, it } from "vitest";
import { orderRoomImages, type EmbeddedRoomImage } from "@/lib/rooms/embedded-images";

/**
 * The determinism guard for a room's embedded images.
 *
 * GET /api/rooms embeds room_images(*) to avoid a 1 + N fetch, but neither
 * backend orders an embedded relation — PostgREST does not order them at all,
 * the memory store returns insertion order. The dashboard renders images[0] as
 * the room's primary thumbnail, so without an explicit order the thumbnail a
 * user sees can change between two reads of unchanged data.
 *
 * This existed as an inline sort in the client component and was provably
 * unguarded: a reviewer deleted it and all 2319 tests still passed.
 */

const img = (id: string, created_at?: string): EmbeddedRoomImage => ({
  id,
  image_url: `/uploads/${id}.jpg`,
  storage_path: `${id}.jpg`,
  created_at,
});

describe("orderRoomImages", () => {
  it("orders by created_at ascending regardless of arrival order", () => {
    const ordered = orderRoomImages([
      img("c", "2026-03-01"),
      img("a", "2026-01-01"),
      img("b", "2026-02-01"),
    ]);
    expect(ordered.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a created_at tie on id, so equal timestamps are still deterministic", () => {
    // The case the tiebreaker exists for: two uploads inside the same timestamp
    // granularity. Without it these keep arrival order, which differs per read.
    const arrivalOne = orderRoomImages([img("z", "2026-01-01"), img("y", "2026-01-01")]);
    const arrivalTwo = orderRoomImages([img("y", "2026-01-01"), img("z", "2026-01-01")]);
    expect(arrivalOne.map((i) => i.id)).toEqual(["y", "z"]);
    expect(arrivalOne).toEqual(arrivalTwo);
  });

  it("keeps a missing created_at ordered ahead of a stamped one, and still deterministic", () => {
    // `?? ""` sorts undefined first rather than throwing; pin that so a future
    // change to the fallback is a visible decision, not a silent reshuffle.
    const ordered = orderRoomImages([img("b", "2026-01-01"), img("a")]);
    expect(ordered.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("maps to the dashboard's render shape", () => {
    expect(orderRoomImages([img("a", "2026-01-01")])).toEqual([
      { id: "a", url: "/uploads/a.jpg", path: "a.jpg" },
    ]);
  });

  it("does not mutate the caller's array", () => {
    // The dashboard reads room.room_images straight off the API response; an
    // in-place sort would reorder that object for every later reader.
    const input = [img("c", "2026-03-01"), img("a", "2026-01-01")];
    orderRoomImages(input);
    expect(input.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("treats a missing or empty relation as no images", () => {
    expect(orderRoomImages(undefined)).toEqual([]);
    expect(orderRoomImages(null)).toEqual([]);
    expect(orderRoomImages([])).toEqual([]);
  });
});
