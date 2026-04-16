// Per-iteration prompt for the greedy design expansion loop.
//
// On each iteration the LLM receives:
//   - Design direction + room context
//   - The current action_list (what has already been decided)
//   - The saturation dashboard (running totals + caps)
//   - A list of available headroom categories
// and is asked to either add ONE more item or declare the room complete.

import type { ActionItem, DesignDirection, FloorPlanRoom } from "@/lib/types/database";
import { formatSaturationForPrompt, type SaturationProfile } from "@/lib/validation/saturation-math";
import type { ExpansionBudget, SiblingRoomSummary } from "@/lib/agents/greedy-decorator";
import { formatPreferencesForPrompt, type PreferenceSignals } from "@/lib/design-context/infer-preferences";

export interface ExpansionPromptContext {
  roomType: string;
  sqft?: number;
  designDirection?: DesignDirection | null;
  currentItems: ActionItem[];
  saturation: SaturationProfile;
  /** Optional rejection reason from the last guardrail block (used for retry prompts) */
  lastRejectionReason?: string;
  /** Optional budget context — keeps expansion from running away from the cap. */
  budget?: ExpansionBudget | null;
  /** Optional sibling room summaries — keeps palette / materials coherent across rooms. */
  siblingRooms?: SiblingRoomSummary[] | null;
  /** Optional user preference signals inferred from sibling rooms. */
  preferences?: PreferenceSignals | null;
  /**
   * Extracted room from the uploaded floor plan (if any). Gives the model
   * exact dimensions and which walls have windows/doors/closets — so finishing
   * items land on the right surface instead of guessed ones.
   */
  extractedRoom?: FloorPlanRoom | null;
}

function formatDirectionSummary(direction: DesignDirection | null | undefined): string {
  if (!direction) return "No specific design direction established.";
  const d = direction as {
    style?: string;
    style_notes?: string;
    recommended_palette?: string[];
    recommended_materials?: string[];
    recommended_textures?: string[];
  };
  const parts: string[] = [];
  if (d.style) parts.push(`Style: ${d.style}`);
  if (d.style_notes) parts.push(d.style_notes);
  if (d.recommended_palette?.length) parts.push(`Palette: ${d.recommended_palette.slice(0, 5).join(", ")}`);
  if (d.recommended_materials?.length) parts.push(`Materials: ${d.recommended_materials.slice(0, 4).join(", ")}`);
  if (d.recommended_textures?.length) parts.push(`Textures: ${d.recommended_textures.slice(0, 3).join(", ")}`);
  return parts.join("\n");
}

function formatItemList(items: ActionItem[]): string {
  return items
    .map((item, i) => {
      const variant = (item as ActionItem & { variant?: string }).variant ? ` [${(item as ActionItem & { variant?: string }).variant}]` : "";
      return `  ${i + 1}. (priority ${item.priority}) ${item.category}${variant} — ${item.action}`;
    })
    .join("\n");
}

function formatBudgetSection(budget: ExpansionBudget | null | undefined): string | null {
  if (!budget) return null;
  const { totalDollars, mode, committedDollars } = budget;
  if (totalDollars == null && !mode && committedDollars == null) return null;

  const parts: string[] = ["## Budget Context"];
  if (totalDollars != null) {
    parts.push(`- Total room budget: $${totalDollars.toLocaleString()}`);
  }
  if (mode) {
    parts.push(`- Budget tier: ${mode}`);
  }
  if (committedDollars != null && totalDollars != null) {
    const remaining = Math.max(0, totalDollars - committedDollars);
    const pctUsed = Math.round((committedDollars / totalDollars) * 100);
    parts.push(
      `- Estimated committed so far: ~$${committedDollars.toLocaleString()} (${pctUsed}% of budget)`,
      `- Approximate headroom: ~$${remaining.toLocaleString()}`,
    );
  } else if (committedDollars != null) {
    parts.push(`- Estimated committed so far: ~$${committedDollars.toLocaleString()}`);
  }
  parts.push(
    "",
    "Prefer finishing items whose typical cost fits the remaining headroom. Candles, books, small plants, and decorative objects are cheap and budget-friendly. Large rugs, statement art, and anchor furniture are expensive — avoid suggesting another one if the headroom is tight.",
  );
  return parts.join("\n");
}

function formatFloorPlanSection(room: FloorPlanRoom | null | undefined): string | null {
  if (!room) return null;
  const lines: string[] = ["## Floor Plan Layout (authoritative — from uploaded floor plan)"];
  if (room.dimensions_text) lines.push(`- Dimensions: ${room.dimensions_text}`);
  if (room.shape) lines.push(`- Shape: ${room.shape}`);
  if (room.natural_light) lines.push(`- Natural light: ${room.natural_light}`);

  const wallsWithFeatures = room.walls.filter(w => w.features.length > 0);
  if (wallsWithFeatures.length > 0) {
    lines.push("- Walls:");
    for (const w of wallsWithFeatures) {
      const feats = w.features.map(f => `${f.type}${f.position_on_wall ? ` (${f.position_on_wall})` : ""}`).join(", ");
      lines.push(`    · ${w.direction} wall: ${feats}`);
    }
  }

  lines.push(
    "",
    "Use this layout when placing finishing items: don't put art on a wall that's mostly window, don't block closets with tall plants, and consider which wall is the focal wall before stacking decor there.",
  );
  return lines.join("\n");
}

function formatSiblingRoomsSection(siblings: SiblingRoomSummary[] | null | undefined): string | null {
  if (!siblings?.length) return null;
  const parts: string[] = ["## Other Rooms in This Apartment"];
  for (const sib of siblings) {
    const lines: string[] = [`### ${sib.roomType}`];
    if (sib.styleNotes) lines.push(`  Style: ${sib.styleNotes}`);
    if (sib.palette?.length) lines.push(`  Palette: ${sib.palette.slice(0, 6).join(", ")}`);
    if (sib.materials?.length) lines.push(`  Materials: ${sib.materials.slice(0, 5).join(", ")}`);
    if (sib.topCategories?.length) lines.push(`  Already has: ${sib.topCategories.slice(0, 6).join(", ")}`);
    parts.push(lines.join("\n"));
  }
  parts.push(
    "",
    "Keep the apartment reading as ONE home: reuse anchor materials and let 2-3 accent colors carry across rooms. You don't need to duplicate — just avoid introducing an unrelated palette or a clashing material family.",
  );
  return parts.join("\n");
}

export const EXPANSION_SYSTEM_PROMPT = `<role>
You are a senior interior designer finishing a room. The foundational and standard furniture has already been selected. Your job is to layer in finishing touches — the carefully chosen items that make a room feel complete, personal, and alive.
</role>

<reasoning_process>
Before every decision, silently run this checklist:

1. **Logical dependencies**: Does adding this item require or block something else on the list? Are any prerequisites missing (e.g., suggesting art before a focal wall is established)?
2. **Risk assessment**: Would adding this item push a category over its soft cap? Would it duplicate texture or color from a sibling room in a jarring way?
3. **Abductive reasoning**: If the room still feels sparse, what's the MOST likely underlying reason — missing vertical interest, missing warm materials, missing scale variety? Don't grab the first category with headroom; pick the category whose absence is most felt.
4. **Outcome evaluation**: After each addition, mentally walk into the room. If density_feel has tipped toward "cluttered", stop — don't chase leftover headroom.
5. **Persistence**: If a guardrail rejects an item, diagnose why (scale, duplication, hard cap) and adapt — don't repeat the same category with a different label.
</reasoning_process>

<design_discipline>
- You visualize the room, not enumerate categories.
- You know the difference between "layered and lush" and "cluttered and overwhelming."
- You stop when adding more would hurt, not help. Not every room needs every category.
- Japandi living rooms feel calm and edited; Bohemian bedrooms embrace abundant texture and greenery. Match density to direction.
- Every suggestion is specific and searchable: concrete materials, counts, placement.
</design_discipline>

<output_contract>
Respond in JSON only. No prose, no markdown fences. Think hard before answering — your reasoning never appears in the output, only the conclusion.
</output_contract>`;

export function buildExpansionPrompt(ctx: ExpansionPromptContext): string {
  const { roomType, sqft, designDirection, currentItems, saturation, budget, siblingRooms, preferences, extractedRoom } = ctx;
  // Prefer floor-plan sqft over caller-supplied — it's measured, not estimated.
  const effectiveSqft = extractedRoom?.sqft ?? sqft;
  const sqftStr = effectiveSqft ? `~${effectiveSqft} sqft` : "unknown size";

  const lines: string[] = [];

  lines.push(`## Room Context`);
  lines.push(`Type: ${roomType} | Size: ${sqftStr}`);
  lines.push(`Design Direction:`);
  lines.push(formatDirectionSummary(designDirection));
  lines.push("");

  const floorPlanSection = formatFloorPlanSection(extractedRoom);
  if (floorPlanSection) {
    lines.push(floorPlanSection);
    lines.push("");
  }

  const prefSection = formatPreferencesForPrompt(preferences);
  if (prefSection) {
    lines.push(prefSection);
    lines.push("");
  }

  const budgetSection = formatBudgetSection(budget);
  if (budgetSection) {
    lines.push(budgetSection);
    lines.push("");
  }

  const siblingSection = formatSiblingRoomsSection(siblingRooms);
  if (siblingSection) {
    lines.push(siblingSection);
    lines.push("");
  }

  lines.push(`## Items Decided So Far (${currentItems.length} total)`);
  lines.push(formatItemList(currentItems));
  lines.push("");

  lines.push(formatSaturationForPrompt(saturation));
  lines.push("");

  lines.push("---");
  lines.push(`Picture this ${(designDirection as { style?: string } | null)?.style ?? "styled"} ${roomType} with everything listed above in place. Stand in the doorway.`);
  lines.push("");
  lines.push("- Where does your eye go?");
  lines.push("- What surfaces, shelves, or walls still feel bare or unfinished?");
  lines.push("- Would adding ONE more item make this room feel more complete, or is it already at its best?");
  lines.push("");
  lines.push("If you would add one more item: describe it precisely. Assign it a priority (1 = critical gap, 5 = pure finishing touch).");
  lines.push("If the room is complete and more would hurt the balance: return STOP with your reasoning.");
  lines.push("");
  lines.push("Respond in JSON only:");
  lines.push(JSON.stringify({
    verdict: "ADD or STOP",
    item: {
      category: "e.g. candles (omit entire 'item' key if STOP)",
      action: "specific, searchable description",
      variant: "e.g. 'trailing shelf' vs 'tall floor' — only if distinguishing a sub-type",
      quantity: "number or null (null = 1)",
      priority: "1–5",
      reasoning: "why this addition helps or why you're stopping",
    },
    density_feel: "sparse | balanced | cozy | full | cluttered",
    overall_reasoning: "1–2 sentences on the room's current state",
  }, null, 2));

  return lines.join("\n");
}

export function buildRetryPrompt(ctx: ExpansionPromptContext): string {
  const { lastRejectionReason } = ctx;
  const base = buildExpansionPrompt(ctx);
  const rejection = lastRejectionReason
    ? `\n\n**NOTE: Your previous suggestion was blocked by a hard design constraint:**\n"${lastRejectionReason}"\n\nPlease suggest a DIFFERENT item (different category) that avoids this constraint, or return STOP if you cannot find a suitable addition.`
    : "";
  return base + rejection;
}
