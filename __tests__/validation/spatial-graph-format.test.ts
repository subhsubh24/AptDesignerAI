import { describe, it, expect } from "vitest";
import { formatSpatialGraphForPrompt } from "@/lib/validation/spatial-graph";
import type { SpatialGraphResult } from "@/lib/validation/spatial-graph";

// Covers formatSpatialGraphForPrompt — the prompt-rendering surface fed into
// harmony-math's diagnostic block. The scoring fn (buildSpatialGraph) is covered
// separately in spatial-graph.test.ts; this pins the FORMATTER's distinct
// branches so a rendering regression can't silently corrupt the traffic-flow
// evidence the diagnosis LLM reads.

function makeResult(overrides: Partial<SpatialGraphResult> = {}): SpatialGraphResult {
  return {
    overall: 0.8,
    traffic_flow_score: 0.9,
    zone_coverage_score: 0.7,
    sight_line_score: 0.85,
    adjacency_score: 0.6,
    dead_zones: [],
    traffic_conflicts: [],
    sight_line_blocks: [],
    broken_pairs: [],
    nodes: [],
    ...overrides,
  };
}

describe("formatSpatialGraphForPrompt", () => {
  it("renders the header and every sub-score with two decimals", () => {
    const out = formatSpatialGraphForPrompt(
      makeResult({
        overall: 0.5,
        traffic_flow_score: 0.4,
        zone_coverage_score: 0.3,
        sight_line_score: 0.2,
        adjacency_score: 0.1,
      }),
    );
    expect(out).toContain("### Spatial Graph / Traffic Flow: 0.50/1.0");
    expect(out).toContain("- Traffic flow: 0.40");
    expect(out).toContain("- Zone coverage: 0.30");
    expect(out).toContain("- Sight-lines: 0.20");
    expect(out).toContain("- Adjacency (natural pairs): 0.10");
  });

  it("emits the DEAD ZONES line only when dead_zones is non-empty", () => {
    const out = formatSpatialGraphForPrompt(
      makeResult({ dead_zones: ["north_wall", "near_window"] }),
    );
    expect(out).toContain("- DEAD ZONES (no floor furniture): north_wall, near_window");
  });

  it("suppresses the DEAD ZONES line when dead_zones is empty — proving the guard is independent of the other loops", () => {
    // Supply a non-empty traffic_conflicts array so the assertion proves the
    // dead_zones guard short-circuits INDEPENDENTLY: a broken guard would leak a
    // phantom "DEAD ZONES (no floor furniture):" header for a well-covered room.
    const out = formatSpatialGraphForPrompt(
      makeResult({
        dead_zones: [],
        traffic_conflicts: [{ item: "bookshelf", path: "entry", reason: "blocks the doorway" }],
      }),
    );
    expect(out).not.toContain("DEAD ZONES");
    // Other content still renders — the guard didn't suppress the whole block.
    expect(out).toContain("TRAFFIC CONFLICT");
  });

  it("renders each traffic conflict with item, path, and reason", () => {
    const out = formatSpatialGraphForPrompt(
      makeResult({
        traffic_conflicts: [{ item: "armchair", path: "sofa-to-window", reason: "sits in the walkway" }],
      }),
    );
    expect(out).toContain('- TRAFFIC CONFLICT: armchair on "sofa-to-window" — sits in the walkway');
  });

  it("renders each sight-line block with blocker and target", () => {
    const out = formatSpatialGraphForPrompt(
      makeResult({
        sight_line_blocks: [{ blocker: "tall_shelf", target: "the window" }],
      }),
    );
    expect(out).toContain("- SIGHT-LINE BLOCK: tall_shelf obstructs the window");
  });

  it("renders each broken pair with both items and the reason", () => {
    const out = formatSpatialGraphForPrompt(
      makeResult({
        broken_pairs: [{ item1: "sofa", item2: "coffee_table", reason: "placed in different zones" }],
      }),
    );
    expect(out).toContain("- BROKEN PAIR: sofa + coffee_table — placed in different zones");
  });
});
