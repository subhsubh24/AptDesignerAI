/**
 * Designer-style warnings: light-touch LLM check that flags coherence
 * issues introduced by a refine patch (palette clash, material mismatch,
 * style drift, scale problems).
 *
 * Runs AFTER the patch has been applied. Receives only the patched
 * analysis + the changed fields — keeps the prompt small.
 *
 * Output is advisory; warnings are surfaced inline in the chat UI.
 */

import { z } from "zod";
import { getProvider } from "@/lib/ai/provider-factory";
import { selectModel } from "@/lib/ai/models";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { createLogger } from "@/lib/logging/logger";
import type { DesignerWarning } from "@/lib/types/database";

const log = createLogger("designer-warnings");

const WarningSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  field: z.string().min(1),
  message: z.string().min(1),
  suggestion: z.string().optional(),
});

const WarningsResponseSchema = z.object({
  warnings: z.array(WarningSchema),
});

export interface WarningsResult {
  warnings: DesignerWarning[];
  tokens: number;
}

export interface WarningsInput {
  /** The analysis after the patch was applied. */
  analysis: Record<string, unknown>;
  /** Field paths the patch changed (e.g. ["recommended_palette", "what_it_needs.sofa"]). */
  changedFields: string[];
  /** What the user asked for in this turn — useful when deciding severity. */
  feedback: string;
  /** System prompt for design profile context. */
  system: string;
}

const WARNING_INSTRUCTIONS = `You are a senior interior designer reviewing a recent edit to a room's design plan. Your ONLY job is to flag problems with the most recent change — not to redo the design or applaud what's working.

## WHAT TO FLAG
- **Palette conflicts**: warm + cool clashes, too many dominant colors, accent colors swallowing the base
- **Material/finish mismatches**: chrome + brass mixed, raw wood + lacquer in same zone, glossy + rustic clashing
- **Style drift**: an item or palette change that pulls the room away from its stated design_direction
- **Scale issues**: an item being too big/small for the spatial_layout
- **Functional gaps**: a removed item the room actually needs (e.g., dropped the only light source)
- **Cross-room incoherence**: only flag if you have evidence

## WHAT NOT TO FLAG
- Subjective opinions about taste
- Anything the client explicitly requested ("I want chrome" → don't flag chrome+brass; just flag the brass to remove)
- Issues that pre-existed in the analysis (you're reviewing the EDIT, not the whole plan)

## SEVERITY
- **high**: real problem the client should know about NOW (functional gap, dominant clash)
- **medium**: worth a heads-up but not blocking
- **low**: nice-to-know, possibly stylistic preference

## OUTPUT
\`\`\`json
{
  "warnings": [
    {
      "severity": "medium",
      "field": "recommended_palette",
      "message": "Adding 'warm cream' to a palette anchored on cool charcoal may dilute the Nordic mood you established.",
      "suggestion": "Keep cream limited to one textile (a throw or pillow) rather than promoting it to a base palette color."
    }
  ]
}
\`\`\`

If everything looks fine, return \`{"warnings": []}\`. NEVER fabricate warnings.

Return JSON only — no prose, no markdown fences.`;

export async function generateDesignerWarnings(
  input: WarningsInput,
): Promise<WarningsResult> {
  const { analysis, changedFields, feedback, system } = input;

  // No-op when nothing actually changed.
  if (changedFields.length === 0) {
    return { warnings: [], tokens: 0 };
  }

  const slim = {
    style_name: analysis.style_name,
    design_direction: analysis.design_direction,
    recommended_palette: analysis.recommended_palette,
    recommended_materials: analysis.recommended_materials,
    recommended_textures: analysis.recommended_textures,
    spatial_layout: analysis.spatial_layout,
    what_works: analysis.what_works,
    what_should_go: analysis.what_should_go,
    what_it_needs: analysis.what_it_needs,
  };

  const userPrompt = `${WARNING_INSTRUCTIONS}

--- PATCHED ANALYSIS (after the edit) ---
${JSON.stringify(slim, null, 2)}
---

--- WHAT FIELDS CHANGED IN THIS EDIT ---
${changedFields.join(", ")}
---

--- WHAT THE CLIENT ASKED FOR ---
"${feedback}"
---

Now review the patched analysis. Flag only problems introduced by this edit.`;

  const result = await withRetry(
    async () => {
      const response = await getProvider("validation").chat({
        model: selectModel("validation"),
        system,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
        max_tokens: 4000,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "low" },
      });

      const raw = extractJsonObject<unknown>(response.content);
      const parsed = WarningsResponseSchema.parse(raw);
      const tokens =
        (response.usage.input_tokens || 0) +
        (response.usage.output_tokens || 0) +
        (response.usage.thinking_tokens || 0);
      return { warnings: parsed.warnings as DesignerWarning[], tokens };
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      isRetryable: (err) => {
        if (isRetryableError(err)) return true;
        if (err instanceof SyntaxError) return true;
        if (err instanceof Error && err.name === "ZodError") return true;
        return false;
      },
    }
  ).catch((err) => {
    // Warnings are advisory; never block the patch on a warnings failure.
    log.warn("Warnings generation failed — returning empty list", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { warnings: [], tokens: 0 };
  });

  log.info("Generated designer warnings", {
    count: result.warnings.length,
    severities: result.warnings.map((w) => w.severity),
    tokens: { total: result.tokens },
  });

  return result;
}
