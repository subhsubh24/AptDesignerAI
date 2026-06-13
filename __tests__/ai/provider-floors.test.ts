/**
 * Paired provider-floor guard.
 *
 * The cheap-by-default contract only holds if BOTH providers default to cheap
 * when no thinkingConfig is supplied. These two assertions must move together —
 * if one provider's floor drifts back to expensive, this test fails.
 *
 *   - DeepSeek: absent config → reasoning OFF (behavioral assert below)
 *   - Gemini:   absent config → thinkingLevel "low" (source assert below; the
 *               default lives inline in geminiProvider.chat and needs the full
 *               SDK to exercise, so we pin the literal instead)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { shouldEnableThinking } from "@/lib/ai/deepseek";

describe("provider floors (paired cheap-by-default guard)", () => {
  it("deepseek: absent thinkingConfig → reasoning off", () => {
    expect(shouldEnableThinking(undefined)).toBe(false);
    expect(shouldEnableThinking({})).toBe(false);
  });

  it("deepseek: only medium/high re-enable reasoning", () => {
    expect(shouldEnableThinking({ thinkingLevel: "minimal" })).toBe(false);
    expect(shouldEnableThinking({ thinkingLevel: "low" })).toBe(false);
    expect(shouldEnableThinking({ thinkingLevel: "medium" })).toBe(true);
    expect(shouldEnableThinking({ thinkingLevel: "high" })).toBe(true);
  });

  it("gemini: inline default is low, not high", () => {
    const src = readFileSync(join(__dirname, "..", "..", "lib", "ai", "gemini.ts"), "utf8");
    // The effective default must fall back to "low".
    expect(src).toMatch(/thinkingConfig\s*\?\?\s*\{\s*thinkingLevel:\s*"low"\s*\}/);
    // And must NOT have reverted to a forced-high default.
    expect(src).not.toMatch(/thinkingConfig\s*\?\?\s*\{\s*thinkingLevel:\s*"high"\s*\}/);
  });
});
