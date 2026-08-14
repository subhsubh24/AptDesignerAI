/**
 * Deterministic cross-view reconciliation for the room scene graph.
 *
 * The scene-assembler VLM call (scene-assembler.ts) sees every photo of a room
 * at once and is asked to merge the same physical object across angles. But the
 * multi-view literature is clear that VLMs are still unreliable at cross-view
 * correspondence ("Seeing from Another Perspective", CVPR/arXiv 2025), so we
 * never trust that merge alone. This module re-derives the canonical inventory
 * with pure, order-independent, LLM-free logic:
 *
 *   raw VLM objects (may duplicate the same sofa per angle)
 *     → normalize categories/attributes
 *     → greedily merge compatible same-category objects (deterministic sort first)
 *     → ground coverage against the floor plan
 *     → one canonical SceneObject per real object, with every photo linked back
 *
 * Everything here is deterministic: no Date.now(), no Math.random(), stable
 * sorts with explicit tiebreakers. `assembled_at` is injected by the caller, not
 * stamped here, so reconciliation output is byte-identical across runs.
 */

import type {
  RoomSceneGraph,
  SceneObject,
  SceneObjectObservation,
  SpatialRelation,
  CoverageReport,
  ExtractedFloorPlan,
  IdentifiedProductDimensions,
} from "@/lib/types/database";
import type { RoomSceneGraphResponse, SceneObjectRaw } from "@/lib/types/schemas";
import { buildRelationGraph, formatRelationsForPrompt } from "./relation-graph";

export const SCENE_GRAPH_VERSION = 1;

const DEFAULT_WALLS = ["north", "south", "east", "west"];

/** Lowercase, collapse separators to single underscore, trim. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normList(xs: string[] | undefined): string[] {
  return Array.from(new Set((xs ?? []).map(norm).filter(Boolean))).sort();
}

/** Stable signature used to sort raw objects so the greedy merge is
 *  order-independent (same inputs in any order → same output). */
function rawSignature(o: SceneObjectRaw): string {
  return [
    norm(o.category),
    norm(o.label),
    normList(o.colors).join(","),
    normList(o.materials).join(","),
    norm(o.placement),
  ].join("|");
}

/** Two same-category objects are the SAME physical object when they share a
 *  distinguishing attribute (a color, a material, or a placement) and their
 *  dimensions don't strongly conflict. Conservative by design: a false merge
 *  loses an object, so we only merge on positive evidence. */
function attributesCompatible(a: SceneObjectRaw, b: SceneObjectRaw): boolean {
  const aColors = new Set(normList(a.colors));
  const bColors = normList(b.colors);
  const aMats = new Set(normList(a.materials));
  const bMats = normList(b.materials);
  const aPlace = norm(a.placement);
  const bPlace = norm(b.placement);

  const sharesColor = bColors.some((c) => aColors.has(c));
  const sharesMaterial = bMats.some((m) => aMats.has(m));
  const samePlacement = aPlace !== "" && aPlace === bPlace;

  // If neither object carries any distinguishing attribute, fall back to
  // merging on category alone (two bare "pendant_light" with no other signal
  // are most likely the same fixture seen twice). Otherwise require a shared
  // attribute so two genuinely different chairs stay separate.
  const aHasSignal = aColors.size > 0 || aMats.size > 0 || aPlace !== "";
  const bHasSignal = bColors.length > 0 || bMats.length > 0 || bPlace !== "";
  if (!aHasSignal && !bHasSignal) return true;

  if (!(sharesColor || sharesMaterial || samePlacement)) return false;

  return dimensionsCompatible(a.dimensions, b.dimensions);
}

/** Dimensions conflict when a shared axis differs by >40% — that's two
 *  different-sized objects, not one seen from two angles. */
function dimensionsCompatible(
  a: IdentifiedProductDimensions | null,
  b: IdentifiedProductDimensions | null,
): boolean {
  if (!a || !b) return true;
  const axes: Array<keyof IdentifiedProductDimensions> = ["width_in", "depth_in", "height_in"];
  for (const axis of axes) {
    const av = a[axis];
    const bv = b[axis];
    if (typeof av === "number" && typeof bv === "number" && av > 0 && bv > 0) {
      const ratio = av > bv ? av / bv : bv / av;
      if (ratio > 1.4) return false;
    }
  }
  return true;
}

function pickDimensions(members: SceneObjectRaw[]): IdentifiedProductDimensions | null {
  for (const m of members) if (m.dimensions) return m.dimensions;
  return null;
}

/** Map a raw object's per-photo observations to URLs, dropping out-of-range
 *  indices, deduping by (image_url, bbox). */
function buildObservations(
  members: SceneObjectRaw[],
  sourceImageUrls: string[],
): SceneObjectObservation[] {
  const byKey = new Map<string, SceneObjectObservation>();
  for (const m of members) {
    for (const obs of m.observed_in) {
      const url = sourceImageUrls[obs.image_index];
      if (!url) continue;
      const key = `${url}|${obs.bounding_box ? JSON.stringify(obs.bounding_box) : ""}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        image_url: url,
        bounding_box: obs.bounding_box ?? null,
        view: obs.view || undefined,
      });
    }
  }
  // Stable order: by image_url then serialized bbox.
  return Array.from(byKey.values()).sort((x, y) => {
    if (x.image_url !== y.image_url) return x.image_url < y.image_url ? -1 : 1;
    return JSON.stringify(x.bounding_box) < JSON.stringify(y.bounding_box) ? -1 : 1;
  });
}

function reconcileDisposition(
  raw: SceneObjectRaw[],
  category: string,
  label: string,
  keepItems: string[],
  replaceItems: string[],
): SceneObject["disposition"] {
  const hay = `${norm(category)} ${norm(label)}`;
  const matches = (items: string[]) =>
    items.some((it) => {
      const t = norm(it);
      return t !== "" && (hay.includes(t) || t.includes(norm(category)));
    });
  // User intent (keep/replace lists) is authoritative over the model's guess.
  if (matches(replaceItems)) return "replace";
  if (matches(keepItems)) return "keep";
  const explicit = raw.find((r) => r.disposition && r.disposition !== "unknown");
  return explicit?.disposition ?? "unknown";
}

/** Merge same-category raw objects into canonical SceneObjects. */
function mergeObjects(
  rawObjects: SceneObjectRaw[],
  sourceImageUrls: string[],
  keepItems: string[],
  replaceItems: string[],
): { objects: SceneObject[]; duplicatesMerged: number } {
  // Group by normalized category, sorting members by a stable signature so the
  // greedy merge below is independent of the order the model emitted objects in.
  const byCategory = new Map<string, SceneObjectRaw[]>();
  for (const o of rawObjects) {
    const cat = norm(o.category) || "unknown";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(o);
  }

  const canonical: SceneObject[] = [];
  let duplicatesMerged = 0;

  for (const cat of Array.from(byCategory.keys()).sort()) {
    const members = byCategory
      .get(cat)!
      .slice()
      .sort((a, b) => (rawSignature(a) < rawSignature(b) ? -1 : rawSignature(a) > rawSignature(b) ? 1 : 0));

    // Greedy clustering: each member joins the first existing cluster it's
    // compatible with, else starts a new one.
    const clusters: SceneObjectRaw[][] = [];
    for (const m of members) {
      let placed = false;
      for (const cluster of clusters) {
        if (cluster.some((c) => attributesCompatible(c, m))) {
          cluster.push(m);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([m]);
    }

    clusters.forEach((cluster, idx) => {
      duplicatesMerged += cluster.length - 1;
      const colors = normListPreserve(cluster.flatMap((c) => c.colors ?? []));
      const materials = normListPreserve(cluster.flatMap((c) => c.materials ?? []));
      const observations = buildObservations(cluster, sourceImageUrls);
      const distinctImages = new Set(observations.map((o) => o.image_url)).size;
      const label = cluster.find((c) => c.label)?.label || cat.replace(/_/g, " ");
      const placement = cluster.find((c) => c.placement)?.placement || undefined;
      const condition = cluster.find((c) => c.condition)?.condition || undefined;

      // Confidence: take the max member confidence, nudged up when the same
      // object was independently seen in multiple distinct photos (corroboration),
      // capped at 1.
      const baseConf = Math.max(...cluster.map((c) => c.confidence ?? 0.5));
      const corroboration = distinctImages >= 2 ? 0.1 : 0;
      const confidence = Math.min(1, Number((baseConf + corroboration).toFixed(3)));

      // Flag colors that disagreed across views (e.g. lighting differences).
      const distinctColorSets = new Set(cluster.map((c) => normList(c.colors).join(",")).filter(Boolean));
      const crossViewNote =
        cluster.length > 1 && distinctColorSets.size > 1
          ? `Color appearance varied across angles: ${colors.join(", ")} (likely lighting).`
          : undefined;

      canonical.push({
        id: `${cat}_${idx + 1}`,
        category: cat,
        label,
        observed_in: observations,
        materials: materials.length ? materials : undefined,
        colors: colors.length ? colors : undefined,
        dimensions: pickDimensions(cluster),
        placement,
        disposition: reconcileDisposition(cluster, cat, label, keepItems, replaceItems),
        condition,
        confidence,
        merged_from_multiple_views: cluster.length > 1 || distinctImages >= 2,
        cross_view_notes: crossViewNote,
      });
    });
  }

  // Stable final order: by category then id.
  canonical.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { objects: canonical, duplicatesMerged };
}

/** Dedup while preserving a deterministic (sorted) order but keeping the
 *  original surface form of the first occurrence. */
function normListPreserve(xs: string[]): string[] {
  const seen = new Map<string, string>();
  for (const x of xs) {
    const k = norm(x);
    if (k && !seen.has(k)) seen.set(k, x.trim());
  }
  return Array.from(seen.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, v]) => v);
}

/** Resolve a raw relation endpoint string to a canonical object id when it
 *  clearly names one; otherwise keep the token (e.g. a wall direction). */
function resolveEndpoint(token: string, objects: SceneObject[]): string {
  const t = norm(token);
  if (!t) return token;
  const exact = objects.find((o) => norm(o.category) === t || norm(o.label) === t);
  if (exact) return exact.id;
  const partial = objects.find((o) => t.includes(norm(o.category)) || norm(o.label).includes(t));
  return partial ? partial.id : token;
}

/**
 * Build the spatial relation graph, then hand it to the deterministic validator
 * (relation-graph.ts) which canonicalises inverses and removes any claim that is
 * geometrically impossible.
 *
 * This used to dedupe by key, drop self-loops, and sort — which let two real
 * problems through: an invented relation term was stored verbatim, and a pair
 * like "A left_of B" + "B left_of A" survived intact because those are distinct
 * keys and neither is a self-loop. Now that these edges are rendered into
 * downstream prompts, an unchecked graph would be actively misleading rather
 * than merely unused.
 */
function buildRelations(
  raw: RoomSceneGraphResponse["relations"],
  objects: SceneObject[],
): SpatialRelation[] {
  return buildRelationGraph(raw, (token) => resolveEndpoint(token, objects)).relations;
}

/** Compute coverage, grounding observed walls against the floor plan (or the
 *  4 cardinal walls when no plan exists). Unseen walls become gaps and concrete
 *  "take this shot" suggestions. */
export function groundCoverage(
  raw: RoomSceneGraphResponse["coverage"],
  roomType: string,
  floorPlan?: ExtractedFloorPlan,
): CoverageReport {
  const observed = normList(raw.walls_observed);

  // Expected walls: from the matching floor-plan room if available, else cardinal.
  //
  // The match must identify exactly ONE room. `?? floorPlan.rooms[0]` took the
  // literal first room in the array whenever the type did not match — and it
  // never matches for the five DB room types the extractor has no bucket for
  // (bedroom_2/3, bathroom_2/3, main_room), so Bedroom 2's expected walls were
  // whichever room the extractor happened to list first, often the living room.
  // That propagates: `gaps` becomes "Unseen areas (no photo): …" in downstream
  // prompts (formatSceneGraphForPrompt) and in the user-facing progress line,
  // both stated as fact. DEFAULT_WALLS — the four cardinals — is the honest
  // answer when we cannot say which room this is. See matchSingleRoom in
  // lib/agents/format-floor-plan for the same rule.
  let expected = DEFAULT_WALLS;
  if (floorPlan?.rooms?.length) {
    const matches = floorPlan.rooms.filter((r) => norm(r.room_type) === norm(roomType));
    const match = matches.length === 1 ? matches[0] : undefined;
    const planWalls = (match?.walls ?? []).map((w) => norm(w.direction)).filter(Boolean);
    if (planWalls.length) expected = Array.from(new Set(planWalls)).sort();
  }

  const missingWalls = expected.filter((w) => !observed.some((o) => o === w || o.includes(w) || w.includes(o)));
  const gaps = Array.from(new Set([...normList(raw.gaps), ...missingWalls])).sort();

  const planCoverage = expected.length ? observed.length / expected.length : raw.estimated_coverage;
  // Conservative: never claim more coverage than either the model or the
  // wall-ratio estimate.
  const estimated_coverage = Number(Math.max(0, Math.min(1, Math.min(raw.estimated_coverage, planCoverage))).toFixed(2));

  const suggested = new Set<string>(raw.suggested_shots ?? []);
  for (const g of missingWalls) {
    suggested.add(`Add a photo showing the ${g} wall — it isn't visible in any current shot.`);
  }
  if (observed.length <= 1 && missingWalls.length === 0) {
    suggested.add("Add a few more angles so the whole room is covered, not just one wall.");
  }

  return {
    walls_observed: observed,
    gaps,
    estimated_coverage,
    suggested_shots: Array.from(suggested).sort(),
  };
}

export interface ReconcileOptions {
  sourceImageUrls: string[];
  roomType: string;
  keepItems?: string[];
  replaceItems?: string[];
  floorPlan?: ExtractedFloorPlan;
  modelUsed?: string;
}

/**
 * Turn the raw VLM scene assembly into a clean, deduped, floor-plan-grounded
 * RoomSceneGraph. Pure and deterministic — `assembled_at` is intentionally NOT
 * set here (the caller stamps it outside deterministic paths).
 */
export function reconcileSceneGraph(
  raw: RoomSceneGraphResponse,
  opts: ReconcileOptions,
): RoomSceneGraph {
  const { objects, duplicatesMerged } = mergeObjects(
    raw.objects,
    opts.sourceImageUrls,
    opts.keepItems ?? [],
    opts.replaceItems ?? [],
  );
  const relations = buildRelations(raw.relations, objects);
  const coverage = groundCoverage(raw.coverage, opts.roomType, opts.floorPlan);

  return {
    version: SCENE_GRAPH_VERSION,
    room_type: opts.roomType,
    summary: raw.summary?.trim() ?? "",
    objects,
    relations,
    coverage,
    source_image_urls: opts.sourceImageUrls.slice(),
    reconciled_duplicate_count: duplicatesMerged,
    floor_plan_grounded: !!opts.floorPlan,
    model_used: opts.modelUsed,
  };
}

/**
 * LLM-FREE quality gate used as the self-consistency escalation trigger. A graph
 * is acceptable when it actually found objects and produced a summary. A
 * degenerate result (photos given but nothing extracted) escalates to N=3.
 * Contractually deterministic — safe to pass to escalate()/selfConsistent().
 */
export function sceneGraphQualityOk(graph: RoomSceneGraph): boolean {
  return graph.objects.length >= 1 && graph.summary.trim().length >= 20;
}

/**
 * Compact, human-readable inventory block for downstream prompts (search brief,
 * placement, mockups) — the deduped "what's already in this room" context. Empty
 * string when there's nothing, so callers stay byte-equivalent to pre-feature.
 */
export function formatSceneGraphForPrompt(graph: RoomSceneGraph | null | undefined): string {
  if (!graph || graph.objects.length === 0) return "";
  const lines = graph.objects.map((o) => {
    const bits = [o.label || o.category.replace(/_/g, " ")];
    if (o.colors?.length) bits.push(`colors: ${o.colors.join(", ")}`);
    if (o.materials?.length) bits.push(`materials: ${o.materials.join(", ")}`);
    if (o.placement) bits.push(`placed: ${o.placement}`);
    if (o.disposition && o.disposition !== "unknown") bits.push(o.disposition.toUpperCase());
    const views = o.observed_in.length;
    bits.push(`seen in ${views} photo${views === 1 ? "" : "s"}`);
    return `- ${bits.join(" · ")}`;
  });
  const gaps = graph.coverage.gaps.length
    ? `\nUnseen areas (no photo): ${graph.coverage.gaps.join(", ")}.`
    : "";

  // The spatial layout was previously extracted, persisted, and then dropped on
  // the floor — every downstream stage knew WHAT was in the room and nothing
  // about where anything sat. Emit it now that the graph is validated. Endpoints
  // that are wall/direction tokens rather than object ids pass through as-is.
  const labelById = new Map(
    graph.objects.map((o) => [o.id, o.label || o.category.replace(/_/g, " ")]),
  );
  const layout = formatRelationsForPrompt(graph.relations, (id) =>
    labelById.get(id) ?? id.replace(/_/g, " "),
  );
  const layoutBlock = layout ? `\n\n${layout}` : "";

  return `ROOM INVENTORY (deduped across all ${graph.source_image_urls.length} photos):\n${lines.join("\n")}${gaps}${layoutBlock}`;
}
