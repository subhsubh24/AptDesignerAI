/**
 * Live eval for mockup DESIGN QUALITY (APT-30) — informed by I-Design
 * (arXiv 2404.02838): does the generated mockup look GOOD, not just faithful
 * to the room's shell?
 *
 * `lib/agents/mockup-verifier.ts` only answers "does this mockup depict the
 * user's actual room?" (fidelity). Nothing in the product answers "is this a
 * good design?" — the `design/taste` ship-critical dimension in the Quality
 * Auditor's rubric had no mechanical signal underneath it. This eval is that
 * signal: it judges a rendered mockup on four axes from I-Design's protocol
 * (0-10 integer scale each) — functionality/activity alignment, layout and
 * furniture arrangement, color scheme and materials, and overall aesthetic —
 * and reports the mean AND standard deviation per axis across 3 independent
 * judge calls.
 *
 * SEED DECISION (required by APT-30's acceptance check — read before editing):
 * `.claude/rules/determinism.md` requires every LLM call to pass
 * `seed: DETERMINISTIC_SEED`. Under that fixed seed, 3 "independent" judge
 * calls return the identical answer and the standard deviation collapses to
 * a meaningless zero — exactly the number this eval exists to produce. This
 * file picks **option (a)**: it deliberately varies the seed for the judge
 * only, runs 3 independent evaluations per scene, and reports the real
 * variance. This is quarantined entirely to the eval lane —
 * `DETERMINISTIC_MODE` is stubbed to `"false"` (via `vi.stubEnv` +
 * `vi.resetModules()`, the same pattern `__tests__/ai/determinism.test.ts`
 * uses to get a fresh module read of the env) ONLY inside this file's own
 * dynamic imports, so the deterministic product path (every `.chat()` call
 * reachable from `app/`/`lib/` outside `evals/`) is completely unaffected —
 * `resolveSeed()` there still always returns `DETERMINISTIC_SEED`. Why (a)
 * over (b) (stay seeded, single-run, cheap but no confidence interval): a
 * quality score with no variance estimate invites exactly the false
 * confidence the two-gate readiness design exists to prevent, and evals
 * already sit outside the deterministic product path (`RUN_EVALS=1`, its own
 * `live-eval.yml` workflow) — so the 3x cost is paid only here, never on a
 * real user request.
 *
 * NOT wired into the product request path — this is an eval-lane signal for
 * the Quality Auditor to consume, never a runtime gate on user generation.
 *
 * Gates behind RUN_EVALS=1:
 *   RUN_EVALS=1 npx vitest run evals/__tests__/mockup-quality.eval.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { evalsEnabled } from "../runner";

const EVAL_TIMEOUT_MS = 6 * 60 * 1000;

// Reused from the mockup-generation eval (evals/__tests__/mockup.eval.test.ts)
// — a warm, furnished, well-composed living room. A real design-quality judge
// should score this decently across all four axes.
const GOOD_DESIGN_IMAGE =
  "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1280&q=80";

// A deliberately degraded input: a completely empty, unfurnished room (bare
// walls, no furniture, no layout to speak of). This is the "rubric that never
// fails is not a rubric" case — functionality and layout in particular have
// nothing to score well on here.
const EMPTY_ROOM_IMAGE =
  "https://images.unsplash.com/photo-1547333101-6bb18e609b2f?w=1280&q=80";

// Three distinct, hardcoded seeds — deliberately NOT DETERMINISTIC_SEED (42).
// Varying the judge's seed is the entire point of decision (a) above.
const JUDGE_SEEDS = [1001, 1002, 1003] as const;

interface DesignQualityScore {
  functionality: number;
  layout: number;
  color_scheme: number;
  aesthetic: number;
}

const AXES: (keyof DesignQualityScore)[] = ["functionality", "layout", "color_scheme", "aesthetic"];

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * Score one image on the four I-Design axes with one judge call at the given
 * seed. Loads gemini.ts/determinism.ts fresh with DETERMINISTIC_MODE stubbed
 * off so `seed` is sent as-is instead of being overridden to
 * DETERMINISTIC_SEED — see the file-level SEED DECISION comment.
 */
async function judgeOnce(imageUrl: string, seed: number): Promise<DesignQualityScore> {
  vi.resetModules();
  vi.stubEnv("DETERMINISTIC_MODE", "false");
  try {
    const { geminiProvider } = await import("@/lib/ai/gemini");
    const { selectModel } = await import("@/lib/ai/models");
    const { thinkingFor } = await import("@/lib/ai/thinking");
    const { resolveImageBlocks } = await import("@/lib/ai/resolve-image");
    const { extractJsonObject } = await import("@/lib/ai/extract-json");

    const [imageBlock] = await resolveImageBlocks([imageUrl], { preferFilesApi: true });

    const response = await geminiProvider.chat({
      model: selectModel("diagnosis"),
      system:
        "You are a rigorous interior design critic scoring a rendered room on design QUALITY, not photographic fidelity. Be honest and discriminating: a bare, empty, or poorly composed room must score low. A well-composed, tasteful room should score well. Do not default to the middle of the scale.",
      messages: [
        {
          role: "user",
          content: [
            imageBlock,
            {
              type: "text",
              text: `Score this room on four axes, each an INTEGER from 0 to 10 (0 = fails completely, 10 = excellent):
1. functionality: does the space support real activity, with furniture/layout suited to the room's apparent use?
2. layout: is furniture arranged sensibly, with good flow and no awkward gaps or overcrowding?
3. color_scheme: do the colors and materials read as a coherent, intentional palette?
4. aesthetic: overall visual appeal and atmosphere.

A room with no furniture at all must score very low on functionality and layout — there is nothing to arrange.

Return ONLY JSON: {"functionality": <int 0-10>, "layout": <int 0-10>, "color_scheme": <int 0-10>, "aesthetic": <int 0-10>}`,
            },
          ],
        },
      ],
      max_tokens: 16000,
      seed,
      responseMimeType: "application/json",
      thinkingConfig: thinkingFor("diagnosis"),
    });

    return extractJsonObject<DesignQualityScore>(response.content);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

async function scoreScene(imageUrl: string): Promise<{ mean: DesignQualityScore; stddev: DesignQualityScore; runs: DesignQualityScore[] }> {
  const runs = await Promise.all(JUDGE_SEEDS.map((seed) => judgeOnce(imageUrl, seed)));
  const meanScore = {} as DesignQualityScore;
  const stddevScore = {} as DesignQualityScore;
  for (const axis of AXES) {
    const values = runs.map((r) => r[axis]);
    meanScore[axis] = mean(values);
    stddevScore[axis] = stddev(values);
  }
  return { mean: meanScore, stddev: stddevScore, runs };
}

const evalsOff = !evalsEnabled();

describe("mockup design quality — live eval (APT-30)", () => {
  it.skipIf(evalsOff)(
    "scores a well-composed, furnished room decently across all four axes, with a real variance estimate",
    async () => {
      const { mean: m, stddev: sd, runs } = await scoreScene(GOOD_DESIGN_IMAGE);

      // The mean/stddev per axis IS the signal this eval exists to produce —
      // surface it in the eval run output.
      console.log("[mockup-quality eval] good design — mean:", m, "stddev:", sd, "runs:", runs);

      for (const axis of AXES) {
        // A tasteful, furnished, well-lit room should clear the midpoint on
        // every axis. Not a high bar — just enough to prove the rubric
        // rewards a genuinely decent scene rather than scoring everything low.
        expect(m[axis]).toBeGreaterThanOrEqual(5);
        // The variance estimate must be a real number, not NaN/undefined —
        // this is the entire point of running 3 independent judge calls.
        expect(Number.isFinite(sd[axis])).toBe(true);
      }
    },
    EVAL_TIMEOUT_MS,
  );

  it.skipIf(evalsOff)(
    "scores a completely empty, unfurnished room LOW on functionality and layout — the rubric must actually discriminate",
    async () => {
      const { mean: m, stddev: sd, runs } = await scoreScene(EMPTY_ROOM_IMAGE);

      console.log("[mockup-quality eval] empty room — mean:", m, "stddev:", sd, "runs:", runs);

      // A rubric that never fails is not a rubric. An empty room has no
      // furniture to arrange and cannot functionally serve any activity —
      // if the judge scores this well, the rubric is not discriminating.
      expect(m.functionality).toBeLessThanOrEqual(4);
      expect(m.layout).toBeLessThanOrEqual(4);
      for (const axis of AXES) {
        expect(Number.isFinite(sd[axis])).toBe(true);
      }
    },
    EVAL_TIMEOUT_MS,
  );
});
