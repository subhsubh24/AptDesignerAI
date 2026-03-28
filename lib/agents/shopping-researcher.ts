import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getSearchBriefPrompt } from "@/lib/prompts/search-brief";
import type { PriceTier } from "@/lib/prompts/search-brief";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { DesignDirection } from "@/lib/types/database";

interface QueryWithAngle {
  query: string;
  angle: string;
}

interface TierBrief {
  search_queries: QueryWithAngle[];
  price_range: { min: number; max: number };
  retailers_to_target: string[];
}

interface SearchBriefCategory {
  category: string;
  tiers: Record<PriceTier, TierBrief>;
  key_requirements: string[];
}

export interface SearchBrief {
  categories: SearchBriefCategory[];
}

export interface SearchCandidate {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

const TIER_DOMAINS: Record<PriceTier, string[]> = {
  budget: [
    "ikea.com", "target.com", "amazon.com", "wayfair.com",
    "hm.com", "worldmarket.com", "overstock.com",
    "walmart.com", "sixpenny.com", "zarahome.com",
  ],
  balanced: [
    "article.com", "cb2.com", "westelm.com", "crateandbarrel.com",
    "allmodern.com", "jossandmain.com", "ruggable.com",
    "castlery.com", "eq3.com", "burrow.com",
    "floyddetroit.com", "interior-define.com", "apt2b.com",
  ],
  high_end: [
    "restorationhardware.com", "rh.com", "potterybarn.com",
    "luluandgeorgia.com", "arhaus.com", "roomandboard.com",
    "dwr.com", "serenaandlily.com", "mcgeeandco.com",
    "rejuvenation.com", "industrywest.com",
  ],
};

/** Best retailers per category — these get dedicated site: searches */
const CATEGORY_RETAILERS: Record<string, Record<PriceTier, string[]>> = {
  rug: {
    budget: ["rugsusa.com", "wayfair.com", "target.com", "ikea.com"],
    balanced: ["ruggable.com", "westelm.com", "crateandbarrel.com", "article.com"],
    high_end: ["luluandgeorgia.com", "serenaandlily.com", "restorationhardware.com", "roomandboard.com"],
  },
  coffee_table: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "castlery.com"],
    high_end: ["roomandboard.com", "dwr.com", "arhaus.com", "restorationhardware.com"],
  },
  dining_table: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com"],
    balanced: ["article.com", "westelm.com", "crateandbarrel.com", "castlery.com"],
    high_end: ["roomandboard.com", "arhaus.com", "restorationhardware.com", "dwr.com"],
  },
  accent_chair: {
    budget: ["ikea.com", "wayfair.com", "target.com", "worldmarket.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "castlery.com"],
    high_end: ["roomandboard.com", "dwr.com", "arhaus.com", "restorationhardware.com"],
  },
  sofa: {
    budget: ["ikea.com", "wayfair.com", "amazon.com", "sixpenny.com"],
    balanced: ["article.com", "burrow.com", "interior-define.com", "castlery.com"],
    high_end: ["roomandboard.com", "restorationhardware.com", "arhaus.com", "dwr.com"],
  },
  side_table: {
    budget: ["ikea.com", "target.com", "wayfair.com", "amazon.com"],
    balanced: ["cb2.com", "westelm.com", "article.com", "crateandbarrel.com"],
    high_end: ["roomandboard.com", "dwr.com", "serenaandlily.com", "mcgeeandco.com"],
  },
  bookshelf: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com"],
    balanced: ["cb2.com", "westelm.com", "crateandbarrel.com", "article.com"],
    high_end: ["roomandboard.com", "restorationhardware.com", "arhaus.com", "dwr.com"],
  },
  floor_lamp: {
    budget: ["ikea.com", "target.com", "amazon.com", "wayfair.com"],
    balanced: ["cb2.com", "westelm.com", "allmodern.com", "article.com"],
    high_end: ["rejuvenation.com", "dwr.com", "serenaandlily.com", "luluandgeorgia.com"],
  },
  table_lamp: {
    budget: ["ikea.com", "target.com", "amazon.com", "wayfair.com"],
    balanced: ["cb2.com", "westelm.com", "crateandbarrel.com", "allmodern.com"],
    high_end: ["rejuvenation.com", "serenaandlily.com", "mcgeeandco.com", "luluandgeorgia.com"],
  },
  media_console: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "floyddetroit.com"],
    high_end: ["roomandboard.com", "restorationhardware.com", "arhaus.com", "dwr.com"],
  },
  art: {
    budget: ["target.com", "society6.com", "amazon.com", "ikea.com"],
    balanced: ["westelm.com", "cb2.com", "luluandgeorgia.com", "mcgeeandco.com"],
    high_end: ["artdotcom.com", "luluandgeorgia.com", "serenaandlily.com", "mcgeeandco.com"],
  },
  curtains: {
    budget: ["ikea.com", "target.com", "amazon.com", "wayfair.com"],
    balanced: ["westelm.com", "crateandbarrel.com", "potterybarn.com", "cb2.com"],
    high_end: ["serenaandlily.com", "potterybarn.com", "restorationhardware.com", "mcgeeandco.com"],
  },
  throw_pillow: {
    budget: ["target.com", "ikea.com", "hm.com", "amazon.com"],
    balanced: ["westelm.com", "cb2.com", "crateandbarrel.com", "mcgeeandco.com"],
    high_end: ["serenaandlily.com", "luluandgeorgia.com", "mcgeeandco.com", "potterybarn.com"],
  },
};

/**
 * Generate a shopping brief based on room diagnosis — now with 5 diverse queries per tier.
 */
export async function generateSearchBrief(
  roomType: string,
  missingCategories: string[],
  budgetMode: string,
  categoryHints?: Record<string, string>,
  designProfile?: DynamicDesignProfile,
  designDirection?: DesignDirection,
  priorities?: string[]
): Promise<AgentResult<SearchBrief>> {
  const model = selectModel("search_brief");
  const system = getSystemPrompt(designProfile);
  const prompt = getSearchBriefPrompt(roomType, missingCategories, budgetMode, categoryHints, designDirection, priorities);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4000,
        temperature: 0.3,
        responseMimeType: "application/json",
      });

      const parsed = JSON.parse(response.content) as SearchBrief;
      return {
        success: true,
        data: parsed,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        model: response.model,
      };
    } catch (error) {
      console.error(`[search-brief] Attempt ${attempt + 1} failed:`, error instanceof Error ? error.message : error);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Search brief generation failed",
      };
    }
  }

  return { success: false, error: "Search brief generation failed after retries" };
}

/**
 * Search the web for products using Gemini Google Search grounding.
 * Returns up to maxResults candidates per query.
 *
 * When a category is provided, also generates targeted `site:` searches
 * against the best retailers for that category+tier from CATEGORY_RETAILERS.
 */
export async function searchProducts(
  query: string,
  maxResults: number = 10,
  tier?: PriceTier,
  category?: string
): Promise<AgentResult<SearchCandidate[]>> {
  const domains = tier
    ? TIER_DOMAINS[tier]
    : [...TIER_DOMAINS.budget, ...TIER_DOMAINS.balanced, ...TIER_DOMAINS.high_end];

  // Build the list of queries to run: the original + targeted site: searches
  const queries: string[] = [query];

  // Add targeted site: searches for the best retailers for this category+tier
  if (category && tier) {
    const categoryKey = category.toLowerCase().replace(/\s+/g, "_");
    const retailers = CATEGORY_RETAILERS[categoryKey]?.[tier];
    if (retailers) {
      // Pick top 2 retailers for dedicated site: searches
      for (const retailer of retailers.slice(0, 2)) {
        queries.push(`site:${retailer} ${query}`);
      }
    }
  }

  const allCandidates: SearchCandidate[] = [];

  // Run all queries in parallel
  const results = await Promise.all(
    queries.map(async (searchQuery) => {
      const searchPrompt = `Search for this specific product and find actual product pages (not category pages) from these retailers: ${domains.join(", ")}.

Search query: "${searchQuery}"

Find up to ${maxResults} relevant product pages. For each, provide title, URL, brief snippet, and retailer.

Return ONLY a valid JSON object — no text before or after:
{
  "products": [
    {
      "title": "Product name",
      "url": "https://...",
      "snippet": "Brief description — price, material, color if visible (max 1 sentence)",
      "source": "retailer domain"
    }
  ]
}`;

      try {
        const response = await geminiProvider.chat({
          model: selectModel("search"),
          system: "You are a product search assistant. Find specific product pages on furniture retailer websites. Only return actual product pages, not category or listing pages. Return ONLY JSON.",
          messages: [{ role: "user", content: searchPrompt }],
          max_tokens: 2000,
          temperature: 0.2,
          tools: [{ googleSearch: {} }],
        });

        try {
          const raw = response.content.trim();
          let parsed: { products?: { title: string; url: string; snippet: string; source: string }[] };
          try {
            parsed = JSON.parse(raw);
          } catch {
            const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[1].trim());
            } else {
              const braceStart = raw.indexOf("{");
              const braceEnd = raw.lastIndexOf("}");
              if (braceStart !== -1 && braceEnd > braceStart) {
                parsed = JSON.parse(raw.slice(braceStart, braceEnd + 1));
              } else {
                parsed = {};
              }
            }
          }
          return (parsed.products || []).map(
            (r: { title: string; url: string; snippet: string; source: string }) => ({
              title: r.title || "",
              url: r.url || "",
              snippet: (r.snippet || "").slice(0, 500),
              source: r.source || "",
            })
          );
        } catch {
          // Fallback: use grounding metadata sources
          if (response.groundingMetadata?.sources) {
            return response.groundingMetadata.sources
              .filter((s) => s.uri)
              .map((s) => {
                let source = "";
                try {
                  source = new URL(s.uri).hostname.replace("www.", "");
                } catch {
                  source = s.uri;
                }
                return { title: s.title, url: s.uri, snippet: "", source };
              });
          }
          return [];
        }
      } catch {
        return [];
      }
    })
  );

  for (const candidates of results) {
    allCandidates.push(...candidates);
  }

  return { success: true, data: allCandidates };
}

/**
 * Deduplicate search candidates by URL (hostname + pathname, ignoring query params).
 * Keeps the first occurrence of each unique URL.
 */
export function deduplicateCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  const seen = new Set<string>();
  const result: SearchCandidate[] = [];

  for (const c of candidates) {
    try {
      const url = new URL(c.url);
      const key = `${url.hostname}${url.pathname}`.toLowerCase().replace(/\/+$/, "");
      if (!seen.has(key)) {
        seen.add(key);
        result.push(c);
      }
    } catch {
      // If URL is malformed, keep it (will be filtered later)
      result.push(c);
    }
  }

  return result;
}

/**
 * Quick screen candidates using Flash model (text-only, no tools).
 * Rates each candidate 1-5 on relevance and filters to ≥3.
 * Includes design direction context for style filtering.
 * Batches up to 30 candidates per call for efficiency.
 */
export async function quickScreenCandidates(
  candidates: SearchCandidate[],
  category: string,
  tier: PriceTier,
  requirements: string[],
  designDirection?: DesignDirection
): Promise<AgentResult<SearchCandidate[]>> {
  if (candidates.length === 0) {
    return { success: true, data: [] };
  }

  const BATCH_SIZE = 30;
  const batches: SearchCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  const allPassed: SearchCandidate[] = [];

  // Process batches in parallel
  const batchResults = await Promise.all(
    batches.map(async (batch, batchIdx) => {
      const candidateList = batch
        .map((c, i) => `[${batchIdx * BATCH_SIZE + i}] "${c.title}" — ${c.source} — ${c.snippet.slice(0, 120)}`)
        .join("\n");

      const styleContext = designDirection
        ? `\nDesign direction: ${designDirection.style_notes}. Palette: ${designDirection.recommended_palette?.join(", ") || "flexible"}. Materials: ${designDirection.recommended_materials?.join(", ") || "flexible"}.\nPenalize products that clearly clash with this direction (e.g. wrong style family).`
        : "";

      const prompt = `Rate each URL candidate for relevance to finding a **${category}** product in the **${tier}** price tier.

Requirements: ${requirements.join(", ")}${styleContext}

## CANDIDATES
${candidateList}

## STEP 1: CHECK THE URL STRUCTURE
Before rating, examine each URL:
- If URL contains /collections, /categories, /browse, /shop-all, /search, /blog, /magazine, /reviews, /inspiration, /ideas → rate 1-2 (these are listing/content pages, NOT product pages)
- If URL is a site homepage (e.g., just "article.com" or "westelm.com") → rate 1
- If URL has product identifiers in path (e.g., /products/walnut-coffee-table, /p/SKU-12345, /dp/B0xxx) → likely product page, rate 4-5
- If URL contains a specific product slug (hyphenated product name) → likely product page

## STEP 2: RATING CRITERIA
- 5: URL structure confirms product page + title clearly matches ${category} + snippet mentions price/materials + style-compatible with design direction
- 4: URL looks like a product page + title matches ${category}, snippet is somewhat relevant
- 3: Uncertain — could be a product page or a targeted subcategory listing. Title seems relevant.
- 2: Probably a category listing, blog post, roundup article, or wrong product type
- 1: Definitely not relevant — review article, unrelated product, broken URL

Return JSON:
{
  "ratings": [
    { "index": number, "rating": number, "reason": "brief reason" }
  ]
}`;

      try {
        const response = await geminiProvider.chat({
          model: selectModel("quick_screen"),
          system: "You are a product page classifier. Be strict — only pass candidates that are likely actual product pages for the requested category. Return ONLY the JSON ratings array.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
          temperature: 0.1,
          responseMimeType: "application/json",
        });

        const parsed = JSON.parse(response.content);
        const passed: SearchCandidate[] = [];
        for (const rating of parsed.ratings || []) {
          if (rating.rating >= 3) {
            const globalIdx = rating.index;
            const localIdx = globalIdx - batchIdx * BATCH_SIZE;
            if (localIdx >= 0 && localIdx < batch.length) {
              passed.push(batch[localIdx]);
            }
          }
        }
        return passed;
      } catch {
        // On failure, pass all candidates through (fail open)
        return batch;
      }
    })
  );

  for (const passed of batchResults) {
    allPassed.push(...passed);
  }

  return { success: true, data: allPassed };
}
