import { describe, it, expect } from "vitest";
import {
  computeSpatialGraph,
  getSpatialGraphIssuesForItem,
} from "@/lib/validation/spatial-graph";

describe("computeSpatialGraph", () => {
  it("flags dead zones when furniture clusters on one wall", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "85\"W x 38\"D x 32\"H", placement: "on the north wall" },
        { category: "coffee_table", specs: "48\"W x 24\"D x 18\"H", placement: "north wall, in front of sofa" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    expect(result.dead_zones.length).toBeGreaterThan(0);
    expect(result.zone_coverage_score).toBeLessThan(0.8);
  });

  it("flags broken natural pairs when sofa and coffee table are placed apart", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "85\"W x 38\"D x 32\"H", placement: "north wall" },
        { category: "coffee_table", specs: "48\"W x 24\"D x 18\"H", placement: "south wall corner" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    expect(result.broken_pairs.length).toBeGreaterThan(0);
    expect(result.adjacency_score).toBeLessThan(1);
  });

  it("does not flag broken pairs when sofa and coffee table share a zone", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "85\"W x 38\"D x 32\"H", placement: "north wall, centered" },
        { category: "coffee_table", specs: "48\"W x 24\"D x 18\"H", placement: "north wall, in front of sofa" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    const sofaBroken = result.broken_pairs.find(
      (p) => p.item1 === "sofa" || p.item2 === "sofa",
    );
    expect(sofaBroken).toBeUndefined();
  });

  it("flags large-footprint items placed near the door as traffic conflicts", () => {
    const analysis = {
      what_it_needs: [
        // 120"W x 84"D = 10,080 sq in — well above the 1500 sq in near-door threshold
        { category: "sectional", specs: "120\"W x 84\"D x 34\"H", placement: "by the door, directly in entry path" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    expect(result.traffic_conflicts.length).toBeGreaterThan(0);
    expect(result.traffic_flow_score).toBeLessThan(1);
  });

  // ─── Sight-line preservation (previously zero coverage) ──────────────────
  // A tall item (≥48") in the room center or blocking a window, with seating
  // present, reduces sight_line_score. Each block subtracts 0.2 (floor 0.4).
  it("flags a tall item in the room center as a sight-line block", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "85\"W x 38\"D x 32\"H", placement: "north wall" },
        { category: "bookcase", specs: "36\"W x 12\"D x 72\"H", placement: "in the center of the room" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    expect(result.sight_line_blocks.some((b) => b.blocker.includes("bookcase") && b.target === "focal wall")).toBe(true);
    expect(result.sight_line_score).toBeLessThan(1);
  });

  it("flags a tall item on the window wall as blocking natural light", () => {
    const analysis = {
      what_it_needs: [
        { category: "accent_chair", specs: "30\"W x 30\"D x 34\"H", placement: "reading nook" },
        { category: "armoire", specs: "40\"W x 20\"D x 78\"H", placement: "on the window wall" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    expect(result.sight_line_blocks.some((b) => /window|natural light/.test(b.target))).toBe(true);
  });

  it("does NOT treat a tall plant near a window as a sight-line block (plant exclusion)", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "85\"W x 38\"D x 32\"H", placement: "north wall" },
        // Tall enough to clear the isTall gate AND anchored to the window wall, so
        // ONLY the plant exclusion spares it from a natural-light sight-line block.
        { category: "plant", specs: "20\"W x 20\"D x 60\"H", placement: "on the window wall" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    expect(result.sight_line_blocks.length).toBe(0);
    expect(result.sight_line_score).toBe(1);
  });

  // ─── Adjacency via cardinal-corner pairing (distinct from the shared-zone path) ──
  // north_wall and east_wall share NO anchor, so this passes ONLY because the
  // north/east walls border at a corner — exercising isAdjacentZone's cardinal-pair
  // branch, not the shared-anchor shortcut the other tests hit.
  it("treats items on corner-adjacent walls (north + east) as a valid pair", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "85\"W x 38\"D x 32\"H", placement: "north wall" },
        { category: "coffee_table", specs: "48\"W x 24\"D x 18\"H", placement: "east wall" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    const sofaBroken = result.broken_pairs.find((p) => p.item1 === "sofa" || p.item2 === "sofa");
    expect(sofaBroken).toBeUndefined();
    expect(result.adjacency_score).toBe(1);
  });

  it("returns neutral scores for empty analysis", () => {
    const result = computeSpatialGraph({ what_it_needs: [] }, { roomType: "living_room" });
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(1);
  });

  it("surfaces per-item issues via getSpatialGraphIssuesForItem", () => {
    const analysis = {
      what_it_needs: [
        { category: "sofa", specs: "85\"W x 38\"D x 32\"H", placement: "north wall" },
        { category: "coffee_table", specs: "48\"W x 24\"D x 18\"H", placement: "south wall corner" },
      ],
    };
    const result = computeSpatialGraph(analysis, { roomType: "living_room" });
    const sofaIssues = getSpatialGraphIssuesForItem(result, "sofa");
    const coffeeIssues = getSpatialGraphIssuesForItem(result, "coffee_table");
    // At least one of them should surface the broken-pair issue
    expect(sofaIssues.length + coffeeIssues.length).toBeGreaterThan(0);
  });
});
