export type PriceTier = "budget" | "balanced" | "high_end";

const TIER_LABELS: Record<PriceTier, string> = {
  budget: "Budget-Friendly",
  balanced: "Mid-Range / Balanced",
  high_end: "High-End / Premium",
};

const TIER_RETAILERS: Record<PriceTier, string[]> = {
  budget: ["IKEA", "Target", "Amazon", "Wayfair", "H&M Home", "World Market", "Overstock"],
  balanced: ["Article", "CB2", "West Elm", "Crate & Barrel", "AllModern", "Joss & Main", "Ruggable"],
  high_end: ["Restoration Hardware", "Pottery Barn", "Lulu and Georgia", "Arhaus", "Room & Board", "Design Within Reach"],
};

export function getSearchBriefPrompt(roomType: string, missingCategories: string[], budgetMode: string): string {
  return `Generate search queries for finding furniture and decor for this room across THREE price tiers.

## CONTEXT
- Room type: ${roomType}
- Default budget mode: ${budgetMode}
- Categories to search: ${missingCategories.join(", ")}

## INSTRUCTIONS
For each category, generate search queries for THREE price tiers:
1. **Budget** — affordable, stylish options from ${TIER_RETAILERS.budget.join(", ")}
2. **Balanced** — mid-range quality from ${TIER_RETAILERS.balanced.join(", ")}
3. **High End** — premium/investment pieces from ${TIER_RETAILERS.high_end.join(", ")}

The design profile is: modern warm, walnut/cream/taupe, sophisticated, urban.
All tiers should match this aesthetic — budget doesn't mean ugly.

## OUTPUT FORMAT
Return a JSON object:
{
  "categories": [
    {
      "category": "category name",
      "tiers": {
        "budget": {
          "search_queries": ["query 1", "query 2"],
          "price_range": { "min": number, "max": number },
          "retailers_to_target": ["retailer1", "retailer2"]
        },
        "balanced": {
          "search_queries": ["query 1", "query 2"],
          "price_range": { "min": number, "max": number },
          "retailers_to_target": ["retailer1", "retailer2"]
        },
        "high_end": {
          "search_queries": ["query 1", "query 2"],
          "price_range": { "min": number, "max": number },
          "retailers_to_target": ["retailer1", "retailer2"]
        }
      },
      "key_requirements": ["specific requirements for this category"]
    }
  ]
}

Be specific in queries. Instead of "rug", use "large 8x10 wool area rug cream taupe modern warm". Include price qualifiers in queries (e.g. "under $200" for budget, "under $800" for balanced).`;
}
