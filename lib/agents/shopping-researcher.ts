import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getSearchBriefPrompt } from "@/lib/prompts/search-brief";
import type { PriceTier } from "@/lib/prompts/search-brief";
import type { AgentResult } from "./types";

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

/**
 * Generate a shopping brief based on room diagnosis — now with 5 diverse queries per tier.
 */
export async function generateSearchBrief(
  roomType: string,
  missingCategories: string[],
  budgetMode: string
): Promise<AgentResult<SearchBrief>> {
  const model = selectModel("search_brief");
  const system = getSystemPrompt();
  const prompt = getSearchBriefPrompt(roomType, missingCategories, budgetMode);

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8192,
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
    return {
      success: false,
      error: error instanceof Error ? error.message : "Search brief generation failed",
    };
  }
}

/**
 * Search the web for products using Gemini Google Search grounding.
 * Returns up to maxResults candidates per query.
 */
export async function searchProducts(
  query: string,
  maxResults: number = 10,
  tier?: PriceTier
): Promise<AgentResult<SearchCandidate[]>> {
  const domains = tier
    ? TIER_DOMAINS[tier]
    : [...TIER_DOMAINS.budget, ...TIER_DOMAINS.balanced, ...TIER_DOMAINS.high_end];

  const searchPrompt = `Search for this specific product and find actual product pages (not category pages) from these retailers: ${domains.join(", ")}.

Search query: "${query}"

For each product found, provide the title, URL, a brief description, and the retailer name. Find up to ${maxResults} relevant product pages.

Return JSON:
{
  "products": [
    {
      "title": "Product name",
      "url": "https://...",
      "snippet": "Brief description of the product including price, material, color if visible",
      "source": "retailer domain"
    }
  ]
}`;

  try {
    const response = await geminiProvider.chat({
      model: selectModel("search"),
      system: "You are a product search assistant. Find specific product pages on furniture retailer websites. Only return actual product pages, not category or listing pages.",
      messages: [{ role: "user", content: searchPrompt }],
      max_tokens: 4096,
      temperature: 0.2,
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
    });

    let candidates: SearchCandidate[] = [];

    try {
      const parsed = JSON.parse(response.content);
      candidates = (parsed.products || []).map(
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
        candidates = response.groundingMetadata.sources.map((s) => ({
          title: s.title,
          url: s.uri,
          snippet: "",
          source: new URL(s.uri).hostname.replace("www.", ""),
        }));
      }
    }

    return { success: true, data: candidates };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Search failed",
    };
  }
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
 * Batches up to 30 candidates per call for efficiency.
 */
export async function quickScreenCandidates(
  candidates: SearchCandidate[],
  category: string,
  tier: PriceTier,
  requirements: string[]
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

      const prompt = `Rate each URL candidate for relevance to finding a **${category}** product in the **${tier}** price tier.

Requirements: ${requirements.join(", ")}

## CANDIDATES
${candidateList}

## RATING CRITERIA
- 5: Clearly a specific product page for the right category and price tier
- 4: Likely a product page, right category, might be right tier
- 3: Possibly relevant — could be a product page or very targeted listing
- 2: Probably a category page, blog, or wrong product type
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
          system: "You are a product page classifier. Be strict — only pass candidates that are likely actual product pages for the requested category.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2048,
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
