import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getSearchBriefPrompt } from "@/lib/prompts/search-brief";
import type { PriceTier } from "@/lib/prompts/search-brief";
import type { AgentResult } from "./types";

interface TierBrief {
  search_queries: string[];
  price_range: { min: number; max: number };
  retailers_to_target: string[];
}

interface SearchBriefCategory {
  category: string;
  tiers: Record<PriceTier, TierBrief>;
  key_requirements: string[];
}

interface SearchBrief {
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
  ],
  balanced: [
    "article.com", "cb2.com", "westelm.com", "crateandbarrel.com",
    "allmodern.com", "jossandmain.com", "ruggable.com",
  ],
  high_end: [
    "restorationhardware.com", "rh.com", "potterybarn.com",
    "luluandgeorgia.com", "arhaus.com", "roomandboard.com",
    "dwr.com",
  ],
};

/**
 * Generate a shopping brief based on room diagnosis — now with 3 price tiers.
 * Uses Gemini with structured output.
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
      max_tokens: 4096,
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
 * Replaces Tavily API. Uses Google Search tool for real-time web search.
 */
export async function searchProducts(
  query: string,
  maxResults: number = 10,
  tier?: PriceTier
): Promise<AgentResult<SearchCandidate[]>> {
  // Use tier-specific domains if provided
  const domains = tier
    ? TIER_DOMAINS[tier]
    : [
        ...TIER_DOMAINS.budget,
        ...TIER_DOMAINS.balanced,
        ...TIER_DOMAINS.high_end,
      ];

  const searchPrompt = `Search for this specific product and find actual product pages (not category pages) from these retailers: ${domains.join(", ")}.

Search query: "${query}"

For each product found, provide the title, URL, a brief description, and the retailer name. Find up to ${maxResults} relevant product pages.

Return JSON:
{
  "products": [
    {
      "title": "Product name",
      "url": "https://...",
      "snippet": "Brief description of the product",
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

    // Try to parse structured response
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
