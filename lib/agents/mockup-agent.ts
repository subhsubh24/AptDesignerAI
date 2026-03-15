import { openaiProvider } from "@/lib/ai/openai";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getMockupPrompt } from "@/lib/prompts/mockup";
import type { AgentResult } from "./types";
import type { CandidateProduct } from "@/lib/types/database";

interface MockupPromptResult {
  prompt: string;
  negative_prompt: string;
  style_notes: string;
}

interface MockupGenerationResult {
  image_url: string;
  prompt_used: string;
  provider: string;
}

/**
 * Generate an image generation prompt from room context + selected products
 */
export async function generateMockupPrompt(
  roomType: string,
  diagnosisSummary: string,
  products: CandidateProduct[]
): Promise<AgentResult<MockupPromptResult>> {
  const model = selectModel("mockup_prompt");
  const system = getSystemPrompt();

  const productDescriptions = products.map(
    (p) =>
      `${p.category}: ${p.title || "Unknown"} (${p.colors?.join("/") || "neutral"}, ${p.materials?.join("/") || "unknown material"})`
  );

  const prompt = getMockupPrompt(roomType, diagnosisSummary, productDescriptions);

  try {
    const response = await openaiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
      temperature: 0.4,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Failed to parse mockup prompt JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as MockupPromptResult;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Mockup prompt generation failed",
    };
  }
}

/**
 * Generate a mockup image using OpenAI's image generation API
 */
export async function generateMockupImage(prompt: string): Promise<AgentResult<MockupGenerationResult>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: "OPENAI_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: "1536x1024",
        quality: "high",
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: `OpenAI API error: ${response.status} ${JSON.stringify(err)}` };
    }

    const data = await response.json();
    const imageData = data.data?.[0];

    if (!imageData) {
      return { success: false, error: "No image generated" };
    }

    return {
      success: true,
      data: {
        image_url: imageData.url || `data:image/png;base64,${imageData.b64_json}`,
        prompt_used: prompt,
        provider: "openai-gpt-image-1",
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Image generation failed",
    };
  }
}
