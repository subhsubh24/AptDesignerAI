import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  truncateContext,
  getInputBudget,
  type ContextSection,
} from "@/lib/ai/context-truncation";

describe("estimateTokens", () => {
  it("should estimate ~1 token per 4 characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("a")).toBe(1); // ceil(1/4) = 1
  });

  it("should add 258 tokens per image", () => {
    expect(estimateTokens("", 1)).toBe(258);
    expect(estimateTokens("", 3)).toBe(774);
    expect(estimateTokens("abcd", 1)).toBe(259); // 1 + 258
  });

  it("should return 0 for empty string and no images", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("truncateContext", () => {
  const makeSections = (sizes: Array<{ key: string; priority: 1 | 2 | 3 | 4; chars: number }>): ContextSection[] =>
    sizes.map((s) => ({
      key: s.key,
      priority: s.priority,
      content: "x".repeat(s.chars),
    }));

  it("should include all sections when within budget", () => {
    const sections = makeSections([
      { key: "a", priority: 1, chars: 100 },
      { key: "b", priority: 2, chars: 100 },
    ]);
    const result = truncateContext(sections, 1000);
    expect(result.wasTruncated).toBe(false);
    expect(result.truncatedSections).toHaveLength(0);
    expect(result.text).toContain("x".repeat(100));
  });

  it("should truncate lower-priority sections first", () => {
    const sections: ContextSection[] = [
      { key: "critical", priority: 1, content: "CRITICAL_DATA" },
      { key: "important", priority: 2, content: "IMPORTANT_DATA" },
      { key: "nice", priority: 4, content: "x".repeat(200000) }, // Very large
    ];
    // Budget: enough for critical + important but not the huge nice-to-have
    const result = truncateContext(sections, 200);
    expect(result.text).toContain("CRITICAL_DATA");
    expect(result.text).toContain("IMPORTANT_DATA");
    expect(result.truncatedSections).toContain("nice");
  });

  it("should always include priority 1 sections even if over budget", () => {
    const sections: ContextSection[] = [
      { key: "critical", priority: 1, content: "x".repeat(10000) },
    ];
    // Budget smaller than the content
    const result = truncateContext(sections, 100);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.truncatedSections).not.toContain("critical");
  });

  it("should partially truncate sections when partially fitting", () => {
    const sections: ContextSection[] = [
      { key: "a", priority: 2, content: "SHORT" },
      { key: "b", priority: 3, content: "x".repeat(10000) },
    ];
    // Enough for 'a' and a truncated 'b'
    const result = truncateContext(sections, 500);
    expect(result.text).toContain("SHORT");
    expect(result.text).toContain("[...truncated]");
    expect(result.truncatedSections).toContain("b");
  });

  it("should preserve order within same priority", () => {
    const sections: ContextSection[] = [
      { key: "first", priority: 2, content: "FIRST" },
      { key: "second", priority: 2, content: "SECOND" },
      { key: "third", priority: 2, content: "THIRD" },
    ];
    const result = truncateContext(sections, 10000);
    const firstIdx = result.text.indexOf("FIRST");
    const secondIdx = result.text.indexOf("SECOND");
    const thirdIdx = result.text.indexOf("THIRD");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it("should account for image tokens in budget", () => {
    const sections: ContextSection[] = [
      { key: "text", priority: 2, content: "x".repeat(1000) },
    ];
    // Budget of 300 tokens, but 3 images eat 774 → no room for text
    const result = truncateContext(sections, 300, 3);
    expect(result.wasTruncated).toBe(true);
  });

  it("should handle empty sections array", () => {
    const result = truncateContext([], 1000);
    expect(result.text).toBe("");
    expect(result.wasTruncated).toBe(false);
  });
});

describe("getInputBudget", () => {
  it("should return context limit minus output tokens", () => {
    const budget = getInputBudget("gemini-3-flash-preview", 16000);
    expect(budget).toBe(800000 - 16000);
  });

  it("should fall back to 100k for unknown models", () => {
    const budget = getInputBudget("unknown-model", 4000);
    expect(budget).toBe(96000);
  });
});
