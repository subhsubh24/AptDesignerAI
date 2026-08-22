import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The regression this guards: app/projects/[projectId]/page.tsx fetched a
// project's rooms via an embedded `select("*, rooms(*))` with no bound on the
// embedded resource. PostgREST embeds are unbounded by default, so an account
// with an unusually large number of rooms in one project would load and
// render every one of them with no cap and no deterministic ordering — the
// same class of bug APT-41 fixed for the picks/area-analysis routes' sibling-
// room queries. This asserts the embed is both capped and ordered, mirroring
// APT-41's own regression tests.

const mockSingle = vi.fn();
const mockLimit = vi.fn();
const mockOrder = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = (...args: unknown[]) => {
        mockOrder(...args);
        return builder;
      };
      builder.limit = (...args: unknown[]) => {
        mockLimit(...args);
        return builder;
      };
      builder.single = () => {
        mockSingle();
        return Promise.resolve({
          data: { id: "proj-1", name: "My Apartment", description: null, rooms: [] },
          error: null,
        });
      };
      return builder;
    }),
  })),
}));

import ProjectPage from "@/app/projects/[projectId]/page";

beforeEach(() => {
  mockSingle.mockReset();
  mockLimit.mockReset();
  mockOrder.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("ProjectPage — rooms embed is bounded (APT-41-class fix)", () => {
  it("bounds the embedded rooms fetch with a .limit() on the referenced table", async () => {
    await ProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) });
    expect(mockLimit).toHaveBeenCalledWith(100, { referencedTable: "rooms" });
  });

  it("orders the embedded rooms fetch before limiting it, so the cap drops a deterministic subset", async () => {
    await ProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) });
    expect(mockOrder).toHaveBeenCalledWith("created_at", { referencedTable: "rooms", ascending: false });
  });
});
