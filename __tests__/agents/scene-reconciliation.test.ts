/**
 * Deterministic cross-view reconciliation — the dedup/merge layer that turns
 * raw multi-angle VLM output into one canonical object per real object. These
 * tests lock in the behavior that the whole feature exists for: the same sofa
 * shot from three angles must collapse to ONE object, genuinely different
 * objects must stay separate, and the result must be byte-identical regardless
 * of the order the model emitted observations in.
 */
import { describe, it, expect } from "vitest";
import {
  reconcileSceneGraph,
  sceneGraphQualityOk,
  groundCoverage,
  formatSceneGraphForPrompt,
  SCENE_GRAPH_VERSION,
} from "@/lib/agents/scene-reconciliation";
import { RoomSceneGraphResponseSchema } from "@/lib/types/schemas";
import type { RoomSceneGraphResponse } from "@/lib/types/schemas";
import type { ExtractedFloorPlan } from "@/lib/types/database";

const PHOTOS = ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg"];

/** Parse through the real Zod schema so tests exercise the same coercion the
 *  pipeline does (defaults, clamping). */
function raw(partial: unknown): RoomSceneGraphResponse {
  return RoomSceneGraphResponseSchema.parse(partial);
}

describe("reconcileSceneGraph — cross-view dedup", () => {
  it("merges the same object seen from multiple angles into one canonical object", () => {
    const input = raw({
      summary: "A warm living room with a grey sectional facing the windows.",
      objects: [
        {
          category: "sofa",
          label: "grey sectional (left angle)",
          observed_in: [{ image_index: 0, view: "wide from door" }],
          colors: ["grey"],
          materials: ["boucle"],
          placement: "against north wall",
          confidence: 0.7,
        },
        {
          category: "sofa",
          label: "grey sectional (right angle)",
          observed_in: [{ image_index: 2, view: "close from kitchen" }],
          colors: ["grey"],
          materials: ["boucle"],
          placement: "against north wall",
          confidence: 0.8,
        },
      ],
      relations: [],
      coverage: { walls_observed: ["north", "east"], gaps: [], estimated_coverage: 0.6, suggested_shots: [] },
    });

    const g = reconcileSceneGraph(input, { sourceImageUrls: PHOTOS, roomType: "living_room" });

    expect(g.objects).toHaveLength(1);
    const sofa = g.objects[0];
    expect(sofa.category).toBe("sofa");
    expect(sofa.observed_in.map((o) => o.image_url).sort()).toEqual([PHOTOS[0], PHOTOS[2]]);
    expect(sofa.merged_from_multiple_views).toBe(true);
    expect(g.reconciled_duplicate_count).toBe(1);
    // Corroboration across distinct photos bumps confidence above the max member.
    expect(sofa.confidence).toBeGreaterThan(0.8);
  });

  it("keeps genuinely different objects of the same category separate", () => {
    const input = raw({
      summary: "Two distinct accent chairs in different colors.",
      objects: [
        { category: "accent_chair", label: "blue velvet chair", observed_in: [{ image_index: 0 }], colors: ["blue"], materials: ["velvet"], placement: "by window" },
        { category: "accent_chair", label: "tan leather chair", observed_in: [{ image_index: 1 }], colors: ["tan"], materials: ["leather"], placement: "by fireplace" },
      ],
      coverage: { walls_observed: ["north"], gaps: [], estimated_coverage: 0.4, suggested_shots: [] },
    });

    const g = reconcileSceneGraph(input, { sourceImageUrls: PHOTOS, roomType: "living_room" });
    expect(g.objects).toHaveLength(2);
    expect(g.reconciled_duplicate_count).toBe(0);
  });

  it("does NOT merge same-category objects whose dimensions strongly conflict", () => {
    const input = raw({
      summary: "A small side table and a large dining table, both wood.",
      objects: [
        { category: "table", label: "side table", observed_in: [{ image_index: 0 }], materials: ["oak"], dimensions: { width_in: 20 } },
        { category: "table", label: "dining table", observed_in: [{ image_index: 1 }], materials: ["oak"], dimensions: { width_in: 72 } },
      ],
      coverage: { walls_observed: [], gaps: [], estimated_coverage: 0.5, suggested_shots: [] },
    });

    const g = reconcileSceneGraph(input, { sourceImageUrls: PHOTOS, roomType: "dining_area" });
    expect(g.objects).toHaveLength(2);
  });

  it("is order-independent: shuffled input yields identical output (determinism)", () => {
    const objects = [
      { category: "sofa", label: "grey sectional", observed_in: [{ image_index: 0 }], colors: ["grey"], placement: "north wall" },
      { category: "sofa", label: "grey sectional", observed_in: [{ image_index: 2 }], colors: ["grey"], placement: "north wall" },
      { category: "rug", label: "jute rug", observed_in: [{ image_index: 1 }], materials: ["jute"] },
      { category: "lamp", label: "brass floor lamp", observed_in: [{ image_index: 0 }], materials: ["brass"] },
    ];
    const forward = reconcileSceneGraph(raw({ summary: "x".repeat(30), objects }), { sourceImageUrls: PHOTOS, roomType: "living_room" });
    const reversed = reconcileSceneGraph(raw({ summary: "x".repeat(30), objects: [...objects].reverse() }), { sourceImageUrls: PHOTOS, roomType: "living_room" });
    expect(JSON.stringify(reversed)).toEqual(JSON.stringify(forward));
  });

  it("drops observations that reference out-of-range photo indices", () => {
    const input = raw({
      summary: "A lamp, partially mis-indexed by the model.",
      objects: [{ category: "lamp", label: "lamp", observed_in: [{ image_index: 0 }, { image_index: 99 }], materials: ["brass"] }],
      coverage: { walls_observed: [], gaps: [], estimated_coverage: 0.5, suggested_shots: [] },
    });
    const g = reconcileSceneGraph(input, { sourceImageUrls: PHOTOS, roomType: "living_room" });
    expect(g.objects[0].observed_in.map((o) => o.image_url)).toEqual([PHOTOS[0]]);
  });

  it("lets keep/replace lists override the model's disposition guess", () => {
    const input = raw({
      summary: "A sofa to keep and a rug to replace.",
      objects: [
        { category: "sofa", label: "grey sofa", observed_in: [{ image_index: 0 }], colors: ["grey"], disposition: "unknown" },
        { category: "area_rug", label: "worn rug", observed_in: [{ image_index: 1 }], disposition: "keep" },
      ],
    });
    const g = reconcileSceneGraph(input, {
      sourceImageUrls: PHOTOS,
      roomType: "living_room",
      keepItems: ["sofa"],
      replaceItems: ["area rug"],
    });
    const sofa = g.objects.find((o) => o.category === "sofa")!;
    const rug = g.objects.find((o) => o.category === "area_rug")!;
    expect(sofa.disposition).toBe("keep");
    expect(rug.disposition).toBe("replace"); // replace list wins over model's "keep"
  });

  it("stamps version and never sets assembled_at in the pure core", () => {
    const g = reconcileSceneGraph(raw({ summary: "y".repeat(30), objects: [] }), { sourceImageUrls: PHOTOS, roomType: "kitchen" });
    expect(g.version).toBe(SCENE_GRAPH_VERSION);
    expect(g.assembled_at).toBeUndefined();
  });
});

describe("groundCoverage — coverage gaps + suggested shots", () => {
  it("flags cardinal walls never shown when there is no floor plan", () => {
    const cov = groundCoverage(
      raw({ objects: [], coverage: { walls_observed: ["north"], gaps: [], estimated_coverage: 0.9, suggested_shots: [] } }).coverage,
      "living_room",
    );
    expect(cov.gaps).toContain("south");
    expect(cov.gaps).toContain("east");
    expect(cov.gaps).toContain("west");
    expect(cov.suggested_shots.some((s) => s.includes("south"))).toBe(true);
    // Conservative: estimate never exceeds the wall-ratio (1 of 4 = 0.25).
    expect(cov.estimated_coverage).toBeLessThanOrEqual(0.25);
  });

  it("uses floor-plan walls as the expected set when present", () => {
    const floorPlan: ExtractedFloorPlan = {
      image_url: "fp.png",
      extracted_at: "2026-01-01T00:00:00Z",
      confidence: "high",
      rooms: [
        {
          room_type: "kitchen",
          label: "Kitchen",
          shape: "rectangular",
          natural_light: "medium",
          walls: [
            { direction: "north", features: [] },
            { direction: "south", features: [] },
          ],
        },
      ],
    };
    const cov = groundCoverage(
      raw({ objects: [], coverage: { walls_observed: ["north"], gaps: [], estimated_coverage: 1, suggested_shots: [] } }).coverage,
      "kitchen",
      floorPlan,
    );
    expect(cov.gaps).toContain("south");
    expect(cov.gaps).not.toContain("east"); // east isn't a wall in this plan
    expect(cov.estimated_coverage).toBe(0.5); // 1 of 2 plan walls observed
  });
});

describe("sceneGraphQualityOk — escalation trigger", () => {
  it("fails a degenerate graph (no objects / empty summary) to trigger escalation", () => {
    const empty = reconcileSceneGraph(raw({ summary: "", objects: [] }), { sourceImageUrls: PHOTOS, roomType: "kitchen" });
    expect(sceneGraphQualityOk(empty)).toBe(false);
  });

  it("passes a graph with objects and a real summary", () => {
    const ok = reconcileSceneGraph(
      raw({ summary: "A bright kitchen with an island and pendant lights.", objects: [{ category: "kitchen_island", label: "island", observed_in: [{ image_index: 0 }] }] }),
      { sourceImageUrls: PHOTOS, roomType: "kitchen" },
    );
    expect(sceneGraphQualityOk(ok)).toBe(true);
  });
});

describe("formatSceneGraphForPrompt", () => {
  it("returns empty string for an empty/absent graph (byte-equivalent downstream)", () => {
    expect(formatSceneGraphForPrompt(null)).toBe("");
    const empty = reconcileSceneGraph(raw({ summary: "", objects: [] }), { sourceImageUrls: PHOTOS, roomType: "kitchen" });
    expect(formatSceneGraphForPrompt(empty)).toBe("");
  });

  it("renders a deduped inventory block with per-object photo counts", () => {
    const g = reconcileSceneGraph(
      raw({
        summary: "z".repeat(30),
        objects: [
          { category: "sofa", label: "grey sectional", observed_in: [{ image_index: 0 }, { image_index: 2 }], colors: ["grey"] },
        ],
      }),
      { sourceImageUrls: PHOTOS, roomType: "living_room" },
    );
    const block = formatSceneGraphForPrompt(g);
    expect(block).toContain("ROOM INVENTORY");
    expect(block).toContain("grey sectional");
    expect(block).toContain("seen in 2 photos");
  });
});
