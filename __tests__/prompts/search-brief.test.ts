import { describe, it, expect } from "vitest";
import { getSearchBriefPrompt } from "@/lib/prompts/search-brief";

const categories = ["sofa", "area_rug", "coffee_table"];

describe("getSearchBriefPrompt — dollar budget", () => {
  it("omits the budget section when no dollar budget is set", () => {
    const prompt = getSearchBriefPrompt("living_room", categories, "balanced");
    expect(prompt).not.toContain("TOTAL ROOM BUDGET");
  });

  it("surfaces the total budget and a per-item average when set", () => {
    const prompt = getSearchBriefPrompt(
      "living_room", categories, "balanced",
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      3000, // budgetDollars
    );
    expect(prompt).toContain("TOTAL ROOM BUDGET: $3,000");
    // 3000 / 3 categories = $1,000 average
    expect(prompt).toContain("≈$1,000 average/item");
    // Must instruct the model to keep the whole set under budget
    expect(prompt).toContain("at or under $3,000");
  });

  it("instructs spending the budget on anchors over secondary items", () => {
    const prompt = getSearchBriefPrompt(
      "living_room", categories, "high_end",
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      8000,
    );
    expect(prompt).toMatch(/anchors.*sofa|sofa.*anchor/i);
    expect(prompt).toContain("TOTAL ROOM BUDGET: $8,000");
  });
});
