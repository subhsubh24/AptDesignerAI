export type PriceTier = "budget" | "balanced" | "high_end";

const TIER_LABELS: Record<PriceTier, string> = {
  budget: "Budget-Friendly",
  balanced: "Mid-Range / Balanced",
  high_end: "High-End / Premium",
};

const TIER_RETAILERS: Record<PriceTier, string[]> = {
  budget: [
    "IKEA", "Target", "Amazon", "Wayfair", "H&M Home", "World Market",
    "Overstock", "Walmart", "Sixpenny", "Zara Home",
  ],
  balanced: [
    "Article", "CB2", "West Elm", "Crate & Barrel", "AllModern",
    "Joss & Main", "Ruggable", "Castlery", "EQ3", "Burrow",
    "Floyd", "Interior Define", "Apt2B",
  ],
  high_end: [
    "Restoration Hardware", "Pottery Barn", "Lulu and Georgia", "Arhaus",
    "Room & Board", "Design Within Reach", "Serena & Lily", "McGee & Co",
    "Rejuvenation", "Industry West",
  ],
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

## QUERY DIVERSITY REQUIREMENT
You MUST generate exactly **5 queries per tier**, each approaching the search from a different angle:
1. **product_specific** — Target a specific known product by name: "Article Seno walnut coffee table"
2. **style_material** — Describe the style + material + color: "modern walnut coffee table tapered legs cream"
3. **retailer_browse** — Browse a specific retailer's selection: "West Elm coffee tables under $800"
4. **comparison** — Find comparison/roundup articles: "best mid-century modern coffee tables 2025"
5. **brand_collection** — Target a specific brand or collection: "Floyd coffee table walnut"

Each query angle finds different products that the others miss. This diversity is critical.

## OUTPUT FORMAT
Return a JSON object:
{
  "categories": [
    {
      "category": "category name",
      "tiers": {
        "budget": {
          "search_queries": [
            { "query": "the search query", "angle": "product_specific | style_material | retailer_browse | comparison | brand_collection" },
            { "query": "...", "angle": "..." },
            { "query": "...", "angle": "..." },
            { "query": "...", "angle": "..." },
            { "query": "...", "angle": "..." }
          ],
          "price_range": { "min": number, "max": number },
          "retailers_to_target": ["retailer1", "retailer2", "retailer3"]
        },
        "balanced": { ... same structure ... },
        "high_end": { ... same structure ... }
      },
      "key_requirements": ["specific requirements for this category"]
    }
  ]
}

CRITICAL RULES for search queries:
- Each query MUST target a SPECIFIC PRODUCT or specific retailer page, not a generic category.
- Include brand/retailer name + product type + material + color in product_specific and brand_collection queries.
- Good: "Article Texa rug 8x10 cream wool" or "CB2 Dondra walnut media console"
- Bad: "modern rugs" or "TV stands" (too generic, will return category pages)
- Include price qualifiers for budget ("under $200") and balanced ("under $800") tiers.
- For high end, include retailer name to find specific products.
- NEVER repeat the same query across different angles — each must find genuinely different results.
- For comparison queries, include the current year to find recent roundups.`;
}
