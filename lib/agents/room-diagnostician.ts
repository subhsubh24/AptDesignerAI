import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getDiagnosisPrompt } from "@/lib/prompts/diagnosis";
import { DiagnosisResponseSchema } from "@/lib/types/schemas";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentContext, AgentResult } from "./types";
import type { DiagnosisData, DesignDirection, ActionItem } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

const log = createLogger("room-diagnostician");

const DIAGNOSIS_GEMINI_SCHEMA = zodToGeminiSchema(DiagnosisResponseSchema);

export interface DiagnosisResult {
  diagnosis: DiagnosisData;
  design_direction: DesignDirection;
  missing_categories: string[];
  action_list: ActionItem[];
}

export async function runRoomDiagnosis(ctx: AgentContext, profile?: DynamicDesignProfile): Promise<AgentResult<DiagnosisResult>> {
  const model = selectModel("diagnosis");
  const system = getSystemPrompt(profile);
  const userPrompt = getDiagnosisPrompt(
    ctx.roomType,
    ctx.keepItems,
    ctx.replaceItems,
    ctx.priorities
  );

  // Build message with images
  const content: AIContentBlock[] = [];

  // Add images first
  for (const url of ctx.imageUrls) {
    content.push({
      type: "image",
      source: {
        type: "url",
        url,
      },
    });
  }

  // Add the text prompt
  content.push({
    type: "text",
    text: userPrompt,
  });

  let lastError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const retryContent = attempt > 0 && lastError
        ? [...content, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON with the exact structure specified. Ensure all arrays have the minimum required items.` }]
        : content;

      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: retryContent }],
        max_tokens: 8000,
        temperature: attempt === 0 ? 0.3 : 0.4,
        responseSchema: DIAGNOSIS_GEMINI_SCHEMA,
      });

      const raw = extractJsonObject(response.content);
      const validated = DiagnosisResponseSchema.parse(raw);

      return {
        success: true,
        data: {
          diagnosis: validated.diagnosis as DiagnosisData,
          design_direction: validated.design_direction as DesignDirection,
          missing_categories: validated.missing_categories,
          action_list: validated.action_list as ActionItem[],
        },
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
        model: response.model,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Diagnosis failed";
      if (attempt === 0) {
        log.warn("Diagnosis attempt 1 failed", { error: lastError });
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return {
        success: false,
        error: lastError,
      };
    }
  }

  return { success: false, error: "Diagnosis failed after retries" };
}
