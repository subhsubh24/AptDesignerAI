import type { DesignDirection } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

export type PriceTier = "budget" | "balanced" | "high_end";

/**
 * Render explicit building finishes + floor plan into the brief prompt. The
 * system prompt already carries these, but queries were coming out generic
 * when the system prompt fell back to defaults. Foregrounding the specific
 * finishes/sqft/dimensions here lets the model anchor size constraints and
 * material queries to the real apartment.
 */
function buildDesignProfileSection(profile?: DynamicDesignProfile): string {
  if (!profile) return "";
  const p = profile as unknown as Record<string, unknown>;
  const building = p.building_research as Record<string, unknown> | undefined;
  const apartment = p.apartment_analysis as Record<string, unknown> | undefined;
  const floorPlan = p.floor_plan as Record<string, unknown> | undefined;
  const lines: string[] = [];

  if (building) {
    const style = building.building_style || building.style;
    const finishes = building.finishes;
    const aesthetic = building.design_aesthetic;
    const pieces: string[] = [];
    if (style) pieces.push(`style: ${typeof style === "string" ? style : JSON.stringify(style)}`);
    if (finishes) pieces.push(`finishes: ${typeof finishes === "string" ? finishes : JSON.stringify(finishes)}`);
    if (aesthetic) pieces.push(`aesthetic: ${typeof aesthetic === "string" ? aesthetic : JSON.stringify(aesthetic)}`);
    if (pieces.length) lines.push(`Building — ${pieces.join("; ")}`);
  }
  if (apartment && typeof apartment.overall === "string" && apartment.overall) {
    lines.push(`Apartment — ${apartment.overall}`);
  }
  if (floorPlan) {
    const sqft = floorPlan.total_sqft;
    const dims = floorPlan.room_dimensions;
    const layout = floorPlan.room_layout;
    const pieces: string[] = [];
    if (sqft) pieces.push(`sqft: ${sqft}`);
    if (dims) pieces.push(`room dimensions: ${typeof dims === "string" ? dims : JSON.stringify(dims)}`);
    if (layout) pieces.push(`layout: ${typeof layout === "string" ? layout : JSON.stringify(layout)}`);
    if (pieces.length) lines.push(`Floor plan — ${pieces.join("; ")}`);
  }

  if (!lines.length) return "";
  return `\n\n## BUILDING & APARTMENT GROUNDING (anchor size constraints and material queries to these specifics — don't default to generic assumptions)\n${lines.map((l) => `- ${l}`).join("\n")}`;
}


const TIER_RETAILERS: Record<PriceTier, string[]> = {
  budget: [
    // Big-box & mass market
    "IKEA", "Target", "Amazon", "Wayfair", "Walmart", "Overstock",
    "Home Depot", "Lowe's",
    // Budget home decor
    "World Market", "H&M Home", "Zara Home", "Kirkland's", "At Home", "Big Lots",
    // Budget furniture brands
    "Ashley Furniture", "Bob's Discount Furniture", "Rooms To Go",
    // Budget rug specialists
    "Rugs USA", "Boutique Rugs", "nuLOOM", "Well Woven", "eSaleRugs",
    // Budget art
    "Society6", "Redbubble", "iCanvas", "Desenio",
    // Budget lighting
    "Lamps Plus",
  ],
  balanced: [
    // Major mid-range retailers
    "West Elm", "CB2", "Crate & Barrel", "Pottery Barn",
    "Anthropologie Home", "Urban Outfitters Home",
    // Wayfair premium brands
    "AllModern", "Joss & Main", "Birch Lane",
    // DTC furniture brands
    "Article", "Castlery", "Burrow", "Joybird", "Apt2B", "Sixpenny",
    "Floyd", "Interior Define", "Inside Weather", "Poly & Bark",
    "Albany Park", "Sabai", "Benchmade Modern", "Maiden Home",
    // Department stores
    "Macy's Home", "Nordstrom Home", "Bloomingdale's Home",
    // Mid-range decor
    "Ballard Designs", "Grandin Road", "Z Gallerie", "Living Spaces",
    "Ethan Allen", "Pier 1",
    // Mid-range rugs
    "Ruggable", "Loloi Rugs", "Dash & Albert", "Revival Rugs", "Surya",
    // Mid-range lighting
    "Schoolhouse", "Lumens", "YLighting", "Shades of Light", "Barn Light Electric",
    // Mid-range art
    "Minted", "Artfully Walls", "Juniper Print Shop", "Etsy", "Framebridge", "Saatchi Art",
    // Curated marketplaces
    "Burke Decor", "McGee & Co", "Amber Interiors", "Lulu and Georgia",
  ],
  high_end: [
    // Luxury retailers
    "Restoration Hardware", "Serena & Lily", "Arhaus", "Room & Board",
    "Design Within Reach",
    // Designer brands
    "Jonathan Adler", "Kelly Wearstler", "Blu Dot", "Industry West",
    "Hem", "Dims",
    // European luxury
    "Ligne Roset", "Roche Bobois", "B&B Italia", "Cassina",
    "HAY", "Muuto", "Ferm Living", "Fritz Hansen",
    "Tom Dixon", "Kartell", "FLOS",
    // Premium home
    "Rejuvenation", "McGee & Co", "Lulu and Georgia",
    "Frontgate", "One Kings Lane", "Kathy Kuo Home", "Horchow", "Neiman Marcus Home",
    // Luxury marketplaces
    "Perigold", "Chairish", "1stDibs",
    // Premium lighting
    "Circa Lighting", "Visual Comfort", "Arteriors", "Louis Poulsen", "Artemide",
    // Premium rugs
    "The Rug Company", "Armadillo", "Stark Carpet",
    // Premium art
    "Artsy", "Uprise Art",
    // Premium accents
    "ABC Carpet & Home",
  ],
};

export function getSearchBriefPrompt(
  roomType: string,
  missingCategories: string[],
  budgetMode: string,
  categoryHints?: Record<string, string>,
  designDirection?: DesignDirection,
  priorities?: string[],
  keepItems?: string[],
  replaceItems?: string[],
  spatialLayout?: string,
  roomSummary?: string,
  userContext?: string,
  diagnosis?: Record<string, unknown>,
  lightingConditions?: string,
  windowDoorPositions?: string,
  outletPositions?: string,
  identifiedContext?: string,
  designProfile?: DynamicDesignProfile
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

  // Build existing items section
  const keepSection = keepItems?.length
    ? `\n\n## EXISTING ITEMS TO WORK WITH\n${keepItems.map((item) => `- ${item}`).join("\n")}\nIMPORTANT: Search results must complement these existing items. Consider their materials, colors, and scale when crafting queries.`
    : "";

  // Build replace items section
  const replaceSection = replaceItems?.length
    ? `\n\n## ITEMS BEING REPLACED OR REMOVED\n${replaceItems.map((item) => `- ${item}`).join("\n")}\nIMPORTANT: Search for REPLACEMENTS for these items. The new pieces should solve the same functional need but better match the design direction. If replacing a rug, search for a rug. If replacing a coffee table, search for a coffee table.`
    : "";

  // Build spatial context
  const spatialSection = spatialLayout
    ? `\n\n## SPATIAL LAYOUT\n${spatialLayout}\nUse this to size items correctly — e.g. compact pieces for tight spaces, full-size for open layouts.`
    : "";

  // Build room assessment
  const summarySection = roomSummary
    ? `\n\n## ROOM ASSESSMENT\n${roomSummary}`
    : "";

  // Build diagnosed problems section — helps target search queries at specific issues
  const diagnosedProblems: string[] = [];
  if (diagnosis) {
    const d = diagnosis as Record<string, unknown>;
    if (Array.isArray(d.scale_proportion_issues) && d.scale_proportion_issues.length > 0) {
      diagnosedProblems.push(`Scale/proportion issues: ${d.scale_proportion_issues.join("; ")}`);
    }
    if (Array.isArray(d.color_issues) && d.color_issues.length > 0) {
      diagnosedProblems.push(`Color issues: ${d.color_issues.join("; ")}`);
    }
    if (Array.isArray(d.texture_material_issues) && d.texture_material_issues.length > 0) {
      diagnosedProblems.push(`Material/texture issues: ${d.texture_material_issues.join("; ")}`);
    }
    if (Array.isArray(d.lighting_issues) && d.lighting_issues.length > 0) {
      diagnosedProblems.push(`Lighting issues: ${d.lighting_issues.join("; ")}`);
    }
    if (Array.isArray(d.layout_issues) && d.layout_issues.length > 0) {
      diagnosedProblems.push(`Layout issues: ${d.layout_issues.join("; ")}`);
    }
    if (d.biggest_improvement_opportunities && Array.isArray(d.biggest_improvement_opportunities)) {
      diagnosedProblems.push(`Biggest opportunities: ${(d.biggest_improvement_opportunities as string[]).join("; ")}`);
    }
  }
  const diagnosisSection = diagnosedProblems.length > 0
    ? `\n\n## DIAGNOSED ROOM PROBLEMS (search queries MUST address these)\n${diagnosedProblems.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Your search queries should find products that SOLVE these specific problems. If scale is off, search for correctly sized pieces. If materials clash, search for harmonious materials. If lighting is poor, include appropriate lighting searches.`
    : "";

  // Environmental context
  const envParts: string[] = [];
  if (lightingConditions) envParts.push(`Lighting: ${lightingConditions}`);
  if (windowDoorPositions) envParts.push(`Windows/doors: ${windowDoorPositions}`);
  if (outletPositions) envParts.push(`Outlets: ${outletPositions}`);
  const environmentSection = envParts.length > 0
    ? `\n\n## ENVIRONMENTAL CONTEXT\n${envParts.join("\n")}\nUse this to size items and search for appropriate lighting (dark corners need lamps, outlets determine powered item placement).`
    : "";

  // User's notes about their room
  const userContextSection = userContext
    ? `\n\n## USER NOTES ABOUT THIS ROOM\n"${userContext}"\nIMPORTANT: Take these notes into account. If they say to ignore something, exclude it from search considerations. If they describe something not visible in photos, incorporate that information.`
    : "";

  // Identified pieces (furniture identification feature). Empty string when the
  // feature is off / no usable identifications — keeps the prompt byte-for-byte
  // equivalent to the pre-feature shape for pre-feature rows.
  const identifiedSection = identifiedContext
    ? `\n\n${identifiedContext}\nANTI-QUERY: do NOT generate search queries for a REPLACEMENT of any identified piece above. Your queries must target complementary items ONLY. Use the canonical dimensions as scale guardrails — e.g. if a 110" KIVIK sectional is identified, the rug query should specify "at least 9x12" and the coffee table query should specify "48-60 inch length to match a 110" sectional".`
    : "";

  return `Generate search queries for finding furniture and decor for this room across THREE price tiers.

## PROCESS — Think through this step by step:
1. For each category, understand what SPECIFICALLY is needed (size, material, color, style from the design direction)
2. For each price tier, think about which REAL BRANDS AND PRODUCTS would match
3. Craft each query to find a SPECIFIC product page, not a generic category page
4. Mentally test: "If I typed this into Google, would it return a real product page?" If no, rewrite.

## CONTEXT
- Room type: ${roomType}
- Default budget mode: ${budgetMode}
- Categories to search: ${missingCategories.join(", ")}${buildDesignProfileSection(designProfile)}${hintsSection}${floorPlanSection}${designSection}${diagnosisSection}${environmentSection}${prioritiesSection}${keepSection}${replaceSection}${spatialSection}${summarySection}${userContextSection}${identifiedSection}

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
- For key_requirements: include at least 4-6 requirements covering size constraints, material preferences, color range, style direction, and functional needs.

## EXAMPLE — For "coffee_table" category in a warm modern living room:
\`\`\`json
{
  "category": "coffee_table",
  "tiers": {
    "budget": {
      "search_queries": [
        { "query": "IKEA Stockholm walnut coffee table", "angle": "product_specific" },
        { "query": "modern walnut coffee table with shelf under $200 48 inch", "angle": "style_material" },
        { "query": "Target threshold coffee tables wood under $250", "angle": "retailer_browse" },
        { "query": "best budget mid-century coffee tables 2025 under $300", "angle": "comparison" },
        { "query": "Walker Edison mid century coffee table walnut", "angle": "brand_collection" }
      ],
      "price_range": { "min": 80, "max": 300 },
      "retailers_to_target": ["IKEA", "Target", "Amazon", "Wayfair"]
    }
  },
  "key_requirements": ["48-54 inch length to match 84 inch sofa", "walnut or warm wood tone", "clean lines / mid-century style", "shelf or storage preferred", "under 18 inch height", "solid wood or wood veneer (not laminate)"]
}
\`\`\`
Follow this level of specificity for all categories.`;
}
