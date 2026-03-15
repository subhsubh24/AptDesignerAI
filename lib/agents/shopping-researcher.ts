import { anthropicProvider } from "@/lib/ai/anthropic";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getSearchBriefPrompt } from "@/lib/prompts/search-brief";
import type { AgentResult } from "./types";

interface SearchBriefCategory {
  category: string;
  search_queries: string[];
  price_range: { min: number; max: number };
  key_requirements: string[];
  retailers_to_target: string[];
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

/**
 * Generate a shopping brief based on room diagnosis
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
      max_tokens: 2048,
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
 * Search the web for products using Tavily API
 */
export async function searchProducts(query: string, maxResults: number = 10): Promise<AgentResult<SearchCandidate[]>> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { success: false, error: "TAVILY_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_domains: [
          "article.com",
          "cb2.com",
          "westelm.com",
          "crateandbarrel.com",
          "potterybarn.com",
          "luluandgeorgia.com",
          "ruggable.com",
          "wayfair.com",
          "target.com",
          "ikea.com",
          "amazon.com",
          "etsy.com",
          "allmodern.com",
          "jossandmain.com",
        ],
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
