import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getExtractionPrompt } from "@/lib/prompts/extraction";
import { ExtractedProductSchema } from "@/lib/types/schemas";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

const log = createLogger("product-extractor");

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
 * Validate that an image URL actually resolves to an image.
 * Uses a HEAD request with a short timeout to avoid blocking.
 * Returns the URL if valid, null if it's dead/non-image.
 */
async function validateImageUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  // Reject obviously invalid URLs before making a network request
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    new URL(url); // validate URL structure
  } catch {
    return null;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/*",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Scrape a product page's HTML to extract real image URLs.
 * Uses og:image, twitter:image meta tags, and JSON-LD structured data.
 * These are reliable, standardized sources that every major retailer uses.
 */
async function scrapeProductImages(
  pageUrl: string
): Promise<{ ogImage: string | null; productImages: string[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return { ogImage: null, productImages: [] };

    const html = await res.text();
    const images: string[] = [];

    // 1. og:image — the single best product image on virtually every retailer
    const ogMatch = html.match(
      /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i
    ) || html.match(
      /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i
    );
    const ogImage = ogMatch ? ogMatch[1] : null;
    if (ogImage) images.push(ogImage);

    // 2. twitter:image — often same as og:image but sometimes different/higher-res
    const twMatch = html.match(
      /<meta\s+(?:property|name)=["']twitter:image["']\s+content=["']([^"']+)["']/i
    ) || html.match(
      /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']twitter:image["']/i
    );
    if (twMatch && twMatch[1] !== ogImage) images.push(twMatch[1]);

    // 3. JSON-LD structured data — Product schema has "image" field
    const jsonLdBlocks = html.match(
      /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    if (jsonLdBlocks) {
      for (const block of jsonLdBlocks) {
        try {
          const content = block.replace(
            /<script\s+type=["']application\/ld\+json["'][^>]*>/i,
            ""
          ).replace(/<\/script>/i, "");
          const ld = JSON.parse(content);
          // Handle both single objects and @graph arrays
          const items = ld["@graph"] ? ld["@graph"] : [ld];
          for (const item of items) {
            if (
              item["@type"] === "Product" ||
              item["@type"]?.includes?.("Product")
            ) {
              const ldImages = Array.isArray(item.image)
                ? item.image
                : item.image
                  ? [item.image]
                  : [];
              for (const img of ldImages) {
                const url = typeof img === "string" ? img : img?.url || img?.contentUrl;
                if (url && !images.includes(url)) images.push(url);
              }
            }
          }
        } catch {
          // JSON parse failure in LD block — skip
        }
      }
    }

    return { ogImage, productImages: images };
  } catch (err) {
    log.warn("Failed to scrape images from page", { url: pageUrl, error: err instanceof Error ? err.message : String(err) });
    return { ogImage: null, productImages: [] };
  }
}

/**
 * Validate and fix image URLs in an extracted product.
 *
 * Strategy:
 *  1. Scrape real image URLs from the product page (og:image, JSON-LD)
 *  2. If the AI-extracted URL is valid, keep it
 *  3. If not, replace with the scraped og:image or first JSON-LD image
 *  4. Validate the final URL to ensure it actually serves an image
 */
async function validateExtractedImages(
  product: ExtractedProduct,
  pageUrl: string
): Promise<ExtractedProduct> {
  // Scrape ground-truth images from the page in parallel with validating AI's URLs
  const [scraped, validMain, validLifestyle] = await Promise.all([
    scrapeProductImages(pageUrl),
    validateImageUrl(product.image_url),
    validateImageUrl(product.lifestyle_image_url),
  ]);

  let finalMain = validMain;
  let finalLifestyle = validLifestyle;

  // If AI's main image is dead, use scraped og:image
  if (!finalMain && scraped.ogImage) {
    finalMain = await validateImageUrl(scraped.ogImage);
    if (finalMain) {
      log.debug("Replaced dead image_url with og:image", { title: product.title });
    }
  }

  // If still no main image, try other scraped images
  if (!finalMain && scraped.productImages.length > 0) {
    for (const candidate of scraped.productImages) {
      if (candidate === scraped.ogImage) continue; // already tried
      finalMain = await validateImageUrl(candidate);
      if (finalMain) {
        log.debug("Replaced dead image_url with JSON-LD image", { title: product.title });
        break;
      }
    }
  }

  // If no lifestyle image, try additional scraped images (skip the one used for main)
  if (!finalLifestyle && scraped.productImages.length > 1) {
    for (const candidate of scraped.productImages) {
      if (candidate === finalMain) continue;
      finalLifestyle = await validateImageUrl(candidate);
      if (finalLifestyle) {
        log.debug("Found lifestyle image from page scrape", { title: product.title });
        break;
      }
    }
  }

  if (finalMain !== product.image_url || finalLifestyle !== product.lifestyle_image_url) {
    log.info("Image fix-up applied", {
      title: product.title,
      mainResolved: !!finalMain,
      lifestyleResolved: !!finalLifestyle,
    });
  }

  return {
    ...product,
    image_url: finalMain,
    lifestyle_image_url: finalLifestyle,
  };
}

/**
 * Parse JSON from a potentially messy LLM response (may have markdown, extra text, etc.)
 * Then validate through the ExtractedProduct Zod schema.
 */
function parseAndValidateExtraction(raw: string): ExtractedProduct {
  let jsonObj: unknown;
  try {
    jsonObj = JSON.parse(raw);
  } catch {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonObj = JSON.parse(jsonMatch[1].trim());
    } else {
      const braceStart = raw.indexOf("{");
      const braceEnd = raw.lastIndexOf("}");
      if (braceStart !== -1 && braceEnd > braceStart) {
        jsonObj = JSON.parse(raw.slice(braceStart, braceEnd + 1));
      } else {
        throw new Error("Could not parse response as JSON");
      }
    }
  }
  return ExtractedProductSchema.parse(jsonObj) as ExtractedProduct;
}

/**
 * Extract product info from a URL using Gemini URL Context.
 * Deep-crawls the product page: reads all content, examines product images,
 * checks color/finish variants, and captures lifestyle photography.
 *
 * Strategy:
 *  1. Try with urlContext tool (lets Gemini fetch + read the page)
 *  2. If that 400s, retry with urlContext once (transient errors are common)
 *  3. If still failing, fall back to plain text prompt without urlContext
 */
export async function extractFromUrl(url: string, designProfile?: DynamicDesignProfile): Promise<AgentResult<ExtractedProduct>> {
  // Check cache first
  const cached = getCachedExtraction(url);
  if (cached) {
    return { success: true, data: cached };
  }

  const model = selectModel("extraction");
  const system = getSystemPrompt(designProfile);
  const extractionPrompt = getExtractionPrompt();

  const userContent = `${extractionPrompt}\n\nExtract product information from this URL: ${url}\n\nVisit the page, read all the content, examine all product images carefully, and check for available color/material variants.\n\nReturn ONLY valid JSON, no markdown or extra text.`;

  // Attempt 1: with urlContext tool
  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: userContent }],
      max_tokens: 3000,
      temperature: 0.1,
      tools: [{ urlContext: {} }],
    });

    const raw = response.content.trim();
    if (!raw) throw new Error("Empty response from extraction");

    let parsed = parseAndValidateExtraction(raw);
    parsed = await validateExtractedImages(parsed, url);
    cacheExtraction(url, parsed);
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
      model: response.model,
    };
  } catch (firstError) {
    // Attempt 2: retry with urlContext after brief delay (transient errors)
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: userContent }],
        max_tokens: 3000,
        temperature: 0.1,
        tools: [{ urlContext: {} }],
      });

      const raw = response.content.trim();
      if (!raw) throw new Error("Empty response from extraction (retry)");

      let parsed = parseAndValidateExtraction(raw);
      parsed = await validateExtractedImages(parsed, url);
      cacheExtraction(url, parsed);
      return {
        success: true,
        data: parsed,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
        model: response.model,
      };
    } catch {
      // Attempt 3: fall back to plain prompt WITHOUT urlContext
      // Flash Lite can still extract from the URL if given just the text prompt
      log.warn("urlContext failed, falling back to plain extraction", { url });
      try {
        const fallbackContent = `${extractionPrompt}\n\nI need you to extract product information from this URL: ${url}\n\nBased on the URL structure and any information you can infer from it, provide your best extraction. If the URL contains a product slug, use it to infer the product name. Set confidence fields low if you're uncertain.\n\nReturn ONLY valid JSON, no markdown or extra text.`;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: fallbackContent }],
          max_tokens: 3000,
          temperature: 0.1,
        });

        const raw = response.content.trim();
        if (!raw) throw new Error("Empty response from fallback extraction");

        let parsed = parseAndValidateExtraction(raw);
        parsed = await validateExtractedImages(parsed, url);
        cacheExtraction(url, parsed);
        return {
          success: true,
          data: parsed,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          model: response.model,
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: fallbackError instanceof Error ? fallbackError.message : "Extraction failed (all attempts)",
        };
      }
    }
  }
}

/**
 * Extract product info from an image using Gemini vision.
 */
export async function extractFromImage(imageUrl: string, designProfile?: DynamicDesignProfile): Promise<AgentResult<ExtractedProduct>> {
  const model = selectModel("extraction");
  const system = getSystemPrompt(designProfile);
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
      max_tokens: 2000,
      temperature: 0.1,
      responseMimeType: "application/json",
    });

    const validated = ExtractedProductSchema.parse(JSON.parse(response.content)) as ExtractedProduct;
    return {
      success: true,
      data: validated,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Image extraction failed",
    };
  }
}
