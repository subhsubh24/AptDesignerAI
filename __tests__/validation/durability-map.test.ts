import { describe, it, expect } from "vitest";
import {
  lookupDurability,
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
