import { geminiProvider } from "@/lib/ai/gemini";
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
 * Generate an image generation prompt from room context + selected products.
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
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
      temperature: 0.4,
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as MockupPromptResult;
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
 * Generate a mockup image using Gemini native image generation.
 * Replaces OpenAI DALL-E / gpt-image-1.
 */
export async function generateMockupImage(prompt: string): Promise<AgentResult<MockupGenerationResult>> {
  try {
    const response = await geminiProvider.chat({
      model: selectModel("image_generation"),
      system: "You are an interior design visualization specialist. Generate photorealistic room mockups.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.5,
      responseModalities: ["Text", "Image"],
    });

    if (response.imageData) {
      // Return as data URI — caller can upload to Supabase Storage
      const imageUrl = `data:${response.imageData.mimeType};base64,${response.imageData.data}`;
      return {
        success: true,
        data: {
          image_url: imageUrl,
          prompt_used: prompt,
          provider: "gemini-image",
        },
      };
    }

    return { success: false, error: "No image generated in response" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Image generation failed",
    };
  }
}
