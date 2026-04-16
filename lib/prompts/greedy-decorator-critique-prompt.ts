// Post-expansion critique prompt. Runs ONCE after the greedy expansion loop
// terminates, so the LLM can see the complete action_list as a whole and
// suggest refinements that single-step greedy cannot spot:
//
//   - Batches that should be added together (tray + 3 objects to style it)
//   - Swaps that improve cohesion (replace generic "vase" with a material-
//     matched one that ties to sibling items)
//   - Duplicates or near-duplicates that should be consolidated
//
// The critique is bounded: it may propose at most MAX_REFINEMENTS changes,
// each is validated against the hard-cap guardrail before being applied, and
// the pass never overrides a user's original action_list — it only touches
// items added during expansion.

import type { ActionItem, DesignDirection } from "@/lib/types/database";
import { formatSaturationForPrompt, type SaturationProfile } from "@/lib/validation/saturation-math";

export interface CritiquePromptContext {
  roomType: string;
  sqft?: number;
  designDirection?: DesignDirection | null;
  /** Full action_list as it stands after greedy expansion. */
  items: ActionItem[];
  /** Current saturation profile — gives the LLM headroom awareness. */
  saturation: SaturationProfile;
  /** Indices (0-based) of items added by the expansion loop (safe to swap/remove). */
  expansionItemIndices: number[];
}

export const MAX_REFINEMENTS = 4;

export const CRITIQUE_SYSTEM_PROMPT = `<role>
You are a senior interior designer doing a final walk-through of a completed room plan. The foundational furniture and finishing items have already been selected. Your job is ONE holistic review — step back, look at the full list as a whole, and identify small refinements that only become visible when everything is seen together.
</role>

<reasoning_process>
Before proposing any refinement, silently run this checklist:

1. **Logical dependencies**: Does any item in the list imply a companion it's missing? (Tray → nothing to style on it. Shelf → nothing to display. Bed → one nightstand instead of a pair.) A dependency gap is the strongest signal that a refinement is needed.
2. **Risk assessment**: Would your proposed change push a category over its cap, break the palette, or introduce a material family not already represented? If yes, don't propose it.
3. **Abductive reasoning**: If the list feels "off" but no single item is wrong, what's the MOST likely underlying cause — a missing batch, a drifting accent, or two items quietly competing for the same role?
4. **Outcome evaluation**: Would a designer reading this list back agree your refinement makes the room more cohesive, or does it just add activity? Favor the quieter, more targeted change.
5. **Persistence and restraint**: Returning zero refinements is always acceptable. Do NOT invent problems to justify output — a cohesive list should leave as-is.
</reasoning_process>

<critique_discipline>
- Look for three patterns only:
  1. **Styling batches** — items present but under-supported (tray with nothing on it, shelf with nothing displayed, lone nightstand).
  2. **Swaps for cohesion** — generic items that drift from the palette/material story. Propose a specific replacement that ties to existing items.
  3. **Consolidations** — two items whose roles overlap so one absorbs the other.
- You are conservative. Fewer refinements is better than more.
- You NEVER touch items marked "original" — those are user-committed anchors. You may only ADD, SWAP, or REMOVE items marked "from expansion".
</critique_discipline>

<output_contract>
Respond in JSON only. No prose, no markdown fences. Think hard before answering — your reasoning never appears in the output, only the conclusion.
</output_contract>`;

function formatDirectionSummary(direction: DesignDirection | null | undefined): string {
  if (!direction) return "No specific design direction established.";
  const d = direction as {
    style?: string;
    style_notes?: string;
    recommended_palette?: string[];
    recommended_materials?: string[];
  };
  const parts: string[] = [];
  if (d.style) parts.push(`Style: ${d.style}`);
  if (d.style_notes) parts.push(d.style_notes);
  if (d.recommended_palette?.length) parts.push(`Palette: ${d.recommended_palette.slice(0, 5).join(", ")}`);
  if (d.recommended_materials?.length) parts.push(`Materials: ${d.recommended_materials.slice(0, 5).join(", ")}`);
  return parts.join("\n");
}

function formatItemsWithOrigin(items: ActionItem[], expansionIndices: Set<number>): string {
  return items
    .map((item, i) => {
      const origin = expansionIndices.has(i) ? "from expansion" : "original";
      const variant = (item as ActionItem & { variant?: string }).variant
        ? ` [${(item as ActionItem & { variant?: string }).variant}]`
        : "";
      return `  ${i}. (${origin}, priority ${item.priority}) ${item.category}${variant} — ${item.action}`;
    })
    .join("\n");
}

export function buildCritiquePrompt(ctx: CritiquePromptContext): string {
  const { roomType, sqft, designDirection, items, saturation, expansionItemIndices } = ctx;
  const expansionSet = new Set(expansionItemIndices);

  const lines: string[] = [];
  lines.push(`## Room Context`);
  lines.push(`Type: ${roomType} | Size: ${sqft ? `~${sqft} sqft` : "unknown"}`);
  lines.push(`Design Direction:`);
  lines.push(formatDirectionSummary(designDirection));
  lines.push("");

  lines.push(`## Full Action List (${items.length} items)`);
  lines.push(formatItemsWithOrigin(items, expansionSet));
  lines.push("");

  lines.push(formatSaturationForPrompt(saturation));
  lines.push("");

  lines.push("---");
  lines.push(`Do one holistic critique. Return at most ${MAX_REFINEMENTS} refinements — fewer is better.`);
  lines.push("");
  lines.push("Allowed operations (each refinement picks ONE):");
  lines.push(`  - **ADD**: introduce a new item that completes a styling batch or fills an obvious gap. Provide { "op": "ADD", "item": {...}, "reason": "..." }.`);
  lines.push(`  - **SWAP**: replace an "from expansion" item with a better alternative. Provide { "op": "SWAP", "index": <number>, "item": {...}, "reason": "..." }.`);
  lines.push(`  - **REMOVE**: drop an "from expansion" item that overlaps with another or drifts from the style. Provide { "op": "REMOVE", "index": <number>, "reason": "..." }.`);
  lines.push("");
  lines.push(`Never touch items marked "original". If the list is already cohesive, return an empty refinements array with a short overall_note.`);
  lines.push("");
  lines.push("Respond in JSON only:");
  lines.push(JSON.stringify({
    overall_note: "1-2 sentences on the list as a whole",
    refinements: [
      {
        op: "ADD | SWAP | REMOVE",
        index: "number (required for SWAP/REMOVE, omit for ADD)",
        item: {
          category: "string (required for ADD and SWAP)",
          action: "specific, searchable description",
          variant: "string | null",
          quantity: "number | null",
          priority: "1-5",
          reasoning: "why this change helps",
        },
        reason: "1 sentence on why this refinement helps the room as a whole",
      },
    ],
  }, null, 2));

  return lines.join("\n");
}
