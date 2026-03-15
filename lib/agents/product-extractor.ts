import { anthropicProvider } from "@/lib/ai/anthropic";
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
}

/**
 * Extract product information from a URL via Jina Reader API
 */
async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/plain",
        ...(process.env.JINA_API_KEY
          ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` }
          : {}),
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Truncate to avoid token limits
    return text.slice(0, 15000);
  } catch {
    return null;
  }
}

/**
 * Extract product info from a URL
 */
export async function extractFromUrl(url: string): Promise<AgentResult<ExtractedProduct>> {
  const model = selectModel("extraction");
  const system = getSystemPrompt();
  const extractionPrompt = getExtractionPrompt();

  const pageContent = await fetchPageContent(url);
  if (!pageContent) {
    return { success: false, error: "Could not fetch page content. Try uploading a screenshot instead." };
  }

  try {
    const response = await anthropicProvider.chat({
      model,
      system,
      messages: [
        {
          role: "user",
          content: `${extractionPrompt}\n\n## PRODUCT PAGE CONTENT\nURL: ${url}\n\n${pageContent}`,
        },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Failed to parse extraction JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractedProduct;
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
 * Extract product info from an image
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
      text: `${extractionPrompt}\n\nAnalyze the product shown in this image. Extract all available information from visual cues.`,
    },
  ];

  try {
    const response = await anthropicProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 2048,
      temperature: 0.1,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Failed to parse extraction JSON from image" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractedProduct;
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
