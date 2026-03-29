import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getSearchBriefPrompt } from "@/lib/prompts/search-brief";
import type { PriceTier } from "@/lib/prompts/search-brief";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { DesignDirection } from "@/lib/types/database";

interface QueryWithAngle {
  query: string;
  angle: string;
}

interface TierBrief {
  search_queries: QueryWithAngle[];
  price_range: { min: number; max: number };
  retailers_to_target: string[];
}

interface SearchBriefCategory {
  category: string;
  tiers: Record<PriceTier, TierBrief>;
  key_requirements: string[];
}

export interface SearchBrief {
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
    // Big-box & mass market
    "ikea.com", "target.com", "amazon.com", "wayfair.com", "walmart.com",
    "overstock.com", "homedepot.com", "lowes.com",
    // Budget home decor
    "worldmarket.com", "hm.com", "zarahome.com", "kirklands.com",
    "athome.com", "biglots.com",
    // Budget furniture brands
    "ashleyfurniture.com", "mybobs.com", "roomstogo.com", "walkeredison.com",
    // Budget rug specialists
    "rugsusa.com", "boutiquerugs.com", "nuloom.com", "wellwoven.com", "esalerugs.com",
    // Budget art & decor
    "society6.com", "redbubble.com", "icanvas.com", "desenio.com", "posterstore.com",
    // Budget lighting
    "lampsplus.com",
  ],
  balanced: [
    // Major mid-range retailers
    "westelm.com", "cb2.com", "crateandbarrel.com", "potterybarn.com",
    "anthropologie.com", "urbanoutfitters.com",
    // Wayfair premium brands
    "allmodern.com", "jossandmain.com", "birchlane.com",
    // DTC furniture brands
    "article.com", "castlery.com", "burrow.com", "joybird.com", "apt2b.com",
    "sixpenny.com", "floyddetroit.com", "insideweather.com",
    "interior-define.com", "polyandbark.com", "albanypark.com",
    "sabai.design", "benchmademodern.com", "maidenhome.com",
    // Department stores (home)
    "macys.com", "nordstrom.com", "bloomingdales.com",
    // Mid-range home decor
    "ballarddesigns.com", "grandinroad.com", "zgallerie.com",
    "livingspaces.com", "ethanallen.com", "pier1.com",
    // Rug specialists
    "ruggable.com", "loloirugs.com", "dashandalbert.com", "revivalrugs.com",
    "surya.com",
    // Lighting specialists
    "schoolhouse.com", "lumens.com", "ylighting.com", "shadesoflight.com",
    "barnlightelectric.com",
    // Art & decor
    "minted.com", "artfullywalls.com", "juniperprintshop.com", "etsy.com",
    "framebridge.com", "saatchiart.com",
    // Curated marketplaces
    "burkedecor.com", "mcgeeandco.com", "shopamberinteriors.com",
    "luluandgeorgia.com",
  ],
  high_end: [
    // Luxury retailers
    "rh.com", "restorationhardware.com", "serenaandlily.com", "arhaus.com",
    "roomandboard.com", "dwr.com",
    // Designer brands
    "jonathanadler.com", "kellywearstler.com", "bludot.com",
    "industrywest.com", "hem.com", "dims.com",
    // European luxury
    "ligne-roset.com", "roche-bobois.com", "bebitalia.com",
    "cassina.com", "hay.com", "muuto.com", "fermliving.com",
    "fritzhansen.com", "tomdixon.net", "kartell.com", "flos.com",
    // Premium home
    "rejuvenation.com", "mcgeeandco.com", "luluandgeorgia.com",
    "frontgate.com", "onekingslane.com", "kathykuohome.com",
    "horchow.com", "neimanmarcus.com",
    // High-end curated marketplaces
    "perigold.com", "chairish.com", "1stdibs.com",
    // Premium lighting
    "circalighting.com", "visualcomfort.com", "arteriorshome.com",
    "louispoulsen.com", "artemide.com",
    // Premium rugs
    "therugcompany.com", "armadillo-co.com", "starkcarpet.com",
    // Premium art
    "artsy.net", "upriseart.com",
    // Premium home accents
    "abchome.com",
  ],
};

/** Best retailers per category — used to build PRIORITY RETAILERS in search prompt */
const CATEGORY_RETAILERS: Record<string, Record<PriceTier, string[]>> = {
  // ── Rugs ──────────────────────────────────────────────────────
  rug: {
    budget: ["rugsusa.com", "boutiquerugs.com", "wayfair.com", "target.com", "ikea.com", "nuloom.com", "wellwoven.com", "esalerugs.com", "amazon.com", "overstock.com"],
    balanced: ["ruggable.com", "loloirugs.com", "dashandalbert.com", "revivalrugs.com", "surya.com", "westelm.com", "crateandbarrel.com", "cb2.com", "luluandgeorgia.com", "article.com", "etsy.com"],
    high_end: ["therugcompany.com", "armadillo-co.com", "serenaandlily.com", "rh.com", "luluandgeorgia.com", "roomandboard.com", "abchome.com", "perigold.com", "starkcarpet.com"],
  },
  area_rug: {
    budget: ["rugsusa.com", "boutiquerugs.com", "wayfair.com", "target.com", "ikea.com", "nuloom.com", "wellwoven.com", "esalerugs.com", "amazon.com", "overstock.com"],
    balanced: ["ruggable.com", "loloirugs.com", "dashandalbert.com", "revivalrugs.com", "surya.com", "westelm.com", "crateandbarrel.com", "cb2.com", "luluandgeorgia.com", "article.com"],
    high_end: ["therugcompany.com", "armadillo-co.com", "serenaandlily.com", "rh.com", "luluandgeorgia.com", "roomandboard.com", "abchome.com", "perigold.com"],
  },
  kitchen_runner: {
    budget: ["rugsusa.com", "boutiquerugs.com", "wayfair.com", "target.com", "nuloom.com", "amazon.com"],
    balanced: ["ruggable.com", "loloirugs.com", "dashandalbert.com", "westelm.com", "crateandbarrel.com"],
    high_end: ["serenaandlily.com", "rh.com", "luluandgeorgia.com", "armadillo-co.com"],
  },
  // ── Seating ───────────────────────────────────────────────────
  sofa: {
    budget: ["ikea.com", "wayfair.com", "amazon.com", "ashleyfurniture.com", "mybobs.com", "roomstogo.com", "walmart.com"],
    balanced: ["article.com", "burrow.com", "interior-define.com", "castlery.com", "joybird.com", "sixpenny.com", "albanypark.com", "benchmademodern.com", "westelm.com", "cb2.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "maidenhome.com", "ligne-roset.com", "roche-bobois.com", "bebitalia.com"],
  },
  accent_chair: {
    budget: ["ikea.com", "wayfair.com", "target.com", "worldmarket.com", "amazon.com", "overstock.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "castlery.com", "joybird.com", "anthropologie.com", "allmodern.com", "polyandbark.com", "crateandbarrel.com"],
    high_end: ["roomandboard.com", "dwr.com", "arhaus.com", "rh.com", "jonathanadler.com", "bludot.com", "industrywest.com", "hay.com", "fritzhansen.com"],
  },
  dining_chairs: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "worldmarket.com", "overstock.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "castlery.com", "allmodern.com", "crateandbarrel.com", "polyandbark.com", "livingspaces.com"],
    high_end: ["roomandboard.com", "dwr.com", "arhaus.com", "rh.com", "hay.com", "muuto.com", "cassina.com", "kartell.com", "fritzhansen.com"],
  },
  // ── Tables ────────────────────────────────────────────────────
  coffee_table: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "worldmarket.com", "overstock.com", "ashleyfurniture.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "castlery.com", "allmodern.com", "crateandbarrel.com", "floyddetroit.com", "burkedecor.com"],
    high_end: ["roomandboard.com", "dwr.com", "arhaus.com", "rh.com", "bludot.com", "industrywest.com", "jonathanadler.com", "perigold.com", "1stdibs.com"],
  },
  side_table: {
    budget: ["ikea.com", "target.com", "wayfair.com", "amazon.com", "worldmarket.com", "overstock.com"],
    balanced: ["cb2.com", "westelm.com", "article.com", "crateandbarrel.com", "allmodern.com", "anthropologie.com", "mcgeeandco.com"],
    high_end: ["roomandboard.com", "dwr.com", "serenaandlily.com", "mcgeeandco.com", "jonathanadler.com", "bludot.com", "hay.com", "perigold.com"],
  },
  dining_table: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "ashleyfurniture.com", "roomstogo.com"],
    balanced: ["article.com", "westelm.com", "crateandbarrel.com", "castlery.com", "cb2.com", "floyddetroit.com", "livingspaces.com", "ethanallen.com"],
    high_end: ["roomandboard.com", "arhaus.com", "rh.com", "dwr.com", "bludot.com", "ligne-roset.com", "perigold.com", "1stdibs.com"],
  },
  console_table: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "worldmarket.com"],
    balanced: ["cb2.com", "westelm.com", "article.com", "crateandbarrel.com", "allmodern.com", "ballarddesigns.com", "mcgeeandco.com"],
    high_end: ["roomandboard.com", "serenaandlily.com", "rh.com", "arhaus.com", "jonathanadler.com", "perigold.com"],
  },
  // ── Storage & Media ───────────────────────────────────────────
  media_console: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "walkeredison.com", "ashleyfurniture.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "floyddetroit.com", "castlery.com", "crateandbarrel.com", "allmodern.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "bludot.com", "industrywest.com"],
  },
  storage_cabinet: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "overstock.com"],
    balanced: ["cb2.com", "westelm.com", "crateandbarrel.com", "article.com", "allmodern.com", "anthropologie.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "jonathanadler.com", "perigold.com"],
  },
  credenza: {
    budget: ["ikea.com", "wayfair.com", "amazon.com", "overstock.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "allmodern.com", "castlery.com", "floyddetroit.com"],
    high_end: ["roomandboard.com", "dwr.com", "rh.com", "bludot.com", "industrywest.com", "perigold.com"],
  },
  bookshelf: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "overstock.com"],
    balanced: ["cb2.com", "westelm.com", "crateandbarrel.com", "article.com", "allmodern.com", "birchlane.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "bludot.com"],
  },
  // ── Lighting ──────────────────────────────────────────────────
  floor_lamp: {
    budget: ["ikea.com", "target.com", "amazon.com", "wayfair.com", "lampsplus.com", "overstock.com"],
    balanced: ["cb2.com", "westelm.com", "allmodern.com", "article.com", "schoolhouse.com", "lumens.com", "ylighting.com", "shadesoflight.com"],
    high_end: ["rejuvenation.com", "dwr.com", "serenaandlily.com", "luluandgeorgia.com", "flos.com", "artemide.com", "louispoulsen.com", "circalighting.com", "visualcomfort.com"],
  },
  table_lamp: {
    budget: ["ikea.com", "target.com", "amazon.com", "wayfair.com", "lampsplus.com", "overstock.com"],
    balanced: ["cb2.com", "westelm.com", "crateandbarrel.com", "allmodern.com", "schoolhouse.com", "lumens.com", "anthropologie.com", "mcgeeandco.com"],
    high_end: ["rejuvenation.com", "serenaandlily.com", "mcgeeandco.com", "luluandgeorgia.com", "circalighting.com", "visualcomfort.com", "arteriorshome.com", "jonathanadler.com"],
  },
  pendant_light: {
    budget: ["ikea.com", "amazon.com", "wayfair.com", "lampsplus.com", "homedepot.com", "lowes.com"],
    balanced: ["cb2.com", "westelm.com", "schoolhouse.com", "lumens.com", "ylighting.com", "barnlightelectric.com", "rejuvenation.com", "allmodern.com"],
    high_end: ["circalighting.com", "visualcomfort.com", "rejuvenation.com", "flos.com", "louispoulsen.com", "tomdixon.net", "arteriorshome.com", "dwr.com"],
  },
  // ── Soft Furnishings ──────────────────────────────────────────
  throw_pillows: {
    budget: ["target.com", "ikea.com", "hm.com", "amazon.com", "worldmarket.com", "wayfair.com"],
    balanced: ["westelm.com", "cb2.com", "crateandbarrel.com", "mcgeeandco.com", "anthropologie.com", "luluandgeorgia.com", "etsy.com", "potterybarn.com"],
    high_end: ["serenaandlily.com", "luluandgeorgia.com", "mcgeeandco.com", "shopamberinteriors.com", "rh.com", "jonathanadler.com"],
  },
  throw_pillow: {
    budget: ["target.com", "ikea.com", "hm.com", "amazon.com", "worldmarket.com", "wayfair.com"],
    balanced: ["westelm.com", "cb2.com", "crateandbarrel.com", "mcgeeandco.com", "anthropologie.com", "luluandgeorgia.com", "etsy.com", "potterybarn.com"],
    high_end: ["serenaandlily.com", "luluandgeorgia.com", "mcgeeandco.com", "shopamberinteriors.com", "rh.com", "jonathanadler.com"],
  },
  throw_blanket: {
    budget: ["target.com", "ikea.com", "hm.com", "amazon.com", "worldmarket.com"],
    balanced: ["westelm.com", "crateandbarrel.com", "cb2.com", "anthropologie.com", "mcgeeandco.com", "potterybarn.com", "etsy.com"],
    high_end: ["serenaandlily.com", "rh.com", "luluandgeorgia.com", "mcgeeandco.com", "abchome.com"],
  },
  curtains: {
    budget: ["ikea.com", "target.com", "amazon.com", "wayfair.com", "walmart.com"],
    balanced: ["westelm.com", "crateandbarrel.com", "potterybarn.com", "cb2.com", "anthropologie.com", "ballarddesigns.com"],
    high_end: ["serenaandlily.com", "rh.com", "potterybarn.com", "mcgeeandco.com", "rejuvenation.com"],
  },
  // ── Wall Art & Decor ──────────────────────────────────────────
  wall_art: {
    budget: ["target.com", "society6.com", "amazon.com", "ikea.com", "icanvas.com", "desenio.com", "posterstore.com", "redbubble.com"],
    balanced: ["minted.com", "artfullywalls.com", "juniperprintshop.com", "etsy.com", "westelm.com", "cb2.com", "luluandgeorgia.com", "mcgeeandco.com", "framebridge.com", "saatchiart.com"],
    high_end: ["artsy.net", "upriseart.com", "saatchiart.com", "1stdibs.com", "luluandgeorgia.com", "serenaandlily.com", "mcgeeandco.com", "abchome.com"],
  },
  art: {
    budget: ["target.com", "society6.com", "amazon.com", "ikea.com", "icanvas.com", "desenio.com", "posterstore.com"],
    balanced: ["minted.com", "artfullywalls.com", "juniperprintshop.com", "etsy.com", "westelm.com", "cb2.com", "luluandgeorgia.com", "saatchiart.com"],
    high_end: ["artsy.net", "upriseart.com", "saatchiart.com", "1stdibs.com", "luluandgeorgia.com", "serenaandlily.com"],
  },
  // ── Decorative Objects ────────────────────────────────────────
  vase: {
    budget: ["target.com", "ikea.com", "hm.com", "amazon.com", "worldmarket.com"],
    balanced: ["cb2.com", "westelm.com", "anthropologie.com", "crateandbarrel.com", "mcgeeandco.com", "etsy.com"],
    high_end: ["serenaandlily.com", "jonathanadler.com", "luluandgeorgia.com", "abchome.com", "rh.com", "fermliving.com"],
  },
  tray: {
    budget: ["target.com", "ikea.com", "amazon.com", "worldmarket.com", "hm.com"],
    balanced: ["cb2.com", "westelm.com", "crateandbarrel.com", "anthropologie.com", "mcgeeandco.com"],
    high_end: ["serenaandlily.com", "jonathanadler.com", "rh.com", "luluandgeorgia.com"],
  },
  plant: {
    budget: ["amazon.com", "homedepot.com", "lowes.com", "ikea.com", "target.com"],
    balanced: ["bloomscape.com", "thesill.com", "westelm.com", "terrain.com", "etsy.com"],
    high_end: ["terrain.com", "thesill.com", "bloomscape.com", "anthropologie.com"],
  },
  mirror: {
    budget: ["ikea.com", "target.com", "amazon.com", "wayfair.com", "walmart.com"],
    balanced: ["cb2.com", "westelm.com", "crateandbarrel.com", "anthropologie.com", "allmodern.com", "ballarddesigns.com"],
    high_end: ["rh.com", "serenaandlily.com", "arhaus.com", "rejuvenation.com", "jonathanadler.com", "perigold.com"],
  },
};

/**
 * Generate a shopping brief based on room diagnosis — now with 5 diverse queries per tier.
 */
export async function generateSearchBrief(
  roomType: string,
  missingCategories: string[],
  budgetMode: string,
  categoryHints?: Record<string, string>,
  designProfile?: DynamicDesignProfile,
  designDirection?: DesignDirection,
  priorities?: string[],
  keepItems?: string[],
  spatialLayout?: string,
  roomSummary?: string
): Promise<AgentResult<SearchBrief>> {
  const model = selectModel("search_brief");
  const system = getSystemPrompt(designProfile);
  const prompt = getSearchBriefPrompt(roomType, missingCategories, budgetMode, categoryHints, designDirection, priorities, keepItems, spatialLayout, roomSummary);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8000,
        temperature: 0.3,
        responseMimeType: "application/json",
      });

      if (response.truncated) {
        console.error("[search-brief] Response was truncated! Need more output tokens.");
      }

      const parsed = JSON.parse(response.content) as SearchBrief;
      return {
        success: true,
        data: parsed,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
        model: response.model,
      };
    } catch (error) {
      console.error(`[search-brief] Attempt ${attempt + 1} failed:`, error instanceof Error ? error.message : error);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Search brief generation failed",
      };
    }
  }

  return { success: false, error: "Search brief generation failed after retries" };
}

/**
 * Search the web for products using Gemini Google Search grounding.
 * Returns up to maxResults candidates per query.
 *
 * When a category is provided, also generates targeted `site:` searches
 * against the best retailers for that category+tier from CATEGORY_RETAILERS.
 */
export async function searchProducts(
  query: string,
  maxResults: number = 10,
  tier?: PriceTier,
  category?: string
): Promise<AgentResult<SearchCandidate[]>> {
  const domains = tier
    ? TIER_DOMAINS[tier]
    : [...TIER_DOMAINS.budget, ...TIER_DOMAINS.balanced, ...TIER_DOMAINS.high_end];

  // Build retailer focus list — prioritize category-specific retailers
  let retailerFocus = "";
  if (category && tier) {
    const categoryKey = category.toLowerCase().replace(/\s+/g, "_");
    const retailers = CATEGORY_RETAILERS[categoryKey]?.[tier];
    if (retailers) {
      retailerFocus = `\nPRIORITY RETAILERS (search these first): ${retailers.join(", ")}`;
    }
  }

  // Single search call per query — retailer targeting baked into the prompt
  const searchPrompt = `Search for this specific product and find actual product pages (not category pages) from these retailers: ${domains.join(", ")}.${retailerFocus}

Search query: "${query}"

Find at least ${maxResults} relevant product pages. Prioritize the PRIORITY RETAILERS above if listed. For each, provide title, URL, brief snippet, and retailer.

Return ONLY a valid JSON object — no text before or after:
{
  "products": [
    {
      "title": "Product name",
      "url": "https://...",
      "snippet": "Brief description — price, material, color if visible (max 1 sentence)",
      "source": "retailer domain"
    }
  ]
}`;

  try {
    const response = await geminiProvider.chat({
      model: selectModel("search"),
      system: "You are a product search assistant. Find specific product pages on furniture retailer websites. Only return actual product pages, not category or listing pages. Return ONLY JSON.",
      messages: [{ role: "user", content: searchPrompt }],
      max_tokens: 2000,
      temperature: 0.2,
      tools: [{ googleSearch: {} }],
    });

    try {
      const raw = response.content.trim();
      let parsed: { products?: { title: string; url: string; snippet: string; source: string }[] };
      try {
        parsed = JSON.parse(raw);
      } catch {
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1].trim());
        } else {
          const braceStart = raw.indexOf("{");
          const braceEnd = raw.lastIndexOf("}");
          if (braceStart !== -1 && braceEnd > braceStart) {
            parsed = JSON.parse(raw.slice(braceStart, braceEnd + 1));
          } else {
            parsed = {};
          }
        }
      }
      const candidates = (parsed.products || []).map(
        (r: { title: string; url: string; snippet: string; source: string }) => ({
          title: r.title || "",
          url: r.url || "",
          snippet: (r.snippet || "").slice(0, 500),
          source: r.source || "",
        })
      );
      return { success: true, data: candidates };
    } catch {
      // Fallback: use grounding metadata sources
      if (response.groundingMetadata?.sources) {
        const candidates = response.groundingMetadata.sources
          .filter((s) => s.uri)
          .map((s) => {
            let source = "";
            try {
              source = new URL(s.uri).hostname.replace("www.", "");
            } catch {
              source = s.uri;
            }
            return { title: s.title, url: s.uri, snippet: "", source };
          });
        return { success: true, data: candidates };
      }
      return { success: true, data: [] };
    }
  } catch {
    return { success: false, error: "Search failed" };
  }
}

/**
 * Deduplicate search candidates by URL (hostname + pathname, ignoring query params).
 * Keeps the first occurrence of each unique URL.
 */
export function deduplicateCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  const seen = new Set<string>();
  const result: SearchCandidate[] = [];

  for (const c of candidates) {
    try {
      const url = new URL(c.url);
      const key = `${url.hostname}${url.pathname}`.toLowerCase().replace(/\/+$/, "");
      if (!seen.has(key)) {
        seen.add(key);
        result.push(c);
      }
    } catch {
      // If URL is malformed, keep it (will be filtered later)
      result.push(c);
    }
  }

  return result;
}

/**
 * Quick screen candidates using Flash model (text-only, no tools).
 * Rates each candidate 1-5 on relevance and filters to ≥3.
 * Includes design direction context for style filtering.
 * Batches up to 30 candidates per call for efficiency.
 */
export async function quickScreenCandidates(
  candidates: SearchCandidate[],
  category: string,
  tier: PriceTier,
  requirements: string[],
  designDirection?: DesignDirection
): Promise<AgentResult<SearchCandidate[]>> {
  if (candidates.length === 0) {
    return { success: true, data: [] };
  }

  const BATCH_SIZE = 30;
  const batches: SearchCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  const allPassed: SearchCandidate[] = [];

  // Process batches in parallel
  const batchResults = await Promise.all(
    batches.map(async (batch, batchIdx) => {
      const candidateList = batch
        .map((c, i) => `[${batchIdx * BATCH_SIZE + i}] "${c.title}" — ${c.source} — ${c.snippet.slice(0, 120)}`)
        .join("\n");

      const styleContext = designDirection
        ? `\nDesign direction: ${designDirection.style_notes}. Palette: ${designDirection.recommended_palette?.join(", ") || "flexible"}. Materials: ${designDirection.recommended_materials?.join(", ") || "flexible"}.\nPenalize products that clearly clash with this direction (e.g. wrong style family).`
        : "";

      const prompt = `Rate each URL candidate for relevance to finding a **${category}** product in the **${tier}** price tier.

Requirements: ${requirements.join(", ")}${styleContext}

## CANDIDATES
${candidateList}

## STEP 1: CHECK THE URL STRUCTURE
Before rating, examine each URL:
- If URL contains /collections, /categories, /browse, /shop-all, /search, /blog, /magazine, /reviews, /inspiration, /ideas → rate 1-2 (these are listing/content pages, NOT product pages)
- If URL is a site homepage (e.g., just "article.com" or "westelm.com") → rate 1
- If URL has product identifiers in path (e.g., /products/walnut-coffee-table, /p/SKU-12345, /dp/B0xxx) → likely product page, rate 4-5
- If URL contains a specific product slug (hyphenated product name) → likely product page

## STEP 2: RATING CRITERIA
- 5: URL structure confirms product page + title clearly matches ${category} + snippet mentions price/materials + style-compatible with design direction
- 4: URL looks like a product page + title matches ${category}, snippet is somewhat relevant
- 3: Uncertain — could be a product page or a targeted subcategory listing. Title seems relevant.
- 2: Probably a category listing, blog post, roundup article, or wrong product type
- 1: Definitely not relevant — review article, unrelated product, broken URL

Return JSON:
{
  "ratings": [
    { "index": number, "rating": number, "reason": "brief reason" }
  ]
}`;

      try {
        const response = await geminiProvider.chat({
          model: selectModel("quick_screen"),
          system: "You are a product page classifier. Be strict — only pass candidates that are likely actual product pages for the requested category. Return ONLY the JSON ratings array.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
          temperature: 0.1,
          responseMimeType: "application/json",
        });

        const parsed = JSON.parse(response.content);
        const passed: SearchCandidate[] = [];
        for (const rating of parsed.ratings || []) {
          if (rating.rating >= 3) {
            const globalIdx = rating.index;
            const localIdx = globalIdx - batchIdx * BATCH_SIZE;
            if (localIdx >= 0 && localIdx < batch.length) {
              passed.push(batch[localIdx]);
            }
          }
        }
        return passed;
      } catch {
        // On failure, pass all candidates through (fail open)
        return batch;
      }
    })
  );

  for (const passed of batchResults) {
    allPassed.push(...passed);
  }

  return { success: true, data: allPassed };
}
