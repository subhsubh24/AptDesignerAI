import { describe, it, expect } from "vitest";
import {
  initializeSaturation,
  updateSaturation,
  wouldExceedHardCap,
  computeDirectionModifier,
  computeAdaptiveMultiplier,
  formatSaturationForPrompt,
} from "@/lib/validation/saturation-math";
import type { ActionItem } from "@/lib/types/database";

function makeItem(category: string, action = ""): ActionItem {
  return { category, action, priority: 3, reasoning: "" };
}

describe("computeDirectionModifier", () => {
  it("returns 1.5 for Maximalist", () => {
    expect(computeDirectionModifier("Maximalist")).toBeCloseTo(1.5);
  });

  it("returns ≤ 0.75 for Japandi", () => {
    expect(computeDirectionModifier("Japandi")).toBeLessThanOrEqual(0.75);
  });

  it("returns ≤ 0.75 for Scandinavian", () => {
    expect(computeDirectionModifier("Scandinavian")).toBeLessThanOrEqual(0.75);
  });

  it("returns 1.0 for Contemporary", () => {
    expect(computeDirectionModifier("Contemporary")).toBeCloseTo(1.0);
  });

  it("returns 1.0 for null/undefined", () => {
    expect(computeDirectionModifier(null)).toBeCloseTo(1.0);
    expect(computeDirectionModifier(undefined)).toBeCloseTo(1.0);
  });

  it("handles DesignDirection object with style field", () => {
    const dir = { style: "Bohemian", recommended_palette: [] } as unknown as import("@/lib/types/database").DesignDirection;
    expect(computeDirectionModifier(dir)).toBeGreaterThan(1.3);
  });
});

describe("initializeSaturation", () => {
  it("builds correct caps for 250 sqft living room with Bohemian direction", () => {
    const items: ActionItem[] = [
      makeItem("sofa"),
      makeItem("area_rug"),
      makeItem("coffee_table"),
      makeItem("floor_lamp"),
    ];
    const profile = initializeSaturation(items, { type: "living_room", sqft: 250 }, "Bohemian");

    // Bohemian modifier ~1.45 — total_items.hard_cap should be well above 15
    expect(profile.total_items.hard_cap).toBeGreaterThan(15);
    // Current should match seeded items
    expect(profile.total_items.current).toBe(4);
    expect(profile.direction_modifier).toBeGreaterThan(1.3);
    expect(profile.room_sqft).toBe(250);
  });

  it("uses 250 sqft default when sqft is not provided", () => {
    const profile = initializeSaturation([], { type: "bedroom" }, null);
    expect(profile.room_sqft).toBe(250);
  });

  it("seeds per_category counts from existing items", () => {
    const items: ActionItem[] = [
      makeItem("plant"), makeItem("plant"), makeItem("wall_art"),
    ];
    const profile = initializeSaturation(items, { sqft: 200 }, null);
    expect(profile.per_category["plant"]?.current).toBe(2);
    expect(profile.per_category["wall_art"]?.current).toBe(1);
  });

  it("Japandi direction produces tighter hard caps than Bohemian", () => {
    const items: ActionItem[] = [];
    const japandi = initializeSaturation(items, { sqft: 250 }, "Japandi");
    const bohemian = initializeSaturation(items, { sqft: 250 }, "Bohemian");
    expect(japandi.total_items.hard_cap).toBeLessThan(bohemian.total_items.hard_cap);
  });
});

describe("wouldExceedHardCap", () => {
  it("allows additions when under caps", () => {
    const profile = initializeSaturation([], { sqft: 300 }, "Contemporary");
    const result = wouldExceedHardCap(profile, { category: "plant" });
    expect(result).toBeNull();
  });

  it("rejects when per-category is at hard cap", () => {
    // Seed with max plants
    const sqft = 120; // small room: floor(120/60)=2 plants max at modifier 1.0
    const items = [makeItem("plant"), makeItem("plant")];
    const profile = initializeSaturation(items, { sqft }, "Contemporary");
    const result = wouldExceedHardCap(profile, { category: "plant" });
    expect(result).not.toBeNull();
    expect(result).toContain("plant");
  });

  it("rejects when total_items is at hard cap", () => {
    // Fill a tiny room
    const sqft = 80; // floor(80/10)+5 = 13 total hard cap at modifier 1.0
    const items = Array.from({ length: 13 }, (_, i) => makeItem(`item_${i}`));
    const profile = initializeSaturation(items, { sqft }, null);
    const result = wouldExceedHardCap(profile, { category: "vase" });
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain("maximum");
  });

  it("rejects when focal points are at hard cap (3)", () => {
    const items = [
      makeItem("wall_art"),
      makeItem("sculpture"),
      makeItem("tall_plant"),
    ];
    const profile = initializeSaturation(items, { sqft: 300 }, null);
    const result = wouldExceedHardCap(profile, { category: "wall_art_large" });
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain("focal");
  });
});

describe("updateSaturation", () => {
  it("increments total_items and per_category", () => {
    const profile = initializeSaturation([], { sqft: 250 }, null);
    const updated = updateSaturation(profile, makeItem("candles"));
    expect(updated.total_items.current).toBe(1);
    expect(updated.per_category["candles"]?.current).toBe(1);
  });

  it("is pure — does not mutate original profile", () => {
    const original = initializeSaturation([makeItem("plant")], { sqft: 250 }, null);
    const originalCount = original.total_items.current;
    updateSaturation(original, makeItem("candles"));
    expect(original.total_items.current).toBe(originalCount);
  });

  it("increments small_decor_count for candles", () => {
    const profile = initializeSaturation([], { sqft: 250 }, null);
    const updated = updateSaturation(profile, makeItem("candles"));
    expect(updated.small_decor_count.current).toBe(1);
  });

  it("increments focal_points for wall_art", () => {
    const profile = initializeSaturation([], { sqft: 250 }, null);
    const updated = updateSaturation(profile, makeItem("wall_art"));
    expect(updated.focal_points.current).toBe(1);
  });
});

describe("formatSaturationForPrompt", () => {
  it("returns a string with ASCII bars for all dimensions", () => {
    const items = [makeItem("sofa"), makeItem("plant"), makeItem("candles")];
    const profile = initializeSaturation(items, { sqft: 250 }, "Contemporary");
    const output = formatSaturationForPrompt(profile);
    expect(typeof output).toBe("string");
    expect(output).toContain("Saturation Dashboard");
    expect(output).toContain("Total items:");
    expect(output).toContain("█");
    expect(output).toContain("Per-category:");
  });

  it("shows available headroom message for sparse/empty profiles", () => {
    const profile = initializeSaturation([], { sqft: 300 }, null);
    const output = formatSaturationForPrompt(profile);
    // With no items, should report all categories open
    expect(output).toContain("Available headroom");
  });
});

describe("computeAdaptiveMultiplier", () => {
  it("returns 1.0 when no adaptive context is given", () => {
    expect(computeAdaptiveMultiplier(undefined)).toBeCloseTo(1.0);
  });

  it("tightens caps when the current room is cluttered", () => {
    expect(computeAdaptiveMultiplier({ currentRoomDensity: "cluttered" })).toBeLessThan(1.0);
  });

  it("loosens caps when the current room is sparse", () => {
    expect(computeAdaptiveMultiplier({ currentRoomDensity: "sparse" })).toBeGreaterThan(1.0);
  });

  it("tightens for minimalist user preference", () => {
    expect(computeAdaptiveMultiplier({ userDensityPreference: "minimalist" })).toBeLessThan(1.0);
  });

  it("loosens for maximalist user preference", () => {
    expect(computeAdaptiveMultiplier({ userDensityPreference: "maximalist" })).toBeGreaterThan(1.0);
  });

  it("recognizes priority keywords like 'minimalist' and 'layered'", () => {
    expect(computeAdaptiveMultiplier({ priorities: ["minimalist look"] })).toBeLessThan(1.0);
    expect(computeAdaptiveMultiplier({ priorities: ["layered decor"] })).toBeGreaterThan(1.0);
  });

  it("clamps the multiplier to 0.5..1.6", () => {
    const tight = computeAdaptiveMultiplier({
      currentRoomDensity: "cluttered",
      userDensityPreference: "minimalist",
      priorities: ["minimalist"],
      styleNotes: "pared-down",
    });
    expect(tight).toBeGreaterThanOrEqual(0.5);
    const loose = computeAdaptiveMultiplier({
      currentRoomDensity: "sparse",
      userDensityPreference: "maximalist",
      priorities: ["maximalist", "layered"],
      styleNotes: "abundant and collected",
    });
    expect(loose).toBeLessThanOrEqual(1.6);
  });
});

describe("initializeSaturation with adaptive context", () => {
  it("tightens hard_cap when user is minimalist and room is cluttered", () => {
    const baseProfile = initializeSaturation([], { sqft: 250 }, "modern");
    const tightProfile = initializeSaturation([], { sqft: 250 }, "modern", {
      currentRoomDensity: "cluttered",
      userDensityPreference: "minimalist",
    });
    expect(tightProfile.total_items.hard_cap).toBeLessThan(baseProfile.total_items.hard_cap);
  });

  it("loosens hard_cap when user is maximalist and room is sparse", () => {
    const baseProfile = initializeSaturation([], { sqft: 250 }, "modern");
    const looseProfile = initializeSaturation([], { sqft: 250 }, "modern", {
      currentRoomDensity: "sparse",
      userDensityPreference: "maximalist",
    });
    expect(looseProfile.total_items.hard_cap).toBeGreaterThan(baseProfile.total_items.hard_cap);
  });

  it("bumps per-category hard_cap for userPreferredCategories", () => {
    const baseProfile = initializeSaturation(
      [makeItem("plants", "")],
      { sqft: 250 },
      "modern",
    );
    const boostedProfile = initializeSaturation(
      [makeItem("plants", "")],
      { sqft: 250 },
      "modern",
      { userPreferredCategories: ["plants"] },
    );
    expect(boostedProfile.per_category.plants.hard_cap).toBeGreaterThan(
      baseProfile.per_category.plants.hard_cap,
    );
  });
});
