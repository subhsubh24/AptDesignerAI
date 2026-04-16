/**
 * Query exploration for the search pipeline.
 *
 * Deterministic search queries always find the same products. This module
 * injects controlled exploration: for each category, with a configurable
 * probability, it generates alternative search queries using style synonyms,
 * broadened material keywords, and different retailer angles.
 *
 * The exploration is seeded per (roomId + category) so it's reproducible
 * within a session but varies across rooms.
 */
import { createLogger } from "@/lib/logging/logger";
import type { PriceTier } from "@/lib/prompts/search-brief";

const log = createLogger("query-exploration");

/** Probability of adding an exploration query per category×tier slot. */
const EXPLORATION_RATE = 0.15;

/** Style synonyms — broadens the search beyond the LLM's default framing */
const STYLE_SYNONYMS: Record<string, string[]> = {
  "mid-century": ["Danish modern", "atomic age", "retro modern", "1960s inspired"],
  "mid century": ["Danish modern", "atomic age", "retro modern", "1960s inspired"],
  "contemporary": ["sleek modern", "current design", "21st century"],
  "modern": ["contemporary minimalist", "clean-line", "architectural"],
  "bohemian": ["boho chic", "global eclectic", "collected look", "artisan"],
  "farmhouse": ["rustic cottage", "country modern", "pastoral"],
  "industrial": ["loft style", "urban warehouse", "raw modern"],
  "coastal": ["beach house", "nautical modern", "seaside"],
  "scandinavian": ["Nordic design", "hygge", "Swedish modern"],
  "japandi": ["zen modern", "Japanese minimalist", "wabi-sabi"],
  "traditional": ["classic design", "timeless", "heritage"],
  "transitional": ["updated classic", "contemporary traditional", "bridge style"],
  "art deco": ["Hollywood regency", "glamour modern", "deco revival"],
  "minimalist": ["pared-back", "essentialism", "less-is-more"],
};

/** Exploration keywords that diversify product discovery */
const EXPLORATION_MODIFIERS = [
  "artisan handmade",
  "boutique designer",
  "emerging brand",
  "vintage-inspired",
  "sustainable eco-friendly",
  "unique statement",
  "small-batch",
  "local maker",
];

export interface ExplorationQuery {
  category: string;
  tier: PriceTier;
  query: string;
  angle: "exploration";
}

/**
 * Simple deterministic hash for seeding. Returns a number 0-1.
 * Not cryptographic — just needs to be consistent and well-distributed.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash) / 2147483647;
}

/**
 * Generate exploration queries for search tasks.
 *
 * For each (category, tier) pair, with probability EXPLORATION_RATE, generates
 * one alternative query using style synonyms or exploration modifiers.
 *
 * @param existingTasks   The deterministic search tasks from the brief
 * @param roomId          Room identifier for deterministic seeding
 * @param designDirection Style direction string (e.g., "mid-century modern with warmth")
 * @returns               Additional exploration queries to append to search tasks
 */
export function generateExplorationQueries(
  existingTasks: Array<{ category: string; tier: PriceTier; query: string }>,
  roomId: string,
  designDirection?: string
): ExplorationQuery[] {
  const explorationQueries: ExplorationQuery[] = [];

  // Group existing tasks by category×tier
  const groups = new Map<string, Array<{ category: string; tier: PriceTier; query: string }>>();
  for (const task of existingTasks) {
    const key = `${task.category}|${task.tier}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }

  for (const [key, tasks] of groups) {
    const [category, tier] = key.split("|") as [string, PriceTier];

    // Deterministic exploration decision per (room, category, tier)
    const seed = simpleHash(`${roomId}:${category}:${tier}:explore`);
    if (seed > EXPLORATION_RATE) continue;

    // Pick a style synonym if the design direction contains a known style
    let explorationQuery = "";
    const directionLower = (designDirection || "").toLowerCase();

    // Try style synonym replacement first
    for (const [style, synonyms] of Object.entries(STYLE_SYNONYMS)) {
      if (directionLower.includes(style)) {
        const synIdx = Math.floor(simpleHash(`${roomId}:${category}:syn`) * synonyms.length);
        const synonym = synonyms[synIdx];

        // Take the first existing query and swap the style term
        const baseQuery = tasks[0].query;
        explorationQuery = baseQuery.toLowerCase().includes(style)
          ? baseQuery.replace(new RegExp(style, "i"), synonym)
          : `${synonym} ${category.replace(/_/g, " ")} ${tier === "budget" ? "affordable" : tier === "high_end" ? "luxury" : ""}`.trim();
        break;
      }
    }

    // Fallback: use an exploration modifier
    if (!explorationQuery) {
      const modIdx = Math.floor(simpleHash(`${roomId}:${category}:mod`) * EXPLORATION_MODIFIERS.length);
      const modifier = EXPLORATION_MODIFIERS[modIdx];
      const categoryName = category.replace(/_/g, " ");
      explorationQuery = `${modifier} ${categoryName} for ${directionLower || "modern"} room`;
    }

    explorationQueries.push({
      category,
      tier,
      query: explorationQuery,
      angle: "exploration",
    });
  }

  if (explorationQueries.length > 0) {
    log.info(`Generated ${explorationQueries.length} exploration queries`, {
      categories: explorationQueries.map((q) => q.category),
    });
  }

  return explorationQueries;
}
