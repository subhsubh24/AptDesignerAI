import { describe, it, expect, vi } from "vitest";

// Mock the Gemini provider so generateMockupImage never makes a network call.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));

import {
  buildMockupContext,
  generateMockupImage,
  type BuildMockupContextInput,
} from "@/lib/agents/mockup-agent";
import { geminiProvider } from "@/lib/ai/gemini";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function build(overrides: Partial<BuildMockupContextInput> = {}) {
  return buildMockupContext({ roomType: "living_room", ...overrides });
}

describe("buildMockupContext — diagnosisSummary fallback chain", () => {
  it("prefers current_vibe_summary over summary", () => {
    const ctx = build({
      diagnosisJson: { current_vibe_summary: "warm and layered", summary: "generic" },
    });
    expect(ctx.diagnosisSummary).toBe("warm and layered");
  });

  it("falls back to summary when current_vibe_summary absent", () => {
    const ctx = build({ diagnosisJson: { summary: "bright and airy" } });
    expect(ctx.diagnosisSummary).toBe("bright and airy");
  });

  it("falls back to a synthesized 'Modern <roomType> room' when neither present", () => {
    const ctx = buildMockupContext({ roomType: "bedroom" });
    expect(ctx.diagnosisSummary).toBe("Modern bedroom room");
  });
});

describe("buildMockupContext — designDirection fallback chain", () => {
  it("prefers design_direction_json.style_notes", () => {
    const ctx = build({
      designDirectionJson: { style_notes: "japandi", direction: "other" },
      diagnosisJson: { design_direction: "third" },
    });
    expect(ctx.designDirection).toBe("japandi");
  });

  it("falls back to design_direction_json.direction, then diagnosis design_direction", () => {
    expect(build({ designDirectionJson: { direction: "mid-century" } }).designDirection).toBe(
      "mid-century",
    );
    expect(build({ diagnosisJson: { design_direction: "coastal" } }).designDirection).toBe(
      "coastal",
    );
  });

  it("is undefined when no source provides a direction", () => {
    expect(build().designDirection).toBeUndefined();
  });
});

describe("buildMockupContext — palette/materials/textures precedence", () => {
  it("prefers design_direction_json over diagnosis_json for each array", () => {
    const ctx = build({
      designDirectionJson: {
        recommended_palette: ["sage"],
        recommended_materials: ["oak"],
        recommended_textures: ["boucle"],
      },
      diagnosisJson: {
        recommended_palette: ["red"],
        recommended_materials: ["steel"],
        recommended_textures: ["glass"],
      },
    });
    expect(ctx.palette).toEqual(["sage"]);
    expect(ctx.materials).toEqual(["oak"]);
    expect(ctx.textures).toEqual(["boucle"]);
  });

  it("falls back to diagnosis_json arrays when design_direction_json lacks them", () => {
    const ctx = build({
      diagnosisJson: {
        recommended_palette: ["red"],
        recommended_materials: ["steel"],
        recommended_textures: ["glass"],
      },
    });
    expect(ctx.palette).toEqual(["red"]);
    expect(ctx.materials).toEqual(["steel"]);
    expect(ctx.textures).toEqual(["glass"]);
  });

  it("collapses empty arrays to undefined (keeps prompt shape byte-identical when sparse)", () => {
    const ctx = build({
      designDirectionJson: { recommended_palette: [], recommended_materials: [] },
    });
    expect(ctx.palette).toBeUndefined();
    expect(ctx.materials).toBeUndefined();
    expect(ctx.textures).toBeUndefined();
  });
});

describe("buildMockupContext — existingItems", () => {
  it("prefers what_works, falls back to what_is_working", () => {
    expect(build({ diagnosisJson: { what_works: ["rug"] } }).existingItems).toEqual(["rug"]);
    expect(build({ diagnosisJson: { what_is_working: ["lamp"] } }).existingItems).toEqual([
      "lamp",
    ]);
  });

  it("is undefined when both are empty/absent", () => {
    expect(build({ diagnosisJson: { what_works: [] } }).existingItems).toBeUndefined();
    expect(build().existingItems).toBeUndefined();
  });
});

describe("buildMockupContext — placementMap merge order", () => {
  it("what_it_needs overwrites action_list for the same category", () => {
    const ctx = build({
      diagnosisJson: {
        action_list: [{ category: "sofa", placement: "against the north wall" }],
        what_it_needs: [{ category: "sofa", placement: "floating in the center" }],
      },
    });
    expect(ctx.placementMap).toEqual({ sofa: "floating in the center" });
  });

  it("merges distinct categories from both sources", () => {
    const ctx = build({
      diagnosisJson: {
        action_list: [{ category: "sofa", placement: "north wall" }],
        what_it_needs: [{ category: "rug", placement: "under the coffee table" }],
      },
    });
    expect(ctx.placementMap).toEqual({ sofa: "north wall", rug: "under the coffee table" });
  });

  it("skips entries missing a category or placement", () => {
    const ctx = build({
      diagnosisJson: {
        action_list: [
          { category: "sofa" },
          { placement: "somewhere" },
          { category: "lamp", placement: "corner" },
        ],
      },
    });
    expect(ctx.placementMap).toEqual({ lamp: "corner" });
  });

  it("is undefined when no placements resolve", () => {
    expect(build({ diagnosisJson: { action_list: [] } }).placementMap).toBeUndefined();
    expect(build().placementMap).toBeUndefined();
  });
});

describe("buildMockupContext — scalar + passthrough fields", () => {
  it("extracts spatial/lighting/window fields when present, undefined otherwise", () => {
    const ctx = build({
      diagnosisJson: {
        spatial_layout: "L-shaped",
        lighting_conditions: "north-facing, dim",
        window_door_positions: "window east, door south",
      },
    });
    expect(ctx.spatialLayout).toBe("L-shaped");
    expect(ctx.lightingConditions).toBe("north-facing, dim");
    expect(ctx.windowDoorPositions).toBe("window east, door south");

    const bare = build();
    expect(bare.spatialLayout).toBeUndefined();
    expect(bare.lightingConditions).toBeUndefined();
    expect(bare.windowDoorPositions).toBeUndefined();
  });

  it("passes buildingResearch through and gates priorities/userContext/iterationNotes on content", () => {
    const research = { finishes: "oak floors" };
    const ctx = build({
      buildingResearch: research,
      priorities: ["seating"],
      userContext: "has a cat",
      iterationNotes: "warmer this time",
    });
    expect(ctx.buildingResearch).toBe(research);
    expect(ctx.priorities).toEqual(["seating"]);
    expect(ctx.userContext).toBe("has a cat");
    expect(ctx.iterationNotes).toBe("warmer this time");

    const bare = build({ priorities: [], userContext: "", iterationNotes: "" });
    expect(bare.priorities).toBeUndefined();
    expect(bare.userContext).toBeUndefined();
    expect(bare.iterationNotes).toBeUndefined();
  });

  it("always carries roomType through unchanged", () => {
    expect(buildMockupContext({ roomType: "home_office" }).roomType).toBe("home_office");
  });
});

describe("generateMockupImage — provider result handling", () => {
  it("returns the generated image on success", async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValue({
      imageData: { data: "data:image/png;base64,abc", mimeType: "image/png" },
      model: "gemini-3-pro-image",
    });
    const res = await generateMockupImage("a cozy living room");
    expect(res.success).toBe(true);
    expect(res.data?.image_url).toBe("data:image/png;base64,abc");
    expect(res.data?.image_mime_type).toBe("image/png");
    expect(res.data?.prompt_used).toBe("a cozy living room");
    expect(res.data?.provider).toBe("gemini-image");
  });

  it("fails cleanly when the model returns no image", async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValue({ content: "text only", model: "gemini-3-pro-image" });
    const res = await generateMockupImage("a cozy living room");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no image/i);
  });

  it("surfaces a thrown provider error as a failed result, never throws", async () => {
    mockChat.mockReset();
    mockChat.mockImplementation(async () => {
      throw new Error("429 rate limited");
    });
    const res = await generateMockupImage("a cozy living room");
    expect(res.success).toBe(false);
    expect(res.error).toBe("429 rate limited");
  });
});
