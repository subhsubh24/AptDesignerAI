import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemoryClient } from "@/lib/store/memory-store";
import type {
  IdentifiedProductCandidate,
  IdentifiedProductEnriched,
} from "@/lib/types/schemas";

// Mock every agent/IO collaborator so we exercise ONLY the orchestration:
// the no-photos / no-crops short-circuits, the verify cap + confidence
// ordering, dedup by (brand,model,variant), the dropUnverified filter, and
// token accumulation. pLimit is a pure zero-dep limiter, kept real.
const runFurnitureCropper = vi.fn();
const runProductIdentifier = vi.fn();
const runProductVerifier = vi.fn();
const embedImage = vi.fn();
const topKSimilar = vi.fn();

vi.mock("@/lib/agents/furniture-cropper", () => ({
  runFurnitureCropper: (...a: unknown[]) => runFurnitureCropper(...a),
}));
vi.mock("@/lib/agents/product-identifier", () => ({
  runProductIdentifier: (...a: unknown[]) => runProductIdentifier(...a),
}));
vi.mock("@/lib/agents/product-verifier", () => ({
  runProductVerifier: (...a: unknown[]) => runProductVerifier(...a),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  embedImage: (...a: unknown[]) => embedImage(...a),
}));
vi.mock("@/lib/store/embedding-index", () => ({
  topKSimilar: (...a: unknown[]) => topKSimilar(...a),
}));

import { runIdentifiedProductsPipeline } from "@/lib/agents/identified-products-pipeline";

const supabase = {} as MemoryClient;

function crop(url: string, label: string) {
  return { source_image_url: url, label, box: { x: 0, y: 0, w: 1, h: 1 } };
}

function candidate(
  brand: string,
  model: string,
  confidence: number,
  variant?: string,
): IdentifiedProductCandidate {
  return { brand, model, variant, confidence } as unknown as IdentifiedProductCandidate;
}

function enriched(
  brand: string,
  model: string,
  confidence: number,
  verified: boolean,
  variant?: string,
): IdentifiedProductEnriched {
  return { brand, model, variant, confidence, verified } as unknown as IdentifiedProductEnriched;
}

beforeEach(() => {
  vi.clearAllMocks();
  embedImage.mockResolvedValue([0.1, 0.2, 0.3]);
  topKSimilar.mockResolvedValue([]);
});

describe("runIdentifiedProductsPipeline", () => {
  it("hard-fails with 'no images' when given no photos (no agents invoked)", async () => {
    const res = await runIdentifiedProductsPipeline({ supabase, imageUrls: [] });
    expect(res.success).toBe(false);
    expect(res.error).toBe("no images");
    expect(runFurnitureCropper).not.toHaveBeenCalled();
  });

  it("returns an empty list (not an error) when the cropper finds nothing", async () => {
    runFurnitureCropper.mockResolvedValue({ crops: [], tokensUsed: 12, model: "m" });
    const res = await runIdentifiedProductsPipeline({ supabase, imageUrls: ["a"] });
    expect(res.success).toBe(true);
    if (!res.success || !res.data) throw new Error("expected data");
    expect(res.data.identified_products).toEqual([]);
    expect(res.data.crops_considered).toBe(0);
    expect(res.data.tokensUsed).toBe(12);
    expect(runProductIdentifier).not.toHaveBeenCalled();
  });

  it("identifies, verifies, dedups, and (by default) drops unverified entries", async () => {
    runFurnitureCropper.mockResolvedValue({
      crops: [crop("u1", "sofa"), crop("u2", "sofa"), crop("u3", "lamp")],
      tokensUsed: 10,
      model: "cropper",
    });
    // u1/u2 → same sofa (dedup); u3 → a lamp the verifier rejects (dropped).
    runProductIdentifier
      .mockResolvedValueOnce({ candidates: [candidate("West Elm", "Harmony", 0.9)], tokensUsed: 5 })
      .mockResolvedValueOnce({ candidates: [candidate("West Elm", "Harmony", 0.7)], tokensUsed: 5 })
      .mockResolvedValueOnce({ candidates: [candidate("IKEA", "Foto", 0.8)], tokensUsed: 5 });
    runProductVerifier.mockImplementation(async ({ candidate: c }: { candidate: IdentifiedProductCandidate }) => ({
      enriched: enriched(c.brand, c.model, c.confidence, c.brand === "West Elm"),
      tokensUsed: 3,
    }));

    const res = await runIdentifiedProductsPipeline({ supabase, imageUrls: ["u1", "u2", "u3"] });
    expect(res.success).toBe(true);
    if (!res.success || !res.data) throw new Error("expected data");

    // Two West Elm Harmony entries dedup to the higher-confidence one; the
    // unverified IKEA lamp is filtered out by the default dropUnverified.
    expect(res.data.identified_products).toHaveLength(1);
    expect(res.data.identified_products[0]).toMatchObject({
      brand: "West Elm",
      model: "Harmony",
      confidence: 0.9,
      verified: true,
    });
    expect(res.data.crops_considered).toBe(3);
    // 10 (crop) + 3×5 (identify) + 3×3 (verify) = 34
    expect(res.data.tokensUsed).toBe(34);
  });

  it("keeps unverified entries when dropUnverified is false", async () => {
    runFurnitureCropper.mockResolvedValue({ crops: [crop("u1", "lamp")], tokensUsed: 0, model: "m" });
    runProductIdentifier.mockResolvedValue({ candidates: [candidate("IKEA", "Foto", 0.8)], tokensUsed: 0 });
    runProductVerifier.mockResolvedValue({ enriched: enriched("IKEA", "Foto", 0.8, false), tokensUsed: 0 });

    const res = await runIdentifiedProductsPipeline({
      supabase,
      imageUrls: ["u1"],
      dropUnverified: false,
    });
    if (!res.success || !res.data) throw new Error("expected data");
    expect(res.data.identified_products).toHaveLength(1);
    expect(res.data.identified_products[0].verified).toBe(false);
  });

  it("honours maxVerifyCalls, verifying the highest-confidence crops first", async () => {
    runFurnitureCropper.mockResolvedValue({
      crops: [crop("u1", "a"), crop("u2", "b"), crop("u3", "c")],
      tokensUsed: 0,
      model: "m",
    });
    runProductIdentifier
      .mockResolvedValueOnce({ candidates: [candidate("B1", "M1", 0.4)], tokensUsed: 0 })
      .mockResolvedValueOnce({ candidates: [candidate("B2", "M2", 0.95)], tokensUsed: 0 })
      .mockResolvedValueOnce({ candidates: [candidate("B3", "M3", 0.6)], tokensUsed: 0 });
    runProductVerifier.mockImplementation(async ({ candidate: c }: { candidate: IdentifiedProductCandidate }) => ({
      enriched: enriched(c.brand, c.model, c.confidence, true),
      tokensUsed: 0,
    }));

    const res = await runIdentifiedProductsPipeline({
      supabase,
      imageUrls: ["u1", "u2", "u3"],
      maxVerifyCalls: 1,
    });
    if (!res.success || !res.data) throw new Error("expected data");

    // Only the single highest-confidence candidate (0.95) is verified.
    expect(runProductVerifier).toHaveBeenCalledTimes(1);
    expect(runProductVerifier.mock.calls[0][0].candidate).toMatchObject({ brand: "B2", confidence: 0.95 });
    expect(res.data.identified_products).toHaveLength(1);
    expect(res.data.identified_products[0].brand).toBe("B2");
  });
});
