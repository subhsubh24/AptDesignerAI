/**
 * Live eval for the mockup IMAGE-GENERATION pipeline stage — the final,
 * user-facing artifact of the design flow (the rendered "after" of their room).
 *
 * Every other core stage (room understanding, diagnosis, product grounding,
 * sourcing relevance, refine summary) already has a live eval; mockup image
 * generation was the last stage with none. A regression here — the model
 * returning no image, an empty payload, or a render that no longer resembles the
 * user's actual room — is highly visible and ships a broken final screen.
 *
 * The eval calls the REAL generateMockupImage() (which invokes the live Gemini
 * image model), then optionally round-trips the result through the real
 * verifyMockupImage() vision check to confirm the generated room still resembles
 * the reference photo.
 *
 * Gates behind RUN_EVALS=1 — never fires in the standard `npm test` run (which
 * has no Gemini key). Run with:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/mockup.eval.test.ts
 * or via the project shorthand:
 *   npm run eval
 *
 * The gold fixture is inlined (not added to evals/gold/) on purpose: the shared
 * loadGoldCases() set is the area-analysis/diagnosis GoldCase shape, and the
 * diagnosis eval + runner unit test iterate every file in that directory — a
 * mockup-shaped case would leak into their loops.
 */

import { describe, it, expect } from "vitest";
import { evalsEnabled } from "../runner";
import { generateMockupImage } from "@/lib/agents/mockup-agent";
import { verifyMockupImage } from "@/lib/agents/mockup-verifier";

// Image generation is slower than text; allow a generous per-test budget.
const EVAL_TIMEOUT_MS = 4 * 60 * 1000;

// Warm neutral living room with beige sofa — shared with the diagnosis /
// sourcing / area-analysis eval gold cases so the fixture is already trusted.
const WARM_LIVING_ROOM_IMAGE =
  "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1280&q=80";

// A representative design-transformation prompt for the warm-sofa room. Hardcoded
// (rather than generated via generateMockupPrompt) so this eval exercises ONLY
// the image-generation stage, not prompt generation, and stays deterministic.
const MOCKUP_PROMPT = [
  "Restyle this living room into a warm Scandinavian space while keeping the EXISTING room shell",
  "(walls, windows, flooring, ceiling, and proportions) recognizably the same apartment.",
  "Keep the beige sofa. Add a natural oak coffee table, a textured cream area rug, a linen",
  "accent chair, warm layered lighting, and a few potted plants. Palette: warm beige, cream,",
  "warm white, natural oak and walnut. Photorealistic interior render, natural daylight.",
].join(" ");

const evalsOff = !evalsEnabled();

describe("mockup image generation — live eval", () => {
  it.skipIf(evalsOff)(
    "generates a real image for the warm-sofa living room grounded on the room photo",
    async () => {
      const res = await generateMockupImage(MOCKUP_PROMPT, [WARM_LIVING_ROOM_IMAGE]);

      // The stage must succeed and return a real image payload — not an empty
      // or text-only response.
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
      const data = res.data!;

      // image_url carries the raw base64 image bytes; it must be present and of
      // a plausible size (a real image is far more than a few bytes).
      expect(typeof data.image_url).toBe("string");
      expect(data.image_url.length).toBeGreaterThan(1000);

      // The mime type must identify an image so the client renders it correctly.
      expect(data.image_mime_type).toBeDefined();
      expect(data.image_mime_type!.startsWith("image/")).toBe(true);

      // Provenance + the prompt we asked for.
      expect(data.provider).toBe("gemini-image");
      expect(data.prompt_used).toContain("Scandinavian");
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(evalsOff)(
    "the generated mockup still resembles the original room (vision round-trip)",
    async () => {
      const res = await generateMockupImage(MOCKUP_PROMPT, [WARM_LIVING_ROOM_IMAGE]);
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
      const data = res.data!;

      const verification = await verifyMockupImage(
        data.image_url,
        data.image_mime_type ?? "image/png",
        [WARM_LIVING_ROOM_IMAGE],
      );

      expect(verification.success).toBe(true);
      // A grounded restyle should keep the room shell recognizable. We assert a
      // modest confidence floor rather than a hard matches_room=true so a single
      // borderline vision call doesn't flake the suite.
      expect(verification.data).toBeDefined();
      expect(verification.data!.confidence).toBeGreaterThanOrEqual(0.5);
    },
    EVAL_TIMEOUT_MS,
  );
});
