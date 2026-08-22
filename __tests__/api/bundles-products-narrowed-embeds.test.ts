import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// The regression this guards (APT-48): GET /api/bundles and GET /api/products
// used to embed nested rows with a bare `(*)` — every column of every
// candidate_products row (description, metadata, dimensions, colors,
// materials...) for EVERY item of EVERY bundle, and every column of every
// product_evaluations row for EVERY product. Neither is a security bug (RLS +
// ownership already guard it) — it's pure over-fetch that adds parse/render
// latency on rooms with many bundle items / products. The fix narrows both
// nested embeds to the columns the client actually reads. Reverting either
// select to `(*)` would compile, pass every other test, and silently
// reintroduce the over-fetch, so the exact select string is what this
// asserts — mirrors __tests__/api/rooms-list-embeds-images.test.ts.

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
      builder.range = () => ({ data: ROWS, error: null });
      return builder;
    }),
  })),
}));
vi.mock("@/lib/auth/ownership", () => ({ requireRoomOwnership: vi.fn(async () => null) }));

import { requireRoomOwnership } from "@/lib/auth/ownership";
import { GET as bundlesGet } from "@/app/api/bundles/route";
import { GET as productsGet } from "@/app/api/products/route";

const ROWS: unknown[] = [];

const mockOwns = requireRoomOwnership as unknown as Mock;

function req(path: string, roomId = "room-1") {
  return new NextRequest(`http://localhost${path}?room_id=${roomId}`);
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockSelect.mockReset();
  mockOwns.mockReset();
  mockOwns.mockResolvedValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/bundles", () => {
  it("narrows the nested embeds to only the columns bundles/page.tsx reads", async () => {
    const res = await bundlesGet(req("/api/bundles"));
    expect(res.status).toBe(200);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    const selectArg = mockSelect.mock.calls[0][0] as string;

    // Top-level product_bundles select stays "*" — only the nested embeds
    // are the over-fetch this issue targets.
    expect(selectArg.startsWith("*, product_bundle_items(")).toBe(true);

    // Nested candidate_products embed: narrowed, not "(*)".
    expect(selectArg).toContain(
      "candidate_products(id, title, category, image_url, price)",
    );
    expect(selectArg).not.toContain("candidate_products(*)");

    // Nested bundle_evaluations embed: narrowed, not "(*)".
    expect(selectArg).toContain("bundle_evaluations(final_bundle_score");
    expect(selectArg).not.toContain("bundle_evaluations(*)");
    // Fields the bundles page radar chart / analysis panel / room-vibe
    // section actually render must survive the narrowing.
    for (const field of [
      "final_bundle_score",
      "palette_harmony_score",
      "material_balance_score",
      "scale_balance_score",
      "style_consistency_score",
      "room_completion_score",
      "practicality_score",
      "analysis",
      "room_vibe",
    ]) {
      expect(selectArg).toContain(field);
    }
  });

  it("still requires authentication before touching the database", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await bundlesGet(req("/api/bundles"));
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("GET /api/products", () => {
  it("narrows the nested product_evaluations embed to only the columns the client reads", async () => {
    const res = await productsGet(req("/api/products"));
    expect(res.status).toBe(200);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    const selectArg = mockSelect.mock.calls[0][0] as string;

    // Top-level candidate_products select stays "*".
    expect(selectArg.startsWith("*, product_evaluations(")).toBe(true);
    expect(selectArg).not.toContain("product_evaluations(*)");

    // Fields products/page.tsx, compare/page.tsx, and focus/page.tsx read
    // (score bars, verdict badge, top reasons/risks, sort/compare columns)
    // must survive the narrowing.
    for (const field of [
      "final_item_score",
      "verdict",
      "confidence_score",
      "style_fit_score",
      "palette_fit_score",
      "material_fit_score",
      "scale_fit_score",
      "function_fit_score",
      "cohesion_fit_score",
      "value_fit_score",
      "reasoning",
    ]) {
      expect(selectArg).toContain(field);
    }
  });

  it("still requires authentication before touching the database", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await productsGet(req("/api/products"));
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("still 404s a room the caller does not own, without querying products", async () => {
    const { NextResponse } = await import("next/server");
    mockOwns.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));
    const res = await productsGet(req("/api/products", "someone-elses-room"));
    expect(res.status).toBe(404);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
