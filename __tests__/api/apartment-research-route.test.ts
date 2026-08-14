import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * APT-31: app/api/apartment-research/route.ts had zero direct test coverage
 * on a 1068-line core-pipeline route with a project-ownership IDOR guard.
 * Scoped per the issue's own fix direction to: IDOR rejection, the happy
 * path, a non-fatal vision-analysis failure, and DB persistence-error
 * logging — not full multi-pass coverage of every branch in one session.
 *
 * Mocks only the provider/DB/auth boundaries (createClient, geminiProvider,
 * requireProjectOwnership, rate/spend limiters); the real route handler,
 * JSON parsing, Zod validation, and matchUnitVariant all run for real.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ requireProjectOwnership: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ geminiProvider: { chat: vi.fn() } }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  RATE_LIMITS: { apartmentResearch: { maxRequests: 3, windowMs: 3_600_000 } },
}));
vi.mock("@/lib/utils/spend-limiter", () => ({
  checkDailySpend: vi.fn(() => ({ allowed: true })),
  dailySpendExceededResponse: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireProjectOwnership } from "@/lib/auth/ownership";
import { geminiProvider } from "@/lib/ai/gemini";
import { POST as apartmentResearchPost } from "@/app/api/apartment-research/route";
import { NextResponse } from "next/server";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireProjectOwnership = requireProjectOwnership as unknown as Mock;
const mockChat = (geminiProvider as unknown as { chat: Mock }).chat;

const USER_ID = "user-1";
const PROJECT_ID = "proj-1";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/apartment-research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function chatResponse(body: unknown) {
  return { content: JSON.stringify(body), model: "cassette-model", usage: { input_tokens: 10, output_tokens: 10, thinking_tokens: 0 } };
}

/**
 * Builds a Supabase stub covering every table this route touches:
 *  - `projects`: `.select("building_research").eq(id).maybeSingle()` (the
 *    user-uploaded-floor-plan check) AND `.update(...).eq(id)` (the final
 *    persistence — configurable error).
 *  - `room_images`: only reached when a floor-plan pass finds variants.
 */
function makeClient(opts: { updateError?: { message: string } | null } = {}) {
  const updateSpy = vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve({ error: opts.updateError ?? null })),
  }));
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: vi.fn((table: string) => {
      if (table === "projects") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
        chain.update = updateSpy;
        return chain;
      }
      if (table === "room_images") {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "limit"]) chain[m] = vi.fn(() => chain);
        // room_images is awaited directly (no .single()/.maybeSingle())
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
        return chain;
      }
      return {};
    }),
    _updateSpy: updateSpy,
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireProjectOwnership.mockReset();
  mockRequireProjectOwnership.mockResolvedValue(null);
  mockChat.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/apartment-research", () => {
  it("rejects with the ownership guard's response when the caller doesn't own project_id, and never calls the model", async () => {
    const rejection = NextResponse.json({ error: "Not found" }, { status: 404 });
    mockRequireProjectOwnership.mockResolvedValue(rejection);
    mockCreateClient.mockResolvedValue(makeClient());

    const res = await apartmentResearchPost(
      jsonReq({ building_name: "The Marlowe", project_id: PROJECT_ID }),
    );

    expect(res.status).toBe(404);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("happy path: researches the building and persists the result to the project", async () => {
    mockCreateClient.mockResolvedValue(makeClient());
    mockChat
      .mockResolvedValueOnce(chatResponse({ building_style: "Modern industrial", finishes: {}, summary: "A nice building." })) // context pass
      .mockResolvedValueOnce(chatResponse({})) // floor-plan pass — no variants
      .mockResolvedValueOnce(chatResponse({})); // maps enrichment pass

    const res = await apartmentResearchPost(
      jsonReq({ building_name: "The Marlowe", project_id: PROJECT_ID, bedrooms: 1, bathrooms: 1 }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.research.building_style).toBe("Modern industrial");
    expect(mockChat).toHaveBeenCalledTimes(3);
  });

  it("a failed vision pass on a single floor-plan variant does not fail the request (non-fatal)", async () => {
    mockCreateClient.mockResolvedValue(makeClient());
    mockChat
      .mockResolvedValueOnce(chatResponse({ building_style: "Modern industrial" })) // context pass
      .mockResolvedValueOnce(
        chatResponse({
          floor_plan: {
            unit_variants: [{ name: "A1", sqft: "700", floor_plan_image_url: "https://example.test/fp.png" }],
          },
        }),
      ) // floor-plan pass — one variant with an image URL, so vision runs
      .mockRejectedValueOnce(new Error("vision model unavailable")) // vision pass fails
      .mockResolvedValueOnce(chatResponse({})); // maps enrichment pass

    const res = await apartmentResearchPost(
      jsonReq({ building_name: "The Marlowe", project_id: PROJECT_ID }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // Single variant -> matchUnitVariant short-circuits without calling the
    // model again, so exactly 4 chat calls: context, floor-plan, vision, maps.
    expect(mockChat).toHaveBeenCalledTimes(4);
    expect(body.research.floor_plan.matched_unit.match_method).toBe("single_variant");
    // The failed vision pass must not have been silently treated as data.
    expect(body.research.floor_plan.vision_analysis).toBeUndefined();
  });

  it("logs and returns 500 (without fabricating success) when saving the researched result to the project fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateClient.mockResolvedValue(makeClient({ updateError: { message: "connection reset" } }));
    mockChat
      .mockResolvedValueOnce(chatResponse({ building_style: "Modern industrial" }))
      .mockResolvedValueOnce(chatResponse({}))
      .mockResolvedValueOnce(chatResponse({}));

    const res = await apartmentResearchPost(
      jsonReq({ building_name: "The Marlowe", project_id: PROJECT_ID }),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/couldn't save it to your project/i);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[apartment-research] failed to save research to project:"),
      "connection reset",
    );

    consoleErrorSpy.mockRestore();
  });
});
