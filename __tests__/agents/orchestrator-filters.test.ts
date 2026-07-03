import { describe, it, expect } from "vitest";
import {
  extractBackfillKeywords,
  isProactivelyBlockedDomain,
  isLikelyProductUrl,
} from "@/lib/agents/orchestrator";

/**
 * These three pure helpers gate real LLM/extraction spend during agentic
 * product search: isLikelyProductUrl + isProactivelyBlockedDomain drop
 * non-PDP / non-retailer URLs BEFORE any extraction call, and
 * extractBackfillKeywords builds the fallback query when the model's queries
 * underperform. A silent regression in any of them either burns tokens on
 * junk pages or narrows/breaks the search — so pin the real branch behaviour.
 */

describe("extractBackfillKeywords", () => {
  it("returns 'modern' when the design direction is undefined", () => {
    expect(extractBackfillKeywords(undefined)).toBe("modern");
  });

  it("returns 'modern' when there are no materials or palette", () => {
    expect(extractBackfillKeywords({})).toBe("modern");
    expect(extractBackfillKeywords({ recommended_materials: [], recommended_palette: [] })).toBe(
      "modern",
    );
  });

  it("uses the first material, trimmed", () => {
    expect(extractBackfillKeywords({ recommended_materials: ["  oak wood  "] })).toBe("oak wood");
  });

  it("splits the first material on a comma", () => {
    expect(extractBackfillKeywords({ recommended_materials: ["walnut, matte finish"] })).toBe(
      "walnut",
    );
  });

  it("splits the first material on an opening paren", () => {
    expect(extractBackfillKeywords({ recommended_materials: ["oak (rift sawn)"] })).toBe("oak");
  });

  it("strips the hex code (and trailing text) from the first palette entry", () => {
    expect(
      extractBackfillKeywords({ recommended_palette: ["Terracotta (#E2725B) warm tone"] }),
    ).toBe("Terracotta");
  });

  it("joins material + palette when both are present", () => {
    expect(
      extractBackfillKeywords({
        recommended_materials: ["linen"],
        recommended_palette: ["Sage (#9CAF88)"],
      }),
    ).toBe("linen Sage");
  });
});

describe("isProactivelyBlockedDomain", () => {
  it("blocks an exact blocklisted domain", () => {
    expect(isProactivelyBlockedDomain("https://reddit.com/r/furniture")).toBe(true);
    expect(isProactivelyBlockedDomain("https://nytimes.com/2024/best-sofas")).toBe(true);
  });

  it("strips a www. prefix before matching", () => {
    expect(isProactivelyBlockedDomain("https://www.nytimes.com/article")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isProactivelyBlockedDomain("https://NYTimes.COM/x")).toBe(true);
  });

  it("blocks subdomains of a blocklisted host", () => {
    expect(isProactivelyBlockedDomain("https://blog.nytimes.com/x")).toBe(true);
  });

  it("does NOT block a legitimate retailer", () => {
    expect(isProactivelyBlockedDomain("https://www.wayfair.com/product/sofa")).toBe(false);
    expect(isProactivelyBlockedDomain("https://shop.westelm.com/products/sofa")).toBe(false);
  });

  it("does NOT block a retailer that merely ends with a blocked host's suffix without the dot", () => {
    // "notreddit.com" ends with "reddit.com" only if preceded by a dot; the
    // guard uses ("." + blocked), so this must NOT be blocked.
    expect(isProactivelyBlockedDomain("https://notreddit.com/x")).toBe(false);
  });

  it("returns false for an unparseable URL", () => {
    expect(isProactivelyBlockedDomain("not a url")).toBe(false);
  });
});

describe("isLikelyProductUrl", () => {
  it("accepts a clean product path with no blocked patterns", () => {
    expect(isLikelyProductUrl("https://westelm.com/products/mid-century-sofa/")).toBe(true);
  });

  it("accepts a .html product page that is NOT a listicle", () => {
    // .html alone is fine — only .html + a listicle slug is rejected.
    expect(isLikelyProductUrl("https://www.wayfair.com/furniture/pdp/sofa-12345.html")).toBe(true);
  });

  it("rejects a .pdf", () => {
    expect(isLikelyProductUrl("https://example.com/spec-sheet.pdf")).toBe(false);
  });

  it("rejects a .html listicle", () => {
    expect(isLikelyProductUrl("https://example.com/best-sofas-2024.html")).toBe(false);
  });

  it("rejects non-product path segments (blog / collections / reviews)", () => {
    expect(isLikelyProductUrl("https://site.com/blog/sofas")).toBe(false);
    expect(isLikelyProductUrl("https://site.com/collections/living-room")).toBe(false);
    expect(isLikelyProductUrl("https://site.com/reviews/best-couch")).toBe(false);
  });

  it("rejects a date-slug article URL", () => {
    expect(isLikelyProductUrl("https://site.com/2024/03/our-favorite-chairs")).toBe(false);
  });

  it("rejects a listicle slug even without an extension", () => {
    expect(isLikelyProductUrl("https://site.com/ultimate-guide-to-sofas")).toBe(false);
    expect(isLikelyProductUrl("https://site.com/top-10-armchairs")).toBe(false);
  });

  it("does NOT reject a product path containing 'products' (not the 'posts' pattern)", () => {
    expect(isLikelyProductUrl("https://retailer.com/products/oak-dining-table")).toBe(true);
  });
});
