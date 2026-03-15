import { anthropicProvider } from "@/lib/ai/anthropic";
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

interface SearchCandidate {
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
 * Generate a shopping brief based on room diagnosis — now with 3 price tiers
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
    const response = await anthropicProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.3,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Failed to parse search brief JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as SearchBrief;
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
 * Search the web for products using Tavily API, optionally scoped to a price tier
 */
export async function searchProducts(
  query: string,
  maxResults: number = 10,
  tier?: PriceTier
): Promise<AgentResult<SearchCandidate[]>> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { success: false, error: "TAVILY_API_KEY not configured" };
  }

  // Use tier-specific domains if provided, otherwise all domains
  const domains = tier
    ? TIER_DOMAINS[tier]
    : [
        ...TIER_DOMAINS.budget,
        ...TIER_DOMAINS.balanced,
        ...TIER_DOMAINS.high_end,
      ];

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_domains: domains,
        search_depth: "advanced",
      }),
    });

    if (!response.ok) {
      return { success: false, error: `Tavily API error: ${response.status}` };
    }

    const data = await response.json();
    const candidates: SearchCandidate[] = (data.results || []).map(
      (r: { title: string; url: string; content: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 500) || "",
        source: new URL(r.url).hostname.replace("www.", ""),
      })
    );

    return { success: true, data: candidates };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Search failed",
    };
  }
}
