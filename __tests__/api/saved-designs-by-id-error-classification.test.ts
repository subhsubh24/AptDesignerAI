import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Regression guard: GET /api/saved-designs/[id] used to collapse EVERY lookup
// failure — a genuine "zero rows" (PGRST116) miss AND a real database error —
// into the same 404 "Not found". A transient DB failure on a saved design read
// therefore looked identical to "this design doesn't exist", masking real
// infrastructure failures from both the client and any retry logic. Mirrors the
// PGRST116-branch pattern already established on the sibling GET routes
// (rooms/[roomId], projects/[projectId] — APT-15).

const { mockGetCurrentUserId, mockSingle } = vi.hoisted(() => ({
  mockGetCurrentUserId: vi.fn(),
  mockSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.single = mockSingle;
      return builder;
    }),
  })),
  getCurrentUserId: mockGetCurrentUserId,
}));

import { GET } from "@/app/api/saved-designs/[id]/route";

function ctx(id = "design-missing") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockGetCurrentUserId.mockReset();
  mockSingle.mockReset();
  mockGetCurrentUserId.mockResolvedValue("user-1");
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/saved-designs/[id]", () => {
  it("returns 404 when the row is missing (PGRST116)", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });
    const res = await GET(new NextRequest("http://localhost/api/saved-designs/design-missing"), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("returns 404 when the client reports no error but no data (defensive branch)", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(new NextRequest("http://localhost/api/saved-designs/design-missing"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns 500 with a generic message for a real database error, not 404", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "53300", message: "too many connections" },
    });
    const res = await GET(new NextRequest("http://localhost/api/saved-designs/design-1"), ctx("design-1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong. Please try again.");
    expect(body.error).not.toContain("too many connections");
  });

  it("returns the design on a real hit", async () => {
    mockSingle.mockResolvedValue({ data: { id: "design-1", title: "Cozy Bedroom" }, error: null });
    const res = await GET(new NextRequest("http://localhost/api/saved-designs/design-1"), ctx("design-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("design-1");
  });

  it("still requires authentication before touching the database", async () => {
    mockGetCurrentUserId.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/saved-designs/design-1"), ctx("design-1"));
    expect(res.status).toBe(401);
    expect(mockSingle).not.toHaveBeenCalled();
  });
});
