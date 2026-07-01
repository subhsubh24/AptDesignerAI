/**
 * Live eval for the refine pipeline stage — the summary the chat designer shows
 * a client after re-running the full area analysis in response to their feedback.
 *
 * Tests whether summarizeRefineChanges() produces a concrete, client-facing
 * summary that actually NAMES what changed between the prior and new assessment
 * (the sofa swap, the palette shift, the item added). A regression here means
 * the designer starts returning vague or empty change summaries — the user asks
 * for a change and can't tell what, if anything, happened.
 *
 * Gates behind RUN_EVALS=1 — never fires in the standard `npm test` run (which
 * has no Gemini key). Run with:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/refine.eval.test.ts
 * or via the project shorthand:
 *   npm run eval
 */

import { describe, it, expect } from "vitest";
import { evalsEnabled } from "../runner";
import { summarizeRefineChanges } from "@/lib/agents/refine-summarizer";

const EVAL_TIMEOUT_MS = 3 * 60 * 1000;

// The generic fallback the summarizer returns when the model yields nothing —
// a real summary must NOT be this string.
const FALLBACK_SUMMARY = "Updated the assessment based on your request.";

const DESIGN_SYSTEM =
  "You are a warm, precise interior designer speaking directly to a residential client.";

// A concrete before/after pair: the client asks to warm up a cool-grey scheme.
// The new assessment swaps a grey performance-weave sofa for a warm ochre boucle
// one and shifts the palette from cool greys to warm terracotta/ochre — a delta
// a good summary must name.
const PRIOR_ANALYSIS = {
  style_name: "Cool Contemporary",
  design_direction:
    "Muted, cool-toned contemporary living room with grey upholstery and blackened-steel accents.",
  recommended_palette: ["cool grey", "charcoal", "slate blue", "off-white"],
  recommended_materials: ["performance weave", "blackened steel", "smoked glass"],
  what_should_go: ["yellowed vertical blinds"],
  what_it_needs: [
    { category: "sofa", description: "grey performance-weave 3-seat sofa", specs: null },
    { category: "area_rug", description: "low-pile slate geometric rug", specs: null },
  ],
};

const NEW_ANALYSIS = {
  style_name: "Warm Modern",
  design_direction:
    "Warm, inviting modern living room anchored by an ochre boucle sofa with walnut and brass accents.",
  recommended_palette: ["terracotta", "ochre", "warm white", "walnut brown"],
  recommended_materials: ["boucle", "solid walnut", "aged brass"],
  what_should_go: ["yellowed vertical blinds"],
  what_it_needs: [
    { category: "sofa", description: "ochre boucle 3-seat sofa with walnut legs", specs: null },
    { category: "area_rug", description: "warm wool rug in terracotta tones", specs: null },
    { category: "table_lamp", description: "aged-brass table lamp for warm evening light", specs: null },
  ],
};

describe("refine-summarizer live eval — run with RUN_EVALS=1", () => {
  it.skipIf(!evalsEnabled())(
    "names the concrete changes when a client asks to warm up a cool scheme",
    async () => {
      const { summary, tokens } = await summarizeRefineChanges({
        feedback: "This feels cold — can we make the whole room warmer and cozier?",
        priorAnalysis: PRIOR_ANALYSIS,
        newAnalysis: NEW_ANALYSIS,
        system: DESIGN_SYSTEM,
      });

      // A real model call was made and produced content.
      expect(tokens, "expected the live call to report token usage").toBeGreaterThan(0);
      expect(summary.trim().length, "summary should not be empty").toBeGreaterThan(0);
      expect(
        summary.trim(),
        `summarizer returned the generic fallback — the model produced no real summary`,
      ).not.toBe(FALLBACK_SUMMARY);

      // It should be genuinely concise (the prompt asks for 1-3 sentences), not a
      // dumped JSON blob or a wall of text.
      expect(
        summary.length,
        `expected a short client-facing summary, got ${summary.length} chars`,
      ).toBeLessThan(600);
      expect(summary, "summary should be prose, not JSON").not.toContain("{");

      // The core of this eval: the summary must NAME the change. The dominant
      // delta is warmth (cool grey → warm ochre/terracotta) and the sofa swap.
      const lower = summary.toLowerCase();
      const namesWarmth = /warm|ochre|terracotta|cozy|cosy|boucle|walnut|brass/.test(lower);
      const namesAChangedThing = /sofa|palette|colou?r|rug|lamp|tone/.test(lower);
      expect(
        namesWarmth,
        `summary should name the warmth shift; got: "${summary}"`,
      ).toBe(true);
      expect(
        namesAChangedThing,
        `summary should name at least one changed element (sofa/palette/rug/lamp); got: "${summary}"`,
      ).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );
});
