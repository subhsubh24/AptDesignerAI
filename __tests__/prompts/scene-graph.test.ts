import { describe, it, expect } from "vitest";
import { getSceneAssemblyPrompt } from "@/lib/prompts/scene-graph";

describe("getSceneAssemblyPrompt", () => {
  it("replaces underscores in the room type with spaces", () => {
    const prompt = getSceneAssemblyPrompt("living_room", 3, false, [], []);
    expect(prompt).toContain("living room");
    expect(prompt).not.toContain("living_room");
  });

  describe("floor plan note", () => {
    it("names the first image as an authoritative floor plan when hasFloorPlan is true", () => {
      const prompt = getSceneAssemblyPrompt("bedroom", 4, true, [], []);
      expect(prompt).toContain("The FIRST image is an authoritative floor plan");
      // photoCount describes the REMAINING photos, not the total image count
      expect(prompt).toContain("The remaining 4 images are photos of the room.");
    });

    it("describes every image as a room photo when hasFloorPlan is false", () => {
      const prompt = getSceneAssemblyPrompt("bedroom", 4, false, [], []);
      expect(prompt).not.toContain("authoritative floor plan");
      expect(prompt).toContain("All 4 images are photos of the same room, taken from different angles.");
    });
  });

  describe("keep / replace notes", () => {
    it("omits the keep note when keepItems is empty", () => {
      const prompt = getSceneAssemblyPrompt("kitchen", 2, false, [], []);
      expect(prompt).not.toContain("wants to KEEP");
    });

    it("lists keep items and instructs disposition=\"keep\" when present", () => {
      const prompt = getSceneAssemblyPrompt("kitchen", 2, false, ["walnut island", "brass pendant"], []);
      expect(prompt).toContain("The user wants to KEEP: walnut island, brass pendant.");
      expect(prompt).toContain('disposition="keep"');
    });

    it("omits the replace note when replaceItems is empty", () => {
      const prompt = getSceneAssemblyPrompt("kitchen", 2, false, [], []);
      expect(prompt).not.toContain("wants to REPLACE");
    });

    it("lists replace items and instructs disposition=\"replace\" when present", () => {
      const prompt = getSceneAssemblyPrompt("kitchen", 2, false, [], ["worn bar stools"]);
      expect(prompt).toContain("The user wants to REPLACE: worn bar stools.");
      expect(prompt).toContain('disposition="replace"');
    });

    it("includes both notes together without one clobbering the other", () => {
      const prompt = getSceneAssemblyPrompt("kitchen", 2, false, ["island"], ["stools"]);
      expect(prompt).toContain("wants to KEEP: island");
      expect(prompt).toContain("wants to REPLACE: stools");
    });
  });

  describe("user context note", () => {
    it("omits the note when userContext is undefined", () => {
      const prompt = getSceneAssemblyPrompt("den", 1, false, [], [], undefined);
      expect(prompt).not.toContain("User notes about these photos");
    });

    it("omits the note when userContext is null", () => {
      const prompt = getSceneAssemblyPrompt("den", 1, false, [], [], null);
      expect(prompt).not.toContain("User notes about these photos");
    });

    it("omits the note when userContext is whitespace-only", () => {
      const prompt = getSceneAssemblyPrompt("den", 1, false, [], [], "   ");
      expect(prompt).not.toContain("User notes about these photos");
    });

    it("includes the trimmed note when userContext is non-empty", () => {
      const prompt = getSceneAssemblyPrompt("den", 1, false, [], [], "  ignore the rug, it's leaving  ");
      expect(prompt).toContain('User notes about these photos: "ignore the rug, it\'s leaving"');
    });
  });

  it("returns valid, parseable JSON-shape scaffolding with the expected top-level keys", () => {
    const prompt = getSceneAssemblyPrompt("living_room", 2, false, [], []);
    // The prompt embeds a literal JSON template describing the required
    // output shape — assert the contract the pipeline's downstream Zod
    // schema actually depends on is present, not just that SOME text came back.
    for (const key of ['"summary"', '"objects"', '"relations"', '"coverage"', '"observed_in"', '"disposition"']) {
      expect(prompt).toContain(key);
    }
  });
});
