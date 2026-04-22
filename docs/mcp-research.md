# MCP Integration Research — Retail & Furniture (April 2026)

**Status:** Research only. No integrations implemented.

This doc captures what MCP servers exist that could augment or replace
the current product discovery + extraction pipeline (Google Search
grounding → URL Context extraction). Recommendations at the bottom.

---

## TL;DR

| Layer | Current | Recommended MCP | Priority |
|---|---|---|---|
| Product discovery | Google Search grounding (Gemini) | **SerpApi MCP** (Google Shopping engine) | High |
| DTC catalog coverage | (none — relies on grounding finding store pages) | **Shopify Catalog MCP** (free, official) | High |
| Hard-to-scrape PDP extraction | Gemini URL Context (often blocked on IKEA/Wayfair/RH) | **Bright Data MCP** | Medium |
| Visual product search | (none) | Custom wrapper around **Google Vision Product Search** | Low (build only when needed) |
| Furniture-retailer-specific | (none — gap) | None exists | n/a |

---

## 1. Furniture / Home Retailer MCP Servers

**Verdict: nothing useful exists.** No MCP servers from IKEA, West Elm,
CB2, Crate & Barrel, Wayfair, Article, AllModern, Pottery Barn, RH, or
Anthropologie Home as of April 2026. None on the official MCP registry,
none in active community repos.

The one tangentially relevant find — `LuisEnVilla "Furniture Designer"
MCP` on PulseMCP — appears to be a layout/design tool, not a
product-catalog server. Not useful.

**Action:** stick with Google Search grounding for these specific
brands. Re-check quarterly.

---

## 2. General Product Search / E-Commerce MCP Servers

### SerpApi MCP — recommended replacement for Google Search grounding
- **Repo:** https://github.com/serpapi/serpapi-mcp
- **Status:** Official, actively maintained.
- **Auth:** API key (paid).
- **What it exposes:** A single `Search` tool covering Google Shopping,
  Google, Bing, eBay, Walmart, etc. Returns structured fields (title,
  price, product_id, link, rating, image, source) instead of unstructured
  SERP HTML.
- **Why it matters:** drops the parse step from our pipeline. The
  `shopping-researcher.ts` agent currently asks Gemini to find product
  pages and parse them into JSON; with SerpApi it gets structured
  shopping results directly, with multi-engine fallback for free.
- **Trade-off:** paid (per-search billing), and SerpApi's results are
  derived from Google so they're not "more accurate" — just structured.

### Shopify Storefront MCP / Catalog MCP — recommended additional source
- **Storefront docs:** https://shopify.dev/docs/apps/build/storefront-mcp
- **Catalog docs:** https://shopify.dev/docs/agents/catalog/mcp
- **Status:** Official. Catalog MCP launched summer 2025.
- **Auth:** Storefront is free per-store, public read. Catalog requires
  Shopify Partner credentials.
- **What it exposes:** Catalog MCP gives global aggregated catalog
  search across all eligible Shopify merchants. Storefront MCP is
  per-store.
- **Why it matters:** many design-DTC home brands (Burrow, Floyd,
  Industry West, Lulu and Georgia, Parachute, etc.) run on Shopify and
  are reachable via one endpoint. Our current pipeline likely
  under-indexes these because Google Search prioritizes the big-box
  retailers.
- **Trade-off:** doesn't cover non-Shopify retailers (IKEA, RH, West
  Elm, Wayfair, etc.).

### Apify scrapers (Amazon, Etsy, eBay) — situational
- **Amazon:** https://apify.com/datapilot/amazon-product-scraper/api/mcp
- **Etsy:** https://apify.com/h4sh/etsy-scraper/api/mcp
- **eBay:** https://apify.com/getdataforme/ebay-scraper/api/mcp
- **Status:** Active. Apify token auth.
- **Usefulness:** Etsy is genuinely strong for handmade/vintage decor
  (medium-high). Amazon has lots of furniture but design-quality is poor
  (medium). eBay is mostly vintage (low-medium).

### Other
- `rigwild/mcp-server-amazon` — unofficial Amazon MCP with search +
  purchase. Smaller community project.
- Multiple Google Images / Bing search MCP wrappers exist but they're
  thin shells around SerpAPI.

---

## 3. Inventory / Pricing Aggregators

### Bright Data MCP — recommended for hard-to-scrape PDPs
- **Repo:** https://github.com/brightdata/brightdata-mcp
- **Status:** Active, 1.9k+ stars, API key auth.
- **What it exposes:** 60+ tools, including structured Amazon extractors
  plus generic `scrape_as_markdown` and `scrape_as_html` for arbitrary
  URLs. Has anti-bot infrastructure that Gemini's URL Context lacks.
- **Why it matters:** could replace `lib/agents/product-extractor.ts`'s
  URL Context call on retailers that block automated access (IKEA,
  Wayfair, RH frequently 403 the URL Context bot). Better extraction
  success rate → fewer wasted screening tokens.
- **Trade-off:** paid; latency higher than URL Context.

### Algolia MCP — not useful for us
- **Repo:** https://github.com/algolia/mcp
- Only useful if we WERE the retailer indexing our catalog. Skip.

---

## 4. Image-Based Visual Product Search

### Inspire MCP — pilot candidate
- **Listing:** https://www.pulsemcp.com/servers/tech-inspire-image-search
- Text-to-similar-image search with pagination. Marketed for e-commerce
  visual search.
- **Usefulness:** medium. Worth a pilot if we want "find products that
  look like this room photo."

### Google Vision Product Search — best fit, requires custom wrapper
- **Docs:** https://docs.cloud.google.com/vision/product-search/docs/searching
- Specifically built for "visually similar product" queries against a
  custom catalog. We'd need to:
  1. Index our extracted products into a Vision Product Search catalog
  2. Build a thin MCP wrapper exposing the search call as a tool
- **Why this beats Inspire:** Vision Product Search supports custom
  catalogs (so we'd be matching against our own canonicalized product
  set, not the open web). Better signal-to-noise ratio.

---

## 5. Domain-Specific (Houzz, Pinterest, Material Bank, etc.)

**Verdict: nothing exists.** No MCP servers for Houzz, Pinterest,
Material Bank, Behance, or Interior Design Foundation. Pinterest in
particular would be valuable for inspiration grounding (it has a public
API but no community MCP wrapper).

This is a real gap. If we wanted to invest engineering effort into
building one of these, Pinterest's API has the most reach for design
inspiration and would be the highest leverage to wrap.

---

## Concrete Recommendations

In order of impact:

### 1. Replace Google Search grounding for product discovery → SerpApi MCP
- **Effort:** Small — wrap the SerpApi tool call where
  `shopping-researcher.ts` currently calls `geminiProvider.chat({tools:
  [{googleSearch: {}}]})`.
- **Gain:** Structured product fields out of the box (title, price,
  image, rating). Drops the JSON parsing step. Multi-engine fallback.
- **Risk:** Adds a paid dependency. Quality is similar (Google data
  source) but format is much cleaner.

### 2. Add Shopify Catalog MCP as a parallel source
- **Effort:** Small — additional source in the search brief phase.
- **Gain:** Better DTC home brand coverage that Google Search currently
  misses.
- **Risk:** None — free, official, additive.

### 3. Use Bright Data MCP for blocked retailer PDPs
- **Effort:** Medium — fallback path in `product-extractor.ts` when
  URL Context returns 403/sentinel.
- **Gain:** Higher extraction success on IKEA, Wayfair, RH.
- **Risk:** Paid. Adds latency.

### 4. Build custom Google Vision Product Search wrapper
- **Effort:** Larger — requires Vision API setup, catalog indexing
  pipeline, and MCP server implementation.
- **Gain:** True visual search "find products like this room photo."
- **Risk:** Build complexity. Defer until clear product need.

### 5. Don't wait for retailer-native MCP
- IKEA/West Elm/Wayfair/RH/CB2 have no MCP servers and no public
  roadmap. Keep Gemini-based extraction as the fallback.

---

## Re-check cadence

Re-run this research **quarterly**. The MCP ecosystem is moving fast and
furniture-retailer servers may appear at any point. Set a calendar
reminder for July 2026.
