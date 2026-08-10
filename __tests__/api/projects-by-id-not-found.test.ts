import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard for APT-15: GET /api/projects/[projectId] used to return
// every `.single()` error as a 500 — including the ordinary "project doesn't
// exist / isn't owned by this user" PGRST116 case — instead of a 404, unlike
// the sibling GET /api/rooms/[roomId] route which already branches on the
// error code. A silent revert to the unconditional `apiError(scope, error)`
// call would compile and pass every other test while every "not found" lookup
// on this route came back as a client-facing 500.

const mockGetUser = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.single = mockSingle;
      return builder;
    }),
  })),
}));

import { GET } from "@/app/api/projects/[projectId]/route";

function ctx(projectId = "proj-missing") {
  return { params: Promise.resolve({ projectId }) };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockSingle.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/projects/[projectId]", () => {
  it("returns 404, not 500, when the row is missing (PGRST116)", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });
    const res = await GET(new Request("http://localhost/api/projects/proj-missing"), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("returns 404, not 500, for a project owned by someone else (same PGRST116 shape)", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });
    const res = await GET(new Request("http://localhost/api/projects/someone-elses"), ctx("someone-elses"));
    expect(res.status).toBe(404);
  });

  it("still returns 500 with a generic message for a real database error", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "53300", message: "too many connections" },
    });
    const res = await GET(new Request("http://localhost/api/projects/proj-1"), ctx("proj-1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Something went wrong. Please try again.");
    expect(body.error).not.toContain("too many connections");
  });

  it("returns the project on a real hit", async () => {
    mockSingle.mockResolvedValue({ data: { id: "proj-1", name: "My Apartment" }, error: null });
    const res = await GET(new Request("http://localhost/api/projects/proj-1"), ctx("proj-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("proj-1");
  });

  it("still requires authentication before touching the database", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(new Request("http://localhost/api/projects/proj-1"), ctx("proj-1"));
    expect(res.status).toBe(401);
    expect(mockSingle).not.toHaveBeenCalled();
  });
});
