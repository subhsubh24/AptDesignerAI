import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getDiagnosisAnalysisPrompt, getDiagnosisPlanPrompt } from "@/lib/prompts/diagnosis";
import {
  DiagnosisAnalysisResponseSchema,
  DiagnosisPlanResponseSchema,
} from "@/lib/types/schemas";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
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
  );

  const analysisContent: AIContentBlock[] = [];
  for (const url of ctx.imageUrls) {
    analysisContent.push({ type: "image", source: { type: "url", url } });
  }
  analysisContent.push({ type: "text", text: analysisPrompt });

  let analysisTokens = 0;
  let analysisModel = model;
  let analysis: { diagnosis: DiagnosisData; design_direction: DesignDirection };

  {
    let lastError: string | undefined;
    let parsed: { diagnosis: DiagnosisData; design_direction: DesignDirection } | undefined;
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
          seed: DETERMINISTIC_SEED,
          responseSchema: DIAGNOSIS_ANALYSIS_GEMINI_SCHEMA,
          mediaResolution: "ultra_high",
        });

        const raw = extractJsonObject(response.content);
        const validated = DiagnosisAnalysisResponseSchema.parse(raw);
        parsed = {
          diagnosis: validated.diagnosis as DiagnosisData,
          design_direction: validated.design_direction as DesignDirection,
        };
        analysisTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        analysisModel = response.model;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Diagnosis analysis failed";
        if (attempt === 0) {
          log.warn("Diagnosis analysis attempt 1 failed", { error: lastError });
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { success: false, error: lastError };
      }
    }
    if (!parsed) return { success: false, error: "Diagnosis analysis failed after retries" };
    analysis = parsed;
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
  const planPrompt = getDiagnosisPlanPrompt(
    ctx.roomType,
    analysisJson,
    ctx.keepItems,
    ctx.replaceItems,
    ctx.priorities,
    ctx.userContext,
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
