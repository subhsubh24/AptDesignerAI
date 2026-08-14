/**
 * Deterministic validation and canonicalisation of the room's spatial relation
 * graph — the "Layout Corrector / Layout Refiner" half of scene reconciliation.
 *
 * WHY THIS EXISTS. The scene-assembler VLM is asked for `relations` describing
 * how objects sit relative to each other and the walls. Nothing checked that
 * output, so three classes of nonsense reached the persisted graph:
 *
 *   1. Invented vocabulary — `relation` was stored verbatim, so "beside-ish"
 *      or "kinda near" persisted as if it meant something.
 *   2. Un-normalised inverses — "sofa left_of table" and "table right_of sofa"
 *      are ONE fact stored as two unrelated rows, so neither dedupe nor any
 *      contradiction check could see them as the same claim.
 *   3. Impossible geometry — "A left_of B" together with "B left_of A" both
 *      survived (different keys, neither a self-loop). Likewise a 3-cycle
 *      A → B → C → A. Both are physically impossible in one dimension.
 *
 * I-Design (arXiv 2404.02838) splits exactly this into two agent stages: a
 * Layout Corrector that removes spatially implausible edges, and a Layout
 * Refiner that verifies the graph is acyclic. We do the same work with pure
 * deterministic code instead of another model call — it is cheaper, it cannot
 * hallucinate, and per this repo's cost contract a verifier must never be an
 * LLM.
 *
 * WHAT WE DO NOT DO. We never repair by inventing an edge. Every operation here
 * only ever DROPS a claim we cannot trust. A thinner graph that is true beats a
 * fuller one that contradicts itself, because the graph is about to be handed
 * to downstream prompts as fact.
 *
 * Determinism: no Date.now(), no Math.random(); every sort carries an explicit
 * final tiebreaker, and cycle-breaking always removes the same edge for the same
 * input regardless of arrival order.
 *
 * NOT TO BE CONFUSED WITH lib/validation/spatial-graph.ts. That one reasons about
 * the room TOPOLOGY of a PROPOSED design — it parses placement strings for
 * recommended products and scores traffic flow, dead zones, and sight-lines. This
 * module validates the relation edges the VLM extracted from PHOTOS of the room
 * as it already is. Different input, different pipeline stage; they never see the
 * same data.
 */

import type { SpatialRelation } from "@/lib/types/database";

/** Lowercase, collapse whitespace/separators to single underscore, trim. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * ORDERING relations: asymmetric AND transitive along one axis. Mutual edges are
 * a contradiction and cycles are impossible, so both are checked.
 *
 * Each pair is stored canonically as the KEY, with the inverse rewritten by
 * swapping endpoints — that is what makes "A left_of B" and "B right_of A"
 * collapse to a single row.
 */
const ORDERING_INVERSES: Record<string, string> = {
  left_of: "right_of",
  in_front_of: "behind",
  above: "below",
  on: "under",
};

/** inverse term -> canonical term (right_of -> left_of, …). */
const INVERSE_TO_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(ORDERING_INVERSES).map(([canonical, inverse]) => [inverse, canonical]),
);

/** Aliases the model reliably emits for a canonical term. */
const ALIASES: Record<string, string> = {
  left: "left_of",
  to_the_left_of: "left_of",
  right: "right_of",
  to_the_right_of: "right_of",
  in_front: "in_front_of",
  front_of: "in_front_of",
  infront_of: "in_front_of",
  over: "above",
  underneath: "under",
  beneath: "under",
  on_top_of: "on",
  next_to: "adjacent_to",
  beside: "adjacent_to",
  adjacent: "adjacent_to",
  faces: "facing",
  facing_towards: "facing",
  corner: "in_corner",
  in_the_corner: "in_corner",
};

/**
 * SYMMETRIC relations: "A adjacent_to B" and "B adjacent_to A" are the same
 * fact, so endpoints are sorted to one canonical order and deduped. Mutual
 * edges are NOT a contradiction here.
 */
const SYMMETRIC = new Set(["adjacent_to"]);

/**
 * FREE relations: directional but not an ordering, so mutual edges are legal and
 * no cycle check applies. Two armchairs genuinely can face each other — treating
 * `facing` as an ordering would delete a true and useful fact.
 */
const FREE = new Set(["facing", "in_corner"]);

const CANONICAL_TERMS = new Set([
  ...Object.keys(ORDERING_INVERSES),
  ...SYMMETRIC,
  ...FREE,
]);

/** The vocabulary the prompt is allowed to use, for docs and prompt-building. */
export const RELATION_VOCABULARY: readonly string[] = [
  ...Object.keys(ORDERING_INVERSES),
  ...Object.values(ORDERING_INVERSES),
  ...SYMMETRIC,
  ...FREE,
].sort();

export interface RelationGraphReport {
  /** Trustworthy edges, canonicalised and deterministically ordered. */
  relations: SpatialRelation[];
  /** Counts of what was discarded, by reason — surfaced for observability. */
  dropped: {
    unknown_term: number;
    self_loop: number;
    contradiction: number;
    cycle: number;
    duplicate: number;
  };
}

/** Resolve a raw term to its canonical form, or null if it is not vocabulary. */
export function canonicalizeTerm(raw: string): string | null {
  const t = norm(raw);
  if (!t) return null;
  const aliased = ALIASES[t] ?? t;
  return CANONICAL_TERMS.has(aliased) || aliased in INVERSE_TO_CANONICAL ? aliased : null;
}

function edgeKey(r: SpatialRelation): string {
  return `${r.subject_id}|${r.relation}|${r.object_id}`;
}

/** Stable ordering: relation, then subject, then object. Total and explicit. */
function compareEdges(a: SpatialRelation, b: SpatialRelation): number {
  const ka = edgeKey(a);
  const kb = edgeKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Validate, canonicalise, and de-conflict a set of raw relation edges.
 *
 * Endpoints are assumed already resolved to canonical ids by the caller; this
 * function is purely about the relation term and the shape of the graph.
 */
export function buildRelationGraph(
  raw: Array<{ subject: string; relation: string; object: string } | null | undefined>,
  resolveEndpoint: (token: string) => string,
): RelationGraphReport {
  const dropped: RelationGraphReport["dropped"] = {
    unknown_term: 0,
    self_loop: 0,
    contradiction: 0,
    cycle: 0,
    duplicate: 0,
  };

  // --- pass 1: canonicalise term + endpoints, drop junk -----------------------
  const byKey = new Map<string, SpatialRelation>();
  for (const r of raw) {
    if (!r || !r.subject || !r.relation || !r.object) continue;

    const term = canonicalizeTerm(r.relation);
    if (!term) {
      dropped.unknown_term++;
      continue;
    }

    let subject_id = resolveEndpoint(r.subject);
    let object_id = resolveEndpoint(r.object);
    let relation = term;

    // Rewrite an inverse into its canonical direction by swapping endpoints, so
    // "table right_of sofa" becomes "sofa left_of table" and collides with the
    // identical claim stated the other way round.
    if (relation in INVERSE_TO_CANONICAL) {
      relation = INVERSE_TO_CANONICAL[relation];
      [subject_id, object_id] = [object_id, subject_id];
    }

    if (subject_id === object_id) {
      dropped.self_loop++;
      continue;
    }

    // Symmetric relations get their endpoints sorted, so both statements of the
    // same adjacency land on one key.
    if (SYMMETRIC.has(relation) && subject_id > object_id) {
      [subject_id, object_id] = [object_id, subject_id];
    }

    const edge: SpatialRelation = { subject_id, relation, object_id };
    const key = edgeKey(edge);
    if (byKey.has(key)) {
      dropped.duplicate++;
      continue;
    }
    byKey.set(key, edge);
  }

  // --- pass 2: drop mutual edges on ORDERING relations (contradictions) -------
  // "A left_of B" AND "B left_of A" cannot both hold. We cannot tell which the
  // model got right, so we drop BOTH rather than coin-flip a survivor — an
  // arbitrary winner would look like knowledge while being 50% wrong.
  const contradicted = new Set<string>();
  for (const edge of byKey.values()) {
    if (!(edge.relation in ORDERING_INVERSES)) continue;
    const mirrorKey = `${edge.object_id}|${edge.relation}|${edge.subject_id}`;
    if (byKey.has(mirrorKey)) {
      contradicted.add(edgeKey(edge));
      contradicted.add(mirrorKey);
    }
  }
  for (const key of contradicted) {
    byKey.delete(key);
    dropped.contradiction++;
  }

  // --- pass 3: break cycles per ordering family ------------------------------
  // "A left_of B, B left_of C, C left_of A" is impossible along one axis. Each
  // ordering relation is its own independent graph — a cycle in `left_of` says
  // nothing about `above`.
  let surviving = Array.from(byKey.values()).sort(compareEdges);

  for (const family of Object.keys(ORDERING_INVERSES)) {
    const familyEdges = surviving.filter((e) => e.relation === family);
    if (familyEdges.length < 2) continue;

    const kept: SpatialRelation[] = [];
    const adjacency = new Map<string, string[]>();

    // Add edges in deterministic order, keeping each only if it does not close a
    // cycle against what is already kept. Because the input is sorted, the edge
    // dropped for any given cycle is always the same one.
    for (const edge of familyEdges) {
      if (reaches(adjacency, edge.object_id, edge.subject_id)) {
        dropped.cycle++;
        continue;
      }
      kept.push(edge);
      const outs = adjacency.get(edge.subject_id) ?? [];
      outs.push(edge.object_id);
      adjacency.set(edge.subject_id, outs);
    }

    if (kept.length !== familyEdges.length) {
      const keptKeys = new Set(kept.map(edgeKey));
      surviving = surviving.filter(
        (e) => e.relation !== family || keptKeys.has(edgeKey(e)),
      );
    }
  }

  return { relations: surviving.sort(compareEdges), dropped };
}

/** Depth-first reachability over the kept-edge adjacency (iterative, cycle-safe). */
function reaches(
  adjacency: Map<string, string[]>,
  from: string,
  target: string,
): boolean {
  if (from === target) return true;
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const node = stack.pop() as string;
    for (const next of adjacency.get(node) ?? []) {
      if (next === target) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/** Human-readable phrasing for a canonical term, used in prompt rendering. */
const PHRASING: Record<string, string> = {
  left_of: "is left of",
  in_front_of: "is in front of",
  above: "is above",
  on: "sits on",
  adjacent_to: "is next to",
  facing: "faces",
  in_corner: "is in the corner of",
};

/**
 * Render the surviving relations as a compact spatial-layout block for a prompt.
 *
 * `labelFor` maps an endpoint id to a human label; endpoints that are wall or
 * direction tokens (not object ids) pass through as-is. Returns "" when there is
 * nothing trustworthy to say, so callers stay byte-identical to before.
 */
export function formatRelationsForPrompt(
  relations: SpatialRelation[],
  labelFor: (id: string) => string,
): string {
  if (!relations.length) return "";
  const lines = relations.map((r) => {
    const verb = PHRASING[r.relation] ?? r.relation.replace(/_/g, " ");
    return `- ${labelFor(r.subject_id)} ${verb} ${labelFor(r.object_id)}`;
  });
  return `SPATIAL LAYOUT (validated — contradictory and cyclic claims removed):\n${lines.join("\n")}`;
}
