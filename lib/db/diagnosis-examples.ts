/**
 * DB-backed few-shot example retrieval for the room diagnosis Pass 2 prompt.
 *
 * Pulls the top-N past action_lists from room_diagnoses that match the
 * current room's type and design direction. These are injected into the
 * Pass 2 prompt as concrete few-shot examples so the model has seen
 * what an excellent action_list looks like for this specific context
 * before it writes its own.
 *
 * Why this improves quality:
 *   - The Gemini prompt design guide recommends always including few-shot
 *     examples; zero-shot prompts are "likely to be less effective".
 *   - Past diagnoses that passed the action_list_count >= 8 threshold
 *     are real, accepted outputs — not synthetic examples. The model
 *     matches their specificity naturally.
 *   - Showing 2 examples (same room_type, same/nearby direction) is
 *     enough to calibrate output format without overfitting.
 *
 * Graceful degradation: returns [] when Supabase isn't configured or
 * when no past examples exist, so the prompt falls back to zero-shot.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("diagnosis-examples");

/** Top N items to keep from each example action_list (token budget). */
const MAX_ITEMS_PER_EXAMPLE = 6;

/** Max examples to inject per prompt call. */
const MAX_EXAMPLES = 2;

export interface ActionItemExample {
  priority: number;
  action: string;
  category: string;
  reasoning: string;
  variant?: string | null;
  quantity?: number | null;
}

export interface DiagnosisExample {
  roomType: string;
  designDirection: string;
  actionList: ActionItemExample[];
}

// Broad groupings so nearby directions share examples when exact
// matches are scarce. E.g. "Japandi" and "Scandinavian" share the
// "minimalist" bucket.
const DIRECTION_BUCKETS: Record<string, string[]> = {
  minimalist: ["Japandi", "Scandinavian", "Minimalist"],
  coastal: ["Coastal", "Farmhouse", "Bohemian Coastal"],
  modern: ["Modern", "Contemporary", "Transitional", "Mid-Century Modern"],
  traditional: ["Traditional", "Classic", "Art Deco"],
  eclectic: ["Bohemian", "Eclectic", "Maximalist"],
};

function directionBucket(direction: string): string | null {
  const normalized = direction.toLowerCase().trim();
  for (const [bucket, labels] of Object.entries(DIRECTION_BUCKETS)) {
    if (labels.some((l) => l.toLowerCase() === normalized)) return bucket;
  }
  return null;
}

function relatedDirections(direction: string): string[] {
  const bucket = directionBucket(direction);
  if (!bucket) return [direction];
  return DIRECTION_BUCKETS[bucket];
}

function truncateActionList(raw: unknown): ActionItemExample[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ActionItemExample[])
    .slice(0, MAX_ITEMS_PER_EXAMPLE)
    .map((item) => ({
      priority: typeof item.priority === "number" ? item.priority : 1,
      action: typeof item.action === "string" ? item.action : "",
      category: typeof item.category === "string" ? item.category : "",
      reasoning: typeof item.reasoning === "string" ? item.reasoning : "",
      ...(item.variant ? { variant: item.variant } : {}),
      ...(typeof item.quantity === "number" ? { quantity: item.quantity } : {}),
    }))
    .filter((item) => item.action && item.category);
}

/**
 * Fetch past high-quality diagnosis action_lists for use as few-shot
 * examples in the Pass 2 prompt.
 *
 * @param roomType   e.g. "living room"
 * @param designDirection  e.g. "Coastal"
 * @param excludeDiagnosisId  The current diagnosis id — don't echo it back.
 */
export async function fetchDiagnosisExamples(
  roomType: string,
  designDirection: string | null | undefined,
  excludeDiagnosisId?: string,
): Promise<DiagnosisExample[]> {
  const db = getAdminClient();
  if (!db || !roomType) return [];

  try {
    const related = designDirection ? relatedDirections(designDirection) : [];

    // Try exact direction match first.
    let { data: rows } = await db
      .from("room_diagnoses")
      .select("id, room_type, design_direction_label, action_list")
      .eq("room_type", roomType.toLowerCase().trim())
      .in("design_direction_label", related.length ? related : ["__none__"])
      .eq("few_shot_eligible", true)
      .gte("action_list_count", 8)
      .neq("id", excludeDiagnosisId ?? "00000000-0000-0000-0000-000000000000")
      .order("created_at", { ascending: false })
      .limit(MAX_EXAMPLES);

    // If fewer than MAX_EXAMPLES, fall back to any direction for this room_type.
    if (!rows || rows.length < MAX_EXAMPLES) {
      const existing = new Set((rows ?? []).map((r: { id: string }) => r.id));
      const needed = MAX_EXAMPLES - (rows?.length ?? 0);
      const { data: fallback } = await db
        .from("room_diagnoses")
        .select("id, room_type, design_direction_label, action_list")
        .eq("room_type", roomType.toLowerCase().trim())
        .eq("few_shot_eligible", true)
        .gte("action_list_count", 8)
        .neq("id", excludeDiagnosisId ?? "00000000-0000-0000-0000-000000000000")
        .order("created_at", { ascending: false })
        .limit(needed + MAX_EXAMPLES); // overfetch to filter already-seen

      const extra = (fallback ?? []).filter((r: { id: string }) => !existing.has(r.id)).slice(0, needed);
      rows = [...(rows ?? []), ...extra];
    }

    if (!rows?.length) return [];

    return rows
      .map((row: { room_type: string; design_direction_label: string; action_list: unknown }) => ({
        roomType: row.room_type,
        designDirection: row.design_direction_label ?? "Unknown",
        actionList: truncateActionList(row.action_list),
      }))
      .filter((ex) => ex.actionList.length >= 3);
  } catch (e) {
    log.warn("Failed to fetch diagnosis examples", { error: (e as Error).message });
    return [];
  }
}

/**
 * Format examples as an XML block for injection into the prompt.
 * Empty array → empty string (caller uses zero-shot naturally).
 */
export function formatExamplesForPrompt(examples: DiagnosisExample[]): string {
  if (!examples.length) return "";

  const blocks = examples
    .map(
      (ex, i) => `<example index="${i + 1}" room_type="${ex.roomType}" design_direction="${ex.designDirection}">
${JSON.stringify(ex.actionList, null, 2)}
</example>`,
    )
    .join("\n\n");

  return `\n<few_shot_examples>
These are real high-quality action_lists from previous diagnoses of similar rooms.
Use them to calibrate specificity, depth of reasoning, and category coverage —
but generate your own list based on the current diagnosis, not a copy of these.

${blocks}
</few_shot_examples>`;
}
