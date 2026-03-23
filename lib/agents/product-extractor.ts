import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getExtractionPrompt } from "@/lib/prompts/extraction";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";

export interface ExtractedProduct {
  title: string | null;
  retailer: string | null;
  price: number | null;
  dimensions: {
    width?: number;
    depth?: number;
    height?: number;
    diameter?: number;
    unit: "inches" | "cm";
  } | null;
  materials: string[];
  colors: string[];
  category: string;
  description: string | null;
  image_url: string | null;
  lifestyle_image_url?: string | null;
  visual_style_tags?: string[];
  available_variants?: string[];
}

/**
 * Extract product info from a URL using Gemini URL Context + Google Search.
 * Deep-crawls the product page: reads all content, examines product images,
 * checks color/finish variants, and captures lifestyle photography.
 */
export async function extractFromUrl(url: string): Promise<AgentResult<ExtractedProduct>> {
  const model = selectModel("extraction");
  const system = getSystemPrompt();
  const extractionPrompt = getExtractionPrompt();

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [
        {
          role: "user",
          content: `${extractionPrompt}\n\nExtract product information from this URL: ${url}\n\nVisit the page, read all the content, examine all product images carefully, and check for available color/material variants.`,
        },
      ],
      max_tokens: 3072,
      temperature: 0.1,
      tools: [{ urlContext: {} }, { googleSearch: {} }],
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as ExtractedProduct;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Extraction failed",
    };
  }
}

/**
 * Extract product info from an image using Gemini vision.
 */
export async function extractFromImage(imageUrl: string): Promise<AgentResult<ExtractedProduct>> {
  const model = selectModel("extraction");
  const system = getSystemPrompt();
  const extractionPrompt = getExtractionPrompt();

  const content: AIContentBlock[] = [
    {
      type: "image",
      source: { type: "url", url: imageUrl },
    },
    {
      type: "text",
      text: `${extractionPrompt}\n\nAnalyze the product shown in this image. Extract all available information from visual cues — describe what you see in detail (color, material, style, texture, proportions).`,
    },
  ];

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 2048,
      temperature: 0.1,
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as ExtractedProduct;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Image extraction failed",
    };
  }
}
