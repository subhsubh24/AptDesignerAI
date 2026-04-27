// Cross-room preference inference — the lightweight feedback loop.
//
// Every existing piece of data in the project tells us something about what
// the user wants:
//   - keep_items across rooms → things they like and want kept
//   - replace_items across rooms → things they've rejected
//   - priorities across rooms → budget pressure + emphasis
//   - past action_list entries → categories the system has already committed to
//   - past design_direction palettes/materials → style consistency signals
//
// We don't need a dedicated feedback table to extract signal from this; we
// just need to aggregate it across the project and pass it as prompt context
// to diagnosis + expansion. This closes the "nothing learns" gap without
// requiring a DB schema change.
//
// Design principle: "soft" signals only. We never hard-block a recommendation
// because of inferred preferences — the LLM sees the aggregate and decides.

import type {
  ActionItem,
  DesignDirection,
  RoomDiagnosis,
} from "@/lib/types/database";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("infer-preferences");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreferenceSignals {
  /** Free-text phrases the user has consistently "wanted to keep" across rooms. */
  preferred_items: string[];
  /** Free-text phrases the user has consistently "wanted to replace" across rooms. */
  avoided_items: string[];
  /** Materials the user's past rooms have leaned on (derived from design_direction_json). */
  preferred_materials: string[];
  /** Accent colors / palette entries consistently chosen across prior rooms. */
  preferred_palette: string[];
  /** Style notes aggregated from prior rooms — hints at overall apartment direction. */
  style_notes: string[];
  /** Categories that prior rooms consistently had items for (user cares about these). */
  recurring_categories: string[];
  /** Priorities stated across rooms (budget emphasis). */
  priorities: string[];
  /** User context strings (sanitized) from prior rooms — free-form taste hints. */
  user_context_snippets: string[];
  /**
   * Inferred intensity from prior rooms:
   *   - "minimalist" — prior rooms averaged <10 items
   *   - "balanced" — 10–18 items
   *   - "maximalist" — >18 items
   *   - "unknown" — no prior rooms diagnosed
   */
  density_preference: "minimalist" | "balanced" | "maximalist" | "unknown";
  /**
   * Soft budget pressure signal:
   *   - "tight" if prior rooms set "budget" mode
   *   - "comfortable" if "balanced"
   *   - "premium" if "best_possible"
   *   - "unknown" otherwise.
   */
  budget_pressure: "tight" | "comfortable" | "premium" | "unknown";
  /** How many prior rooms contributed to these signals. */
  source_room_count: number;
}

export const EMPTY_PREFERENCE_SIGNALS: PreferenceSignals = {
  preferred_items: [],
  avoided_items: [],
  preferred_materials: [],
  preferred_palette: [],
  style_notes: [],
  recurring_categories: [],
  priorities: [],
  user_context_snippets: [],
  density_preference: "unknown",
  budget_pressure: "unknown",
  source_room_count: 0,
};

// ─── Aggregation helpers ─────────────────────────────────────────────────────

/**
 * Count normalized-token frequency across an array of strings and return the
 * top-N entries. We deliberately keep the originals (case + phrasing) so the
 * prompt reads naturally; the normalization is purely for deduplication.
 */
function topFrequent(entries: string[], n: number): string[] {
  const freq = new Map<string, { count: number; original: string }>();
  for (const raw of entries) {
    const s = raw?.trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/[\s\-_]+/g, " ").trim();
    const prev = freq.get(key);
    if (prev) prev.count += 1;
    else freq.set(key, { count: 1, original: s });
  }
  return Array.from(freq.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((v) => v.original);
}

function inferDensityPreference(
  roomItemCounts: number[],
): PreferenceSignals["density_preference"] {
  if (!roomItemCounts.length) return "unknown";
  const avg = roomItemCounts.reduce((a, b) => a + b, 0) / roomItemCounts.length;
  if (avg < 10) return "minimalist";
  if (avg > 18) return "maximalist";
  return "balanced";
}

function inferBudgetPressure(
  budgetModes: Array<string | null | undefined>,
): PreferenceSignals["budget_pressure"] {
  const counts = { tight: 0, comfortable: 0, premium: 0 };
  for (const m of budgetModes) {
    if (m === "budget") counts.tight += 1;
    else if (m === "balanced") counts.comfortable += 1;
    else if (m === "best_possible") counts.premium += 1;
  }
  const total = counts.tight + counts.comfortable + counts.premium;
  if (total === 0) return "unknown";
  // Majority vote
  if (counts.tight > counts.comfortable && counts.tight > counts.premium) return "tight";
  if (counts.premium > counts.comfortable && counts.premium > counts.tight) return "premium";
  return "comfortable";
}

// ─── Main entry point ────────────────────────────────────────────────────────

interface RoomRow {
  id: string;
  room_type: string;
  keep_items: string[] | null;
  replace_items: string[] | null;
  priorities: string[] | null;
  user_context: string | null;
  budget_mode: string | null;
  room_diagnoses: RoomDiagnosis[] | null;
}

/**
 * Aggregate preference signals from the project's existing rooms. Callers pass
 * the rows from a single join query (`rooms` + `room_diagnoses`) — we don't
 * touch the DB directly so this stays testable without a Supabase mock.
 */
export function aggregatePreferenceSignals(
  rooms: RoomRow[],
  currentRoomId: string,
): PreferenceSignals {
  const siblings = rooms.filter((r) => r.id !== currentRoomId);
  if (siblings.length === 0) return { ...EMPTY_PREFERENCE_SIGNALS };

  const keepItems: string[] = [];
  const replaceItems: string[] = [];
  const priorities: string[] = [];
  const userContexts: string[] = [];
  const materials: string[] = [];
  const palette: string[] = [];
  const styleNotes: string[] = [];
  const categories: string[] = [];
  const budgetModes: Array<string | null> = [];
  const itemCounts: number[] = [];

  for (const room of siblings) {
    if (Array.isArray(room.keep_items)) keepItems.push(...room.keep_items);
    if (Array.isArray(room.replace_items)) replaceItems.push(...room.replace_items);
    if (Array.isArray(room.priorities)) priorities.push(...room.priorities);
    if (typeof room.user_context === "string" && room.user_context.trim()) {
      // Cap each snippet to avoid context bloat
      userContexts.push(room.user_context.slice(0, 200));
    }
    budgetModes.push(room.budget_mode ?? null);

    // Use the most recent diagnosis per room
    const diagnoses = (room.room_diagnoses ?? []).slice().sort((a, b) =>
      (a.created_at < b.created_at ? 1 : -1),
    );
    const latest = diagnoses[0];
    if (!latest) continue;

    const dd = latest.design_direction_json as DesignDirection | null;
    if (dd) {
      if (Array.isArray(dd.recommended_materials)) materials.push(...dd.recommended_materials);
      if (Array.isArray(dd.recommended_palette)) palette.push(...dd.recommended_palette);
      if (typeof dd.style_notes === "string" && dd.style_notes.trim()) {
        styleNotes.push(dd.style_notes.slice(0, 280));
      }
    }

    const actionList = (latest.action_list as ActionItem[] | null) ?? [];
    itemCounts.push(actionList.length);
    for (const item of actionList) {
      if (item.category) categories.push(item.category);
    }
  }

  return {
    preferred_items: topFrequent(keepItems, 10),
    avoided_items: topFrequent(replaceItems, 10),
    preferred_materials: topFrequent(materials, 8),
    preferred_palette: topFrequent(palette, 8),
    style_notes: topFrequent(styleNotes, 3),
    recurring_categories: topFrequent(categories, 12),
    priorities: topFrequent(priorities, 6),
    user_context_snippets: userContexts.slice(0, 3),
    density_preference: inferDensityPreference(itemCounts),
    budget_pressure: inferBudgetPressure(budgetModes),
    source_room_count: siblings.length,
  };
}

/**
 * Fetch + aggregate signals in one call. Returns null if the DB call fails
 * or there are no sibling rooms — callers should treat preference context
 * as strictly optional.
 *
 * After the deterministic aggregation, calls an LLM to refine the density /
 * budget classifications and generate a free-form taste summary that
 * frequency-counting can't produce. LLM failure falls back to the
 * heuristic-only signals.
 */
export async function inferUserPreferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  projectId: string,
  currentRoomId: string,
): Promise<PreferenceSignals | null> {
  try {
    const { data: rooms } = await supabase
      .from("rooms")
      .select(
        "id, room_type, keep_items, replace_items, priorities, user_context, budget_mode, room_diagnoses(design_direction_json, action_list, created_at)",
      )
      .eq("project_id", projectId);

    if (!rooms?.length) return null;

    const signals = aggregatePreferenceSignals(rooms as RoomRow[], currentRoomId);
    if (signals.source_room_count === 0) return null;

    // LLM refinement — replaces inferDensityPreference / inferBudgetPressure
    // heuristics + adds a one-sentence taste summary. Strictly enriches; never
    // drops information.
    try {
      const siblings = (rooms as RoomRow[]).filter((r) => r.id !== currentRoomId);
      const itemCounts = siblings.flatMap((r) => {
        const diags = (r.room_diagnoses ?? []).slice().sort((a, b) =>
          (a.created_at < b.created_at ? 1 : -1),
        );
        const latest = diags[0];
        const actionList = (latest?.action_list as ActionItem[] | null) ?? [];
        return [actionList.length];
      });
      const budgetModes = siblings.map((r) => r.budget_mode || "unknown");
      const { summarizePreferencesLLM } = await import("@/lib/ai/semantic-extract");
      const llm = await summarizePreferencesLLM({
        keep_items: signals.preferred_items,
        replace_items: signals.avoided_items,
        materials: signals.preferred_materials,
        palette: signals.preferred_palette,
        style_notes: signals.style_notes,
        priorities: signals.priorities,
        user_context_snippets: signals.user_context_snippets,
        budget_modes: budgetModes,
        per_room_item_counts: itemCounts,
      });
      if (llm) {
        return {
          ...signals,
          density_preference: llm.density_preference,
          budget_pressure: llm.budget_pressure,
          // Append the LLM taste summary to style_notes so existing prompt
          // formatters surface it without a schema change.
          style_notes: llm.taste_summary
            ? [llm.taste_summary, ...signals.style_notes].slice(0, 4)
            : signals.style_notes,
        };
      }
    } catch (err) {
      log.debug("LLM preference refinement skipped", { error: err instanceof Error ? err.message : String(err) });
    }
    return signals;
  } catch (err) {
    log.warn("inferUserPreferences: lookup failed", {
      projectId,
      currentRoomId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Prompt rendering ────────────────────────────────────────────────────────

/**
 * Render preference signals as a prompt block. Returns null when nothing
 * meaningful has been inferred (so callers can skip the section cleanly).
 */
export function formatPreferencesForPrompt(
  signals: PreferenceSignals | null | undefined,
): string | null {
  if (!signals || signals.source_room_count === 0) return null;

  const lines: string[] = [
    `## User Preference Signals`,
    `_Inferred from ${signals.source_room_count} previously-decided room${signals.source_room_count === 1 ? "" : "s"} in this apartment — treat as soft guidance, not rules._`,
  ];

  if (signals.preferred_items.length) {
    lines.push(`- **Tends to keep**: ${signals.preferred_items.slice(0, 6).join("; ")}`);
  }
  if (signals.avoided_items.length) {
    lines.push(`- **Tends to reject**: ${signals.avoided_items.slice(0, 6).join("; ")}`);
  }
  if (signals.preferred_materials.length) {
    lines.push(`- **Recurring materials**: ${signals.preferred_materials.slice(0, 6).join(", ")}`);
  }
  if (signals.preferred_palette.length) {
    lines.push(`- **Recurring palette**: ${signals.preferred_palette.slice(0, 6).join(", ")}`);
  }
  if (signals.recurring_categories.length) {
    lines.push(`- **Categories this user cares about**: ${signals.recurring_categories.slice(0, 8).join(", ")}`);
  }
  if (signals.priorities.length) {
    lines.push(`- **Priorities**: ${signals.priorities.join(", ")}`);
  }
  if (signals.style_notes.length) {
    lines.push(`- **Style continuity notes**: ${signals.style_notes.join(" | ")}`);
  }

  const densityLine = {
    minimalist: "leans minimalist — has preferred fewer, more curated pieces in prior rooms",
    balanced: "balanced density — comfortable mix of finishing items",
    maximalist: "leans maximalist — has consistently chosen layered, abundant decor",
    unknown: null as string | null,
  }[signals.density_preference];
  if (densityLine) lines.push(`- **Density tendency**: ${densityLine}`);

  const budgetLine = {
    tight: "prior rooms used the 'budget' tier — stay cost-conscious, favor cheap finishing items",
    comfortable: "prior rooms used 'balanced' tier — typical spend expected",
    premium: "prior rooms used 'best_possible' — quality over cost",
    unknown: null as string | null,
  }[signals.budget_pressure];
  if (budgetLine) lines.push(`- **Budget posture**: ${budgetLine}`);

  if (signals.user_context_snippets.length) {
    lines.push(`- **Past free-form notes**: ${signals.user_context_snippets.map((s) => `"${s}"`).join(" | ")}`);
  }

  return lines.join("\n");
}
