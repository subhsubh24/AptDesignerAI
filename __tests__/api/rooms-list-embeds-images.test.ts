import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// The regression this guards: GET /api/rooms used to select("*"), so the
// dashboard had to fire one GET /api/rooms/[roomId]/images per room to render
// a project — 1 + N requests, each re-running auth.getUser() and its own
// ownership check. The fix embeds room_images in the list query. Reverting to
// a bare select("*") would compile, pass every other test, and silently
// reintroduce the N+1 while the dashboard rendered zero thumbnails, so the
// select string itself is what this asserts.

const mockGetUser = vi.fn();
const mockSelect = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = (columns: string) => {
        mockSelect(columns);
        return builder;
      };
      builder.eq = chain;
      builder.order = chain;
      builder.range = () => ({ data: ROOMS, error: null });
      return builder;
    }),
  })),
}));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsProject: vi.fn(async () => true) }));

import { userOwnsProject } from "@/lib/auth/ownership";
import { GET } from "@/app/api/rooms/route";

const ROOMS = [
  {
    id: "room-1",
    project_id: "proj-1",
    room_type: "living_room",
    status: "setup",
    room_images: [
      { id: "img-a", image_url: "/uploads/a.jpg", storage_path: "a.jpg", created_at: "2026-01-01" },
    ],
  },
];

const mockOwns = userOwnsProject as unknown as Mock;

function req(projectId = "proj-1") {
  return new NextRequest(`http://localhost/api/rooms?project_id=${projectId}`);
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockSelect.mockReset();
  mockOwns.mockReset();
  mockOwns.mockResolvedValue(true);
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/rooms", () => {
  it("embeds room_images so listing rooms is ONE request, not 1 + N", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockSelect).toHaveBeenCalledWith("*, room_images(*)");
  });

  it("returns each room's images inline", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body[0].room_images).toHaveLength(1);
    expect(body[0].room_images[0].image_url).toBe("/uploads/a.jpg");
  });

  it("still requires authentication before touching the database", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("still 404s a project the caller does not own, without querying rooms", async () => {
    mockOwns.mockResolvedValue(false);
    const res = await GET(req("someone-elses-project"));
    expect(res.status).toBe(404);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
