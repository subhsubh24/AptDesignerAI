import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getExtractionPrompt } from "@/lib/prompts/extraction";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";

// ─── Extraction Cache (24h TTL) ───────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const extractionCache = new Map<string, { data: ExtractedProduct; timestamp: number }>();

function getCachedExtraction(url: string): ExtractedProduct | null {
  const entry = extractionCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    extractionCache.delete(url);
    return null;
  }
  return entry.data;
}

function cacheExtraction(url: string, data: ExtractedProduct) {
  extractionCache.set(url, { data, timestamp: Date.now() });
  // Prevent unbounded growth — evict oldest entries over 500
  if (extractionCache.size > 500) {
    const oldest = extractionCache.keys().next().value;
    if (oldest) extractionCache.delete(oldest);
  }
}

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
 * Parse JSON from a potentially messy LLM response (may have markdown, extra text, etc.)
 */
function parseJsonResponse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }
    const braceStart = raw.indexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      return JSON.parse(raw.slice(braceStart, braceEnd + 1)) as T;
    }
    throw new Error("Could not parse response as JSON");
  }
}

/**
 * Extract product info from a URL using Gemini URL Context.
 * Deep-crawls the product page: reads all content, examines product images,
 * checks color/finish variants, and captures lifestyle photography.
 *
 * Retries once on API errors (transient 400s from urlContext are common).
 * Falls back to extraction without urlContext if both attempts fail.
 */
export async function extractFromUrl(url: string): Promise<AgentResult<ExtractedProduct>> {
  // Check cache first
  const cached = getCachedExtraction(url);
  if (cached) {
    return { success: true, data: cached };
  }

  const model = selectModel("extraction");
  const system = getSystemPrompt();
  const extractionPrompt = getExtractionPrompt();

  const userContent = `${extractionPrompt}\n\nExtract product information from this URL: ${url}\n\nVisit the page, read all the content, examine all product images carefully, and check for available color/material variants.\n\nReturn ONLY valid JSON, no markdown or extra text.`;

  // Attempt 1: with urlContext tool
  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: userContent }],
      max_tokens: 3072,
      temperature: 0.1,
      tools: [{ urlContext: {} }],
    });

    const raw = response.content.trim();
    if (!raw) throw new Error("Empty response from extraction");

    const parsed = parseJsonResponse<ExtractedProduct>(raw);
    cacheExtraction(url, parsed);
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (firstError) {
    // Attempt 2: retry after brief delay (transient rate limit / API errors)
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: userContent }],
        max_tokens: 3072,
        temperature: 0.1,
        tools: [{ urlContext: {} }],
      });

      const raw = response.content.trim();
      if (!raw) throw new Error("Empty response from extraction (retry)");

      const parsed = parseJsonResponse<ExtractedProduct>(raw);
      cacheExtraction(url, parsed);
      return {
        success: true,
        data: parsed,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        model: response.model,
      };
    } catch (retryError) {
      return {
        success: false,
        error: retryError instanceof Error ? retryError.message : "Extraction failed",
      };
    }
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
