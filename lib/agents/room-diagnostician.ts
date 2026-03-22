import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getDiagnosisPrompt } from "@/lib/prompts/diagnosis";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentContext, AgentResult } from "./types";
import type { DiagnosisData, DesignDirection, ActionItem } from "@/lib/types/database";

export interface DiagnosisResult {
  diagnosis: DiagnosisData;
  design_direction: DesignDirection;
  missing_categories: string[];
  action_list: ActionItem[];
}

export async function runRoomDiagnosis(ctx: AgentContext): Promise<AgentResult<DiagnosisResult>> {
  const model = selectModel("diagnosis");
  const system = getSystemPrompt();
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

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 8192,
      temperature: 0.3,
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content);

    return {
      success: true,
      data: {
        diagnosis: parsed.diagnosis,
        design_direction: parsed.design_direction,
        missing_categories: parsed.missing_categories || [],
        action_list: parsed.action_list || [],
      },
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during diagnosis",
    };
  }
}
