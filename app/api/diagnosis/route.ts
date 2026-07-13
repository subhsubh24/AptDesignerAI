import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { runRoomDiagnosis } from "@/lib/agents/room-diagnostician";
import { assembleRoomSceneGraph } from "@/lib/agents/scene-assembler";
import {
  runDiagnosisExpansion,
  type ExpansionBudget,
  type SiblingRoomSummary,
} from "@/lib/agents/greedy-decorator";
import type { AdaptiveCapContext } from "@/lib/validation/saturation-math";
import { validateDiagnosisAsync } from "@/lib/agents/diagnosis-validator";
import { selfReviewDiagnosis } from "@/lib/agents/self-correction";
import { runIdentifiedProductsPipeline } from "@/lib/agents/identified-products-pipeline";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { getRoomFromFloorPlan } from "@/lib/agents/format-floor-plan";
import { inferUserPreferences, type PreferenceSignals } from "@/lib/design-context/infer-preferences";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { sanitizeUserContext } from "@/lib/utils/sanitize-prompt";
import { createLogger } from "@/lib/logging/logger";
import { withTrace } from "@/lib/observability/tracing";
import { runWithMarginSession } from "@/lib/observability/margin-context";
import type { AgentContext } from "@/lib/agents/types";
import type {
  ActionItem,
  BudgetMode,
  DesignDirection,
  DiagnosisData,
} from "@/lib/types/database";

const log = createLogger("diagnosis-route");

// Long-running LLM pipeline route. Without an explicit maxDuration, Vercel
// applies a short platform default and can kill the function mid-run — a
// "builds green, request gets killed" failure on a core product path. 300s is
// the Vercel Pro ceiling and covers the documented worst-case pipeline latency.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit
  const limit = checkRateLimit(`diagnosis:${user.id}`, RATE_LIMITS.diagnosis);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many diagnosis requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } }
    );
  }

  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  let body: { room_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id } = body;

  // Wrap the rest of the handler so every agent/logger call inherits a
  // shared trace id. OTel export is opt-in via OTEL_EXPORTER_OTLP_ENDPOINT.
  //
  // Margin: also open this journey run's SHARED session (room-scoped) so every
  // LLM call in the diagnosis pipeline links into the same supply-chain, tagged
  // with the "diagnosis" step. Guarded on a valid room_id (validated again
  // inside the handler); sub-agents refine the operation via withMarginOperation.
  return withTrace(
    "diagnosis.POST",
    () =>
      typeof room_id === "string"
        ? runWithMarginSession(room_id, "diagnosis", () =>
            handleDiagnosisPost(supabase, user.id, room_id),
          )
        : handleDiagnosisPost(supabase, user.id, room_id),
    { userId: user.id, route: "diagnosis" }
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleDiagnosisPost(supabase: any, userId: string, room_id: unknown) {
  if (!room_id || typeof room_id !== "string") {
    return NextResponse.json({ error: "room_id required" }, { status: 400 });
  }

  // Ownership guard BEFORE the (paid) diagnosis pipeline: room_id is
  // client-supplied and the memory-store read is not user-scoped, so without
  // this check any authenticated caller could run diagnosis on — and write a
  // diagnosis row into — another user's room (IDOR + LLM-cost abuse).
  if (!(await userOwnsRoom(supabase, room_id, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch room + images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const imageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);
  if (imageUrls.length === 0) {
    return NextResponse.json({ error: "Upload room photos first" }, { status: 400 });
  }

  // Create agent run for logging
  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "diagnostician",
    input_json: { room_type: room.room_type, image_count: imageUrls.length },
  });

  // Load the project (design-profile context) and infer user preferences from
  // sibling rooms concurrently — both depend only on project_id/room_id, not on
  // each other, so serializing them wasted a round-trip on this hot path.
  // inferUserPreferences is best-effort: if it fails, diagnosis runs without
  // preference signals (closes the "nothing learns" gap when it succeeds).
  const [{ data: project }, inferredPreferences] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("id", room.project_id)
      .single(),
    inferUserPreferences(supabase, room.project_id, room_id),
  ]);

  const profile = buildDesignProfile(project);

  if (profile && inferredPreferences) {
    profile.inferredPreferences = inferredPreferences;
  }
  if (inferredPreferences) {
    log.info("User preference signals inferred", {
      room_id,
      sourceRoomCount: inferredPreferences.source_room_count,
      densityPreference: inferredPreferences.density_preference,
      budgetPressure: inferredPreferences.budget_pressure,
    });
  }

  // Sanitize user context before it enters the AI pipeline
  const rawUserContext = room.user_context || undefined;
  const sanitized = rawUserContext ? sanitizeUserContext(rawUserContext) : null;
  if (sanitized?.injectionDetected || sanitized?.piiCategories.length) {
    log.warn("User context flagged by pre-LLM guardrails", {
      room_id,
      injectionDetected: sanitized.injectionDetected,
      detectedPatterns: sanitized.detectedPatterns,
      piiCategories: sanitized.piiCategories,
    });
  }

  // Extract floor plan data from building_research (if user has uploaded one)
  const br = project?.building_research as Record<string, unknown> | undefined;
  const floorPlanImageUrl = br?.floor_plan_image_url as string | undefined;
  const extractedFloorPlan = br?.extracted_floor_plan as import("@/lib/types/database").ExtractedFloorPlan | undefined;

  // Build cross-room coherence context so the design direction
  // considers palettes/materials already chosen for sibling rooms.
  let otherRoomsContext: string | undefined;
  if (project) {
    const { data: otherRooms } = await supabase
      .from("rooms")
      .select("id, name, room_type")
      .eq("project_id", room.project_id)
      .neq("id", room_id);
    if (otherRooms && otherRooms.length > 0) {
      // 90-day freshness window — palette/material choices older than that
      // reflect a prior user preference that has likely evolved. Falling back
      // to stale sibling context pulls the current room toward a direction
      // the user no longer wants.
      const staleCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data: otherDiagnoses } = await supabase
        .from("room_diagnoses")
        .select("room_id, design_direction_json, created_at")
        .in("room_id", otherRooms.map((r: { id: string }) => r.id))
        .gte("created_at", staleCutoff);
      const otherRoomSummaries: string[] = [];
      for (const otherRoom of otherRooms) {
        const otherDiag = otherDiagnoses?.find(
          (d: { room_id: string }) => d.room_id === otherRoom.id
        );
        const dd = otherDiag?.design_direction_json as { style_notes?: string; recommended_palette?: string[]; recommended_materials?: string[] } | undefined;
        let summary = `${otherRoom.name} (${otherRoom.room_type})`;
        if (dd?.style_notes) summary += `: ${dd.style_notes}`;
        if (dd?.recommended_palette?.length) summary += ` | Palette: ${dd.recommended_palette.join(", ")}`;
        if (dd?.recommended_materials?.length) summary += ` | Materials: ${dd.recommended_materials.join(", ")}`;
        otherRoomSummaries.push(summary);
      }
      if (otherRoomSummaries.length > 0) {
        otherRoomsContext = `Other rooms in apartment:\n${otherRoomSummaries.join("\n")}`;
      }
    }
  }

  // Build context and run diagnosis
  const ctx: AgentContext = {
    roomId: room_id,
    roomType: room.room_type,
    keepItems: room.keep_items || [],
    replaceItems: room.replace_items || [],
    priorities: room.priorities || [],
    budgetMode: room.budget_mode,
    sourcingMode: room.sourcing_mode,
    imageUrls,
    userContext: sanitized?.sanitized || rawUserContext,
    floorPlanImageUrl,
    extractedFloorPlan,
    otherRoomsContext,
  };

  // Multi-view scene assembly runs concurrently with diagnosis — both read the
  // same photos, so this adds holistic cross-angle understanding at ~zero extra
  // latency. Best-effort: a failure never blocks the diagnosis (scene_graph_json
  // is just left null). Awaited just before the DB insert below.
  const sceneGraphPromise = assembleRoomSceneGraph(ctx).catch((err) => {
    log.warn("scene assembly threw — continuing without scene graph", { room_id, error: String(err) });
    return { success: false as const, error: String(err) };
  });

  const result = await runRoomDiagnosis(ctx, profile);

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Diagnosis failed" }, { status: 500 });
  }

  // Self-review: LLM checks its own diagnosis for internal consistency
  {
    const selfReview = await selfReviewDiagnosis(
      result.data.diagnosis as unknown as Record<string, unknown>,
      result.data.design_direction as unknown as Record<string, unknown>,
      ctx.roomType,
    );
    if (selfReview.wasCorrepted) {
      result.data.diagnosis = selfReview.output.diagnosis as unknown as typeof result.data.diagnosis;
      result.data.design_direction = selfReview.output.designDirection as unknown as typeof result.data.design_direction;
      console.log(`[diagnosis] Self-correction applied (${selfReview.correctionRounds} round(s)):`,
        selfReview.issues.join("; "));
    }
  }

  // Validate diagnosis against user constraints (exclusions, keep items, explicit requests)
  const validation = await validateDiagnosisAsync(
    result.data,
    ctx.keepItems,
    ctx.userContext
  );

  // Use the patched version (violations auto-corrected)
  const diagnosisData = validation.patched;

  // ─── Product identification (best-effort, inline on diagnosis_json) ──
  // Off by default; opt in with IDENTIFY_PRODUCTS=1. Failures here never
  // block diagnosis saving — we just omit the field.
  let identifiedProductsTokens = 0;
  let diagnosisJsonToSave: DiagnosisData = diagnosisData.diagnosis;
  if (process.env.IDENTIFY_PRODUCTS === "1") {
    try {
      // Compact aesthetic hint from the just-produced design direction so the
      // identifier/verifier can calibrate brand guesses to the room's actual
      // style + palette + materials rather than running context-free.
      const dd = diagnosisData.design_direction as {
        recommended_palette?: string[];
        recommended_materials?: string[];
        style_notes?: string;
      } | undefined;
      const hintParts: string[] = [];
      if (dd?.style_notes) hintParts.push(dd.style_notes);
      if (dd?.recommended_palette?.length) hintParts.push(`palette: ${dd.recommended_palette.slice(0, 6).join(", ")}`);
      if (dd?.recommended_materials?.length) hintParts.push(`materials: ${dd.recommended_materials.slice(0, 6).join(", ")}`);
      const aestheticHint = hintParts.length ? hintParts.join(" | ") : undefined;

      const identRoom = getRoomFromFloorPlan(ctx.extractedFloorPlan, ctx.roomType);
      const identResult = await runIdentifiedProductsPipeline({
        supabase,
        imageUrls,
        roomType: ctx.roomType,
        aestheticHint,
        budgetMode: ctx.budgetMode,
        roomDimensions: identRoom?.dimensions_text
          ?? (identRoom?.sqft ? `~${identRoom.sqft} sqft` : undefined),
      });
      if (identResult.success && identResult.data) {
        diagnosisJsonToSave = {
          ...diagnosisData.diagnosis,
          identified_products: identResult.data.identified_products,
        };
        identifiedProductsTokens = identResult.tokensUsed ?? 0;
      } else {
        log.warn("identified-products pipeline returned no data", {
          room_id,
          error: identResult.error,
        });
      }
    } catch (err) {
      log.warn("identified-products pipeline threw — continuing without it", {
        room_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Greedy expansion: grow action_list until room is saturated ────────────
  // Runs after validation / patching, before saving, so the expanded list is
  // what gets persisted and consumed by the product search pipeline.
  // Non-fatal: if expansion throws, we continue with the baseline action_list.
  let expandedActionList = diagnosisData.action_list ?? [];
  let expansionLog: import("@/lib/types/database").DecoratorDecision[] | null = null;

  if (expandedActionList.length > 0) {
    try {
      // Best-effort: fetch sibling-room diagnoses in the same project so the
      // expansion can maintain cross-room palette / material coherence.
      const siblingRooms = await fetchSiblingRoomSummaries(supabase, room.project_id, room_id);

      // Best-effort: fetch this room's budget dollars for budget-aware expansion.
      const budget = await buildExpansionBudgetContext(supabase, room_id, room.budget_mode, expandedActionList);

      // Derive adaptive cap context from inferred preferences + this room's
      // priorities + the Pass A style notes. Tightens/loosens the saturation
      // ceilings so they respond to real signals rather than hard-coded heuristics.
      const adaptiveCaps = buildAdaptiveCapContext({
        preferences: inferredPreferences,
        priorities: ctx.priorities,
        designDirection: diagnosisData.design_direction ?? null,
      });

      const expansionRoom = getRoomFromFloorPlan(ctx.extractedFloorPlan, ctx.roomType);
      const expansion = await runDiagnosisExpansion({
        currentItems: expandedActionList,
        room: {
          type: ctx.roomType,
          sqft: expansionRoom?.sqft
            ?? ctx.extractedFloorPlan?.total_sqft,
        },
        designDirection: diagnosisData.design_direction ?? undefined,
        roomPhotos: ctx.imageUrls,
        floorPlanImageUrl: ctx.floorPlanImageUrl ?? null,
        extractedRoom: expansionRoom ?? null,
        budget,
        siblingRooms,
        adaptiveCaps,
        preferences: inferredPreferences,
      });
      expandedActionList = expansion.expanded_items;
      expansionLog = expansion.decision_log;
      log.info("Greedy expansion complete", {
        room_id,
        baseline: diagnosisData.action_list?.length ?? 0,
        expanded: expansion.expanded_items.length,
        added: expansion.added_count,
        stopReason: expansion.stop_reason,
        siblingRoomCount: siblingRooms?.length ?? 0,
        budgetProvided: budget?.totalDollars != null,
        critiqueRefinements: expansion.critique_refinements ?? 0,
        adaptiveCapsUsed: adaptiveCaps != null,
      });
    } catch (err) {
      log.warn("Greedy expansion failed — using baseline action_list", {
        room_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Resolve the concurrent scene-assembly result (best-effort — null on failure).
  const sceneResult = await sceneGraphPromise;
  const sceneGraph = sceneResult.success && "data" in sceneResult ? sceneResult.data ?? null : null;
  const sceneGraphTokens = sceneResult.success && "tokensUsed" in sceneResult ? sceneResult.tokensUsed ?? 0 : 0;
  if (sceneGraph) {
    log.info("Scene graph assembled", {
      room_id,
      objects: sceneGraph.objects.length,
      duplicatesMerged: sceneGraph.reconciled_duplicate_count,
      coverage: sceneGraph.coverage.estimated_coverage,
      gaps: sceneGraph.coverage.gaps.length,
    });
  }

  // Save diagnosis (with expanded action_list + expansion_log)
  const { data: diagnosis, error: saveError } = await supabase
    .from("room_diagnoses")
    .insert({
      room_id,
      diagnosis_json: diagnosisJsonToSave,
      design_direction_json: diagnosisData.design_direction,
      missing_categories: [...new Set(expandedActionList.map(i => i.category))],
      action_list: expandedActionList,
      model_used: result.model,
      expansion_log: expansionLog,
      scene_graph_json: sceneGraph,
      // Quality tracking columns (migration 010) — enable DB few-shot retrieval.
      // design_direction_label left null for now (schema lacks a label field).
      room_type: room.room_type ?? null,
      action_list_count: expandedActionList.length,
    })
    .select()
    .single();

  if (saveError) {
    console.error("[diagnosis] Failed to save diagnosis:", saveError.message);
    return NextResponse.json({ error: "Failed to save diagnosis" }, { status: 500 });
  }

  // Update room status. The diagnosis itself is already persisted above; this
  // only advances the room's lifecycle flag. supabase-js returns the error
  // in-band, so log a failure rather than dropping it silently — otherwise the
  // room stays stuck at its prior status (e.g. "analyzing") while a diagnosis
  // exists, desyncing the UI's step indicator from reality.
  const { error: statusError } = await supabase
    .from("rooms")
    .update({ status: "diagnosed", updated_at: new Date().toISOString() })
    .eq("id", room_id);
  if (statusError) {
    console.error("[diagnosis] Failed to update room status:", statusError.message);
  }

  // Complete agent run
  await completeAgentRun(supabase, agentRun.id, {
    status: "completed",
    output_json: {
      ...diagnosisData as unknown as Record<string, unknown>,
      _validation: {
        issues: validation.issues,
        wasModified: validation.wasModified,
      },
    },
    tokens_used: (result.tokensUsed ?? 0) + identifiedProductsTokens + sceneGraphTokens,
  });

  return NextResponse.json({
    ...diagnosis,
    _validation: validation.issues.length > 0
      ? { issueCount: validation.issues.length, issues: validation.issues }
      : undefined,
  }, { status: 201 });
}

// ─── Helpers for budget + cross-room expansion context ───────────────────────

/**
 * Rough per-item cost estimates by category tier. Used only to compute a
 * "committed dollars" estimate passed as soft guidance to the greedy expansion
 * LLM. Not authoritative — real costs land via the product search pipeline.
 */
const CATEGORY_COST_ESTIMATES: Record<string, number> = {
  // Large anchors
  sofa: 1500,
  sectional: 2200,
  bed: 1200,
  dining_table: 900,
  area_rug: 600,
  accent_chair: 500,
  lounge_chair: 500,
  credenza: 800,
  dresser: 700,
  bookshelf: 500,
  coffee_table: 400,
  nightstand: 300,
  side_table: 250,
  desk: 400,
  // Mid-tier
  statement_mirror: 300,
  floor_lamp: 200,
  table_lamp: 150,
  pendant_light: 250,
  curtains: 200,
  wall_art_large: 350,
  sculpture: 250,
  // Finishing (cheap)
  wall_art: 120,
  frames: 60,
  throw_pillow: 60,
  throw_blanket: 80,
  tall_plant: 120,
  plants: 60,
  greenery: 60,
  candles: 35,
  books: 25,
  books_styled: 30,
  baskets: 70,
  tray: 40,
  vase: 50,
  decorative_objects: 45,
  decorative_bowls: 50,
  poufs: 150,
};

const BUDGET_MODE_TO_DEFAULT_DOLLARS: Record<BudgetMode, number> = {
  budget: 2500,
  balanced: 6000,
  best_possible: 12000,
};

/**
 * Compute a best-effort "committed dollars" estimate from the current items.
 * Used only to steer the LLM away from stacking more expensive anchors when
 * the budget is already tight — not a hard constraint.
 */
function estimateCommittedDollars(items: ActionItem[]): number {
  let total = 0;
  for (const item of items) {
    const base = CATEGORY_COST_ESTIMATES[item.category] ?? 150; // catch-all mid-finishing
    const qty = item.quantity ?? 1;
    total += base * qty;
  }
  return Math.round(total);
}

/**
 * Resolve the room's budget dollars (either the explicit value on the room,
 * or a reasonable default from the budget tier) plus a committed-dollars
 * estimate computed from the current action_list.
 */
async function buildExpansionBudgetContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  roomId: string,
  budgetMode: BudgetMode | null | undefined,
  currentItems: ActionItem[],
): Promise<ExpansionBudget | null> {
  try {
    const { data: room } = await supabase
      .from("rooms")
      .select("budget_dollars, budget_mode")
      .eq("id", roomId)
      .single();

    const dollars =
      (room?.budget_dollars as number | null | undefined) ??
      (budgetMode ? BUDGET_MODE_TO_DEFAULT_DOLLARS[budgetMode] : null);

    const committed = estimateCommittedDollars(currentItems);

    return {
      totalDollars: dollars ?? null,
      mode: (room?.budget_mode as string | null | undefined) ?? budgetMode ?? null,
      committedDollars: committed,
    };
  } catch (err) {
    log.warn("buildExpansionBudgetContext: lookup failed", {
      roomId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build summaries of sibling rooms in the same project so the greedy expansion
 * can keep palette / materials coherent across the apartment.
 */
async function fetchSiblingRoomSummaries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  projectId: string,
  currentRoomId: string,
): Promise<SiblingRoomSummary[] | null> {
  try {
    const { data: siblingRooms } = await supabase
      .from("rooms")
      .select("id, room_type, room_diagnoses(design_direction_json, action_list, created_at)")
      .eq("project_id", projectId)
      .neq("id", currentRoomId)
      .limit(6);

    if (!siblingRooms?.length) return null;

    const summaries: SiblingRoomSummary[] = [];
    for (const sr of siblingRooms) {
      const diagnoses = (sr.room_diagnoses ?? []) as Array<{
        design_direction_json: DesignDirection | null;
        action_list: ActionItem[] | null;
        created_at: string;
      }>;
      if (!diagnoses.length) continue;

      // Pick the latest diagnosis for this sibling room
      const latest = diagnoses
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      const dd = latest.design_direction_json;
      const items = latest.action_list ?? [];

      const topCategories = [...new Set(items.map((i) => i.category))].slice(0, 8);

      summaries.push({
        roomType: sr.room_type as string,
        palette: dd?.recommended_palette ?? undefined,
        materials: dd?.recommended_materials ?? undefined,
        styleNotes: dd?.style_notes ?? undefined,
        topCategories,
      });
    }

    return summaries.length ? summaries : null;
  } catch (err) {
    log.warn("fetchSiblingRoomSummaries: lookup failed", {
      projectId,
      currentRoomId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build an AdaptiveCapContext from the inferred preferences + this room's
 * priorities + design direction style notes. Returns null when no signals
 * are present — saturation-math falls back to pure direction-modifier caps.
 */
function buildAdaptiveCapContext(args: {
  preferences: PreferenceSignals | null;
  priorities: string[] | undefined;
  designDirection: DesignDirection | null;
}): AdaptiveCapContext | null {
  const { preferences, priorities, designDirection } = args;
  const hasPrefs = preferences && preferences.source_room_count > 0;
  const hasPriorities = Array.isArray(priorities) && priorities.length > 0;
  const hasStyleNotes = !!designDirection?.style_notes;

  if (!hasPrefs && !hasPriorities && !hasStyleNotes) return null;

  return {
    userDensityPreference: preferences?.density_preference ?? "unknown",
    priorities: priorities ?? [],
    styleNotes: designDirection?.style_notes,
    userPreferredCategories: preferences?.recurring_categories ?? [],
  };
}
