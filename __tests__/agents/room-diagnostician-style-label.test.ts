import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/semantic-extract", () => ({
  classifyStyleLabelLLM: vi.fn(),
}));

import { inferStyleLabel, reconcileStyleLabel } from "@/lib/agents/room-diagnostician";
import { classifyStyleLabelLLM } from "@/lib/ai/semantic-extract";
import type { DesignDirection } from "@/lib/types/database";

const mockedClassify = vi.mocked(classifyStyleLabelLLM);

function direction(overrides: Partial<DesignDirection> = {}): DesignDirection {
  return {
    recommended_palette: [],
    recommended_materials: [],
    recommended_textures: [],
    recommended_furniture_types: [],
    style_notes: "",
    ...overrides,
  };
}

describe("inferStyleLabel", () => {
  beforeEach(() => {
    mockedClassify.mockReset();
  });

  it("returns the LLM classification when it succeeds, without falling back to regex", async () => {
    mockedClassify.mockResolvedValue("Japandi");
    const label = await inferStyleLabel(direction({ style_notes: "warm minimalist vibe" }));
    expect(label).toBe("Japandi");
  });

  it("falls back to the regex tier when the LLM call throws", async () => {
    mockedClassify.mockRejectedValue(new Error("timeout"));
    const label = await inferStyleLabel(direction({ style_notes: "a cozy mid-century modern living room" }));
    expect(label).toBe("Mid-Century Modern");
  });

  it("falls back to the regex tier when the LLM returns null", async () => {
    mockedClassify.mockResolvedValue(null);
    const label = await inferStyleLabel(direction({ style_notes: "farmhouse charm throughout" }));
    expect(label).toBe("Farmhouse");
  });

  it("prefers bohemian coastal over the plain bohemian/coastal matches", async () => {
    mockedClassify.mockResolvedValue(null);
    const label = await inferStyleLabel(direction({ style_notes: "boho coastal beach house energy" }));
    expect(label).toBe("Bohemian Coastal");
  });

  it("infers Coastal from the rattan + linen material heuristic when no named style matches", async () => {
    mockedClassify.mockResolvedValue(null);
    const label = await inferStyleLabel(
      direction({ style_notes: "airy and relaxed", recommended_materials: ["rattan", "linen"] }),
    );
    expect(label).toBe("Coastal");
  });

  it("does not apply the rattan heuristic without linen or white-washed wood", async () => {
    mockedClassify.mockResolvedValue(null);
    const label = await inferStyleLabel(
      direction({ style_notes: "eclectic mix", recommended_materials: ["rattan", "brass"] }),
    );
    expect(label).toBe("Eclectic");
  });

  it("returns null when nothing matches either tier", async () => {
    mockedClassify.mockResolvedValue(null);
    const label = await inferStyleLabel(direction({ style_notes: "just a room with some furniture" }));
    expect(label).toBeNull();
  });
});

describe("reconcileStyleLabel", () => {
  beforeEach(() => {
    mockedClassify.mockReset();
  });

  it("keeps the current label without any classification call when style_notes and materials are unchanged", async () => {
    const before = direction({ style_notes: "japandi calm", recommended_materials: ["oak"] });
    const after = direction({
      style_notes: "japandi calm",
      recommended_materials: ["oak"],
      recommended_palette: ["different palette entirely"],
    });

    const label = await reconcileStyleLabel("Japandi", before, after);

    expect(label).toBe("Japandi");
    expect(mockedClassify).not.toHaveBeenCalled();
  });

  it("re-infers the label when style_notes changed", async () => {
    mockedClassify.mockResolvedValue(null);
    const before = direction({ style_notes: "japandi calm" });
    const after = direction({ style_notes: "industrial loft with exposed brick" });

    const label = await reconcileStyleLabel("Japandi", before, after);

    expect(label).toBe("Industrial");
    expect(mockedClassify).toHaveBeenCalledTimes(1);
  });

  it("re-infers the label when recommended_materials changed even if style_notes did not", async () => {
    mockedClassify.mockResolvedValue(null);
    const before = direction({ style_notes: "relaxed neutral room", recommended_materials: [] });
    const after = direction({
      style_notes: "relaxed neutral room",
      recommended_materials: ["rattan", "linen"],
    });

    const label = await reconcileStyleLabel(null, before, after);

    expect(label).toBe("Coastal");
  });
});
