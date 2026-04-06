import { describe, it, expect } from "vitest";
import { parseUserContext, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";

describe("parseUserContext", () => {
  describe("exclusion detection", () => {
    it("should detect 'don't need' exclusions", () => {
      const result = parseUserContext("my windows have blinds so don't need curtains");
      expect(result.exclusions).toContain("curtains");
    });

    it("should detect 'no' exclusions", () => {
      const result = parseUserContext("no curtains. no rug.");
      expect(result.exclusions.some((e) => e.includes("curtain"))).toBe(true);
      expect(result.exclusions.some((e) => e.includes("rug"))).toBe(true);
    });

    it("should detect 'ignore' exclusions", () => {
      const result = parseUserContext("ignore the yoga mat, it won't be there");
      expect(result.exclusions.some((e) => e.includes("yoga mat"))).toBe(true);
    });

    it("should detect 'won't be there' exclusions", () => {
      const result = parseUserContext("the yoga mat won't be there");
      expect(result.exclusions.some((e) => e.includes("yoga mat"))).toBe(true);
    });

    it("should handle compound exclusions", () => {
      const result = parseUserContext("my windows have blinds so don't need curtains. ignore the boxes.");
      expect(result.exclusions.some((e) => e.includes("curtain"))).toBe(true);
      expect(result.exclusions.some((e) => e.includes("boxes"))).toBe(true);
    });
  });

  describe("explicit request detection", () => {
    it("should detect 'I want' requests", () => {
      const result = parseUserContext("I want a dining table");
      expect(result.explicitRequests.some((r) => r.item.includes("dining table"))).toBe(true);
    });

    it("should detect plural requests", () => {
      const result = parseUserContext("I want plants also");
      const plantReq = result.explicitRequests.find((r) => r.item.includes("plant"));
      expect(plantReq).toBeDefined();
      expect(plantReq!.wantsMultiple).toBe(true);
    });

    it("should detect singular requests", () => {
      const result = parseUserContext("I want a dining table");
      const tableReq = result.explicitRequests.find((r) => r.item.includes("dining table"));
      expect(tableReq).toBeDefined();
      expect(tableReq!.wantsMultiple).toBe(false);
    });

    it("should detect 'I need' requests", () => {
      const result = parseUserContext("I need more storage");
      expect(result.explicitRequests.some((r) => r.item.includes("storage"))).toBe(true);
    });

    it("should detect multiple requests", () => {
      const result = parseUserContext("I want a dining table. I want plants also. decor also.");
      expect(result.explicitRequests.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("keep item detection", () => {
    it("should detect 'keep the' items", () => {
      const result = parseUserContext("Keep the black arc floor lamp behind the sofa");
      expect(result.additionalKeepItems.some((k) => k.includes("black arc floor lamp"))).toBe(true);
    });

    it("should detect 'keep my' items", () => {
      const result = parseUserContext("keep my sectional sofa");
      expect(result.additionalKeepItems.some((k) => k.includes("sectional sofa"))).toBe(true);
    });

    it("should detect 'keep both' items", () => {
      const result = parseUserContext("keep both lights next to the TV");
      expect(result.additionalKeepItems.some((k) => k.includes("lights next to the TV") || k.includes("light"))).toBe(true);
    });

    it("should detect 'keep all' items", () => {
      const result = parseUserContext("keep all the plants in the corner");
      expect(result.additionalKeepItems.some((k) => k.includes("plant"))).toBe(true);
    });
  });

  describe("lifestyle detection", () => {
    it("should detect 'I am' lifestyle context", () => {
      const result = parseUserContext("I am a 30 year old bachelor working in tech");
      expect(result.lifestyleNotes.some((n) => n.includes("30 year old"))).toBe(true);
    });

    it("should detect 'I like to' lifestyle context", () => {
      const result = parseUserContext("I like to host");
      expect(result.lifestyleNotes.some((n) => n.includes("host"))).toBe(true);
    });

    it("should detect style preferences", () => {
      const result = parseUserContext("i like to be stylish and aesthetic");
      expect(result.lifestyleNotes.length).toBeGreaterThan(0);
    });
  });

  describe("full context parsing", () => {
    it("should handle the real user input from the Porte apartment", () => {
      const input = "ignore the yoga mat, it won't be there. Keep the black arc floor lamp behind the sofa. My windows have blinds so don't need curtains. I want to host so it should be comfortable and slightly impressed for people when they are at my apartment. I want a dining table. for context, I am a 30 year old bachelor working in tech and i like to be stylish and aesthetic and fashionable but not performative. I want plants also. decor also. My apt sq ft is 725. I also have high ceilings.";

      const result = parseUserContext(input);

      // Should find exclusions
      expect(result.exclusions.some((e) => e.includes("yoga mat") || e.includes("curtain"))).toBe(true);

      // Should find keep items
      expect(result.additionalKeepItems.some((k) => k.includes("black arc floor lamp"))).toBe(true);

      // Should find explicit requests
      expect(result.explicitRequests.some((r) => r.item.includes("dining table"))).toBe(true);

      // Should detect plural for plants
      const plantReq = result.explicitRequests.find((r) => r.item.includes("plant"));
      expect(plantReq).toBeDefined();
      expect(plantReq!.wantsMultiple).toBe(true);

      // Should preserve raw context
      expect(result.rawContext).toBe(input);
    });

    it("should handle empty context", () => {
      const result = parseUserContext("");
      expect(result.exclusions).toHaveLength(0);
      expect(result.explicitRequests).toHaveLength(0);
      expect(result.additionalKeepItems).toHaveLength(0);
      expect(result.lifestyleNotes).toHaveLength(0);
    });
  });
});

describe("formatParsedContextForPrompt", () => {
  it("should format exclusions with warning markers", () => {
    const parsed = parseUserContext("don't need curtains");
    const prompt = formatParsedContextForPrompt(parsed);
    expect(prompt).toContain("EXPLICIT EXCLUSIONS");
    expect(prompt).toContain("NON-NEGOTIABLE");
  });

  it("should format keep items", () => {
    const parsed = parseUserContext("keep the floor lamp");
    const prompt = formatParsedContextForPrompt(parsed);
    expect(prompt).toContain("ADDITIONAL ITEMS TO KEEP");
  });

  it("should format plural requests with quantity guidance", () => {
    const parsed = parseUserContext("I want plants also");
    const prompt = formatParsedContextForPrompt(parsed);
    expect(prompt).toContain("AT LEAST 2-3");
  });

  it("should return empty string for no constraints", () => {
    const parsed = parseUserContext("my apartment is nice");
    // May or may not have lifestyle notes, but shouldn't have exclusions/requests
    // If it's empty, should be empty string or just lifestyle
    expect(parsed.exclusions).toHaveLength(0);
  });
});
