export function getSearchBriefPrompt(roomType: string, missingCategories: string[], budgetMode: string): string {
  return `Generate search queries for finding furniture and decor for this room.

## CONTEXT
- Room type: ${roomType}
- Budget mode: ${budgetMode}
- Categories to search: ${missingCategories.join(", ")}

## INSTRUCTIONS
For each category, generate 2-3 specific search queries that would find products matching the user's design profile (modern warm, walnut/cream/taupe, sophisticated, Article/CB2/West Elm/RH level).

## OUTPUT FORMAT
Return a JSON object:
{
  "categories": [
    {
      "category": "category name",
      "search_queries": ["query 1", "query 2", "query 3"],
      "price_range": { "min": number, "max": number },
      "key_requirements": ["specific requirements for this category"],
      "retailers_to_target": ["specific retailers to search"]
    }
  ]
}

Be specific in queries. Instead of "rug", use "large 8x10 wool area rug cream taupe modern warm". Target retailers the user would shop at: Article, CB2, West Elm, Crate & Barrel, Pottery Barn, Lulu and Georgia, Ruggable, Wayfair.`;
}
