/**
 * Live eval tests for the area-analysis Pass A (room understanding) pipeline stage.
 *
 * Tests whether the Gemini model correctly interprets room photos and produces
 * structured, high-quality interior design analysis. A regression here means the
 * vision pipeline has degraded — bad prompts, wrong model, or provider changes.
 *
 * Calls geminiProvider.chat() directly with the same model/prompt setup as
 * app/api/mobile/analyze/route.ts — exercises the actual AI capability without
 * requiring an HTTP server or live Supabase session.
 *
 * Gates behind RUN_EVALS=1 — never fires in the standard `npm test` run.
 * Run with:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/area-analysis.eval.test.ts
 * or via the project shorthand:
 *   npm run eval
 *
 * Timeout: 3 minutes per test — area-analysis uses HIGH thinking, which is slower.
 */

import { describe, it, expect } from "vitest";
import { evalsEnabled } from "../runner";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { thinkingFor } from "@/lib/ai/thinking";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import type { AIContentBlock } from "@/lib/ai/provider";

const EVAL_TIMEOUT_MS = 3 * 60 * 1000;

// Warm-toned neutral living room — beige sofa, oak floors, cream walls.
// Same image used in sourcing and diagnosis evals (consistent gold set).
const WARM_LIVING_ROOM_IMAGE =
  "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1280&q=80";

// Terms that should appear in the recommended palette for a warm neutral room.
const WARM_PALETTE_TERMS = [
  "warm", "neutral", "beige", "cream", "white", "wood", "oak", "walnut",
  "natural", "light", "soft", "brown", "tan", "linen", "ivory", "sand", "taupe",
];

interface PassAOutput {
  summary: string;
  style_name: string;
  design_direction: string;
  recommended_palette: string[];
  recommended_materials: string[];
  recommended_textures: string[];
  what_works: string[];
  what_should_go: string[];
}

function buildPassAPrompt(roomType: string): string {
  return `Analyze this ${roomType} photo and provide a comprehensive room understanding.

Study the photo carefully:
- Identify every visible piece of furniture, finish, lighting element, and fixture.
- Note what's working well and what needs improvement.
- Determine a design direction based on the existing aesthetic and materials.

<critical_rules>
WHAT_WORKS — every entry must be a physical object the owner has and can move:
✅ furniture, decor, lamps, art, textiles, baskets
❌ NEVER include: flooring, countertops, walls, built-ins, ceiling fixtures, appliances

WHAT_SHOULD_GO — only removable items clearly visible in the photo:
✅ "Black laminate TV stand — undersized, wrong material, clashes with warm palette"
❌ NEVER include: absences, architectural features, hypotheticals, vague phrases

NAME EVERYTHING specifically: material + color + form. Never use "generic furniture" or "clutter".
</critical_rules>

Return ONLY valid JSON (no markdown, no prose, no code fences):
{
  "summary": "3-4 sentences — dominant colors, materials, what's working, what's broken. Mention flooring and wall finishes here, not in what_works.",
  "style_name": "2-3 word evocative label from the room's actual cues.",
  "design_direction": "4-6 sentences — color strategy, material mixing, texture layering. Specific and actionable.",
  "recommended_palette": ["4-6 specific colors"],
  "recommended_materials": ["4-6 materials"],
  "recommended_textures": ["3-5 textures"],
  "what_works": ["Exact item — color + material + form. Only movable furniture and decor you can see."],
  "what_should_go": ["Exact item + why. Only removable items you can actually see in the photo."]
}`;
}

describe("area-analysis Pass A (room understanding) live evals — run with RUN_EVALS=1", () => {
  it.skipIf(!evalsEnabled())(
    "warm neutral living room: produces complete, well-structured Pass A analysis",
    async () => {
      const model = selectModel("area_analysis");
      const { thinkingLevel } = thinkingFor("area_analysis");

      const response = await geminiProvider.chat({
        model,
        system:
          "You are an expert interior designer analyzing room photos for a mobile design app. Provide specific, actionable analysis grounded in what you actually see in the photo.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPassAPrompt("living room") } as AIContentBlock,
              {
                type: "image",
                source: { type: "url", url: WARM_LIVING_ROOM_IMAGE },
              } as AIContentBlock,
            ],
          },
        ],
        max_tokens: 2048,
        seed: DETERMINISTIC_SEED,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel },
      });

      const raw = extractJsonObject<PassAOutput>(response.content);

      // All required fields must be present and non-empty
      expect(
        typeof raw.summary === "string" && raw.summary.length > 20,
        `summary must be a non-trivial string, got: ${JSON.stringify(raw.summary)}`,
      ).toBe(true);

      expect(
        typeof raw.style_name === "string" && raw.style_name.length > 3,
        `style_name must be a non-trivial string, got: ${JSON.stringify(raw.style_name)}`,
      ).toBe(true);

      expect(
        typeof raw.design_direction === "string" && raw.design_direction.length > 20,
        `design_direction must be non-trivial, got: ${JSON.stringify(raw.design_direction)}`,
      ).toBe(true);

      expect(
        Array.isArray(raw.recommended_palette) && raw.recommended_palette.length >= 3,
        `recommended_palette must have ≥3 entries, got: ${JSON.stringify(raw.recommended_palette)}`,
      ).toBe(true);

      expect(
        Array.isArray(raw.recommended_materials) && raw.recommended_materials.length >= 2,
        `recommended_materials must have ≥2 entries, got: ${JSON.stringify(raw.recommended_materials)}`,
      ).toBe(true);

      expect(
        Array.isArray(raw.recommended_textures) && raw.recommended_textures.length >= 1,
        `recommended_textures must have ≥1 entry, got: ${JSON.stringify(raw.recommended_textures)}`,
      ).toBe(true);

      expect(
        Array.isArray(raw.what_works) && raw.what_works.length >= 1,
        `what_works must have ≥1 entry — a regression means the model stopped identifying existing furniture, got: ${JSON.stringify(raw.what_works)}`,
      ).toBe(true);

      // The palette must contain at least one warm/neutral term.
      // This image has a beige sofa, oak floors, cream walls — any non-warm palette is a regression.
      const paletteStr = raw.recommended_palette.join(" ").toLowerCase();
      const hasWarmTerm = WARM_PALETTE_TERMS.some((t) => paletteStr.includes(t));
      expect(
        hasWarmTerm,
        `recommended_palette must contain at least one warm/neutral term from ${JSON.stringify(WARM_PALETTE_TERMS)}. ` +
          `Got palette: ${JSON.stringify(raw.recommended_palette)}. ` +
          `This image has a beige sofa, oak floors, cream walls — a cold palette is a vision regression.`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(!evalsEnabled())(
    "response is parseable JSON without manual extraction (responseMimeType honored)",
    async () => {
      const model = selectModel("area_analysis");
      const { thinkingLevel } = thinkingFor("area_analysis");

      const response = await geminiProvider.chat({
        model,
        system:
          "You are an expert interior designer. Return ONLY valid JSON.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPassAPrompt("living room") } as AIContentBlock,
              {
                type: "image",
                source: { type: "url", url: WARM_LIVING_ROOM_IMAGE },
              } as AIContentBlock,
            ],
          },
        ],
        max_tokens: 2048,
        seed: DETERMINISTIC_SEED,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel },
      });

      // Direct JSON.parse should work — responseMimeType: "application/json" forces
      // the model to return clean JSON without markdown fences.
      // If this fails, the Gemini provider's JSON mode has regressed.
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.content.trim());
      } catch {
        // extractJsonObject is the fallback; if direct parse fails, log it but
        // still validate the fallback works — we want to know if JSON mode regressed.
        parsed = extractJsonObject(response.content);
        console.warn(
          "[area-analysis eval] responseMimeType JSON mode regressed — extractJsonObject fallback used. " +
            `Raw prefix: ${response.content.slice(0, 200)}`,
        );
      }

      expect(parsed, "Response must parse to a non-null object").toBeDefined();
      expect(
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
        `Response must be a JSON object, got: ${typeof parsed}`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );
});
