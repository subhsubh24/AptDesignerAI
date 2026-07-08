import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  IDENTIFIABLE_BRANDS,
  getIdentifiableBrands,
  lookupBrand,
  isAllowListedBrand,
  formatBrandsForPrompt,
  type IdentifiableBrand,
} from "@/lib/constants/identifiable-brands";

// getIdentifiableBrands() optionally merges a JSON overrides file pointed at by
// IDENTIFIABLE_BRANDS_PATH. It must NEVER throw at read time — a missing file,
// bad JSON, a non-array payload, or malformed entries all fall back to the base
// list. These helpers drive a REAL temp file through the real fs read path
// (deterministic filename, no randomness) so the parse/merge/dedup/filter
// branches are exercised against the actual code, not a mock.
const OVERRIDES_PATH = path.join(os.tmpdir(), "aptdesigner-identifiable-brands-test.json");

function withOverridesFile(contents: string): void {
  fs.writeFileSync(OVERRIDES_PATH, contents, "utf8");
  process.env.IDENTIFIABLE_BRANDS_PATH = OVERRIDES_PATH;
}

function withOverridesPath(p: string): void {
  process.env.IDENTIFIABLE_BRANDS_PATH = p;
}

afterEach(() => {
  delete process.env.IDENTIFIABLE_BRANDS_PATH;
  if (fs.existsSync(OVERRIDES_PATH)) fs.unlinkSync(OVERRIDES_PATH);
});

describe("getIdentifiableBrands", () => {
  it("returns the base allow-list verbatim when no overrides path is set", () => {
    delete process.env.IDENTIFIABLE_BRANDS_PATH;
    const brands = getIdentifiableBrands();
    // Same reference as the exported constant — no copy, no merge work.
    expect(brands).toBe(IDENTIFIABLE_BRANDS);
    expect(brands.some((b) => b.brand === "IKEA")).toBe(true);
  });

  it("appends a genuinely new override brand to the base list", () => {
    const newBrand: IdentifiableBrand = { brand: "Test Studio", domain: "teststudio.example" };
    withOverridesFile(JSON.stringify([newBrand]));

    const brands = getIdentifiableBrands();
    expect(brands).toHaveLength(IDENTIFIABLE_BRANDS.length + 1);
    // New brands merge in at the end (Map insertion order).
    expect(brands[brands.length - 1]).toEqual(newBrand);
    expect(lookupBrand("Test Studio")?.domain).toBe("teststudio.example");
  });

  it("overrides an existing brand case-insensitively without changing the count", () => {
    // Same brand name, different case + new signatures — should replace, not add.
    withOverridesFile(
      JSON.stringify([{ brand: "ikea", domain: "ikea.example", signatures: ["patched"] }]),
    );

    const brands = getIdentifiableBrands();
    expect(brands).toHaveLength(IDENTIFIABLE_BRANDS.length);
    const ikea = brands.find((b) => b.brand.toLowerCase() === "ikea");
    expect(ikea?.domain).toBe("ikea.example");
    expect(ikea?.signatures).toEqual(["patched"]);
  });

  it("drops malformed entries (null, non-object, missing brand) but keeps valid ones", () => {
    withOverridesFile(
      JSON.stringify([
        null,
        "not-an-object",
        { domain: "no-brand.example" }, // missing required `brand`
        { brand: 42 }, // brand not a string
        { brand: "Valid Co" }, // the only survivor
      ]),
    );

    const brands = getIdentifiableBrands();
    expect(brands).toHaveLength(IDENTIFIABLE_BRANDS.length + 1);
    expect(isAllowListedBrand("Valid Co")).toBe(true);
  });

  it("falls back to the base list when the JSON payload is not an array", () => {
    withOverridesFile(JSON.stringify({ brand: "Object Not Array" }));
    expect(getIdentifiableBrands()).toBe(IDENTIFIABLE_BRANDS);
  });

  it("falls back to the base list on unparseable JSON (never throws)", () => {
    withOverridesFile("{ this is : not valid json ]");
    expect(getIdentifiableBrands()).toBe(IDENTIFIABLE_BRANDS);
  });

  it("falls back to the base list when the overrides file does not exist", () => {
    withOverridesPath(path.join(os.tmpdir(), "aptdesigner-does-not-exist-xyz.json"));
    expect(getIdentifiableBrands()).toBe(IDENTIFIABLE_BRANDS);
  });
});

describe("lookupBrand", () => {
  it("finds a brand by its canonical name", () => {
    expect(lookupBrand("IKEA")?.brand).toBe("IKEA");
  });

  it("is case-insensitive", () => {
    expect(lookupBrand("wEsT eLm")?.brand).toBe("West Elm");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(lookupBrand("   CB2   ")?.brand).toBe("CB2");
  });

  it("returns undefined for an unknown brand", () => {
    expect(lookupBrand("Definitely Not A Real Brand")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(lookupBrand("")).toBeUndefined();
  });
});

describe("isAllowListedBrand", () => {
  it("is true for an allow-listed brand regardless of case/whitespace", () => {
    expect(isAllowListedBrand("IKEA")).toBe(true);
    expect(isAllowListedBrand("  ikea  ")).toBe(true);
  });

  it("is false for a brand not on the list", () => {
    expect(isAllowListedBrand("Acme Sofas")).toBe(false);
  });
});

describe("formatBrandsForPrompt", () => {
  it("renders one bullet line per brand", () => {
    const lines = formatBrandsForPrompt().split("\n");
    // The base list (93 brands) is under the default 200 cap, so every brand
    // renders. If it ever grows past the cap this assertion catches the trim.
    expect(lines).toHaveLength(Math.min(200, IDENTIFIABLE_BRANDS.length));
    expect(lines.every((l) => l.startsWith("- "))).toBe(true);
  });

  it("appends up to three tagline hints as an example hint", () => {
    const line = formatBrandsForPrompt().split("\n").find((l) => l.startsWith("- IKEA"));
    // IKEA has 10 tagline_hits; only the first three are shown.
    expect(line).toBe("- IKEA (e.g. KIVIK, POÄNG, EKTORP)");
    expect(line).not.toContain("STOCKSUND");
  });

  it("omits the hint clause for brands with no tagline hits", () => {
    const line = formatBrandsForPrompt().split("\n").find((l) => l.startsWith("- Wayfair"));
    expect(line).toBe("- Wayfair");
  });

  it("respects the limit and never exceeds the available brands", () => {
    expect(formatBrandsForPrompt(1)).toBe("- IKEA (e.g. KIVIK, POÄNG, EKTORP)");
    expect(formatBrandsForPrompt(0)).toBe("");
    const all = formatBrandsForPrompt(10_000).split("\n");
    expect(all).toHaveLength(IDENTIFIABLE_BRANDS.length);
  });
});
