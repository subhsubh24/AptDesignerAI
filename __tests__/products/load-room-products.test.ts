import { describe, it, expect, vi, afterEach } from "vitest";

import { loadRoomProducts, ROOM_PRODUCTS_LOAD_ERROR } from "@/lib/products/load-room-products";

/**
 * The bug this module exists to make impossible: on the sourcing page, both
 * product hydrations run inside a `catch` written for something else (the SSE
 * branch's is there to skip a malformed `data:` line). A `fetch` that THREW was
 * therefore swallowed by a handler that had no idea what it was handling, and
 * the user — after minutes of waiting on a search that SUCCEEDED — landed on an
 * empty results page with no error and no retry.
 *
 * So the load must never throw, and it must report failure for every way the
 * request can go wrong, not just the non-OK one that was already handled.
 */

function mockFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadRoomProducts", () => {
  it("returns the array on a successful load", async () => {
    mockFetch(async () => jsonResponse([{ id: "p1" }, { id: "p2" }]));

    const result = await loadRoomProducts<{ id: string }>("room-1");

    expect(result).toEqual({ ok: true, products: [{ id: "p1" }, { id: "p2" }] });
  });

  it("treats an empty array as a SUCCESSFUL load, not a failure", async () => {
    // A search that legitimately found nothing must not show the retry error —
    // the page's own empty state is the right surface for that.
    mockFetch(async () => jsonResponse([]));

    expect(await loadRoomProducts("room-1")).toEqual({ ok: true, products: [] });
  });

  it("reports failure when the request THROWS — the regression this closes", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    // Must resolve, not reject: a rejection is exactly what the unrelated
    // catch block upstream used to absorb.
    await expect(loadRoomProducts("room-1")).resolves.toEqual({ ok: false });
  });

  it("reports failure on a non-OK response", async () => {
    mockFetch(async () => jsonResponse({ error: "boom" }, false, 500));

    expect(await loadRoomProducts("room-1")).toEqual({ ok: false });
  });

  it("reports failure when the body is not JSON", async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    }) as unknown as Response);

    expect(await loadRoomProducts("room-1")).toEqual({ ok: false });
  });

  it("reports failure when the body is JSON but not an array", async () => {
    // An error envelope must not be mistaken for a zero-product result.
    mockFetch(async () => jsonResponse({ error: "Not found" }));

    expect(await loadRoomProducts("room-1")).toEqual({ ok: false });
  });

  it("encodes the room id into the query string, with an abort signal so a hang cannot spin forever", async () => {
    const fn = mockFetch(async () => jsonResponse([]));

    await loadRoomProducts("a room/1&x=2");

    expect(fn).toHaveBeenCalledWith(
      "/api/products?room_id=a%20room%2F1%26x%3D2",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reports failure when the request is aborted (timeout) — not an infinite spinner", async () => {
    // A real timeout aborts the signal fetch was given, which a real fetch
    // implementation surfaces as a rejected promise. The generic-throw test
    // above already covers "any throw resolves to ok:false"; this confirms
    // that abort-shaped errors specifically hit that same path.
    mockFetch(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });

    await expect(loadRoomProducts("room-1")).resolves.toEqual({ ok: false });
  });

  it("exports copy that says matches WERE found", async () => {
    // The failure is hydration, not the search — copy that reads as "no
    // results" would be a lie about what happened.
    expect(ROOM_PRODUCTS_LOAD_ERROR).toMatch(/found matches/i);
    expect(ROOM_PRODUCTS_LOAD_ERROR).toMatch(/try again/i);
  });
});
