import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getMockupPrompt } from "@/lib/prompts/mockup";
import type { AgentResult } from "./types";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { CandidateProduct } from "@/lib/types/database";

interface MockupPromptResult {
  prompt: string;
  negative_prompt: string;
  style_notes: string;
}

interface MockupGenerationResult {
  image_url: string;
  image_mime_type?: string;
  prompt_used: string;
  provider: string;
}

/**
 * Generate an image generation prompt from room context + selected products.
 */
export async function generateMockupPrompt(
  roomType: string,
  diagnosisSummary: string,
  products: CandidateProduct[],
  existingItems?: string[],
  designDirection?: string,
): Promise<AgentResult<MockupPromptResult>> {
  const model = selectModel("mockup_prompt");
  const system = getSystemPrompt();

  const productDescriptions = products.map(
    (p) =>
      `${p.category}: ${p.title || "Unknown"} (${p.colors?.join("/") || "neutral"}, ${p.materials?.join("/") || "unknown material"})`
  );

  const prompt = getMockupPrompt(roomType, diagnosisSummary, productDescriptions, existingItems, designDirection);

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
 * Supports optional room photos as visual reference so the generated
 * image actually resembles the real apartment.
 */
export async function generateMockupImage(
  prompt: string,
  roomImageUrls?: string[],
): Promise<AgentResult<MockupGenerationResult>> {
  try {
    // Build content blocks: room photos first (if any), then prompt text
    const content: AIContentBlock[] = [];

    if (roomImageUrls && roomImageUrls.length > 0) {
      content.push({
        type: "text",
        text: "Here are photos of the actual room. Use these as visual reference for the room's architecture, layout, flooring, walls, windows, and lighting when generating the mockup:",
      });
      for (const url of roomImageUrls) {
        content.push({
          type: "image",
          source: { type: "url", url },
        });
      }
    }

    content.push({
      type: "text",
      text: prompt,
    });

    const response = await geminiProvider.chat({
      model: selectModel("image_generation"),
      system: "You are an interior design visualization specialist. Generate photorealistic room mockups that match the actual room architecture shown in any reference photos.",
      messages: [{ role: "user", content }],
      max_tokens: 8192,
      temperature: 0.5,
      responseModalities: ["Text", "Image"],
    });

    if (response.imageData) {
      return {
        success: true,
        data: {
          image_url: response.imageData.data,
          image_mime_type: response.imageData.mimeType,
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
