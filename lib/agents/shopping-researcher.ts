import { geminiProvider } from "@/lib/ai/gemini";
import { withMarginOperation } from "@/lib/observability/margin-context";
import { selectModel } from "@/lib/ai/models";
import { thinkingFor } from "@/lib/ai/thinking";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getSearchBriefPrompt } from "@/lib/prompts/search-brief";
import { SearchBriefResponseSchema, QuickScreenResponseSchema } from "@/lib/types/schemas";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logging/logger";
import { tavilySearch } from "@/lib/ai/tavily";
import type { PriceTier } from "@/lib/prompts/search-brief";
import type { AgentResult } from "./types";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";
import type { DesignDirection } from "@/lib/types/database";
import type { AIContentBlock } from "@/lib/ai/provider";
import { getCachedQuery, cacheQuery, getCachedScreen, cacheScreen } from "./search-cache";
import { prioritizeDomains, type DomainStatsMap } from "./domain-router";

/**
 * Max number of room photos to attach to researcher/reranker/extractor calls.
 * These are auxiliary text-heavy agents where the images are context
 * reminders ("never forget the room"); we keep the count modest so payloads
 * stay small. The real image-heavy scoring happens in fit-scorer / bundle-
 * optimizer / validation-agent, which already pass up to 2–4 images.
 */
const ROOM_IMAGES_CONTEXT_LIMIT = 3;

/**
 * Helper: prepend the room photos (+ a short text preamble) to a text
 * prompt so every LLM call carries the physical room as grounding context.
 * Returns a content-block array suitable for `messages[].content`.
 */
function withRoomImages(prompt: string, roomImageUrls?: string[]): AIContentBlock[] | string {
  if (!roomImageUrls || roomImageUrls.length === 0) return prompt;
  const content: AIContentBlock[] = [
    {
      type: "text",
      text: "REFERENCE PHOTOS OF THE ACTUAL ROOM (ground every decision in these — they are the source of truth for style, scale, lighting, and what already exists):",
    },
  ];
  for (const url of roomImageUrls.slice(0, ROOM_IMAGES_CONTEXT_LIMIT)) {
    content.push({ type: "image", source: { type: "url", url } });
  }
  content.push({ type: "text", text: prompt });
  return content;
}

const log = createLogger("shopping-researcher");

/** Pre-computed Gemini-compatible schemas. */
const SEARCH_BRIEF_GEMINI_SCHEMA = zodToGeminiSchema(SearchBriefResponseSchema);
const QUICK_SCREEN_GEMINI_SCHEMA = zodToGeminiSchema(QuickScreenResponseSchema);

interface QueryWithAngle {
  query: string;
  angle: string;
}

interface TierBrief {
  search_queries: QueryWithAngle[];
  price_range: { min: number; max: number };
}

interface SearchBriefCategory {
  category: string;
  // Each tier is optional — the model may omit a tier if it can't propose
  // queries for it. Orchestrator skips undefined tiers.
  tiers: Partial<Record<PriceTier, TierBrief>>;
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
  relevanceScore?: number;
  rawContent?: string;
  imageUrl?: string;
}

const TIER_DOMAINS: Record<PriceTier, string[]> = {
  budget: [
    // Big-box & mass market
    "ikea.com", "target.com", "amazon.com", "wayfair.com", "walmart.com",
    "overstock.com", "homedepot.com", "lowes.com", "costco.com", "menards.com",
    // Budget home decor
    "worldmarket.com", "hm.com", "zarahome.com", "kirklands.com",
    "athome.com", "biglots.com", "tuftandneedle.com",
    // Budget furniture brands
    "ashleyfurniture.com", "mybobs.com", "roomstogo.com", "walkeredison.com",
    "structube.com", "homary.com",
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
    "roveconcepts.com", "scandinaviandesigns.com",
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
    "industrywest.com", "hem.com", "dims.com", "roveconcepts.com",
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
  // ── Bedroom ──────────────────────────────────────────────────
  nightstand: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "ashleyfurniture.com", "overstock.com"],
    balanced: ["article.com", "westelm.com", "cb2.com", "castlery.com", "crateandbarrel.com", "allmodern.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "serenaandlily.com", "dwr.com", "perigold.com"],
  },
  dresser: {
    budget: ["ikea.com", "wayfair.com", "amazon.com", "ashleyfurniture.com", "roomstogo.com", "overstock.com"],
    balanced: ["article.com", "westelm.com", "crateandbarrel.com", "castlery.com", "cb2.com", "allmodern.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "bludot.com", "perigold.com"],
  },
  bed_frame: {
    budget: ["ikea.com", "wayfair.com", "amazon.com", "ashleyfurniture.com", "tuftandneedle.com", "roomstogo.com"],
    balanced: ["article.com", "westelm.com", "castlery.com", "cb2.com", "floyddetroit.com", "crateandbarrel.com", "thuma.co"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "roveconcepts.com", "perigold.com"],
  },
  // ── Additional Seating ───────────────────────────────────────
  ottoman: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "worldmarket.com", "overstock.com"],
    balanced: ["article.com", "cb2.com", "westelm.com", "crateandbarrel.com", "joybird.com", "anthropologie.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "jonathanadler.com", "perigold.com"],
  },
  bench: {
    budget: ["ikea.com", "wayfair.com", "target.com", "amazon.com", "overstock.com"],
    balanced: ["cb2.com", "westelm.com", "article.com", "crateandbarrel.com", "allmodern.com"],
    high_end: ["roomandboard.com", "rh.com", "arhaus.com", "dwr.com", "bludot.com", "perigold.com"],
  },
  // ── Decor & Accessories ──────────────────────────────────────
  candle: {
    budget: ["target.com", "amazon.com", "ikea.com", "hm.com", "worldmarket.com"],
    balanced: ["cb2.com", "anthropologie.com", "westelm.com", "etsy.com", "mcgeeandco.com"],
    high_end: ["abchome.com", "jonathanadler.com", "serenaandlily.com", "luluandgeorgia.com"],
  },
  decorative_objects: {
    budget: ["target.com", "ikea.com", "amazon.com", "worldmarket.com", "hm.com"],
    balanced: ["cb2.com", "westelm.com", "anthropologie.com", "mcgeeandco.com", "etsy.com"],
    high_end: ["serenaandlily.com", "jonathanadler.com", "luluandgeorgia.com", "abchome.com", "rh.com"],
  },
};

/**
 * Generate a shopping brief based on room diagnosis — now with 5 diverse queries per tier.
 */
// Margin: the search-brief authoring call is a "product-research" node.
export function generateSearchBrief(
  ...args: Parameters<typeof generateSearchBriefImpl>
): ReturnType<typeof generateSearchBriefImpl> {
  return withMarginOperation("product-research", () => generateSearchBriefImpl(...args));
}
async function generateSearchBriefImpl(
  roomType: string,
  missingCategories: string[],
  budgetMode: string,
  categoryHints?: Record<string, string>,
  designProfile?: DynamicDesignProfile,
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
  roomImageUrls?: string[],
  otherRoomsContext?: string,
  budgetDollars?: number
): Promise<AgentResult<SearchBrief>> {
  const model = selectModel("search_brief");
  const system = getSystemPrompt(designProfile);
  const prompt = getSearchBriefPrompt(roomType, missingCategories, budgetMode, categoryHints, designDirection, priorities, keepItems, replaceItems, spatialLayout, roomSummary, userContext, diagnosis, lightingConditions, windowDoorPositions, outletPositions, identifiedContext, designProfile, otherRoomsContext, budgetDollars);

  let lastError: string | undefined;
  let attempt = 0;

  try {
    return await withRetry(
      async () => {
        attempt++;
        const retryHint = attempt > 1 && lastError
          ? `\n\nPrevious response was invalid: "${lastError}". Return ONLY valid JSON with the exact schema above. Each category must have tiers with search_queries and price_range.`
          : "";

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: withRoomImages(prompt + retryHint, roomImageUrls) }],
          max_tokens: 16000,
          seed: DETERMINISTIC_SEED,
          responseSchema: SEARCH_BRIEF_GEMINI_SCHEMA,
          thinkingConfig: thinkingFor("search_brief"),
        });

        if (response.truncated) {
          log.warn("Search brief response truncated", { phase: "search_brief" });
        }

        const raw = extractJsonObject(response.content);
        const validated = SearchBriefResponseSchema.parse(raw);

        log.info("Search brief generated", {
          phase: "search_brief",
          categories: validated.categories.length,
        });

        return {
          success: true as const,
          data: validated as SearchBrief,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          model: response.model,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        maxDelayMs: 15000,
        isRetryable: (error) => {
          if (isRetryableError(error)) return true;
          if (error instanceof SyntaxError) return true;
          if (error instanceof Error && error.name === "ZodError") return true;
          return false;
        },
        onRetry: (retryAttempt, delayMs, error) => {
          lastError = error instanceof Error ? error.message : "Search brief generation failed";
          log.warn(`Search brief retry ${retryAttempt}`, { phase: "search_brief", durationMs: delayMs, error: lastError });
        },
      }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Search brief generation failed after retries";
    log.error("Search brief generation failed", { phase: "search_brief", error: errMsg });
    return { success: false, error: errMsg };
  }
}

// ─── Query sanitizer ──────────────────────────────────────────
// Detects and cleans malformed search queries before they reach Tavily.
// Prevents prose fragments from leaking into queries (backfill/exploration
// paths historically concatenated truncated style_notes prose).
const PROSE_PATTERNS = [
  /\b(pivot|shift|transition|aim|goal is|moving toward|the current)\b/i,
  /\b(we aim to|the goal is to|shifting toward|pivoted? to|pivot from)\b/i,
  /\b(sterile|monochromatic|monochro|aesthetic that|scheme to)\b/i,
];

export function sanitizeSearchQuery(query: string): string | null {
  if (!query || typeof query !== "string") return null;
  let clean = query.trim();
  if (clean.length > 120) clean = clean.slice(0, 120).trim();
  // Strip hex color codes — not useful for search
  clean = clean.replace(/\s*\(#[A-Fa-f0-9]{3,8}\)/g, "");
  // Strip percentage annotations (e.g. "— dominant (50%)")
  clean = clean.replace(/\s*—\s*\w+\s*\(\d+%\)/g, "");
  clean = clean.replace(/\s+/g, " ").trim();
  for (const pattern of PROSE_PATTERNS) {
    if (pattern.test(clean)) {
      log.warn("Rejected prose-contaminated search query", { query: clean });
      return null;
    }
  }
  if (clean.length < 5) return null;
  return clean;
}

/**
 * Search the web for products using Tavily Search API.
 * Returns up to maxResults candidates per query with zero LLM token cost.
 *
 * Uses `include_raw_content` to pre-fetch page text (skipping extraction
 * for ~30-50% of products) and `include_images` for product images.
 */
export async function searchProducts(
  query: string,
  maxResults: number = 10,
  tier?: PriceTier,
  category?: string,
  _roomImageUrls?: string[],
  domainStats?: DomainStatsMap,
): Promise<AgentResult<SearchCandidate[]>> {
  const sanitized = sanitizeSearchQuery(query);
  if (!sanitized) {
    return { success: true, data: [], tokensUsed: 0 };
  }
  query = sanitized;

  const cached = getCachedQuery(query, tier, category, maxResults);
  if (cached) {
    return { success: true, data: cached, tokensUsed: 0 };
  }

  // Build domain allowlist: category-specific retailers first, then tier defaults
  const includeDomains: string[] = [];
  if (category && tier) {
    const categoryKey = category.toLowerCase().replace(/\s+/g, "_");
    const retailers = CATEGORY_RETAILERS[categoryKey]?.[tier];
    if (retailers) includeDomains.push(...retailers);
  }
  const tierDomains = tier
    ? TIER_DOMAINS[tier]
    : [...TIER_DOMAINS.budget, ...TIER_DOMAINS.balanced, ...TIER_DOMAINS.high_end];
  for (const d of tierDomains) {
    if (!includeDomains.includes(d)) includeDomains.push(d);
  }
  // Reorder by extraction success rate: high-success domains first,
  // chronically-failing domains removed entirely.
  const routed = domainStats
    ? prioritizeDomains(includeDomains, domainStats)
    : includeDomains;
  // Tavily caps include_domains at 300
  const domainList = routed.slice(0, 300);

  try {
    const response = await tavilySearch({
      query,
      max_results: Math.min(maxResults, 20),
      include_domains: domainList,
      search_depth: tier === "high_end" ? "advanced" : "basic",
      include_images: true,
      include_raw_content: true,
      country: "united states",
      time_range: "year",
    });

    const candidates: SearchCandidate[] = response.results.map((r) => {
      let source = "";
      try {
        source = new URL(r.url).hostname.replace("www.", "");
      } catch {
        source = r.url;
      }

      // Pick first product image from per-result images or global images
      let imageUrl: string | undefined;
      if (r.images && r.images.length > 0) {
        imageUrl = r.images[0].url;
      }

      return {
        title: r.title,
        url: r.url,
        snippet: (r.content || "").slice(0, 500),
        source,
        relevanceScore: r.score,
        rawContent: r.raw_content && r.raw_content.length > 500 ? r.raw_content : undefined,
        imageUrl,
      };
    });

    cacheQuery(query, tier, category, maxResults, candidates);
    log.info("Tavily search returned candidates", {
      phase: "search", query: query.slice(0, 60), tier, category,
      results: candidates.length, withRawContent: candidates.filter((c) => c.rawContent).length,
    });
    return { success: true, data: candidates, tokensUsed: 0 };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Tavily search failed", { phase: "search", query, tier, category, error: errMsg });
    return { success: false, error: `Search failed: ${errMsg}` };
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

// Deterministic junk filter — drops obvious non-furniture before LLM screening.
// Each title is cheap to check, and kills off the classic offenders from prior
// runs (books titled "The Punishment of Gaza", Beatles T-shirt amazon listings,
// paperback novel entries) before they eat screening tokens or — worse — slip
// through to extraction. Non-global regexes → `.test()` is stateless, so these
// are safe to hoist to module scope and reuse across calls.
const JUNK_TITLE_PATTERNS = [
  /\bpaperback\b/i, /\bhardcover\b/i, /\bebook\b/i, /\bkindle\b/i, /\bISBN\b/i,
  /\bnovel\b/i, /\bmemoir\b/i, /\bbiography\b/i, /\bpenguin books\b/i,
  /\bt-?shirt\b/i, /\bhoodie\b/i, /\bsweatshirt\b/i, /\bsneakers?\b/i, /\bjacket\b/i,
  /\bDVD\b/i, /\bBlu-?ray\b/i, /\bCD album\b/i, /\bvinyl record\b/i,
  /\bBeatles\b/i, /\bpunishment of\b/i,
];
const JUNK_URL_PATTERNS = [
  /goodreads\.com/i, /barnesandnoble\.com\/w\//i,
  /penguinrandomhouse\.com/i, /bookshop\.org/i,
  /amazon\.com\/[^/]*\/dp\/[^/]+\/?.*[?&]ref=[^&]*books/i,
];

/**
 * Pure, deterministic prefilter that drops obvious non-furniture candidates
 * (books / apparel / media) by title or URL before the paid quick-screen LLM
 * pass. Every dropped candidate is screening tokens (and a possible extraction)
 * saved, so the pattern set is a real cost lever — extracted + exported here so
 * it can be unit-tested in isolation.
 */
export function prefilterJunkCandidates(
  candidates: SearchCandidate[],
): { prefiltered: SearchCandidate[]; junkDropped: number } {
  const prefiltered: SearchCandidate[] = [];
  let junkDropped = 0;
  for (const c of candidates) {
    const t = c.title || "";
    const u = c.url || "";
    const isJunk = JUNK_TITLE_PATTERNS.some((re) => re.test(t)) ||
                   JUNK_URL_PATTERNS.some((re) => re.test(u));
    if (isJunk) {
      junkDropped++;
      continue;
    }
    prefiltered.push(c);
  }
  return { prefiltered, junkDropped };
}

/**
 * Quick screen candidates using Flash model (text-only, no tools).
 * Rates each candidate 1-5 on relevance and filters to ≥3.
 * Includes design direction context for style filtering.
 * Batches up to 30 candidates per call for efficiency.
 */
// Margin: the candidate junk-screen LLM call is a "product-research" node.
export function quickScreenCandidates(
  ...args: Parameters<typeof quickScreenCandidatesImpl>
): ReturnType<typeof quickScreenCandidatesImpl> {
  return withMarginOperation("product-research", () => quickScreenCandidatesImpl(...args));
}
async function quickScreenCandidatesImpl(
  candidates: SearchCandidate[],
  category: string,
  tier: PriceTier,
  requirements: string[],
  designDirection?: DesignDirection,
  roomImageUrls?: string[]
): Promise<AgentResult<SearchCandidate[]>> {
  if (candidates.length === 0) {
    return { success: true, data: [] };
  }

  const { prefiltered, junkDropped } = prefilterJunkCandidates(candidates);
  if (junkDropped > 0) {
    log.info("Quick-screen junk prefilter dropped candidates", {
      phase: "quick_screen", category, tier, dropped: junkDropped,
    });
  }
  if (prefiltered.length === 0) {
    return { success: true, data: [], tokensUsed: 0 };
  }

  const BATCH_SIZE = 15;
  const batches: SearchCandidate[][] = [];
  for (let i = 0; i < prefiltered.length; i += BATCH_SIZE) {
    batches.push(prefiltered.slice(i, i + BATCH_SIZE));
  }

  const allPassed: SearchCandidate[] = [];

  // Process batches in parallel
  const batchResults = await Promise.all(
    batches.map(async (batch, batchIdx) => {
      const cachedPassed = getCachedScreen(batch, category, tier, requirements, designDirection);
      if (cachedPassed) {
        return { passed: cachedPassed, tokensUsed: 0 };
      }

      // Use 0-based local indices per batch (simpler, avoids global↔local conversion bugs)
      const candidateList = batch
        .map((c, i) => `[${i}] "${c.title}" — ${c.source} — ${c.snippet.slice(0, 300)}`)
        .join("\n");

      const styleContext = designDirection
        ? `\nDesign direction: Palette: ${designDirection.recommended_palette?.slice(0, 3).join(", ") || "flexible"}. Materials: ${designDirection.recommended_materials?.slice(0, 3).join(", ") || "flexible"}.\nPenalize products that clearly clash with this direction.`
        : "";

      const prompt = `## SEARCH CONTEXT
Category: **${category}** | Price tier: **${tier}**
Requirements: ${requirements.join(", ")}${styleContext}

## CANDIDATES
${candidateList}

Based on the search context and candidates above, rate each URL for relevance to finding a **${category}** product page.

## STEP 0: HARD REJECT (rate 1 immediately — do NOT pass)
These are never valid furniture/decor product pages:
- Books, ebooks, paperbacks, hardcovers (amazon.com/dp/ pointing to a book, Barnes & Noble, Goodreads, Penguin, Random House)
- Apparel, clothing, footwear: t-shirts, hoodies, sneakers, dresses, jackets, hats
- Music, movies, video games, software
- Food, supplements, beverages, groceries
- Political/news content, memoirs, biographies
- Toys, pet products (unless the category explicitly asks for a pet bed/crate)
- Auto parts, tools, industrial hardware
If the title mentions any of: "Beatles", "Gaza", "Punishment of", "Novel", "Memoir", "T-Shirt", "Hoodie", "Sneakers", "ISBN", "Paperback" — rate 1 regardless of URL.

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
- 1: Definitely not relevant — review article, unrelated product, book/apparel/media, broken URL

## STEP 3: CALIBRATION ANCHORS — reference these when scoring
Anchor your ratings to these examples. The 3/4 boundary is the pass/fail line — weigh it most carefully.
- **5** (clear product page): "Emmerson® Reclaimed Wood Dining Table" — westelm.com/products/emmerson-dining-table-h1567/ → /products/ path + SKU + exact product name + price/material in snippet.
- **4** (likely product page, thin snippet): "Mid-Century Walnut Coffee Table" — article.com/product/2847/ → product path, generic snippet, still extractable. ALSO "Linen Slipcovered Sofa" — potterybarn.com/p/PB-comfort-square-arm-slipcovered-sofa/ → /p/ path, category match.
- **3** (uncertain): "Shop All Sofas" with /products/shop-all-sofas/ → ambiguous listing vs curated page. ALSO a title with the category but a /category/livingroom/ URL path → probably a listing; pass only if the pool is thin.
- **2** (listing / content / wrong type): "Sectional Sofas — West Elm" — westelm.com/shop/furniture/sectionals/ → /shop/ path = category listing. Also review roundups (/wirecutter/reviews/) and /b/ browse pages.
- **1** (hard reject): "The Punishment of Gaza (Paperback)" — amazon.com/.../dp/1844673332/ → book. Also apparel, media, and retailer homepages.

When uncertain between two ratings, pick the lower — a bad extraction costs more downstream than missing one borderline candidate.

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
          messages: [{ role: "user", content: withRoomImages(prompt, roomImageUrls) }],
          max_tokens: 8000,
          seed: DETERMINISTIC_SEED,
          responseSchema: QUICK_SCREEN_GEMINI_SCHEMA,
          thinkingConfig: thinkingFor("quick_screen"),
        });

        const tokensUsed = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        const raw = extractJsonObject(response.content);
        const validated = QuickScreenResponseSchema.parse(raw);
        const passed: SearchCandidate[] = [];
        for (const rating of validated.ratings) {
          if (rating.rating >= 4) {
            const idx = rating.index;
            if (idx >= 0 && idx < batch.length) {
              passed.push(batch[idx]);
            }
          }
        }
        cacheScreen(batch, category, tier, requirements, designDirection, passed);
        return { passed, tokensUsed };
      } catch (err) {
        log.warn(`Quick-screen batch ${batchIdx} failed, returning empty`, { phase: "quick_screen", error: err instanceof Error ? err.message : String(err) });
        return { passed: [], tokensUsed: 0 };
      }
    })
  );

  let totalTokens = 0;
  for (const { passed, tokensUsed } of batchResults) {
    allPassed.push(...passed);
    totalTokens += tokensUsed;
  }

  return { success: true, data: allPassed, tokensUsed: totalTokens };
}
