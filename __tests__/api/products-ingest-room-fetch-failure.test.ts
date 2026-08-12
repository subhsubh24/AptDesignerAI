import { describe, expect, it, vi, type Mock } from "vitest";

// Regression guard: POST /api/products/ingest used to discard both the room
// and project fetch's `.error`, silently proceeding with null room/project
// context (and losing roomImageUrls — the vision call's grounding for
// visual_style_tags) on any DB error, even though requireRoomOwnership()
// had already verified this exact row moments earlier. Independent review
// caught that the room-fetch half deserved a hard failure (matching
// area-analysis/refine-chat/route.ts's identical room-fetch precedent),
// while the project-fetch half correctly stays log-and-continue (it only
// personalizes the design profile). This test asserts both halves of that
// split directly: a room-fetch error returns 500 and never reaches the paid
// extraction call; a project-fetch error still completes the extraction.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn(async () => null) }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { productsIngest: { maxRequests: 20, windowMs: 3_600_000 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));
vi.mock("@/lib/utils/url-validator", () => ({
  validateExternalUrl: vi.fn(() => ({ valid: true })),
}));
vi.mock("@/lib/db/agent-runs", () => ({
  createAgentRun: vi.fn(async () => ({ id: "run-1" })),
  completeAgentRun: vi.fn(async () => {}),
}));
const mockExtractFromUrl = vi.fn(async () => ({
  success: true,
  data: { title: "Lamp", category: "lighting", retailer: "Foo" },
}));
vi.mock("@/lib/agents/product-extractor", () => ({
  extractFromUrl: mockExtractFromUrl,
  extractFromImage: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

const mockCreateClient = createClient as unknown as Mock;

const ROOM_ID = "room-1";

function jsonReq(): Request {
  return new Request("http://localhost/api/products/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room_id: ROOM_ID, url: "https://example.com/product" }),
  });
}

function makeClient(opts: { roomError?: { message: string }; projectError?: { message: string } }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(() =>
          Promise.resolve(
            opts.roomError
              ? { data: null, error: opts.roomError }
              : { data: { project_id: "proj-1", room_images: [] }, error: null },
          ),
        );
        return chain;
      }
      if (table === "projects") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(() =>
          Promise.resolve(
            opts.projectError
              ? { data: null, error: opts.projectError }
              : { data: { id: "proj-1" }, error: null },
          ),
        );
        return chain;
      }
      if (table === "candidate_products") {
        const chain: Record<string, unknown> = {};
        chain.insert = vi.fn(() => chain);
        chain.select = vi.fn(() => chain);
        chain.single = vi.fn(() => Promise.resolve({ data: { id: "product-1" }, error: null }));
        return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("POST /api/products/ingest — room vs project fetch failure", () => {
  it("hard-fails with 500 and never calls the paid extractor when the room fetch errors", async () => {
    mockExtractFromUrl.mockClear();
    mockCreateClient.mockResolvedValue(makeClient({ roomError: { message: "connection reset" } }));
    const { POST } = await import("@/app/api/products/ingest/route");

    const res = await POST(jsonReq());

    expect(res.status).toBe(500);
    expect(mockExtractFromUrl).not.toHaveBeenCalled();
  });

  it("still completes extraction when only the project fetch errors", async () => {
    mockExtractFromUrl.mockClear();
    mockCreateClient.mockResolvedValue(makeClient({ projectError: { message: "connection reset" } }));
    const { POST } = await import("@/app/api/products/ingest/route");

    const res = await POST(jsonReq());

    expect(res.status).toBe(201);
    expect(mockExtractFromUrl).toHaveBeenCalledTimes(1);
  });
});
