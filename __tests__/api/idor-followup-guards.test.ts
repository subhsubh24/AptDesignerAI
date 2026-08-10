import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Regression guard for the two IDOR gaps the Run-73 pass left open and the
// independent QUALITY_SCORECARD named:
//   1. GET /api/area-analysis read another user's diagnosis by a client room_id
//      with no userOwnsRoom guard (its POST + refine-chat siblings were guarded).
//   2. POST /api/products/evaluate verified room ownership but never bound the
//      client-supplied product_id to that room, so a caller who owns room A could
//      pass another user's candidate product_id and have it read + scored.
// The runtime data layer is not user-scoped (RLS inert), so these app-layer
// guards are the sole cross-tenant boundary.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  getCurrentUserId: vi.fn(),
}));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn() }));
// Guard must fire BEFORE the paid per-product scoring — spy so we can assert it.
vi.mock("@/lib/agents/fit-scorer", () => ({ scoreProduct: vi.fn() }));

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { scoreProduct } from "@/lib/agents/fit-scorer";
import { GET as areaAnalysisGet } from "@/app/api/area-analysis/route";
import { POST as productsEvaluatePost } from "@/app/api/products/evaluate/route";

const mockCreateClient = createClient as unknown as Mock;
const mockRequireRoomOwnership = requireRoomOwnership as unknown as Mock;
const mockScoreProduct = scoreProduct as unknown as Mock;
const notFoundResponse = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** A chainable query stub whose terminal read resolves to `result`. */
function queryStub(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "neq", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ error: null, ...result });
  chain.maybeSingle = vi.fn().mockResolvedValue({ error: null, ...result });
  chain.then = (res: (v: unknown) => unknown) => res({ error: null, ...result });
  return chain;
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockRequireRoomOwnership.mockReset();
  mockScoreProduct.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/area-analysis ownership guard", () => {
  it("404s a non-owner without reading the diagnosis", async () => {
    const fromSpy = vi.fn(() => queryStub({ data: null }));
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "attacker-1" } } }) },
      from: fromSpy,
    });
    mockRequireRoomOwnership.mockResolvedValue(notFoundResponse());

    const res = await areaAnalysisGet(
      new NextRequest("http://localhost/api/area-analysis?room_id=victim-room"),
    );

    expect(res.status).toBe(404);
    expect(mockRequireRoomOwnership).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-1");
    // The guard runs before any diagnosis read — the private table is never touched.
    expect(fromSpy).not.toHaveBeenCalledWith("room_diagnoses");
  });

  it("serves the analysis to the owner (guard does not break the happy path)", async () => {
    const djson = { what_it_needs: [{ item: "rug" }] };
    const fromSpy = vi.fn(() => queryStub({ data: { diagnosis_json: djson } }));
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
      from: fromSpy,
    });
    mockRequireRoomOwnership.mockResolvedValue(null);

    const res = await areaAnalysisGet(
      new NextRequest("http://localhost/api/area-analysis?room_id=own-room"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ analysis: djson });
    expect(fromSpy).toHaveBeenCalledWith("room_diagnoses");
  });
});

describe("POST /api/products/evaluate product↔room binding", () => {
  function evaluateBody(room_id: string, product_id = "p-1") {
    return new Request("http://localhost/api/products/evaluate", {
      method: "POST",
      body: JSON.stringify({ product_id, room_id }),
    });
  }

  it("404s a non-owner before fetching or scoring the product", async () => {
    const fromSpy = vi.fn(() => queryStub({ data: null }));
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "attacker-1" } } }) },
      from: fromSpy,
    });
    mockRequireRoomOwnership.mockResolvedValue(notFoundResponse());

    const res = await productsEvaluatePost(evaluateBody("victim-room"));

    expect(res.status).toBe(404);
    expect(mockRequireRoomOwnership).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-1");
    expect(fromSpy).not.toHaveBeenCalledWith("candidate_products");
    expect(mockScoreProduct).not.toHaveBeenCalled();
  });

  it("404s when the product belongs to a different room, even for a room the caller owns", async () => {
    // Caller owns "attacker-room" but passes a product_id whose room_id is the
    // victim's room — the guard must reject it before any scoring happens.
    const fromSpy = vi.fn((table: string) => {
      if (table === "candidate_products") {
        return queryStub({ data: { id: "p-1", room_id: "victim-room", title: "secret sofa" } });
      }
      return queryStub({ data: { id: "attacker-room", project_id: "proj-1", room_images: [] } });
    });
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "attacker-1" } } }) },
      from: fromSpy,
    });
    mockRequireRoomOwnership.mockResolvedValue(null); // caller genuinely owns attacker-room

    const res = await productsEvaluatePost(evaluateBody("attacker-room"));

    expect(res.status).toBe(404);
    // The product was read (to learn its room_id) but never scored — the paid
    // LLM call is gated behind the binding check.
    expect(mockScoreProduct).not.toHaveBeenCalled();
  });
});
