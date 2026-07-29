/**
 * Load the products a completed search persisted for a room.
 *
 * This exists as its own module for one reason: BOTH callers on the sourcing
 * page hydrate products from inside a `catch` that was written for something
 * else. The SSE branch's enclosing try/catch is there to skip a malformed
 * `data:` line ("Skip malformed JSON"); the batch-fallback branch sits inside
 * the outer network catch. So a `fetch` that THROWS — a dropped connection, a
 * DNS blip, an aborted navigation — was swallowed by a handler that had no
 * idea it was handling a product load, and the page fell through to the
 * results step with zero products, no error and no retry. The search had
 * SUCCEEDED; only the hydration failed, and the UI reported "no results" after
 * the user had been waiting minutes.
 *
 * A non-OK response was already handled at both sites. A thrown one was not,
 * and only at one of them — the asymmetry is the bug. Returning a
 * discriminated result rather than throwing makes the failure impossible to
 * swallow by accident: there is no throw to catch, so every caller must look
 * at `ok`.
 */

/** Failure is deliberately opaque: every caller shows the same copy. */
export type RoomProductsResult<T> = { ok: true; products: T[] } | { ok: false };

/**
 * User-facing copy for a failed hydration. The search DID find matches — say
 * so, so the message doesn't read as "we found nothing".
 */
export const ROOM_PRODUCTS_LOAD_ERROR =
  "We found matches but couldn't load them. Please try again.";

export async function loadRoomProducts<T>(roomId: string): Promise<RoomProductsResult<T>> {
  try {
    const res = await fetch(`/api/products?room_id=${encodeURIComponent(roomId)}`);
    if (!res.ok) return { ok: false };
    const body = await res.json().catch(() => null);
    // The route returns a bare array. Anything else (an error envelope, an
    // HTML error page parsed as JSON) is a failure, not an empty result.
    return Array.isArray(body) ? { ok: true, products: body as T[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}
