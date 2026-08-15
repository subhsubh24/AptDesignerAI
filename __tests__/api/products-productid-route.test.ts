import { describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for APT-35: PATCH /api/products/[productId] validated
// image_url/product_url only for type + length, never scheme — unlike its
// sibling POST /api/products/ingest, which rejects non-http(s)/malformed URLs
// via validateExternalUrl() before persisting. An authenticated owner could
// PATCH their own product's image_url/product_url to an arbitrary string
// (protocol-relative, javascript:, etc.) that later gets rendered as an
// <img src>. This test uses the REAL validateExternalUrl (not mocked) so it
// actually exercises the scheme check, not just that some function was called.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({
  requireCandidateProductOwnership: vi.fn(async () => null),
}));
vi.mock("@/lib/utils/write-rate-limit", () => ({
  enforceWriteRateLimit: vi.fn(() => null),
  DELETE_WRITE_LIMIT: { maxRequests: 10, windowMs: 3_600_000 },
}));

import { createClient } from "@/lib/supabase/server";

const mockCreateClient = createClient as unknown as Mock;

const PRODUCT_ID = "product-1";

function patchReq(body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/products/${PRODUCT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: vi.fn((table: string) => {
      if (table === "candidate_products") {
        const chain: Record<string, unknown> = {};
        chain.update = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.select = vi.fn(() => chain);
        chain.single = vi.fn(() =>
          Promise.resolve({ data: { id: PRODUCT_ID }, error: null }),
        );
        return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("PATCH /api/products/[productId] — URL scheme validation (APT-35)", () => {
  it("rejects a protocol-relative image_url with 400, matching POST /ingest's behavior", async () => {
    mockCreateClient.mockResolvedValue(makeClient());
    const { PATCH } = await import("@/app/api/products/[productId]/route");

    const res = await PATCH(patchReq({ image_url: "//evil.com/x.jpg" }), {
      params: Promise.resolve({ productId: PRODUCT_ID }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/image_url/);
  });

  it("rejects a javascript: product_url with 400", async () => {
    mockCreateClient.mockResolvedValue(makeClient());
    const { PATCH } = await import("@/app/api/products/[productId]/route");

    const res = await PATCH(patchReq({ product_url: "javascript:alert(1)" }), {
      params: Promise.resolve({ productId: PRODUCT_ID }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/product_url/);
  });

  it("accepts a valid https image_url and persists the update", async () => {
    mockCreateClient.mockResolvedValue(makeClient());
    const { PATCH } = await import("@/app/api/products/[productId]/route");

    const res = await PATCH(
      patchReq({ image_url: "https://example.com/lamp.jpg" }),
      { params: Promise.resolve({ productId: PRODUCT_ID }) },
    );

    expect(res.status).toBe(200);
  });

  it("does not validate image_url/product_url when absent from the PATCH body (partial update)", async () => {
    mockCreateClient.mockResolvedValue(makeClient());
    const { PATCH } = await import("@/app/api/products/[productId]/route");

    const res = await PATCH(patchReq({ title: "New title" }), {
      params: Promise.resolve({ productId: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
  });
});
