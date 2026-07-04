import { describe, it, expect, vi } from "vitest";
import type { CandidateProduct } from "@/lib/types/database";

/**
 * Render-pipeline integration test (functional-reality money path).
 *
 * Drives the REAL final-render pipeline — buildMockupContext (defensive field
 * extraction) → generateMockupPrompt (real system/prompt assembly + JSON parse)
 * → generateMockupImage (real content-block assembly + image extraction) —
 * against a recorded provider (the cassette). Only the LLM boundary is
 * substituted; every line of pipeline glue runs for real. The terminal
 * assertion is the money-path outcome: the pipeline yields a REAL, decodable
 * PNG (valid signature + non-zero dimensions), not a placeholder or a mocked
 * pass-through string.
 *
 * This is the hermetic, locally-verifiable half of the functional-reality
 * gate: it proves the AI design→render pipeline is wired end-to-end. (The
 * authed browser E2E half, which drives the same pipeline through the served
 * app under E2E_AUTH_STACK, reuses this cassette.)
 */

// Replace the Gemini provider (imported directly by mockup-agent) with the
// cassette so generateMockupPrompt + generateMockupImage hit recorded responses.
vi.mock("@/lib/ai/gemini", async () => {
  const { cassetteProvider } = await import("@/lib/ai/cassette-provider");
  return { geminiProvider: cassetteProvider };
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeProducts(): CandidateProduct[] {
  // Only the fields the prompt agent reads (category/title/colors/materials/
  // dimensions) matter here; cast through unknown to skip the DB-row columns.
  return [
    {
      category: "sofa",
      title: 'Harmony 84" Cognac Leather Sofa',
      colors: ["cognac"],
      materials: ["top-grain leather", "oak"],
      dimensions: "84W x 38D x 34H",
    },
    {
      category: "coffee_table",
      title: "Solid Oak Low Coffee Table",
      colors: ["natural oak"],
      materials: ["oak"],
      dimensions: "48W x 24D x 16H",
    },
  ] as unknown as CandidateProduct[];
}

describe("render pipeline (cassette) — the AI design→render money path", () => {
  it("extracts context, writes a prompt, and produces a REAL decodable PNG", async () => {
    const { buildMockupContext, generateMockupPrompt, generateMockupImage } =
      await import("@/lib/agents/mockup-agent");

    // 1) Real defensive extraction from raw diagnosis + design-direction rows.
    const context = buildMockupContext({
      roomType: "living_room",
      diagnosisJson: {
        current_vibe_summary: "Sparse rental living room with good north light",
        what_works: ["hardwood floors", "tall windows"],
        action_list: [{ category: "sofa", placement: "against the window wall" }],
        spatial_layout: "rectangular, ~14x18ft, entry on the short south wall",
        lighting_conditions: "bright indirect north light through two windows",
      },
      designDirectionJson: {
        style_notes: "Warm modern with natural oak and cognac leather",
        recommended_palette: ["greige", "cognac", "warm oak", "charcoal"],
        recommended_materials: ["oak", "leather", "wool"],
        recommended_textures: ["boucle", "matte metal"],
      },
      buildingResearch: { finishes: "oak flooring, greige walls" },
    });

    // The extraction actually mapped the source rows (not defaults/fallbacks).
    expect(context.roomType).toBe("living_room");
    expect(context.diagnosisSummary).toContain("Sparse rental");
    expect(context.existingItems).toEqual(["hardwood floors", "tall windows"]);
    expect(context.designDirection).toContain("Warm modern");
    expect(context.palette).toContain("cognac");
    expect(context.materials).toContain("oak");
    expect(context.placementMap).toEqual({ sofa: "against the window wall" });

    // 2) Real prompt agent: assembles system + mockup prompt, parses cassette JSON.
    const promptResult = await generateMockupPrompt(
      context.roomType,
      context.diagnosisSummary,
      makeProducts(),
      context.existingItems,
      context.designDirection,
      context.buildingResearch,
      context,
    );

    expect(promptResult.success).toBe(true);
    if (!promptResult.success || !promptResult.data) throw new Error(promptResult.error);
    const mockupPrompt = promptResult.data;
    expect(mockupPrompt.prompt.length).toBeGreaterThan(20);
    expect(mockupPrompt).toHaveProperty("negative_prompt");
    expect(mockupPrompt).toHaveProperty("style_notes");

    // 3) Real image agent: builds content blocks, calls the provider, extracts
    //    the image payload. The terminal money-path assertion.
    const imageResult = await generateMockupImage(mockupPrompt.prompt);

    expect(imageResult.success).toBe(true);
    if (!imageResult.success || !imageResult.data) throw new Error(imageResult.error);
    expect(imageResult.data.image_mime_type).toBe("image/png");
    expect(imageResult.data.prompt_used).toBe(mockupPrompt.prompt);

    // The output is REAL, decodable image bytes — not a placeholder string.
    const bytes = Buffer.from(imageResult.data.image_url, "base64");
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("fails loud when a stage has no recorded cassette (no silent fallback)", async () => {
    const { createCassetteProvider } = await import("@/lib/ai/cassette-provider");
    const provider = createCassetteProvider();
    // A plain-text stage (no JSON mime, no image modality) is intentionally
    // uncovered — the cassette must throw rather than invent a response.
    await expect(
      provider.chat({ model: "gemini-x", system: "s", messages: [] }),
    ).rejects.toThrow(/no recorded response/);
  });
});
