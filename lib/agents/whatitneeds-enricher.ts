// Validates and enriches what_it_needs items after area analysis Pass B.
//
// Pass B asks the LLM for specific search_title (material + color + size +
// style + type) and specs (dimensions, materials, price range). LLMs don't
// always comply — they sometimes return "coffee table" instead of "solid
// walnut round coffee table 36-40 inch diameter with tapered legs".
//
// This agent finds items that are still vague after Pass B and enriches them
// in a single batch call, grounded in the Pass 1 design brief.
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import type { DiagnosisItem } from "./types";
import type { DesignDirection } from "@/lib/types/database";

const log = createLogger("whatitneeds-enricher");

// A search_title is "specific enough" if it contains at least one dimension
// signal (a number with a unit or an × separator) AND at least one material
// keyword. Both are required — size without material is still too vague.
const DIMENSION_RE = /\b\d+["']\s*x|\b\d+\s*(inch|in\b|ft\b|foot|feet|cm|sqft|sq\.?\s*ft|x\s*\d)|\d+['"]\b/i;
const MATERIAL_KEYWORDS = [
  "wood","walnut","oak","ash","pine","birch","mahogany","teak","maple","bamboo","acacia","rubberwood",
  "linen","cotton","wool","velvet","boucle","bouclé","leather","suede","canvas","chenille","jute","rattan",
  "wicker","seagrass","sisal","hemp","shag","flatweave","kilim","persian","moroccan",
  "metal","brass","copper","bronze","gold","silver","chrome","iron","steel","aluminum","matte black",
  "marble","stone","ceramic","porcelain","glass","acrylic","concrete","slate","granite","terrazzo",
  "woven","knit","natural","organic","solid","reclaimed","mdf","plywood","veneer","lacquered",
];
const MATERIAL_RE = new RegExp(`\\b(${MATERIAL_KEYWORDS.join("|")})\\b`, "i");

// Categories that don't need size signals — they're inherently small and
// decorative. Enriching these adds noise without real value.
const SKIP_ENRICHMENT = new Set([
  "candles","throw_pillows","throw_blanket","books","tray","vase",
  "decorative_objects","baskets","frames","wall_art_small","mirror_small",
]);

// Standard sizing guide used when no floor plan or room dimensions are available
const STANDARD_SIZING = `
Standard furniture sizing reference:
- sofa (standard): 84-96 inch wide, 34-38 inch deep, 30-34 inch tall
- sectional: 100-120 inch wide, 60-80 inch deep (L-shape)
- area_rug (living room): 8x10 ft or 9x12 ft
- area_rug (dining): one size up from table, e.g., 8x10 for a 6-seat table
- coffee_table: 48x24 inch or 36-42 inch diameter; height 16-18 inch
- dining_table (4-seater): 36x60 inch; 6-seater: 36x72 or 42x84 inch
- dining_chairs: 17-19 inch seat width, 18 inch seat height
- accent_chair: 28-32 inch wide, 30-34 inch deep
- bed (queen): 60x80 inch mattress; frame adds ~4 inch each side
- bed (king): 76x80 inch mattress
- nightstand/side_table: 22-26 inch wide, 16-20 inch deep
- floor_lamp: 60-72 inch tall
- table_lamp: 24-30 inch tall
- media_console/credenza: 60-72 inch wide, 18 inch deep
- bookshelf: 30-36 inch wide, 12 inch deep, 72-80 inch tall
- console_table: 48-60 inch wide, 12-14 inch deep
- pendant_light: 12-24 inch diameter (scale to table below)`;

export function hasSpecificity(item: DiagnosisItem): boolean {
  const combined = `${item.search_title || ""} ${item.specs || ""}`;
  return DIMENSION_RE.test(combined) && MATERIAL_RE.test(combined);
}

/**
 * Validate and enrich vague what_it_needs items from area analysis Pass B.
 *
 * @param items       The raw what_it_needs array from Pass B.
 * @param ctx         Design context from Pass 1 used to ground enrichment.
 * @returns           Items with vague search_title/specs filled in. Never throws.
 */
export async function enrichWhatItNeeds(
  items: DiagnosisItem[],
  ctx: {
    roomType: string;
    roomSqft?: number;
    designDirection?: DesignDirection;
    /** JSON string of the Pass 1 understanding object (design brief) */
    pass1Brief: string;
  }
): Promise<DiagnosisItem[]> {
  // Find items that need enrichment (track by index to handle duplicate categories)
  const vagueIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!SKIP_ENRICHMENT.has(item.category) && !hasSpecificity(item)) {
      vagueIndices.push(i);
    }
  }

  if (vagueIndices.length === 0) {
    log.info(`All ${items.length} what_it_needs items already have sufficient specificity`);
    return items;
  }

  log.info(`Enriching ${vagueIndices.length}/${items.length} vague items`, {
    categories: vagueIndices.map((i) => items[i].category),
  });

  const vagueItems = vagueIndices.map((i) => items[i]);

  const prompt = `You are an interior designer adding precise dimensions, materials, and price ranges to product search specifications.

## ROOM CONTEXT
Room type: ${ctx.roomType}${ctx.roomSqft ? `, ~${ctx.roomSqft} sqft` : ""}

## PASS 1 DESIGN BRIEF
${ctx.pass1Brief}

${STANDARD_SIZING}

## YOUR TASK
For each item below, rewrite search_title and specs to be fully specific.

MANDATORY — every search_title MUST contain ALL of these:
1. A specific MATERIAL or FINISH (e.g., "solid walnut", "oak veneer", "linen upholstered", "boucle fabric")
2. A specific SIZE with a number and unit (e.g., "36 inch diameter", "84 inch wide", "60x36 inch")
3. A COLOR descriptor (e.g., "warm cream", "charcoal", "natural oak")
4. STYLE + product type (e.g., "mid-century modern dining table", "Parsons-style console")

If you omit the material keyword or the dimension number, the item FAILS validation. Do not return generic titles.

search_title examples (GOOD — pass validation):
- "Large 8x10 hand-knotted wool area rug in warm cream with geometric texture"
- "Solid walnut round coffee table 36-40 inch diameter with tapered legs and lower shelf"
- "Linen upholstered dining chair with oak legs, 19 inch seat width, natural oatmeal tone"
- "Solid oak rectangular dining table 72x36 inch with trestle base in warm natural finish"
- "Boucle upholstered accent chair 30 inch wide with walnut frame in ivory cream"

search_title examples (BAD — fail validation):
- "Coffee table" — no material, no color, no size
- "Modern dining table for six" — no material, no dimensions
- "Comfortable accent chair in neutral tone" — no material keyword, no size
- "Dining chairs set of 4" — no material, no dimensions

specs MUST include: W × D × H (with numbers and "inch" or "ft" unit), material(s), color range, ~$price range

Items to enrich (${vagueItems.length} total):
${vagueItems.map((item, pos) => `[${pos}] category="${item.category}" current_title="${item.search_title || ""}" current_specs="${item.specs || ""}" description="${item.description || ""}"`).join("\n")}

Return a JSON array with exactly ${vagueItems.length} objects, indexed 0 to ${vagueItems.length - 1}, in the same order:
[
  {
    "index": 0,
    "category": "same as input — do not change",
    "search_title": "MUST contain a material keyword + a number with unit — see examples above",
    "specs": "W × D × H in inches, material(s), color range, ~$price range"
  }
]`;

  try {
    const response = await geminiProvider.chat({
      model: selectModel("search"),
      system: getSystemPrompt(),
      messages: [{ role: "user", content: prompt }],
      max_tokens: 16384,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "minimal" },
      tools: [
        { googleSearch: {} as Record<string, never> },
        { codeExecution: {} as Record<string, never> },
      ],
    });

    const enriched = extractJsonObject<Array<{ index: number; category: string; search_title: string; specs: string }>>(
      response.content
    );

    if (!Array.isArray(enriched) || enriched.length === 0) {
      log.warn("Enricher returned unexpected shape — using original items", {
        preview: response.content.slice(0, 200),
      });
      return items;
    }

    // Apply enriched values back by index
    const result = [...items];
    for (const patch of enriched) {
      const itemIdx = vagueIndices[patch.index];
      if (itemIdx === undefined) continue;
      const original = result[itemIdx];
      result[itemIdx] = {
        ...original,
        search_title: patch.search_title?.trim() || original.search_title,
        specs: patch.specs?.trim() || original.specs,
      };
    }

    const stillVague = vagueIndices.filter((i) => !hasSpecificity(result[i]));
    if (stillVague.length > 0) {
      log.warn(`${stillVague.length} items still vague after enrichment`, {
        categories: stillVague.map((i) => result[i].category),
      });
    }

    log.info(`Enriched ${vagueIndices.length - stillVague.length}/${vagueIndices.length} items successfully`);
    return result;
  } catch (err) {
    log.warn("Enricher failed — using original Pass B items unchanged", {
      error: err instanceof Error ? err.message : String(err),
    });
    return items;
  }
}
