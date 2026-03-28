import type { DesignDirection } from "@/lib/types/database";

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

export function getSearchBriefPrompt(
  roomType: string,
  missingCategories: string[],
  budgetMode: string,
  categoryHints?: Record<string, string>,
  designDirection?: DesignDirection,
  priorities?: string[]
): string {
  // Separate floor plan context from per-category hints
  const floorPlanHint = categoryHints?.["_floor_plan"];
  const catOnlyHints = categoryHints
    ? Object.fromEntries(Object.entries(categoryHints).filter(([k]) => k !== "_floor_plan"))
    : {};

  const hintsSection = Object.keys(catOnlyHints).length > 0
    ? `\n\n## CATEGORY DETAILS\n${Object.entries(catOnlyHints).map(([cat, hint]) => `- **${cat}**: ${hint}`).join("\n")}`
    : "";

  const floorPlanSection = floorPlanHint
    ? `\n\n## FLOOR PLAN CONTEXT\n${floorPlanHint}\nIMPORTANT: Use these dimensions to search for correctly sized furniture. A small room needs compact pieces; a large room can handle statement furniture. Include size constraints in search queries (e.g. "compact 48 inch dining table" for small spaces, "large 8x10 area rug" for spacious rooms).`
    : "";

  // Build design direction section from actual diagnosis — not hardcoded
  const designInfo = designDirection
    ? [
        designDirection.recommended_palette?.length && `Target palette: ${designDirection.recommended_palette.join(", ")}`,
        designDirection.recommended_materials?.length && `Target materials: ${designDirection.recommended_materials.join(", ")}`,
        designDirection.recommended_textures?.length && `Target textures: ${designDirection.recommended_textures.join(", ")}`,
        designDirection.style_notes && `Style: ${designDirection.style_notes}`,
      ].filter(Boolean).join("\n")
    : null;

  const designSection = designInfo
    ? `\n\n## DESIGN DIRECTION (from room diagnosis)\n${designInfo}\nAll tiers should match this aesthetic direction — budget doesn't mean ugly.`
    : `\nThe design profile should be inferred from the apartment context in the system prompt. All tiers should match the apartment's aesthetic — budget doesn't mean ugly.`;

  // Build priorities section — captures hosting, seating, lifestyle
  const prioritiesSection = priorities?.length
    ? `\n\n## CLIENT PRIORITIES & LIFESTYLE\n${priorities.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Search for pieces that serve these priorities. If hosting is important, search for dining tables that seat enough guests and extra seating options. If comfort is key, search for deeply comfortable seating. The search should reflect how the client actually lives.`
    : "";

  return `Generate search queries for finding furniture and decor for this room across THREE price tiers.

## CONTEXT
- Room type: ${roomType}
- Default budget mode: ${budgetMode}
- Categories to search: ${missingCategories.join(", ")}${hintsSection}${floorPlanSection}${designSection}${prioritiesSection}

## INSTRUCTIONS
For each category, generate search queries for THREE price tiers:
1. **Budget** — affordable, stylish options from ${TIER_RETAILERS.budget.join(", ")}
2. **Balanced** — mid-range quality from ${TIER_RETAILERS.balanced.join(", ")}
3. **High End** — premium/investment pieces from ${TIER_RETAILERS.high_end.join(", ")}

## QUERY DIVERSITY REQUIREMENT
Generate exactly **5 high-quality queries per tier**, each from a different angle. Quality over quantity — each query must be highly specific and likely to return actual product pages:

1. **product_specific** — Target a specific known product by exact name: "Article Seno walnut coffee table" or "West Elm Mid-Century Pop-Up Storage Coffee Table"
2. **style_material** — Describe style + material + color + size using design direction: "modern solid walnut coffee table tapered legs 48 inch"
3. **retailer_browse** — Browse a specific retailer's filtered selection: "West Elm coffee tables walnut under $800"
4. **comparison** — Find recent comparison/roundup articles: "best mid-century walnut coffee tables 2025 review"
5. **brand_collection** — Target a specific brand or designer collection: "Floyd The Coffee Table walnut"

Each query MUST return meaningfully different results. Test mentally: would these 5 queries surface 5 different products? If two queries would find the same products, rewrite one.

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
            ... exactly 5 queries
          ],
          "price_range": { "min": number, "max": number },
          "retailers_to_target": ["retailer1", "retailer2", "retailer3", "retailer4"]
        },
        "balanced": { ... same structure ... },
        "high_end": { ... same structure ... }
      },
      "key_requirements": ["at least 4-6 specific requirements for this category — include size, material, color, style, and functional requirements"]
    }
  ]
}

## CRITICAL RULES for search queries:
- Each query MUST target a SPECIFIC PRODUCT or specific retailer page, not a generic category.
- Include brand/retailer name + product type + material + color in product_specific and brand_collection queries.
- Use the design direction palette and materials in style_material queries — search for the RIGHT aesthetic.
- GOOD queries (specific, will find product pages):
  "Article Texa rug 8x10 cream wool"
  "CB2 Dondra teak media console 64 inch"
  "West Elm Mid-Century coffee table walnut under $600"
  "Castlery Miso round dining table 47 inch"
  "best walnut coffee tables with shelf 2025"
- BAD queries (generic, will return category pages):
  "modern rugs" ← too vague, no size/material/color
  "TV stands" ← no style, no material, no retailer
  "affordable coffee tables" ← no specifics
  "nice dining chairs" ← useless
- Include price qualifiers for budget ("under $200") and balanced ("under $800") tiers.
- For high end, include retailer name to find specific premium products.
- NEVER repeat the same search terms across different angles — each must surface genuinely different products.
- For comparison queries, include "2025" or "2026" to find recent roundups.
- For key_requirements: include at least 4-6 requirements covering size constraints, material preferences, color range, style direction, and functional needs.`;
}
