import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getExtractionPrompt } from "@/lib/prompts/extraction";
import { ExtractedProductSchema } from "@/lib/types/schemas";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC, DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

const log = createLogger("product-extractor");

// ─── Extraction Cache (24h TTL) ───────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const extractionCache = new Map<string, { data: ExtractedProduct; timestamp: number }>();

function getCachedExtraction(url: string): ExtractedProduct | null {
  // Bypass cache entirely in deterministic mode — we always want the
  // extraction step to run through the seeded LLM call so runs are
  // reproducible regardless of cache warmth.
  if (DETERMINISTIC) return null;
  const entry = extractionCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    extractionCache.delete(url);
    return null;
  }
  // LRU bump: move to recent end so frequently-read URLs survive eviction.
  extractionCache.delete(url);
  extractionCache.set(url, entry);
  return entry.data;
}

function cacheExtraction(url: string, data: ExtractedProduct) {
  extractionCache.delete(url);
  extractionCache.set(url, { data, timestamp: Date.now() });
  while (extractionCache.size > 500) {
    const next = extractionCache.keys().next();
    if (next.done || next.value === undefined) break;
    extractionCache.delete(next.value);
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
  // (r) Stock/availability info
  in_stock?: boolean | null;
  stock_notes?: string | null;
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
              // Collect image field — can be string, object, or array of either
              const imageField = item.image || item.images;
              const ldImages = Array.isArray(imageField)
                ? imageField
                : imageField
                  ? [imageField]
                  : [];
              for (const img of ldImages) {
                // Handle all common JSON-LD image formats:
                // - String: "https://..."
                // - Object: { url: "..." } or { contentUrl: "..." } or { "@id": "..." }
                // - Nested: { url: { "@id": "..." } } or { image: { url: "..." } }
                const url = typeof img === "string"
                  ? img
                  : img?.url
                    ? (typeof img.url === "string" ? img.url : img.url?.["@id"] || img.url?.url)
                    : img?.contentUrl || img?.["@id"] || img?.thumbnail?.url || null;
                if (url && typeof url === "string" && !images.includes(url)) images.push(url);
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
 * Fetch a product page's HTML and extract structured product context:
 * JSON-LD Product schema, og meta tags, and any visible price/title text.
 * Returns a formatted string ready to inject into the LLM extraction prompt.
 * Returns null if the page can't be fetched.
 */
async function scrapePageContext(pageUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const html = await res.text();
    const lines: string[] = [];

    // 1. JSON-LD Product schema — best structured source for title, price, description
    const jsonLdBlocks = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdBlocks) {
      for (const block of jsonLdBlocks) {
        try {
          const content = block
            .replace(/<script\s+type=["']application\/ld\+json["'][^>]*>/i, "")
            .replace(/<\/script>/i, "");
          const ld = JSON.parse(content);
          const items = ld["@graph"] ? ld["@graph"] : [ld];
          for (const item of items) {
            if (item["@type"] === "Product" || String(item["@type"]).includes("Product")) {
              const name = item.name || item.headline;
              if (name) lines.push(`Title: ${name}`);
              if (item.description) lines.push(`Description: ${String(item.description).slice(0, 600)}`);
              // Price from offers
              const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              if (offers?.price) lines.push(`Price: $${offers.price} ${offers.priceCurrency || "USD"}`);
              if (offers?.availability) lines.push(`Availability: ${offers.availability}`);
              if (item.brand?.name) lines.push(`Brand: ${item.brand.name}`);
              // Dimensions often appear in additionalProperty or as part of description
              if (Array.isArray(item.additionalProperty)) {
                const dimProps = item.additionalProperty
                  .filter((p: Record<string, string>) => /dimension|width|depth|height|size|weight/i.test(p.name || ""))
                  .map((p: Record<string, string>) => `${p.name}: ${p.value}`);
                if (dimProps.length) lines.push(`Specs: ${dimProps.join(", ")}`);
              }
              if (item.material) lines.push(`Material: ${Array.isArray(item.material) ? item.material.join(", ") : item.material}`);
              if (item.color) lines.push(`Color: ${item.color}`);
            }
          }
        } catch { /* malformed JSON-LD block */ }
      }
    }

    // 2. og meta tags as fallback for title/description/image
    const ogTitle = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)?.[1];
    const ogDesc = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:description["']/i)?.[1];
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();

    if (!lines.some((l) => l.startsWith("Title:"))) {
      if (ogTitle) lines.push(`Title: ${ogTitle}`);
      else if (titleTag) lines.push(`Title: ${titleTag}`);
    }
    if (!lines.some((l) => l.startsWith("Description:")) && ogDesc) {
      lines.push(`Description: ${ogDesc.slice(0, 400)}`);
    }

    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
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

// Retailers that ship clean JSON-LD Product schema + reliable og meta. For
// these, scraping the HTML directly is faster and more accurate than URL
// Context (which struggles with JS-heavy retailer pages). URL Context remains
// the generic path for unknown retailers.
const STRUCTURED_SCRAPE_FIRST = [
  "westelm.com",
  "cb2.com",
  "rh.com",
  "restorationhardware.com",
  "article.com",
  "burrow.com",
  "crateandbarrel.com",
  "potterybarn.com",
  "wayfair.com",
  "target.com",
  "ikea.com",
  "amazon.com",
  "anthropologie.com",
  "allmodern.com",
  "jossandmain.com",
  "roomandboard.com",
];

function shouldTryStructuredScrapeFirst(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return STRUCTURED_SCRAPE_FIRST.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Domains where URL Context consistently 400s with INVALID_ARGUMENT.
 * For these, we skip the URL Context attempts entirely after structured
 * scrape fails — going straight to the plain-text fallback. Saves ~3s
 * of doomed retries per URL on these retailers.
 */
const URL_CONTEXT_BLACKLIST = new Set([
  "wayfair.com",
]);

function isUrlContextBlacklisted(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    for (const d of URL_CONTEXT_BLACKLIST) {
      if (host === d || host.endsWith(`.${d}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Consider scraped context "sufficient" only when it includes at least a
// Title AND one of (Price, Description). Otherwise fall through to URL Context.
//
// Two-phase: cheap regex check first (catches the labeled-fields case with
// zero cost), then an LLM semantic check on the borderline case where the
// regex says "no" — this catches pages whose JSON-LD names fields differently
// (e.g., "Product Name" instead of "Title:") and would otherwise burn an
// expensive URL Context call unnecessarily.
function isScrapeContextSufficient(ctx: string): boolean {
  const hasTitle = /^Title:/m.test(ctx);
  const hasPrice = /^Price:/m.test(ctx);
  const hasDesc = /^Description:/m.test(ctx);
  return hasTitle && (hasPrice || hasDesc);
}

async function isScrapeContextSufficientAsync(ctx: string): Promise<boolean> {
  if (isScrapeContextSufficient(ctx)) return true;
  // LLM tiebreaker for the "regex said no but content might still be enough" case.
  if (!ctx || ctx.length < 60) return false;
  try {
    const { isScrapeContextSufficientLLM } = await import("@/lib/ai/semantic-extract");
    const llm = await isScrapeContextSufficientLLM(ctx);
    return llm === true;
  } catch {
    return false;
  }
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
export async function extractFromUrl(
  url: string,
  designProfile?: DynamicDesignProfile,
  roomImageUrls?: string[],
): Promise<AgentResult<ExtractedProduct>> {
  // Check cache first
  const cached = getCachedExtraction(url);
  if (cached) {
    return { success: true, data: cached };
  }

  const model = selectModel("extraction");
  const system = getSystemPrompt(designProfile);
  const extractionPrompt = getExtractionPrompt();

  const userContent = `${extractionPrompt}\n\nExtract product information from this URL: ${url}\n\nVisit the page, read all the content, examine all product images carefully, and check for available color/material variants.\n\nReturn ONLY valid JSON, no markdown or extra text.`;

  // Room images are intentionally NOT sent during extraction:
  // 1. urlContext tool + inline images = Gemini 400 INVALID_ARGUMENT.
  // 2. Each image adds ~1500–2500 tokens at ultra_high resolution; across 100
  //    extractions that burns ~600K tokens for marginal style-tag benefit.
  //    The design profile (text) already carries style context. Deep-score
  //    calls later send room images where vision actually matters.
  // Kept as a no-op helper so fallback paths still compile unchanged.
  const buildContent = (text: string): string => text;

  // Attempt 0 (known-brittle retailers only): try HTML structured scrape first.
  // These retailers ship clean JSON-LD Product schema — scraping is faster and
  // more reliable than URL Context, which struggles with JS-heavy PDPs.
  if (shouldTryStructuredScrapeFirst(url)) {
    try {
      const pageContext = await scrapePageContext(url);
      if (pageContext && await isScrapeContextSufficientAsync(pageContext)) {
        const scrapeFirstContent = `${extractionPrompt}\n\nExtract product information for: ${url}\n\n## Page content extracted directly from ${url}:\n${pageContext}\n\nUse the above page content to fill in all fields accurately.\n\nReturn ONLY valid JSON, no markdown or extra text.`;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: buildContent(scrapeFirstContent) }],
          max_tokens: 64000,
          seed: DETERMINISTIC_SEED,
        });

        const raw = response.content.trim();
        if (raw) {
          let parsed = parseAndValidateExtraction(raw);
          parsed = await validateExtractedImages(parsed, url);
          cacheExtraction(url, parsed);
          log.debug("Extracted via structured scrape (known retailer)", { url });
          return {
            success: true,
            data: parsed,
            tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
            model: response.model,
          };
        }
      }
    } catch (scrapeErr) {
      log.debug("Structured-scrape-first path failed, falling through to URL Context", {
        url,
        error: scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr),
      });
    }
  }

  // For domains where URL Context consistently 400s with INVALID_ARGUMENT
  // (Wayfair, etc.), throw early in both attempts so we jump to the
  // plain-text fallback rather than burning ~3s on doomed retries.
  const skipUrlContext = isUrlContextBlacklisted(url);

  // Attempt 1: with urlContext tool
  try {
    if (skipUrlContext) throw new Error("urlContext blacklisted for this domain");
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: buildContent(userContent) }],
      max_tokens: 64000,
      seed: DETERMINISTIC_SEED,
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
  } catch (attempt1Error) {
    // Attempt 2: retry with urlContext after brief delay (transient errors)
    log.debug("urlContext attempt 1 failed", { url, error: attempt1Error instanceof Error ? attempt1Error.message : String(attempt1Error) });
    if (!skipUrlContext) await new Promise((r) => setTimeout(r, 1500));
    try {
      if (skipUrlContext) throw new Error("urlContext blacklisted for this domain");
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: buildContent(userContent) }],
        max_tokens: 64000,
        seed: DETERMINISTIC_SEED,
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
    } catch (attempt2Error) {
      // Attempt 3: fall back to HTML scraping — fetch the raw page and extract
      // JSON-LD Product schema + og meta ourselves, then pass as structured
      // context to the model. This works better than URL slug inference for
      // JS-heavy retailer pages (Target, AllModern, Joss & Main, etc.)
      log.warn("urlContext failed, falling back to plain extraction", {
        url,
        error: attempt2Error instanceof Error ? attempt2Error.message : String(attempt2Error),
      });
      try {
        const pageContext = await scrapePageContext(url);
        const contextBlock = pageContext
          ? `\n\n## Page content extracted directly from ${url}:\n${pageContext}\n\nUse the above page content to fill in all fields accurately.`
          : `\n\nNote: The page could not be fetched. Extract what you can from the URL slug itself and set all fields conservatively.`;

        const fallbackContent = `${extractionPrompt}\n\nExtract product information for: ${url}${contextBlock}\n\nReturn ONLY valid JSON, no markdown or extra text.`;

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: buildContent(fallbackContent) }],
          max_tokens: 64000,
          seed: DETERMINISTIC_SEED,
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
export async function extractFromImage(
  imageUrl: string,
  designProfile?: DynamicDesignProfile,
  roomImageUrls?: string[],
): Promise<AgentResult<ExtractedProduct>> {
  const model = selectModel("extraction");
  const system = getSystemPrompt(designProfile);
  const extractionPrompt = getExtractionPrompt();

  const content: AIContentBlock[] = [];

  // Attach room photos first (if any) so style-judgment fields like
  // visual_style_tags can reference the actual room context.
  if (roomImageUrls && roomImageUrls.length > 0) {
    content.push({
      type: "text",
      text: "REFERENCE PHOTOS OF THE ACTUAL ROOM the product is being considered for:",
    });
    for (const u of roomImageUrls.slice(0, 3)) {
      content.push({ type: "image", source: { type: "url", url: u } });
    }
    content.push({ type: "text", text: "PRODUCT IMAGE to extract from:" });
  }

  content.push(
    { type: "image", source: { type: "url", url: imageUrl } },
    {
      type: "text",
      text: `${extractionPrompt}\n\nAnalyze the product shown in the product image above. Extract all available information from visual cues — describe what you see in detail (color, material, style, texture, proportions).`,
    },
  );

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content }],
      max_tokens: 64000,
      // No temperature override — Gemini 3 is optimized for its default (1.0).
      responseMimeType: "application/json",
      mediaResolution: "high",
    });

    const validated = ExtractedProductSchema.parse(extractJsonObject(response.content)) as ExtractedProduct;
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
