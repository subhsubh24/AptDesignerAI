/**
 * Live eval tests for the product-DISCOVERY pipeline stages: web search,
 * relevance screening, and structured-data extraction.
 *
 * `sourcing.eval.test.ts` only exercises scoreProduct() — relevance scoring
 * of products that are already found. This file drives the stages upstream
 * of that: shopping-researcher.searchProducts() (real Tavily web search),
 * shopping-researcher.quickScreenCandidates() (live Gemini relevance
 * screen), and product-extractor.extractFromUrlBatch() (real retailer page
 * fetch/extract + live Gemini structured extraction) end to end for a real
 * gold-case room. A regression here means search stops finding real
 * retailer products, or extraction stops holding up against real retailer
 * page structures — neither of which the mocked unit tests for these
 * modules can catch.
 *
 * Assertions are PLAUSIBILITY bounds (non-empty results, right general
 * category, sane price band, valid URL shape), not exact-match — real
 * retailer inventory and search ranking drift over time, so pinning exact
 * products would make this eval flake on inventory changes rather than
 * catch real regressions.
 *
 * Gates behind RUN_EVALS=1 — never fires in the standard `npm test` run
 * (which has no Gemini/Tavily key). Run with:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/product-discovery.eval.test.ts
 * or via the project shorthand:
 *   npm run eval
 *
 * Timeout: 4 minutes — this chains a live Tavily search, a live Gemini
 * quick-screen call, a live Tavily extract, and a live Gemini extraction
 * call, so it's slower than the single-call evals elsewhere in this dir.
 */

import { describe, it, expect } from "vitest";
import { loadGoldCases, evalsEnabled } from "../runner";
import {
  searchProducts,
  deduplicateCandidates,
  quickScreenCandidates,
} from "@/lib/agents/shopping-researcher";
import { extractFromUrlBatch } from "@/lib/agents/product-extractor";
import type { DesignDirection } from "@/lib/types/database";

const EVAL_TIMEOUT_MS = 4 * 60 * 1000;

// Category-ish terms that count as a plausible match for a "sofa" search —
// real retailer titles/categories use several near-synonyms for the same
// product type, and this is a plausibility check, not an exact-match one.
const SOFA_CATEGORY_TERMS = ["sofa", "couch", "sectional", "loveseat", "settee"];

// A sane real-world furniture price band. Values outside this almost always
// indicate a parts/accessory page, a bundle, or an extraction failure
// (e.g. picking up a shipping fee or a "$0" placeholder) rather than a real
// sofa listing.
const MIN_PLAUSIBLE_PRICE = 50;
const MAX_PLAUSIBLE_PRICE = 15000;

describe("product-discovery live evals — run with RUN_EVALS=1", () => {
  it.skipIf(!evalsEnabled())(
    "living-room-warm-sofa: search -> screen -> extract finds a real, plausible sofa listing",
    async () => {
      const cases = loadGoldCases();
      const gold = cases.find((c) => c.id === "living-room-warm-sofa");
      expect(gold, "living-room-warm-sofa fixture missing").toBeTruthy();
      if (!gold) return;

      const designDirection: DesignDirection = {
        recommended_palette: ["warm beige", "cream", "warm white", "natural oak"],
        recommended_materials: ["linen", "oak", "walnut", "natural fiber"],
        recommended_textures: ["textured weave", "matte"],
        recommended_furniture_types: ["sofa", "coffee table", "area rug"],
        style_notes:
          "Warm Scandinavian. Neutral palette with natural wood accents, clean lines, textured fabrics.",
      };

      // ── Stage 1: real web search (Tavily, no LLM) ──────────────────
      const searchResult = await searchProducts(
        "warm scandinavian linen sofa",
        10,
        "balanced",
        "sofa",
      );

      expect(
        searchResult.success,
        `searchProducts failed: ${searchResult.error ?? "unknown"}`,
      ).toBe(true);
      expect(
        searchResult.data,
        "searchProducts returned success:true but data was undefined",
      ).toBeDefined();
      if (!searchResult.data) return;

      expect(
        searchResult.data.length,
        "Live sofa search returned zero candidates — search is completely broken " +
          "or the domain allowlist has drifted from what retailers actually serve.",
      ).toBeGreaterThan(0);

      const deduped = deduplicateCandidates(searchResult.data);

      // ── Stage 2: live relevance screen (Gemini quick_screen) ───────
      const screenResult = await quickScreenCandidates(
        deduped,
        "sofa",
        "balanced",
        ["warm Scandinavian living room", "linen or natural fabric", "wood legs"],
        designDirection,
      );

      expect(
        screenResult.success,
        `quickScreenCandidates failed: ${screenResult.error ?? "unknown"}`,
      ).toBe(true);
      expect(
        screenResult.data,
        "quickScreenCandidates returned success:true but data was undefined",
      ).toBeDefined();
      if (!screenResult.data) return;

      expect(
        screenResult.data.length,
        `Quick-screen passed zero of ${deduped.length} deduped candidates for a plain ` +
          `"sofa" search — either the screener regressed to rejecting everything, or the ` +
          `search stage upstream stopped returning real product pages.`,
      ).toBeGreaterThan(0);

      // ── Stage 3: real page fetch + live extraction (Gemini extraction) ──
      const toExtract = screenResult.data.slice(0, 3);
      const preExtracted = new Map<string, string>();
      for (const c of toExtract) {
        if (c.rawContent) preExtracted.set(c.url, c.rawContent);
      }

      const extractionResults = await extractFromUrlBatch(
        toExtract.map((c) => c.url),
        "sofa",
        undefined,
        preExtracted,
      );

      const successes = [...extractionResults.entries()].filter(
        ([, r]) => r.success && r.data,
      );

      expect(
        successes.length,
        `Extraction failed for all ${toExtract.length} screened URLs: ` +
          JSON.stringify(
            [...extractionResults.entries()].map(([url, r]) => ({
              url,
              error: r.success ? undefined : r.error,
            })),
          ),
      ).toBeGreaterThan(0);

      // ── Plausibility checks on at least one successful extraction ──
      let sawPlausibleCategory = false;
      let sawPlausiblePrice = false;

      for (const [url, result] of successes) {
        // Valid retailer/product URL shape.
        expect(() => new URL(url), `Extracted URL is not a valid URL: ${url}`).not.toThrow();
        const parsed = new URL(url);
        expect(
          ["http:", "https:"].includes(parsed.protocol),
          `Extracted URL has a non-http(s) protocol: ${url}`,
        ).toBe(true);
        expect(
          parsed.hostname.includes("."),
          `Extracted URL has an implausible hostname: ${url}`,
        ).toBe(true);

        const product = result.data!;

        const categoryText = `${product.category ?? ""} ${product.title ?? ""}`.toLowerCase();
        if (SOFA_CATEGORY_TERMS.some((term) => categoryText.includes(term))) {
          sawPlausibleCategory = true;
        }

        if (typeof product.price === "number") {
          if (
            product.price >= MIN_PLAUSIBLE_PRICE &&
            product.price <= MAX_PLAUSIBLE_PRICE
          ) {
            sawPlausiblePrice = true;
          }
        }
      }

      expect(
        sawPlausibleCategory,
        `None of the ${successes.length} extracted products' category/title matched a sofa-ish ` +
          `term (${SOFA_CATEGORY_TERMS.join(", ")}) — extraction may be pulling the wrong product ` +
          `off multi-item retailer pages. Extracted: ` +
          JSON.stringify(successes.map(([, r]) => ({ title: r.data?.title, category: r.data?.category }))),
      ).toBe(true);

      expect(
        sawPlausiblePrice,
        `None of the ${successes.length} extracted products had a price in the plausible ` +
          `$${MIN_PLAUSIBLE_PRICE}-$${MAX_PLAUSIBLE_PRICE} sofa band — extraction may be picking ` +
          `up $0, a shipping fee, or a wildly wrong figure. Extracted: ` +
          JSON.stringify(successes.map(([, r]) => ({ title: r.data?.title, price: r.data?.price }))),
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );
});
