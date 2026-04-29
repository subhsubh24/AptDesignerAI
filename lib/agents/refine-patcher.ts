/**
 * Refine patcher: turns user feedback ("make it cozier") into a structured
 * AnalysisPatch that mutates only what's necessary.
 *
 * Replaces the legacy 2-pass full-regen flow in /api/area-analysis/refine.
 * Token wins:
 *   - No JSON output for fields the user didn't touch
 *   - Room images cached via Gemini context cache (cacheScope)
 *   - Lower max_tokens (4K vs 64K) since output is a small diff
 *
 * Returns the patch + a short summary line for the chat history.
 */

import { z } from "zod";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AnalysisPatch, RefineMessage } from "@/lib/types/database";

const log = createLogger("refine-patcher");

const WhatItNeedsItemSchema = z.object({
  category: z.string(),
  search_title: z.string().optional(),
  description: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  specs: z.string(),
  placement: z.string().optional(),
});

const StringDiffSchema = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
});

const PatchSchema = z.object({
  summary: z.string().optional(),
  design_direction: z.string().optional(),
  style_name: z.string().optional(),
  spatial_layout: z.string().optional(),
  lighting_conditions: z.string().optional(),
  recommended_palette: z.array(z.string()).optional(),
  recommended_materials: z.array(z.string()).optional(),
  recommended_textures: z.array(z.string()).optional(),
  what_works: StringDiffSchema.optional(),
  what_should_go: StringDiffSchema.optional(),
  what_it_needs: z
    .object({
      add: z.array(WhatItNeedsItemSchema).optional(),
      remove: z.array(z.string()).optional(),
      update: z
        .array(
          z.object({
            category: z.string(),
            changes: WhatItNeedsItemSchema.partial(),
          })
        )
        .optional(),
    })
    .optional(),
});

const PatchResponseSchema = z.object({
  patch: PatchSchema,
  summary: z.string().optional(),
  /** Whether anything changed at all. If false, patch should be empty. */
  changed: z.boolean(),
});

export interface PatchResult {
  patch: AnalysisPatch;
  summary: string;
  changed: boolean;
  tokens: number;
}

export interface PatchInput {
  /** Raw user message ("make it cozier"). */
  feedback: string;
  /** Current analysis (the one in the DB). */
  priorAnalysis: Record<string, unknown>;
  /** Last N user/assistant exchanges for short-term memory. */
  history: Pick<RefineMessage, "role" | "content">[];
  /** Room images attached as content. Cached via cacheScope. */
  roomImages: AIContentBlock[];
  /** Stable session key for cacheScope (e.g. `refine-chat:${room_id}`). */
  cacheSessionKey: string;
  /** System prompt for design profile context. */
  system: string;
  /** Items the client wants to keep (non-negotiable). */
  keepItems?: string[];
}

const PATCH_INSTRUCTIONS = `You are an interior designer revising your previous assessment based on a client's chat message. You are NOT regenerating the analysis. You are producing a structured PATCH describing only what changes.

## CRITICAL RULES
1. **Touch as little as possible.** If the client only asks to swap a sofa color, only update that one item — do NOT re-emit the palette, materials, or other items.
2. **Always express change as a patch operation.** Use \`update\` for tweaking an existing what_it_needs item; \`add\` for genuinely new items; \`remove\` for items the client no longer wants.
3. **Honor keep items.** Never put items the client wants to keep into what_should_go.
4. **No-op when applicable.** If the client's message is just chit-chat, asks for clarification, or doesn't request a change, set \`changed: false\` and return \`patch: {}\`.

## PATCH SHAPE
\`\`\`json
{
  "patch": {
    // Scalar overwrites — set ONLY if you're rewriting them entirely.
    "summary": "...",
    "design_direction": "...",
    "style_name": "...",
    "spatial_layout": "...",
    "lighting_conditions": "...",

    // Array overwrites — full replacement, only set if you want to replace.
    "recommended_palette": ["...", "..."],
    "recommended_materials": ["...", "..."],
    "recommended_textures": ["...", "..."],

    // String-list diffs — preferred over full replacement.
    "what_works": { "add": ["..."], "remove": ["..."] },
    "what_should_go": { "add": ["..."], "remove": ["..."] },

    // Item-level operations on what_it_needs:
    "what_it_needs": {
      "add": [ { "category": "...", "description": "...", "priority": "high", "specs": "..." } ],
      "remove": ["category_slug_to_drop"],
      "update": [
        { "category": "sofa", "changes": { "description": "...", "search_title": "..." } }
      ]
    }
  },
  "summary": "1-2 sentence human-friendly description of what you changed",
  "changed": true
}
\`\`\`

## EXAMPLES
**Client:** "I want the sofa to be cream not cognac"
→ patch.what_it_needs.update = [{ category: "sofa", changes: { description: "cream linen sofa...", search_title: "Cream linen track-arm sofa, ..." } }]
→ patch.recommended_palette stays UNTOUCHED unless cognac was central to the palette

**Client:** "Make the room cozier"
→ Add a throw blanket and a floor lamp via what_it_needs.add
→ Possibly tweak palette to add a warm tone via recommended_palette

**Client:** "What do you think?"
→ changed: false, patch: {}, summary: "No change requested — happy to discuss further."

Return JSON only. No prose. No markdown fences.`;

export async function generateAnalysisPatch(input: PatchInput): Promise<PatchResult> {
  const {
    feedback,
    priorAnalysis,
    history,
    roomImages,
    cacheSessionKey,
    system,
    keepItems,
  } = input;

  const model = selectModel("area_analysis");

  const historyBlock = history.length > 0
    ? `\n\n--- RECENT CHAT HISTORY (for context) ---\n${history
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n")}\n---`
    : "";

  const keepBlock = keepItems?.length
    ? `\n\n--- ITEMS THE CLIENT WANTS TO KEEP (NON-NEGOTIABLE) ---\n${keepItems
        .map((k) => `- ${k}`)
        .join("\n")}\n---`
    : "";

  // Strip noisy fields that don't help the patcher (they'd waste tokens
  // and the patcher should never touch them via this flow).
  const slimAnalysis = {
    summary: priorAnalysis.summary,
    style_name: priorAnalysis.style_name,
    design_direction: priorAnalysis.design_direction,
    recommended_palette: priorAnalysis.recommended_palette,
    recommended_materials: priorAnalysis.recommended_materials,
    recommended_textures: priorAnalysis.recommended_textures,
    spatial_layout: priorAnalysis.spatial_layout,
    lighting_conditions: priorAnalysis.lighting_conditions,
    what_works: priorAnalysis.what_works,
    what_should_go: priorAnalysis.what_should_go,
    what_it_needs: priorAnalysis.what_it_needs,
  };

  const userPrompt = `${PATCH_INSTRUCTIONS}

--- CURRENT ANALYSIS (the thing you're patching) ---
${JSON.stringify(slimAnalysis, null, 2)}
---${historyBlock}${keepBlock}

--- CLIENT'S NEW MESSAGE ---
"${feedback}"
---

Now produce the patch JSON.`;

  const result = await withRetry(
    async () => {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
        max_tokens: 6000,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "low" },
        cacheScope: roomImages.length > 0
          ? { sessionKey: cacheSessionKey, content: roomImages }
          : undefined,
      });

      const raw = extractJsonObject<unknown>(response.content);
      const parsed = PatchResponseSchema.parse(raw);
      const tokens =
        (response.usage.input_tokens || 0) +
        (response.usage.output_tokens || 0) +
        (response.usage.thinking_tokens || 0);
      return {
        patch: parsed.patch as AnalysisPatch,
        summary: parsed.summary && parsed.summary.trim().length > 0
          ? parsed.summary
          : (parsed.changed ? "Updated the assessment." : "No change made."),
        changed: parsed.changed,
        tokens,
      };
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1500,
      maxDelayMs: 10000,
      isRetryable: (err) => {
        if (isRetryableError(err)) return true;
        if (err instanceof SyntaxError) return true;
        if (err instanceof Error && err.name === "ZodError") return true;
        return false;
      },
    }
  );

  log.info("Generated analysis patch", {
    changed: result.changed,
    fields: Object.keys(result.patch).length,
    tokens: { total: result.tokens },
  });

  return result;
}
