import { describe, it, expect } from "vitest";
import {
  reconcileSceneGraph,
  formatSceneGraphForPrompt,
} from "@/lib/agents/scene-reconciliation";
import { canonicalizeTerm, buildRelationGraph } from "@/lib/agents/relation-graph";
import type { RoomSceneGraphResponse } from "@/lib/types/schemas";

/**
 * These run through the REAL reconcileSceneGraph path rather than calling the
 * validator directly, because the thing worth protecting is the graph that
 * actually gets persisted and rendered into downstream prompts.
 */

function obj(category: string, label: string) {
  return {
    category,
    label,
    observed_in: [{ image_index: 0, view: "wide", bounding_box: null }],
    materials: [],
    colors: [],
    dimensions: null,
    placement: "",
    disposition: "unknown" as const,
    condition: "",
    confidence: 0.9,
  };
}

function response(
  relations: Array<{ subject: string; relation: string; object: string }>,
  categories: string[] = ["sofa", "coffee_table", "rug"],
): RoomSceneGraphResponse {
  return {
    summary: "A bright living room with a sofa, a coffee table and a rug on the floor.",
    objects: categories.map((c) => obj(c, c.replace(/_/g, " "))),
    relations,
    coverage: {
      walls_observed: ["north"],
      gaps: [],
      estimated_coverage: 0.8,
      suggested_shots: [],
    },
  } as RoomSceneGraphResponse;
}

const OPTS = { sourceImageUrls: ["https://example.test/a.jpg"], roomType: "living_room" };

function relate(raw: RoomSceneGraphResponse) {
  return reconcileSceneGraph(raw, OPTS).relations;
}

/** Render an edge as "<subjectLabel> <relation> <objectLabel>" for assertions. */
function readable(graph: ReturnType<typeof reconcileSceneGraph>) {
  const label = new Map(graph.objects.map((o) => [o.id, o.category]));
  return graph.relations.map(
    (r) => `${label.get(r.subject_id) ?? r.subject_id} ${r.relation} ${label.get(r.object_id) ?? r.object_id}`,
  );
}

describe("relation vocabulary", () => {
  it("drops a term that is not in the vocabulary", () => {
    // Previously `norm(r.relation)` stored whatever the model said, so a vague
    // or invented relation persisted as though it carried meaning.
    const rels = relate(
      response([
        { subject: "sofa", relation: "beside-ish", object: "coffee_table" },
        { subject: "sofa", relation: "kinda near", object: "rug" },
      ]),
    );
    expect(rels).toHaveLength(0);
  });

  it("keeps a real term and accepts common aliases", () => {
    expect(canonicalizeTerm("to the left of")).toBe("left_of");
    expect(canonicalizeTerm("next_to")).toBe("adjacent_to");
    expect(canonicalizeTerm("ON TOP OF")).toBe("on");
    expect(canonicalizeTerm("teleported past")).toBeNull();
  });
});

describe("inverse canonicalisation", () => {
  it("collapses 'B right_of A' onto the same fact as 'A left_of B'", () => {
    // One claim stated from either side must produce ONE row, otherwise nothing
    // downstream can tell they are the same fact.
    const both = reconcileSceneGraph(
      response([
        { subject: "sofa", relation: "left_of", object: "coffee_table" },
        { subject: "coffee_table", relation: "right_of", object: "sofa" },
      ]),
      OPTS,
    );
    expect(readable(both)).toEqual(["sofa left_of coffee_table"]);
  });

  it("stores a lone inverse in canonical direction", () => {
    const only = reconcileSceneGraph(
      response([{ subject: "coffee_table", relation: "right_of", object: "sofa" }]),
      OPTS,
    );
    expect(readable(only)).toEqual(["sofa left_of coffee_table"]);
  });

  it("treats adjacency as symmetric, not directional", () => {
    const graph = reconcileSceneGraph(
      response([
        { subject: "rug", relation: "adjacent_to", object: "sofa" },
        { subject: "sofa", relation: "adjacent_to", object: "rug" },
      ]),
      OPTS,
    );
    expect(graph.relations).toHaveLength(1);
  });
});

describe("contradictions", () => {
  it("drops BOTH edges when the same ordering is asserted each way", () => {
    // "A left_of B" and "B left_of A" cannot both hold. We cannot know which is
    // right, so keeping either would be a coin-flip presented as knowledge.
    const rels = relate(
      response([
        { subject: "sofa", relation: "left_of", object: "coffee_table" },
        { subject: "coffee_table", relation: "left_of", object: "sofa" },
      ]),
    );
    expect(rels).toHaveLength(0);
  });

  it("does not treat mutual 'facing' as a contradiction", () => {
    // Two armchairs really can face each other — this is a true, useful fact and
    // must survive.
    const graph = reconcileSceneGraph(
      response(
        [
          { subject: "armchair_a", relation: "facing", object: "armchair_b" },
          { subject: "armchair_b", relation: "facing", object: "armchair_a" },
        ],
        ["armchair_a", "armchair_b"],
      ),
      OPTS,
    );
    expect(graph.relations).toHaveLength(2);
  });
});

describe("cycles", () => {
  it("breaks a 3-cycle in an ordering relation", () => {
    const rels = relate(
      response([
        { subject: "sofa", relation: "left_of", object: "coffee_table" },
        { subject: "coffee_table", relation: "left_of", object: "rug" },
        { subject: "rug", relation: "left_of", object: "sofa" },
      ]),
    );
    // Two of the three are mutually consistent; the edge that closes the loop goes.
    expect(rels).toHaveLength(2);
  });

  it("keeps a chain that does not close a loop", () => {
    const rels = relate(
      response([
        { subject: "sofa", relation: "left_of", object: "coffee_table" },
        { subject: "coffee_table", relation: "left_of", object: "rug" },
      ]),
    );
    expect(rels).toHaveLength(2);
  });

  it("treats each ordering family as its own graph", () => {
    // A cycle in `left_of` says nothing about `above`; collapsing them would
    // delete true facts.
    const rels = relate(
      response([
        { subject: "sofa", relation: "left_of", object: "coffee_table" },
        { subject: "coffee_table", relation: "above", object: "rug" },
        { subject: "rug", relation: "above", object: "sofa" },
      ]),
    );
    expect(rels).toHaveLength(3);
  });
});

describe("prompt rendering", () => {
  it("emits a spatial layout section naming surviving relations", () => {
    // The regression this guards: relations were extracted, persisted, and never
    // rendered, so every downstream stage knew WHAT was in the room and nothing
    // about where it sat.
    const graph = reconcileSceneGraph(
      response([{ subject: "sofa", relation: "left_of", object: "coffee_table" }]),
      OPTS,
    );
    const out = formatSceneGraphForPrompt(graph);
    expect(out).toContain("SPATIAL LAYOUT");
    expect(out).toContain("sofa is left of coffee table");
  });

  it("omits the layout section entirely when nothing survived validation", () => {
    const graph = reconcileSceneGraph(
      response([{ subject: "sofa", relation: "beside-ish", object: "rug" }]),
      OPTS,
    );
    expect(formatSceneGraphForPrompt(graph)).not.toContain("SPATIAL LAYOUT");
  });
});

describe("determinism", () => {
  it("is byte-identical across runs and independent of input order", () => {
    const edges = [
      { subject: "rug", relation: "adjacent_to", object: "sofa" },
      { subject: "sofa", relation: "left_of", object: "coffee_table" },
      { subject: "coffee_table", relation: "above", object: "rug" },
    ];
    const forward = formatSceneGraphForPrompt(reconcileSceneGraph(response(edges), OPTS));
    const again = formatSceneGraphForPrompt(reconcileSceneGraph(response(edges), OPTS));
    const reversed = formatSceneGraphForPrompt(
      reconcileSceneGraph(response([...edges].reverse()), OPTS),
    );
    expect(again).toBe(forward);
    expect(reversed).toBe(forward);
  });
});

describe("dropped-reason accounting", () => {
  it("reports why each edge was discarded", () => {
    const report = buildRelationGraph(
      [
        { subject: "a", relation: "nonsense", object: "b" },
        { subject: "a", relation: "left_of", object: "a" },
        { subject: "a", relation: "left_of", object: "b" },
        { subject: "b", relation: "left_of", object: "a" },
        { subject: "c", relation: "on", object: "d" },
        { subject: "c", relation: "on", object: "d" },
      ],
      (t) => t,
    );
    expect(report.dropped.unknown_term).toBe(1);
    expect(report.dropped.self_loop).toBe(1);
    expect(report.dropped.contradiction).toBe(2);
    expect(report.dropped.duplicate).toBe(1);
    expect(report.relations).toHaveLength(1);
  });
});
