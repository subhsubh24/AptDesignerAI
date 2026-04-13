/**
 * Allow-list of brands the identifier agent is allowed to propose as a
 * recognized product. Used as a SOFT guardrail — the identifier prompt lists
 * these as priors and tells the model to prefer them, but unknown brands may
 * still be returned if visual evidence is overwhelming (at a higher confidence
 * bar — see the `MIN_CONFIDENCE` constants below).
 *
 * Seeded from the retailer domains in `lib/agents/shopping-researcher.ts`.
 * Grouping is informational only — the identifier sees the flat list.
 *
 * Expansion path:
 *   1. Add the brand here with a few signature features.
 *   2. Run `pnpm tsx scripts/seed-product-embeddings.ts` to index their
 *      hero catalog images so retrieval priors surface the new brand.
 *   3. No code changes elsewhere — `getIdentifiableBrands()` picks it up.
 *
 * NOTE: Brand names here are displayed verbatim in the identifier prompt —
 * keep capitalization faithful to the canonical brand (e.g. "IKEA", not "Ikea").
 */

export interface IdentifiableBrand {
  /** Canonical brand name as shown to the model and UI. */
  brand: string;
  /** Retailer domain (matches shopping-researcher.ts entries). */
  domain?: string;
  /**
   * Model name hints — iconic product lines the model should especially look
   * for. Keeps the model's brand→model reasoning grounded on real SKUs.
   */
  tagline_hits?: string[];
  /**
   * Signature visual features the model can check against the room photo:
   * silhouette quirks, hardware, stitching, proportions, tags.
   */
  signatures?: string[];
}

/**
 * Default allow-list. Order doesn't matter but grouping keeps it readable.
 * About ~80 brands total — wide enough to cover most US/Euro furniture seen
 * in user rooms, narrow enough to shut down "probably IKEA?"-style guesses
 * on truly generic pieces.
 */
export const IDENTIFIABLE_BRANDS: IdentifiableBrand[] = [
  // ── Big-box, mass market ──────────────────────────────────────
  {
    brand: "IKEA",
    domain: "ikea.com",
    tagline_hits: ["KIVIK", "POÄNG", "EKTORP", "STOCKSUND", "HAVSTA", "BILLY", "MALM", "HEMNES", "STRANDMON", "LANDSKRONA"],
    signatures: ["assembly pin visible", "Nordic minimal silhouette", "KIVIK knot-stitch under seat cushions"],
  },
  { brand: "Target (Threshold / Studio McGee)", domain: "target.com", tagline_hits: ["Threshold", "Studio McGee", "Casaluna"] },
  { brand: "Wayfair", domain: "wayfair.com" },
  { brand: "Walmart", domain: "walmart.com" },
  { brand: "Overstock", domain: "overstock.com" },

  // ── DTC mid-range ─────────────────────────────────────────────
  {
    brand: "Article",
    domain: "article.com",
    tagline_hits: ["Sven", "Ceni", "Burrard", "Abisko", "Divan", "Landen", "Gabriola"],
    signatures: ["mid-century tapered wood legs", "tufted bench seat (Sven)", "rounded tight-back cushions"],
  },
  { brand: "Burrow", domain: "burrow.com", tagline_hits: ["Nomad", "Range", "Field"], signatures: ["modular arm connector clips", "channel-tufted removable cushions"] },
  { brand: "Castlery", domain: "castlery.com", tagline_hits: ["Adams", "Todd", "Jonathan", "Auburn"] },
  { brand: "Joybird", domain: "joybird.com", tagline_hits: ["Briar", "Eliot", "Collins", "Preston"] },
  { brand: "Sixpenny", domain: "sixpenny.com", tagline_hits: ["Neva", "Aere", "Ila"], signatures: ["slipcovered linen with relaxed wrinkles", "deep overstuffed seat"] },
  { brand: "Floyd", domain: "floyddetroit.com", tagline_hits: ["The Sofa", "The Bed", "The Shelving System"] },
  { brand: "Inside Weather", domain: "insideweather.com" },
  { brand: "Interior Define", domain: "interior-define.com" },
  { brand: "Poly & Bark", domain: "polyandbark.com", tagline_hits: ["Napa", "Verona", "Essex"] },
  { brand: "Albany Park", domain: "albanypark.com", tagline_hits: ["Kova", "Park"] },
  { brand: "Sabai", domain: "sabai.design", tagline_hits: ["Essential", "City"] },
  { brand: "Benchmade Modern", domain: "benchmademodern.com" },
  { brand: "Maiden Home", domain: "maidenhome.com", tagline_hits: ["Sullivan", "Dune", "Warren"] },
  { brand: "Medley", domain: "medleyhome.com" },
  { brand: "Apt2B", domain: "apt2b.com" },
  { brand: "Thuma", domain: "thuma.co", tagline_hits: ["The Bed"], signatures: ["Japanese-joinery bed corner, no screws visible"] },
  { brand: "Piglet in Bed", domain: "pigletinbed.com" },

  // ── Major mid-range retailers ─────────────────────────────────
  { brand: "West Elm", domain: "westelm.com", tagline_hits: ["Andes", "Harmony", "Haven", "Drake", "Urban"] },
  { brand: "CB2", domain: "cb2.com", tagline_hits: ["Movie", "Lenyx", "Gwyneth", "Piazza"] },
  { brand: "Crate & Barrel", domain: "crateandbarrel.com", tagline_hits: ["Lounge", "Axis", "Davis", "Petrie"] },
  { brand: "Pottery Barn", domain: "potterybarn.com", tagline_hits: ["Comfort", "Pearce", "Big Sur", "York"] },
  { brand: "Anthropologie", domain: "anthropologie.com" },
  { brand: "Urban Outfitters", domain: "urbanoutfitters.com" },
  { brand: "AllModern", domain: "allmodern.com" },
  { brand: "Birch Lane", domain: "birchlane.com" },
  { brand: "Joss & Main", domain: "jossandmain.com" },

  // ── High end / designer ───────────────────────────────────────
  { brand: "Room & Board", domain: "roomandboard.com", tagline_hits: ["Jasper", "Metro", "Hess", "Linger"] },
  { brand: "Design Within Reach", domain: "dwr.com" },
  { brand: "Restoration Hardware", domain: "rh.com", tagline_hits: ["Cloud", "Maxwell", "Lancaster"], signatures: ["oversized deep seat", "floor-skimming slipcover"] },
  { brand: "Arhaus", domain: "arhaus.com" },
  { brand: "Serena & Lily", domain: "serenaandlily.com" },
  { brand: "Lulu and Georgia", domain: "luluandgeorgia.com" },
  { brand: "McGee & Co", domain: "mcgeeandco.com" },
  { brand: "Mitchell Gold + Bob Williams", domain: "mgbwhome.com" },
  { brand: "Kathy Kuo Home", domain: "kathykuohome.com" },
  { brand: "Rejuvenation", domain: "rejuvenation.com" },
  { brand: "Jonathan Adler", domain: "jonathanadler.com" },
  { brand: "Blu Dot", domain: "bludot.com", tagline_hits: ["Cleon", "Bank", "Paramount"], signatures: ["powder-coat metal frames", "squared-off proportions"] },
  { brand: "Industry West", domain: "industrywest.com" },

  // ── Mid-century / designer classic manufacturers ──────────────
  {
    brand: "Herman Miller",
    domain: "hermanmiller.com",
    tagline_hits: ["Eames Lounge", "Noguchi Table", "Nelson Bench", "Sayl", "Aeron", "Mira"],
    signatures: ["Eames shell arm-rest curve", "Noguchi glass top on biomorphic base"],
  },
  { brand: "Knoll", domain: "knoll.com", tagline_hits: ["Saarinen Tulip", "Barcelona", "Bertoia", "Platner"], signatures: ["Saarinen pedestal continuous curve", "Bertoia welded-wire diamond"] },
  { brand: "Vitra", domain: "vitra.com", tagline_hits: ["Eames", "Panton"], signatures: ["Panton chair single-piece molded shell"] },
  { brand: "Fritz Hansen", domain: "fritzhansen.com", tagline_hits: ["Series 7", "Egg", "Swan"], signatures: ["Egg chair wing-shoulder silhouette"] },
  { brand: "Cassina", domain: "cassina.com", tagline_hits: ["LC2", "LC3", "Utrecht", "Mex"], signatures: ["LC2 exposed steel frame cradling cushions"] },
  { brand: "Ligne Roset", domain: "ligne-roset.com", tagline_hits: ["Togo", "Ploum", "Prado"], signatures: ["Togo horizontal knot-stitch all around, floor-sitting silhouette"] },
  { brand: "Roche Bobois", domain: "roche-bobois.com", tagline_hits: ["Mah Jong", "Bubble"] },
  { brand: "B&B Italia", domain: "bebitalia.com", tagline_hits: ["Camaleonda", "Le Bambole"], signatures: ["Camaleonda bold channel-tufted modular blocks"] },

  // ── European design ───────────────────────────────────────────
  { brand: "HAY", domain: "hay.com", tagline_hits: ["About A Chair", "Mags", "Pastille"] },
  { brand: "Muuto", domain: "muuto.com", tagline_hits: ["Fiber", "Outline", "Connect"] },
  { brand: "Ferm Living", domain: "fermliving.com" },
  { brand: "Gubi", domain: "gubi.com", tagline_hits: ["Beetle", "Pacha", "Bestlite"] },
  { brand: "Menu", domain: "menu-world.com" },
  { brand: "String Furniture", domain: "stringfurniture.com", tagline_hits: ["String Shelving"], signatures: ["ladder-side wire panels with wall-mounted brackets"] },
  { brand: "Hem", domain: "hem.com" },
  { brand: "Kartell", domain: "kartell.com", tagline_hits: ["Masters", "Louis Ghost", "Componibili"] },
  { brand: "Flos", domain: "flos.com", tagline_hits: ["Arco", "IC Lights", "Taccia"], signatures: ["Arco marble base + long steel arc"] },
  { brand: "Artemide", domain: "artemide.com", tagline_hits: ["Tolomeo", "Nesso"] },
  { brand: "Louis Poulsen", domain: "louispoulsen.com", tagline_hits: ["PH 5", "AJ"], signatures: ["PH 5 tiered reflector layers"] },
  { brand: "Tom Dixon", domain: "tomdixon.net", tagline_hits: ["Beat", "Melt", "Mirror Ball"] },
  { brand: "&Tradition", domain: "andtradition.com", tagline_hits: ["Flowerpot", "Little Petra"] },

  // ── Lighting specialists ──────────────────────────────────────
  { brand: "Circa Lighting / Visual Comfort", domain: "circalighting.com" },
  { brand: "Schoolhouse", domain: "schoolhouse.com" },
  { brand: "Rejuvenation Lighting", domain: "rejuvenation.com" },
  { brand: "Lumens", domain: "lumens.com" },

  // ── Rug / textile specialists ─────────────────────────────────
  { brand: "Ruggable", domain: "ruggable.com" },
  { brand: "Loloi", domain: "loloirugs.com" },
  { brand: "Dash & Albert", domain: "dashandalbert.com" },
  { brand: "Revival", domain: "revivalrugs.com" },
  { brand: "The Rug Company", domain: "therugcompany.com" },
  { brand: "Armadillo & Co", domain: "armadillo-co.com" },

  // ── Budget furniture ──────────────────────────────────────────
  { brand: "Ashley Furniture", domain: "ashleyfurniture.com" },
  { brand: "Bob's Discount Furniture", domain: "mybobs.com" },
  { brand: "Rooms To Go", domain: "roomstogo.com" },
  { brand: "Ethan Allen", domain: "ethanallen.com" },
  { brand: "Living Spaces", domain: "livingspaces.com" },
  { brand: "Kirkland's", domain: "kirklands.com" },

  // ── Curated marketplaces / secondary ──────────────────────────
  { brand: "Chairish", domain: "chairish.com" },
  { brand: "1stDibs", domain: "1stdibs.com" },
  { brand: "Perigold", domain: "perigold.com" },
  { brand: "AptDeco", domain: "aptdeco.com" },

  // ── Modular / storage specialists ─────────────────────────────
  { brand: "Kardiel", domain: "kardiel.com" },
  { brand: "EQ3", domain: "eq3.com" },
  { brand: "Gus Modern", domain: "gusmodern.com" },
  { brand: "Copeland", domain: "copelandfurniture.com" },

  // ── World Market / mid-tier home decor ────────────────────────
  { brand: "World Market", domain: "worldmarket.com" },
  { brand: "Ballard Designs", domain: "ballarddesigns.com" },
  { brand: "Grandin Road", domain: "grandinroad.com" },
  { brand: "Frontgate", domain: "frontgate.com" },
];

/**
 * Read the allow-list, optionally merging in a JSON overrides file at
 * `IDENTIFIABLE_BRANDS_PATH` (useful for hot-patching without a redeploy).
 *
 * The file should contain a JSON array matching `IdentifiableBrand`. Any
 * unparseable entry is logged and skipped — we never throw at module load.
 */
export function getIdentifiableBrands(): IdentifiableBrand[] {
  const extraPath = process.env.IDENTIFIABLE_BRANDS_PATH;
  if (!extraPath) return IDENTIFIABLE_BRANDS;

  try {
    // Lazy-import so edge runtimes that can't use fs don't blow up at load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const raw = fs.readFileSync(extraPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return IDENTIFIABLE_BRANDS;
    const extras = parsed
      .filter((e): e is IdentifiableBrand => !!e && typeof e === "object" && typeof (e as IdentifiableBrand).brand === "string");
    const byName = new Map<string, IdentifiableBrand>();
    for (const b of IDENTIFIABLE_BRANDS) byName.set(b.brand.toLowerCase(), b);
    for (const b of extras) byName.set(b.brand.toLowerCase(), b);
    return Array.from(byName.values());
  } catch {
    return IDENTIFIABLE_BRANDS;
  }
}

/**
 * Confidence floors enforced on the identifier output.
 *  - In-list brands must clear 0.70 to survive.
 *  - Out-of-list brands must clear 0.85 — higher bar because we have less
 *    prior signal and the catalog index won't backstop retrieval.
 */
export const MIN_CONFIDENCE_IN_LIST = 0.7;
export const MIN_CONFIDENCE_OUT_OF_LIST = 0.85;

/** Auto-confirmation threshold — identifications at/above this don't prompt the user. */
export const AUTO_CONFIRM_CONFIDENCE = 0.9;

/** Minimum user-prompt threshold — below this we drop silently (treated as noise). */
export const USER_PROMPT_FLOOR = 0.4;

/**
 * Case-insensitive lookup. Returns the canonical entry if the brand is in the
 * allow-list, or undefined otherwise. Callers can use this to decide which
 * confidence floor to enforce and to fetch canonical retailer domains.
 */
export function lookupBrand(brand: string): IdentifiableBrand | undefined {
  const q = brand.trim().toLowerCase();
  return getIdentifiableBrands().find((b) => b.brand.toLowerCase() === q);
}

/** True iff the brand is in the allow-list (case-insensitive). */
export function isAllowListedBrand(brand: string): boolean {
  return lookupBrand(brand) !== undefined;
}

/**
 * Compact rendering of the allow-list for injection into model prompts.
 * Bounded under ~1.5K tokens so it's cheap to include.
 */
export function formatBrandsForPrompt(limit = 200): string {
  const all = getIdentifiableBrands();
  const lines: string[] = [];
  for (const b of all.slice(0, limit)) {
    const hints = b.tagline_hits?.length ? ` (e.g. ${b.tagline_hits.slice(0, 3).join(", ")})` : "";
    lines.push(`- ${b.brand}${hints}`);
  }
  return lines.join("\n");
}
