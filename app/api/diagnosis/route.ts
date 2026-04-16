import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runRoomDiagnosis } from "@/lib/agents/room-diagnostician";
import {
  runDiagnosisExpansion,
  type ExpansionBudget,
  type SiblingRoomSummary,
} from "@/lib/agents/greedy-decorator";
import type { AdaptiveCapContext } from "@/lib/validation/saturation-math";
import { validateDiagnosis } from "@/lib/agents/diagnosis-validator";
import { runIdentifiedProductsPipeline } from "@/lib/agents/identified-products-pipeline";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { getRoomFromFloorPlan } from "@/lib/agents/format-floor-plan";
import { inferUserPreferences, type PreferenceSignals } from "@/lib/design-context/infer-preferences";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { sanitizeUserContext } from "@/lib/utils/sanitize-prompt";
import { createLogger } from "@/lib/logging/logger";
import { withTrace } from "@/lib/observability/tracing";
import type { AgentContext } from "@/lib/agents/types";
import type {
  ActionItem,
  BudgetMode,
  DesignDirection,
  DiagnosisData,
} from "@/lib/types/database";

const log = createLogger("diagnosis-route");

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

  const body = await request.json();
  const { room_id } = body;

  // Wrap the rest of the handler so every agent/logger call inherits a
  // shared trace id. OTel export is opt-in via OTEL_EXPORTER_OTLP_ENDPOINT.
  return withTrace(
    "diagnosis.POST",
    () => handleDiagnosisPost(supabase, user.id, room_id),
    { userId: user.id, route: "diagnosis" }
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleDiagnosisPost(supabase: any, _userId: string, room_id: unknown) {
  if (!room_id || typeof room_id !== "string") {
    return NextResponse.json({ error: "room_id required" }, { status: 400 });
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

  // Load project for design profile context
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", room.project_id)
    .single();

  const profile = buildDesignProfile(project);

  // Infer user preferences from sibling rooms — closes the "nothing learns"
  // gap by turning existing keep/replace/action_list data into prompt context.
  // Best-effort: if the lookup fails, diagnosis runs without preference signals.
  const inferredPreferences = await inferUserPreferences(
    supabase,
    room.project_id,
    room_id,
  );
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
  };

  const result = await runRoomDiagnosis(ctx, profile);

  if (!result.success || !result.data) {
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: result.error,
    });
    return NextResponse.json({ error: result.error || "Diagnosis failed" }, { status: 500 });
  }

  // Validate diagnosis against user constraints (exclusions, keep items, explicit requests)
  const validation = validateDiagnosis(
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
            ?? ctx.extractedFloorPlan?.total_sqft
            ?? (ctx.floorPlan?.total_sqft as number | undefined),
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
    })
    .select()
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  // Update room status
  await supabase
    .from("rooms")
    .update({ status: "diagnosed", updated_at: new Date().toISOString() })
    .eq("id", room_id);

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
    tokens_used: (result.tokensUsed ?? 0) + identifiedProductsTokens,
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
