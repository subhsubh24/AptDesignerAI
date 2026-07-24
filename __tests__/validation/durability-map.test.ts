import { describe, it, expect } from "vitest";
import {
  lookupDurability,
  lookupCategoryDurability,
  aggregateDurability,
  resolveLifestyleFlags,
  scoreLifestyleFit,
} from "@/lib/validation/durability-map";

describe("lookupDurability", () => {
  it("returns a non-null vector for common materials", () => {
    expect(lookupDurability("linen")).not.toBeNull();
    expect(lookupDurability("leather")).not.toBeNull();
    expect(lookupDurability("wool")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(lookupDurability("LINEN")).toEqual(lookupDurability("linen"));
  });

  it("returns null for unknown materials", () => {
    expect(lookupDurability("unobtainium")).toBeNull();
  });
});

describe("lookupCategoryDurability", () => {
  // This is the fallback path aggregateDurability takes when no material string
  // resolves (e.g. a product with an empty/unmapped materials array) — a wrong
  // vector here silently skews lifestyle-fit scoring, so each branch is pinned.

  it("matches an exact category key regardless of spacing/hyphen/case (normalize + [\\s-]+->_)", () => {
    const canonical = lookupCategoryDurability("dining_table");
    expect(canonical).not.toBeNull();
    // Space- and hyphen-separated, mixed-case variants must normalize to the
    // same underscore key. If the `[\s-]+ -> _` rewrite is dropped, "dining
    // table" no longer matches any key and falls through to null.
    expect(lookupCategoryDurability("dining table")).toEqual(canonical);
    expect(lookupCategoryDurability("Dining-Table")).toEqual(canonical);
  });

  it("falls back to a substring match when the input CONTAINS a known key (key.includes(k))", () => {
    // "sectional sofa" -> "sectional_sofa": no exact key, but it contains "sofa".
    expect(lookupCategoryDurability("sectional sofa")).toEqual(
      lookupCategoryDurability("sofa"),
    );
  });

  it("falls back to a substring match when a known key CONTAINS the input (k.includes(key))", () => {
    // "chair" is not a key, but "accent_chair" contains it (first such key).
    expect(lookupCategoryDurability("chair")).toEqual(
      lookupCategoryDurability("accent_chair"),
    );
  });

  it("returns null for an unknown category (no exact, no substring overlap)", () => {
    expect(lookupCategoryDurability("spaceship")).toBeNull();
  });
});

describe("aggregateDurability", () => {
  it("weighted blend includes worst material (30%)", () => {
    // Silk is one of the weakest materials; blending with leather should still drag min.
    const blended = aggregateDurability(["leather", "silk"]);
    const leatherAlone = aggregateDurability(["leather"]);
    expect(blended.pet_friendly).toBeLessThan(leatherAlone.pet_friendly);
  });

  it("falls back to category when no materials resolve", () => {
    const result = aggregateDurability(["unknown_material"], "sofa");
    expect(result).toBeDefined();
    // fallback returns SOMETHING (either neutral or category default)
    expect(result.pet_friendly).toBeGreaterThanOrEqual(0);
    expect(result.pet_friendly).toBeLessThanOrEqual(1);
  });
});

describe("resolveLifestyleFlags", () => {
  it("detects pets and kids from positive strings", () => {
    const flags = resolveLifestyleFlags({ pets: "2 cats", kids: "toddler" });
    expect(flags.has_pets).toBe(true);
    expect(flags.has_kids).toBe(true);
    expect(flags.high_traffic).toBe(true);
  });

  it("treats 'none' and 'no' as negative", () => {
    const flags = resolveLifestyleFlags({ pets: "none", kids: "no" });
    expect(flags.has_pets).toBe(false);
    expect(flags.has_kids).toBe(false);
  });

  it("returns all-false for undefined lifestyle", () => {
    const flags = resolveLifestyleFlags(undefined);
    expect(flags.has_pets).toBe(false);
    expect(flags.has_kids).toBe(false);
    expect(flags.entertains).toBe(false);
    expect(flags.high_traffic).toBe(false);
    expect(flags.works_from_home).toBe(false);
  });

  it("infers high_traffic from durability signals in free-text notes", () => {
    // The notes field is scanned for wear-relevant keywords even when no explicit
    // pets/kids/hosting flag is set — a user who writes "the dog is always shedding"
    // should get durability-biased recommendations. Mutation guard on the notes regex.
    const shedding = resolveLifestyleFlags({ notes: "our dog is always shedding" });
    expect(shedding.high_traffic).toBe(true);
    // pets/kids/entertains stay false — only the derived high_traffic flips.
    expect(shedding.has_pets).toBe(false);

    const scratch = resolveLifestyleFlags({ notes: "the cat likes to scratch the couch" });
    expect(scratch.high_traffic).toBe(true);

    const calm = resolveLifestyleFlags({ notes: "a quiet minimalist home" });
    expect(calm.high_traffic).toBe(false);
  });

  it("treats work-from-home as high_traffic (daily wear)", () => {
    const flags = resolveLifestyleFlags({ work_from_home: true });
    expect(flags.works_from_home).toBe(true);
    expect(flags.high_traffic).toBe(true);
  });

  it("detects entertaining from a positive hosting string and ignores negatives", () => {
    const hosts = resolveLifestyleFlags({ hosting: "dinner parties monthly" });
    expect(hosts.entertains).toBe(true);
    expect(hosts.high_traffic).toBe(true);

    const rarely = resolveLifestyleFlags({ hosting: "never" });
    expect(rarely.entertains).toBe(false);
  });
});

describe("scoreLifestyleFit", () => {
  it("flags white linen + shedding pets as low pet-friendliness", () => {
    const flags = resolveLifestyleFlags({ pets: "shedding dog" });
    const result = scoreLifestyleFit(
      { category: "sofa", materials: ["linen"], colors: ["white"] },
      flags,
    );
    expect(result.score).toBeLessThan(0.5);
    expect(result.issues.some((i) => /pet/i.test(i))).toBe(true);
  });

  it("scores leather sofa high for pet owners", () => {
    const flags = resolveLifestyleFlags({ pets: "2 dogs" });
    const result = scoreLifestyleFit(
      { category: "sofa", materials: ["leather"] },
      flags,
    );
    expect(result.score).toBeGreaterThan(0.6);
  });

  it("does not penalize any material when no lifestyle flags are set", () => {
    const flags = resolveLifestyleFlags(undefined);
    const result = scoreLifestyleFit(
      { category: "sofa", materials: ["silk"] },
      flags,
    );
    // No flags → score should reflect baseline axes only (no low-issue flagging)
    expect(result.issues.length).toBe(0);
  });
});
