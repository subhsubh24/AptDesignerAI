/**
 * Shared post-diagnosis expansion pipeline — called by both the streaming and
 * non-streaming diagnosis routes so the two endpoints produce identical output.
 *
 * Wraps:
 *   - greedy expansion (lib/agents/greedy-decorator.ts)
 *   - budget context + committed-dollars estimate
 *   - sibling-room coherence summaries
 *   - adaptive caps from inferred preferences + priorities + style notes
 */

import {
  runDiagnosisExpansion,
  type ExpansionBudget,
  type SiblingRoomSummary,
} from "@/lib/agents/greedy-decorator";
import type { AdaptiveCapContext } from "@/lib/validation/saturation-math";
import type { PreferenceSignals } from "@/lib/design-context/infer-preferences";
import { getRoomFromFloorPlan } from "@/lib/agents/format-floor-plan";
import { pickLatestDiagnosis } from "@/lib/diagnosis/latest-diagnosis";
import { createLogger } from "@/lib/logging/logger";
import type {
  ActionItem,
  BudgetMode,
  DesignDirection,
  DecoratorDecision,
  ExtractedFloorPlan,
} from "@/lib/types/database";

const log = createLogger("diagnosis-expansion-pipeline");

const CATEGORY_COST_ESTIMATES: Record<string, number> = {
  sofa: 1500, sectional: 2200, bed: 1200, dining_table: 900, area_rug: 600,
  accent_chair: 500, lounge_chair: 500, credenza: 800, dresser: 700,
  bookshelf: 500, coffee_table: 400, nightstand: 300, side_table: 250,
  desk: 400, statement_mirror: 300, floor_lamp: 200, table_lamp: 150,
  pendant_light: 250, curtains: 200, wall_art_large: 350, sculpture: 250,
  wall_art: 120, frames: 60, throw_pillow: 60, throw_blanket: 80,
  tall_plant: 120, plants: 60, greenery: 60, candles: 35, books: 25,
  books_styled: 30, baskets: 70, tray: 40, vase: 50,
  decorative_objects: 45, decorative_bowls: 50, poufs: 150,
};

const BUDGET_MODE_TO_DEFAULT_DOLLARS: Record<BudgetMode, number> = {
  budget: 2500,
  balanced: 6000,
  best_possible: 12000,
};

export interface DiagnosisExpansionResult {
  expandedActionList: ActionItem[];
  expansionLog: DecoratorDecision[] | null;
  siblingRoomCount: number;
}

function estimateCommittedDollars(items: ActionItem[]): number {
  let total = 0;
  for (const item of items) {
    const base = CATEGORY_COST_ESTIMATES[item.category] ?? 150;
    const qty = item.quantity ?? 1;
    total += base * qty;
  }
  return Math.round(total);
}

async function buildExpansionBudgetContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  roomId: string,
  budgetMode: BudgetMode | null | undefined,
  currentItems: ActionItem[],
): Promise<ExpansionBudget | null> {
  try {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("budget_dollars, budget_mode")
      .eq("id", roomId)
      .single();
    // Best-effort budget context, not a 404-determining query — a real DB
    // error resolves in-band as {data: null, error}, never a throw, so the
    // surrounding try/catch alone would never observe it. Log it explicitly.
    if (roomError && roomError.code !== "PGRST116") {
      log.warn("buildExpansionBudgetContext: room lookup error", {
        roomId,
        error: roomError.message ?? String(roomError),
      });
    }

    const dollars =
      (room?.budget_dollars as number | null | undefined) ??
      (budgetMode ? BUDGET_MODE_TO_DEFAULT_DOLLARS[budgetMode] : null);

    return {
      totalDollars: dollars ?? null,
      mode: (room?.budget_mode as string | null | undefined) ?? budgetMode ?? null,
      committedDollars: estimateCommittedDollars(currentItems),
    };
  } catch (err) {
    log.warn("buildExpansionBudgetContext failed", { roomId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function fetchSiblingRoomSummaries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  projectId: string,
  currentRoomId: string,
): Promise<SiblingRoomSummary[] | null> {
  try {
    const { data: siblingRooms, error: siblingRoomsError } = await supabase
      .from("rooms")
      .select("id, room_type, room_diagnoses(id, design_direction_json, action_list, created_at)")
      .eq("project_id", projectId)
      .neq("id", currentRoomId)
      .limit(6);
    // Best-effort cross-room context — a real DB error resolves in-band as
    // {data: null, error}, never a throw, so the surrounding try/catch alone
    // would never observe it. Log it explicitly before falling through.
    if (siblingRoomsError) {
      log.warn("fetchSiblingRoomSummaries: siblingRooms lookup error", {
        projectId,
        currentRoomId,
        error: siblingRoomsError.message ?? String(siblingRoomsError),
      });
    }

    if (!siblingRooms?.length) return null;

    const summaries: SiblingRoomSummary[] = [];
    for (const sr of siblingRooms) {
      const diagnoses = (sr.room_diagnoses ?? []) as Array<{
        id: string;
        design_direction_json: DesignDirection | null;
        action_list: ActionItem[] | null;
        created_at: string;
      }>;
      if (!diagnoses.length) continue;
      // Deterministic latest pick (created_at DESC, id DESC tiebreak) — a
      // created_at-only sort is non-reproducible on same-timestamp diagnoses and
      // this feeds the seeded cross-room coherence prompt (determinism contract).
      const latest = pickLatestDiagnosis(diagnoses)!;
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
    log.warn("fetchSiblingRoomSummaries failed", { projectId, currentRoomId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

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

export async function runFullDiagnosisExpansion(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  roomId: string;
  projectId: string;
  roomType: string;
  budgetMode: BudgetMode | null | undefined;
  priorities: string[];
  baselineActionList: ActionItem[];
  designDirection: DesignDirection | null;
  roomPhotos: string[];
  floorPlanImageUrl: string | null;
  extractedFloorPlan: ExtractedFloorPlan | undefined;
  preferences: PreferenceSignals | null;
}): Promise<DiagnosisExpansionResult> {
  const {
    supabase, roomId, projectId, roomType, budgetMode, priorities,
    baselineActionList, designDirection, roomPhotos, floorPlanImageUrl,
    extractedFloorPlan, preferences,
  } = args;

  if (baselineActionList.length === 0) {
    return { expandedActionList: baselineActionList, expansionLog: null, siblingRoomCount: 0 };
  }

  try {
    // Sibling-room summaries and this room's budget context are independent DB
    // reads (they share only supabase/roomId/projectId, already resolved), so
    // fetch them together — serializing stacked two round-trips on the diagnosis
    // hot path (this pipeline runs on every streamed room diagnosis).
    const [siblingRooms, budget] = await Promise.all([
      fetchSiblingRoomSummaries(supabase, projectId, roomId),
      buildExpansionBudgetContext(supabase, roomId, budgetMode, baselineActionList),
    ]);
    const adaptiveCaps = buildAdaptiveCapContext({ preferences, priorities, designDirection });
    const expansionRoom = getRoomFromFloorPlan(extractedFloorPlan, roomType);

    const expansion = await runDiagnosisExpansion({
      currentItems: baselineActionList,
      room: { type: roomType, sqft: expansionRoom?.sqft ?? extractedFloorPlan?.total_sqft },
      designDirection: designDirection ?? undefined,
      roomPhotos,
      floorPlanImageUrl,
      extractedRoom: expansionRoom ?? null,
      budget,
      siblingRooms,
      adaptiveCaps,
      preferences,
    });

    log.info("Greedy expansion complete", {
      roomId,
      baseline: baselineActionList.length,
      expanded: expansion.expanded_items.length,
      added: expansion.added_count,
      stopReason: expansion.stop_reason,
      siblingRoomCount: siblingRooms?.length ?? 0,
    });

    return {
      expandedActionList: expansion.expanded_items,
      expansionLog: expansion.decision_log,
      siblingRoomCount: siblingRooms?.length ?? 0,
    };
  } catch (err) {
    log.warn("Greedy expansion failed — using baseline", { roomId, error: err instanceof Error ? err.message : String(err) });
    return { expandedActionList: baselineActionList, expansionLog: null, siblingRoomCount: 0 };
  }
}
