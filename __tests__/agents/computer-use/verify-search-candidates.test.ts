import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// verifyTopSearchCandidates grounds the top-ranked candidate per category against
// its retailer URL via the Computer Use product verifier, cache-first. The
// deterministic logic under test — tracking-param-stripping URL normalisation (the
// cache key), top-1-per-category ranking by evaluation score, in-place field merge
// (only fill EMPTY fields / changed price), the cache-hit short-circuit, and the
// Browserbase-unavailable no-op — is exercised here with the verifier, the admin
// (Supabase) client, and the optional Browserbase SDK all mocked, so no network or
// browser session is touched.

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
// The module gates on a dynamic `import("@browserbasehq/sdk")` (an OPTIONAL dep).
// Mock it so browserbaseAvailable() resolves true once the env creds are present.
vi.mock("@browserbasehq/sdk", () => ({ default: {} }));
vi.mock("@/lib/agents/computer-use/product-verifier", () => ({
  runProductVerifier: vi.fn(),
}));

import { verifyTopSearchCandidates } from "@/lib/agents/computer-use/verify-search-candidates";
import { getAdminClient } from "@/lib/supabase/admin";
import { runProductVerifier } from "@/lib/agents/computer-use/product-verifier";
import type { CandidateProduct } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { VerifiedProduct } from "@/lib/agents/computer-use/product-verifier";

const mockGetAdmin = getAdminClient as unknown as Mock;
const mockVerifier = runProductVerifier as unknown as Mock;

// ─── Mock Supabase admin client ───────────────────────────────────
// Chainable query builder. `.maybeSingle()` resolves the configured cache row
// (null = miss). `.insert()` records the row + table so writeCache / writeAgentLog
// can be asserted. Every `.eq()` is captured so we can prove the cache key was the
// NORMALISED url.

interface InsertRecord {
  table: string;
  row: Record<string, unknown>;
}

function makeAdmin(cacheRow: Record<string, unknown> | null = null) {
  const eqCalls: Array<[string, unknown]> = [];
  const inserts: InsertRecord[] = [];
  let currentTable = "";
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: cacheRow, error: null }),
    insert: async (row: Record<string, unknown>) => {
      inserts.push({ table: currentTable, row });
      return { data: null, error: null };
    },
  };
  const db = {
    from: (table: string) => {
      currentTable = table;
      return builder;
    },
    _eqCalls: eqCalls,
    _inserts: inserts,
  };
  return db;
}

// ─── Fixtures ─────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateProduct> = {}): CandidateProduct {
  return {
    id: "prod-1",
    room_id: "room-1",
    search_session_id: "sess-1",
    title: "Oak Coffee Table",
    category: "coffee_table",
    retailer: "example",
    product_url: "https://shop.example.com/oak-table",
    image_url: null,
    local_image_path: null,
    price: 200,
    dimensions: null,
    materials: null,
    colors: null,
    description: null,
    source_type: "agentic_search",
    metadata: null,
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeVerified(overrides: Partial<VerifiedProduct> = {}): VerifiedProduct {
  return {
    title: "Oak Coffee Table",
    price: null,
    currency: "USD",
    in_stock: true,
    dimensions: null,
    materials: [],
    available_colors: [],
    available_sizes: [],
    shipping_estimate: null,
    return_policy_summary: null,
    caveats: [],
    ...overrides,
  };
}

function evalWith(scores: Record<string, number>): Map<string, ProductEvaluationResult> {
  const m = new Map<string, ProductEvaluationResult>();
  for (const [id, s] of Object.entries(scores)) {
    m.set(id, { final_item_score: s } as ProductEvaluationResult);
  }
  return m;
}

describe("verifyTopSearchCandidates", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    mockVerifier.mockReset();
    mockGetAdmin.mockReset();
    // Default: Browserbase configured so verification runs.
    process.env.BROWSERBASE_API_KEY = "bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "bb-proj";
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("is a no-op when Browserbase is not configured (missing env creds)", async () => {
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_PROJECT_ID;
    const candidate = makeCandidate();
    const summary = await verifyTopSearchCandidates(
      { coffee_table: [candidate] },
      evalWith({ "prod-1": 1 }),
    );
    expect(summary).toEqual({ attempted: 0, succeeded: 0, cacheHits: 0, entries: [] });
    expect(mockVerifier).not.toHaveBeenCalled();
    // The candidate is left untouched.
    expect(candidate.price).toBe(200);
  });

  it("verifies the top-ranked candidate per category by final_item_score", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null)); // cache miss
    mockVerifier.mockResolvedValue({
      product: makeVerified(),
      source_url: "https://shop.example.com/oak-table",
      agent_status: "completed",
      turns: 3,
    });

    const low = makeCandidate({ id: "low", product_url: "https://shop.example.com/low" });
    const high = makeCandidate({ id: "high", product_url: "https://shop.example.com/high" });
    const summary = await verifyTopSearchCandidates(
      { coffee_table: [low, high] },
      evalWith({ low: 0.2, high: 0.9 }),
    );

    expect(mockVerifier).toHaveBeenCalledTimes(1);
    expect(mockVerifier).toHaveBeenCalledWith(
      expect.objectContaining({ productUrl: "https://shop.example.com/high" }),
    );
    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.entries[0]).toMatchObject({ productId: "high", status: "ok" });
  });

  it("strips tracking params (utm_*, gclid, …) from the cache key but keeps legit params", async () => {
    const admin = makeAdmin(null);
    mockGetAdmin.mockReturnValue(admin);
    mockVerifier.mockResolvedValue({
      product: makeVerified(),
      source_url: "x",
      agent_status: "completed",
      turns: 1,
    });

    const candidate = makeCandidate({
      product_url: "https://shop.example.com/oak-table?utm_source=google&gclid=abc&color=oak",
    });
    await verifyTopSearchCandidates({ coffee_table: [candidate] }, evalWith({ "prod-1": 1 }));

    const keyLookup = admin._eqCalls.find(([col]) => col === "product_url_key");
    expect(keyLookup).toBeDefined();
    // utm_source + gclid stripped; the functional `color` param preserved.
    expect(keyLookup?.[1]).toBe("https://shop.example.com/oak-table?color=oak");
  });

  it("strips a trailing slash from the cache key", async () => {
    const admin = makeAdmin(null);
    mockGetAdmin.mockReturnValue(admin);
    mockVerifier.mockResolvedValue({
      product: makeVerified(),
      source_url: "x",
      agent_status: "completed",
      turns: 1,
    });

    const candidate = makeCandidate({ product_url: "https://shop.example.com/oak-table/" });
    await verifyTopSearchCandidates({ coffee_table: [candidate] }, evalWith({ "prod-1": 1 }));

    const keyLookup = admin._eqCalls.find(([col]) => col === "product_url_key");
    expect(keyLookup?.[1]).toBe("https://shop.example.com/oak-table");
  });

  it("short-circuits on a cache hit without running the verifier", async () => {
    const admin = makeAdmin({
      title: "Oak Coffee Table",
      price: 175,
      currency: "USD",
      in_stock: true,
      dimensions: null,
      materials: ["oak"],
      available_colors: [],
      available_sizes: [],
      shipping_estimate: null,
      return_policy_summary: null,
      caveats: [],
    });
    mockGetAdmin.mockReturnValue(admin);

    const candidate = makeCandidate({ price: 200, materials: null });
    const summary = await verifyTopSearchCandidates(
      { coffee_table: [candidate] },
      evalWith({ "prod-1": 1 }),
    );

    expect(mockVerifier).not.toHaveBeenCalled();
    expect(summary.cacheHits).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.entries[0]).toMatchObject({ status: "cache_hit" });
    // Cached price merged into the candidate.
    expect(candidate.price).toBe(175);
    // A cache HIT is never re-written to the cache.
    const cacheWrites = admin._inserts.filter((i) => i.table === "computer_use_verified_products");
    expect(cacheWrites).toHaveLength(0);
  });

  it("merges verified price / dimensions / materials into the candidate and records changed fields", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null));
    mockVerifier.mockResolvedValue({
      product: makeVerified({
        price: 249,
        dimensions: { width_in: 40, depth_in: 20, height_in: 18 },
        materials: ["solid oak", "steel"],
        available_colors: ["natural"],
      }),
      source_url: "x",
      agent_status: "completed",
      turns: 2,
    });

    const candidate = makeCandidate({ price: 200, dimensions: null, materials: null, colors: null });
    await verifyTopSearchCandidates({ coffee_table: [candidate] }, evalWith({ "prod-1": 1 }));

    expect(candidate.price).toBe(249);
    expect(candidate.dimensions).toEqual({ width: 40, depth: 20, height: 18, unit: "inches" });
    expect(candidate.materials).toEqual(["solid oak", "steel"]);
    expect(candidate.colors).toEqual(["natural"]);
    const verification = (candidate.metadata as { verification?: { changed_fields?: string[] } })
      ?.verification;
    expect(verification?.changed_fields).toEqual(
      expect.arrayContaining(["price", "dimensions", "materials", "colors"]),
    );
  });

  it("does NOT overwrite fields the candidate already has (fills only empties)", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null));
    mockVerifier.mockResolvedValue({
      product: makeVerified({
        price: 200, // same price → no change
        materials: ["particle board"],
        available_colors: ["grey"],
      }),
      source_url: "x",
      agent_status: "completed",
      turns: 1,
    });

    const candidate = makeCandidate({
      price: 200,
      materials: ["solid oak"],
      colors: ["natural"],
    });
    await verifyTopSearchCandidates({ coffee_table: [candidate] }, evalWith({ "prod-1": 1 }));

    // Existing materials/colors preserved; identical price is not a change.
    expect(candidate.materials).toEqual(["solid oak"]);
    expect(candidate.colors).toEqual(["natural"]);
    const changed =
      (candidate.metadata as { verification?: { changed_fields?: string[] } })?.verification
        ?.changed_fields ?? [];
    expect(changed).not.toContain("materials");
    expect(changed).not.toContain("colors");
    expect(changed).not.toContain("price");
  });

  it("leaves dimensions untouched when the verifier returns all-null dimensions", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null));
    mockVerifier.mockResolvedValue({
      product: makeVerified({
        dimensions: { width_in: null, depth_in: null, height_in: null },
      }),
      source_url: "x",
      agent_status: "completed",
      turns: 1,
    });

    const candidate = makeCandidate({ dimensions: null });
    await verifyTopSearchCandidates({ coffee_table: [candidate] }, evalWith({ "prod-1": 1 }));
    expect(candidate.dimensions).toBeNull();
  });

  it("writes the live result to the cache only when the agent completed", async () => {
    const admin = makeAdmin(null);
    mockGetAdmin.mockReturnValue(admin);
    mockVerifier.mockResolvedValue({
      product: makeVerified({ price: 300 }),
      source_url: "x",
      agent_status: "completed",
      turns: 4,
    });

    const candidate = makeCandidate();
    await verifyTopSearchCandidates({ coffee_table: [candidate] }, evalWith({ "prod-1": 1 }));

    const cacheWrites = admin._inserts.filter((i) => i.table === "computer_use_verified_products");
    expect(cacheWrites).toHaveLength(1);
    expect(cacheWrites[0].row).toMatchObject({ price: 300, agent_status: "completed" });
  });

  it("does NOT cache a non-completed (e.g. partial) agent run", async () => {
    const admin = makeAdmin(null);
    mockGetAdmin.mockReturnValue(admin);
    mockVerifier.mockResolvedValue({
      product: makeVerified({ price: 300 }),
      source_url: "x",
      agent_status: "max_turns",
      turns: 8,
    });

    const candidate = makeCandidate();
    const summary = await verifyTopSearchCandidates(
      { coffee_table: [candidate] },
      evalWith({ "prod-1": 1 }),
    );

    // Field merge still applied (the product data is usable)...
    expect(candidate.price).toBe(300);
    expect(summary.succeeded).toBe(1);
    // ...but a non-completed run is not persisted to the cache.
    const cacheWrites = admin._inserts.filter((i) => i.table === "computer_use_verified_products");
    expect(cacheWrites).toHaveLength(0);
  });

  it("marks a category with no product_url as skipped and never calls the verifier", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null));
    const candidate = makeCandidate({ product_url: null });
    const summary = await verifyTopSearchCandidates(
      { coffee_table: [candidate] },
      evalWith({ "prod-1": 1 }),
    );
    expect(mockVerifier).not.toHaveBeenCalled();
    expect(summary.attempted).toBe(0);
    expect(summary.entries[0]).toMatchObject({ status: "skipped", notes: "no product_url" });
  });

  it("records a failed entry when the verifier returns no product", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null));
    mockVerifier.mockResolvedValue({
      product: null,
      source_url: "x",
      agent_status: "failed",
      turns: 1,
    });

    const candidate = makeCandidate();
    const summary = await verifyTopSearchCandidates(
      { coffee_table: [candidate] },
      evalWith({ "prod-1": 1 }),
    );
    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.entries[0]).toMatchObject({ productId: "prod-1", status: "failed" });
  });

  it("records a failed entry (not a throw) when the verifier rejects", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null));
    mockVerifier.mockRejectedValue(new Error("browserbase exploded"));

    const candidate = makeCandidate();
    const summary = await verifyTopSearchCandidates(
      { coffee_table: [candidate] },
      evalWith({ "prod-1": 1 }),
    );
    expect(summary.succeeded).toBe(0);
    expect(summary.entries[0]).toMatchObject({ status: "failed", notes: "browserbase exploded" });
  });

  it("verifies one top candidate for each distinct category", async () => {
    mockGetAdmin.mockReturnValue(makeAdmin(null));
    mockVerifier.mockResolvedValue({
      product: makeVerified(),
      source_url: "x",
      agent_status: "completed",
      turns: 1,
    });

    const sofa = makeCandidate({ id: "sofa", category: "sofa", product_url: "https://ex.com/sofa" });
    const rug = makeCandidate({ id: "rug", category: "rug", product_url: "https://ex.com/rug" });
    const summary = await verifyTopSearchCandidates(
      { sofa: [sofa], rug: [rug] },
      evalWith({ sofa: 1, rug: 1 }),
    );
    expect(mockVerifier).toHaveBeenCalledTimes(2);
    expect(summary.attempted).toBe(2);
  });
});
