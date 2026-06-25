/**
 * Live eval tests for the mockup-grounding pipeline stage.
 *
 * Tests whether verifyWhatShouldGoAgainstPhotos() correctly distinguishes
 * items that ARE visible in room photos from absent/hallucinated items.
 *
 * This is the photo-grounding validator that runs during the diagnosis stage
 * to remove fabricated what_should_go entries before sourcing begins. A
 * regression here means either real items are dropped (causing silent diagnosis
 * gaps) or hallucinated items slip through (causing irrelevant sourcing).
 *
 * Gates behind RUN_EVALS=1 — never fires in the standard `npm test` run.
 * Run with:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/grounding.eval.test.ts
 * or via the project shorthand:
 *   npm run eval
 *
 * Timeout: 2 minutes per test.
 */

import { describe, it, expect } from "vitest";
import { evalsEnabled } from "../runner";
import { verifyWhatShouldGoAgainstPhotos } from "@/lib/agents/photo-grounding-validator";

const EVAL_TIMEOUT_MS = 2 * 60 * 1000;

// Warm neutral living room with beige sofa — same image used in diagnosis eval gold cases.
const WARM_SOFA_IMAGE =
  "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1280&q=80";

describe("photo-grounding validator live evals — run with RUN_EVALS=1", () => {
  it.skipIf(!evalsEnabled())(
    "clearly visible sofa is not dropped by the grounding validator",
    async () => {
      // A sofa is unambiguously present in the warm-sofa Unsplash photo.
      // The conservative grounding validator should never drop it.
      const whatShouldGo = ["Beige fabric sofa with throw pillows"];

      const result = await verifyWhatShouldGoAgainstPhotos(
        whatShouldGo,
        [WARM_SOFA_IMAGE],
        "living_room",
      );

      // A fell-back result means the LLM or JSON parse failed — surface that
      // clearly so it doesn't mask a silent regression.
      expect(
        result.fellBack,
        "Grounding validator fell back — check LLM availability and JSON parse",
      ).toBe(false);

      const sofaKept = result.what_should_go.some((entry) =>
        entry.toLowerCase().includes("sofa"),
      );
      expect(
        sofaKept,
        `Sofa entry was incorrectly dropped from a photo where a sofa is clearly visible. ` +
          `Kept: ${JSON.stringify(result.what_should_go)}, ` +
          `Dropped: ${JSON.stringify(result.dropped)}`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(!evalsEnabled())(
    "impossible kitchen appliance is dropped when cross-checked against living-room photo",
    async () => {
      // A gas range stove cannot appear in a residential living-room sofa photo.
      // Even with the validator's conservative defaults, an object that is
      // definitively absent should be flagged as not visible and dropped.
      // The sofa entry is included as a control: it must be kept.
      const whatShouldGo = [
        "Beige fabric sofa with throw pillows", // clearly visible — MUST be kept
        "Freestanding gas range kitchen stove",  // impossible in this photo — should be dropped
      ];

      const result = await verifyWhatShouldGoAgainstPhotos(
        whatShouldGo,
        [WARM_SOFA_IMAGE],
        "living_room",
      );

      expect(
        result.fellBack,
        "Grounding validator fell back — check LLM availability and JSON parse",
      ).toBe(false);

      // The gas range stove must be identified as absent and dropped.
      const stoveDropped = result.dropped.some((d) =>
        d.entry.toLowerCase().includes("stove"),
      );
      expect(
        stoveDropped,
        `Gas range stove was not dropped despite being impossible in a living-room sofa photo. ` +
          `Kept: ${JSON.stringify(result.what_should_go)}, ` +
          `Dropped: ${JSON.stringify(result.dropped)}`,
      ).toBe(true);

      // The sofa control must still be kept.
      const sofaKept = result.what_should_go.some((entry) =>
        entry.toLowerCase().includes("sofa"),
      );
      expect(
        sofaKept,
        `Sofa control entry was incorrectly dropped alongside the stove. ` +
          `Kept: ${JSON.stringify(result.what_should_go)}`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );
});
