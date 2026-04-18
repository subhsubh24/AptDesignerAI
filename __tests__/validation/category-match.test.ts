import { describe, it, expect } from "vitest";
import { productMatchesCategory } from "@/lib/validation/category-match";

describe("productMatchesCategory", () => {
  it("rejects a lint roller for a vase search", () => {
    const result = productMatchesCategory("vase", "other", "OXO Good Grips Lint Roller");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lint roller|disqualifying/i);
  });

  it("rejects a gift card for any category", () => {
    const result = productMatchesCategory("coffee_table", "other", "West Elm Gift Card");
    expect(result.ok).toBe(false);
  });

  it("accepts a coffee table for a coffee_table search", () => {
    const result = productMatchesCategory("coffee_table", "coffee_table", "Walnut Round Coffee Table");
    expect(result.ok).toBe(true);
  });

  it("accepts an end table for a side_table search via alias", () => {
    const result = productMatchesCategory("side_table", "other", "Mid-Century End Table in Oak");
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/end table/i);
  });

  it("accepts a sectional for a sofa search via alias", () => {
    const result = productMatchesCategory("sofa", "sectional", "Modular Sectional in Linen");
    expect(result.ok).toBe(true);
  });

  it("rejects when extractor returns 'other' and no title keywords match", () => {
    const result = productMatchesCategory("vase", "other", "Assembly Service for Sofa");
    expect(result.ok).toBe(false);
  });

  it("rejects when extractor returns a clearly different category", () => {
    const result = productMatchesCategory("vase", "rug", "Persian Area Rug 8x10");
    expect(result.ok).toBe(false);
  });

  it("accepts an armchair for accent_chair search", () => {
    const result = productMatchesCategory("accent_chair", "accent_chair", "Performance Velvet Armchair");
    expect(result.ok).toBe(true);
  });

  it("accepts a pendant for pendant_light search", () => {
    const result = productMatchesCategory("pendant_light", "pendant_light", "Brass Pendant Light");
    expect(result.ok).toBe(true);
  });

  it("accepts a throw pillow for throw_pillow search", () => {
    const result = productMatchesCategory("throw_pillow", "other", "Linen Accent Pillow 18x18");
    expect(result.ok).toBe(true);
  });

  it("allows empty expected category to pass (no check)", () => {
    const result = productMatchesCategory("", "other", "Some Random Title");
    expect(result.ok).toBe(true);
  });

  it("rejects a cleaning kit for furniture search", () => {
    const result = productMatchesCategory("dining_table", "other", "Wood Furniture Cleaner Kit");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cleaner|cleaning kit/i);
  });
});
