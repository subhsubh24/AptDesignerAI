import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { resolveImageBlock } from "@/lib/ai/resolve-image";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getDiagnosisAnalysisPrompt, getDiagnosisPlanPrompt } from "@/lib/prompts/diagnosis";
import { fetchDiagnosisExamples, formatExamplesForPrompt } from "@/lib/db/diagnosis-examples";
import {
  DiagnosisAnalysisResponseSchema,
  DiagnosisPlanResponseSchema,
} from "@/lib/types/schemas";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { selfConsistent } from "./self-consistency";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentContext, AgentResult } from "./types";
import type { DiagnosisData, DesignDirection, ActionItem } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

const log = createLogger("room-diagnostician");

const DIAGNOSIS_ANALYSIS_GEMINI_SCHEMA = zodToGeminiSchema(DiagnosisAnalysisResponseSchema);
const DIAGNOSIS_PLAN_GEMINI_SCHEMA = zodToGeminiSchema(DiagnosisPlanResponseSchema);

export interface DiagnosisResult {
  diagnosis: DiagnosisData;
  design_direction: DesignDirection;
  missing_categories: string[];
  action_list: ActionItem[];
}

/**
 * Two-pass room diagnosis:
 *   1. Analysis — vision-heavy observation + problem ID + design direction
 *   2. Plan — text-reasoning synthesis of missing_categories + action_list
 *
 * Splitting prevents the plan from being truncated when the analysis takes
 * most of the token budget, and gives each job the model's full attention.
 */
export async function runRoomDiagnosis(ctx: AgentContext, profile?: DynamicDesignProfile): Promise<AgentResult<DiagnosisResult>> {
  const model = selectModel("diagnosis");
  const system = getSystemPrompt(profile);

  // ─── Pass 1: Analysis (vision + design direction) ───────────
  const analysisPrompt = getDiagnosisAnalysisPrompt(
    ctx.roomType,
    ctx.keepItems,
    ctx.replaceItems,
    ctx.priorities,
    ctx.userContext,
    ctx.otherRoomsContext,
    profile,
  );

  const analysisContent: AIContentBlock[] = [];

  // Pre-resolve reused visual assets through the Files API cache. Pass 1 runs
  // N parallel self-consistency samples, so the same floor plan + photos hit
  // Gemini N× — uploading once eliminates N-1 rounds of fetch + base64. Any
  // upload failure falls back to URL blocks (the old behavior) transparently.
  if (ctx.floorPlanImageUrl) {
    analysisContent.push({
      type: "text",
      text: "AUTHORITATIVE FLOOR PLAN — exact dimensions, wall features (windows/doors/built-ins), and building orientation. Use this as the ground truth for all spatial facts. Do not infer or contradict any dimension readable from this plan.",
    });
    analysisContent.push(await resolveImageBlock(ctx.floorPlanImageUrl, { preferFilesApi: true }));
  }

  for (const url of ctx.imageUrls) {
    analysisContent.push(await resolveImageBlock(url, { preferFilesApi: true }));
  }
  analysisContent.push({ type: "text", text: analysisPrompt });

  let analysisTokens = 0;
  let analysisModel = model;
  let analysis: { diagnosis: DiagnosisData; design_direction: DesignDirection };

  // ─── Self-consistency: sample N candidate analyses in parallel, then pick
  // the most coherent one via a separate judge call. This is the single
  // highest-variance commitment point in the pipeline — palette / materials /
  // style_notes chosen here are consumed unchanged by Pass B (plan) and every
  // downstream product search. Reduces Pass A variance at the cost of N×
  // the Pass A call count (default N=3, configurable via SELF_CONSISTENCY_N).
  {
    type Sample = {
      parsed: { diagnosis: DiagnosisData; design_direction: DesignDirection };
      tokens: number;
      model: string;
    };

    const generateSample = async (seed: number, sampleIndex: number): Promise<Sample | null> => {
      let lastError: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const retryContent = attempt > 0 && lastError
            ? [...analysisContent, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON with the exact structure specified.` }]
            : analysisContent;

          const response = await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content: retryContent }],
            max_tokens: 6000,
            seed,
            responseSchema: DIAGNOSIS_ANALYSIS_GEMINI_SCHEMA,
            mediaResolution: "ultra_high",
          });

          const raw = extractJsonObject(response.content);
          const validated = DiagnosisAnalysisResponseSchema.parse(raw);
          return {
            parsed: {
              diagnosis: validated.diagnosis as DiagnosisData,
              design_direction: validated.design_direction as DesignDirection,
            },
            tokens: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
            model: response.model,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Diagnosis analysis failed";
          if (attempt === 0) {
            log.warn("Diagnosis analysis attempt 1 failed", { sampleIndex, error: lastError });
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
        }
      }
      return null;
    };

    // Judge: pick the most coherent candidate. Uses a different prompt framing
    // than the generator to mitigate self-confirmation bias — it never re-
    // evaluates the room; it only compares the candidate analyses against each
    // other on coherence / concreteness / actionability.
    const judgeAnalyses = async (candidates: Sample[]): Promise<number> => {
      const judgeModel = selectModel("diagnosis");
      const summaries = candidates.map((c, i) => {
        const d = c.parsed.diagnosis;
        const dd = c.parsed.design_direction;
        return [
          `=== CANDIDATE ${i} ===`,
          `Vibe summary: ${d.current_vibe_summary ?? ""}`,
          `What works (${d.what_is_working?.length ?? 0}): ${(d.what_is_working ?? []).slice(0, 4).join("; ")}`,
          `What doesn't work (${d.what_is_not_working?.length ?? 0}): ${(d.what_is_not_working ?? []).slice(0, 4).join("; ")}`,
          `Missing categories (${d.missing_furniture_categories?.length ?? 0}): ${(d.missing_furniture_categories ?? []).slice(0, 8).join(", ")}`,
          `Style notes: ${dd.style_notes ?? ""}`,
          `Palette (${dd.recommended_palette?.length ?? 0}): ${(dd.recommended_palette ?? []).join(", ")}`,
          `Materials (${dd.recommended_materials?.length ?? 0}): ${(dd.recommended_materials ?? []).join(", ")}`,
          `Textures: ${(dd.recommended_textures ?? []).join(", ")}`,
        ].join("\n");
      }).join("\n\n");

      const judgePrompt = `You are a senior design critic comparing ${candidates.length} candidate analyses of the same room. Pick the ONE most useful candidate for driving a shopping list.

Evaluation criteria (in order):
1. **Palette–material–style coherence** — do the recommended colors, materials, textures, and style_notes describe a single consistent direction? A candidate that says "mid-century modern" with brass + walnut beats one that says "mid-century" with chrome + lacquer.
2. **Concreteness** — specific colors ("warm walnut brown", "sage green") beat vague colors ("neutral tones"). Specific materials ("boucle", "solid oak") beat categories ("fabric", "wood").
3. **Diagnostic honesty** — the "what doesn't work" list should name specific items, not platitudes. A candidate that says "sofa scale is off — it's swallowing the 12ft wall" beats "room feels crowded".
4. **Missing-category completeness** — does it name enough categories (8+) across essential/standard/finishing tiers to support a full shopping list?

${summaries}

Return ONLY a JSON object: {"best_index": <integer 0 to ${candidates.length - 1}>, "reason": "<one sentence>"}`;

      try {
        const resp = await geminiProvider.chat({
          model: judgeModel,
          system: "You are a design critic selecting the best of several candidate room analyses. Be decisive, terse, and return only the required JSON.",
          messages: [{ role: "user", content: [{ type: "text", text: judgePrompt }] }],
          max_tokens: 2000,
        });
        const parsed = extractJsonObject(resp.content) as { best_index?: number; reason?: string };
        const idx = typeof parsed?.best_index === "number" ? parsed.best_index : 0;
        log.info("Diagnosis Pass A judge chose candidate", {
          chosen: idx,
          reason: parsed?.reason,
          candidates: candidates.length,
        });
        return idx;
      } catch (err) {
        log.warn("Diagnosis Pass A judge call failed — defaulting to sample 0", { error: String(err) });
        return 0;
      }
    };

    try {
      const selection = await selfConsistent<Sample>({
        generate: generateSample,
        judge: judgeAnalyses,
        label: "diagnosis.passA",
      });
      analysis = selection.chosen.parsed;
      // Sum tokens across every surviving sample (generation cost is N×, not 1×)
      analysisTokens = selection.candidates.reduce((sum, c) => sum + c.tokens, 0);
      analysisModel = selection.chosen.model;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Diagnosis analysis failed after retries";
      return { success: false, error: msg };
    }

    // Preserve the original seeded-by-DETERMINISTIC_SEED behavior as a fallback
    // reference for any downstream code inspecting this constant.
    void DETERMINISTIC_SEED;
  }

  log.info("Diagnosis analysis pass complete", {
    roomType: ctx.roomType,
    tokens: { total: analysisTokens },
    whatIsWorking: analysis.diagnosis.what_is_working?.length ?? 0,
    whatIsNotWorking: analysis.diagnosis.what_is_not_working?.length ?? 0,
    missingInDiagnosis: analysis.diagnosis.missing_furniture_categories?.length ?? 0,
  });

  // ─── Pass 2: Plan (consumes Pass 1's analysis as text) ──────
  const analysisJson = JSON.stringify(analysis, null, 2);

  // Fetch DB-backed few-shot examples: top-N past action_lists from
  // diagnoses of the same room_type. Real accepted outputs calibrate
  // specificity and category coverage better than synthetic examples.
  const fewShotExamples = await fetchDiagnosisExamples(
    ctx.roomType,
    null, // direction label not in schema yet — room_type match only
  );
  const fewShotBlock = formatExamplesForPrompt(fewShotExamples);
  if (fewShotExamples.length > 0) {
    log.info("Injecting few-shot examples into Pass 2 prompt", {
      count: fewShotExamples.length,
      roomType: ctx.roomType,
    });
  }

  const planPrompt = getDiagnosisPlanPrompt(
    ctx.roomType,
    analysisJson,
    ctx.keepItems,
    ctx.replaceItems,
    ctx.priorities,
    ctx.userContext,
    fewShotBlock,
  );

  let planTokens = 0;
  let plan: { missing_categories: string[]; action_list: ActionItem[] };

  {
    let lastError: string | undefined;
    let parsed: { missing_categories: string[]; action_list: ActionItem[] } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const retryText = attempt > 0 && lastError
          ? `${planPrompt}\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON with the exact structure specified.`
          : planPrompt;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: retryText }] }],
          max_tokens: 4000,
          seed: DETERMINISTIC_SEED,
          responseSchema: DIAGNOSIS_PLAN_GEMINI_SCHEMA,
        });

        const raw = extractJsonObject(response.content);
        const validated = DiagnosisPlanResponseSchema.parse(raw);
        parsed = {
          missing_categories: validated.missing_categories,
          action_list: validated.action_list as ActionItem[],
        };
        planTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Diagnosis plan failed";
        if (attempt === 0) {
          log.warn("Diagnosis plan attempt 1 failed", { error: lastError });
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { success: false, error: lastError };
      }
    }
    if (!parsed) return { success: false, error: "Diagnosis plan failed after retries" };
    plan = parsed;
  }

  log.info("Diagnosis plan pass complete", {
    roomType: ctx.roomType,
    tokens: { total: planTokens },
    missingCategories: plan.missing_categories.length,
    actionItems: plan.action_list.length,
  });

  return {
    success: true,
    data: {
      diagnosis: analysis.diagnosis,
      design_direction: analysis.design_direction,
      missing_categories: plan.missing_categories,
      action_list: plan.action_list,
    },
    tokensUsed: analysisTokens + planTokens,
    model: analysisModel,
  };
}
