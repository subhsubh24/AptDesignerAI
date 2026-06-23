# Loop memory — AptDesignerAI autonomous engineering loop

Durable lessons across runs. Each run appends; nothing is deleted until a guard makes it redundant.

---

## Run 2026-06-23 (first run)

### State on entry
- No prior loop-memory or IMPROVEMENT_LOG; fresh start.
- All 700 tests passing, no open PRs.
- Recent git history heavy on: AI pipeline tuning, UI/dark-mode polish, mobile responsiveness, performance.

### Area served this run
**Engineering quality** — test coverage for a critical untested validation module.

### What was done
Added 55 tests for `lib/validation/color-math.ts` (CIEDE2000 implementation + palette harmony + cross-room coherence).
- Pure math primitives (`hslToRgb`, `linearize`, `rgbToXyz`, `xyzToLab`, `hslToLab`) verified against known boundary cases.
- `deltaE2000` verified against 11 Sharma et al. (2005) reference test pairs, ±0.002 tolerance.
- `computeColorHarmony` integration tested: neutral defaults, palette scheme scoring, conflict detection, per-item fit, cross-room coherence.

### Lessons learned

1. **`lookupColor` is surprisingly broad.** Words like "oak", "rectangular", "tempered" all match entries in the color map. When writing tests that assume "no color found", verify with a quick `npx tsx` debug call before asserting.

2. **The per-item color fit has a subtlety:** spec colors extracted from `what_it_needs` are merged into the global resolved palette, so an item's own colors trivially match themselves. Tests should account for this rather than testing "item color fit against an unrelated palette" naively.

3. **Engineering quality is under-served.** Many validation math modules (`set-math`, `bundle-math`, `material-math`, `proportion-math`, `spatial-math`, `harmony-math`) still have zero tests. Rotate here next.

4. **Pick + implement + verify cycle was fast** (~10 min) for pure-math test additions. These are safe auto-merge candidates.

### Merge outcome
PR opened with auto-merge enabled (CI-gated squash).

### Rotation guide for next run
- **Under-served areas**: `set-math.ts` tests (cross-product coherence, duplicate detection, tier differentiation) — similar complexity to color-math, pure functions.
- **Avoid**: More UI changes until a human run has reviewed the visual design bar for existing ones.
- **Watch out**: `harmony-math.ts` (the orchestrator) needs more setup for tests — defer until you can mock all 10+ sub-modules cleanly.

---

## Run 2026-06-23 (second run)

### State on entry
- 757 tests passing, 1 merged PR (color-math tests).
- loop-memory was incorrectly placed in `.claude/loop-memory.md` instead of `docs/loop-memory.md` — corrected this run.

### Area served this run
**Engineering quality** — test coverage for two more untested validation math modules.

### What was done
Added 53 tests (22 + 31) across two new test files:
- `__tests__/validation/set-math.test.ts` (22 tests): `computeSetMathScores` + `formatSetMathForPrompt`. Covers bounds, weighted combination accuracy, cross-product color coherence, material coherence (wood species / warm+cool metal conflicts), duplicate detection (Jaccard similarity), tier price differentiation, collective functional coverage (6 roles), per-product shape invariants, format output.
- `__tests__/validation/bundle-math.test.ts` (31 tests): `computeBundleMathScores` + `formatBundleMathForPrompt`. Covers bounds, palette harmony (color coherence, palette alignment, issue emission), material balance (wood/metal conflicts, variety), scale balance (relational dimensional rules, unit conversion), spatial feasibility (floor plan coverage ratios, footprint bands, traffic clearance), room completeness (tier coverage for living_room + bedroom), price coherence (variance, outliers, zero-price filter), format output.

### Lessons learned

1. **`dimMap` in bundle/set spatial functions is keyed by category**, not by product. Multiple products with the same category collapse to one entry in the map. Tests that send 10 products of "accent_chair" will only compute footprint for ONE chair. Use distinct categories when testing footprint accumulation.

2. **`computeSpatialFeasibility` has a traffic-flow penalty**: if the largest single product dimension exceeds 65% of the smaller room dimension, an additional -0.15 is applied even on top of the footprint penalty. Design test inputs with large rugs that stay under this threshold (e.g. rug depth < 0.65 × smaller_room_dim).

3. **`computePriceCoherence` filters `price > 0`** — zero prices are excluded. With < 2 valid prices, it returns the neutral 0.7 default, not a penalty. Tests that expected low scores for zero-price bundles must account for this.

4. **`computeCompleteness` for living_room has 14 finishing items.** Covering only a handful won't approach 1.0. The practical ceiling for "all essential + all standard + some finishing" is ~0.85. Tests should use `> 0.75` not `≈ 1.0`.

5. **Vacuous `if (condition) { expect(...) }` patterns silently pass on lookup regressions.** Always verify the triggering state unconditionally BEFORE the conditional assertion, or remove the conditional entirely. Reviewer caught this pattern in 4 places.

6. **Pure-function test files (no LLM, no IO) are the fastest and safest improvement type for this loop.** Two full files (839 lines, 53 tests) were implemented and passing in a single run with 2 review cycles.

### Merge outcome
PR opened with auto-merge enabled (CI-gated squash). Both reviewer subagents approved.

### Rotation guide for next run
- **Remaining untested validation modules**: `material-math.ts`, `proportion-math.ts`, `spatial-math.ts` (sub-module for `parseDimensions`, room coverage, per-item spatial), `product-math.ts` (scale fit, palette fit, value fit, proportion fit for individual products). `harmony-math.ts` still deferred (requires mocking 10+ sub-modules).
- **Non-engineering areas under-served**: UX/latency improvements, new features (the app's VISION.md calls for "fast time-to-first-wow" and "reasons to come back"). Consider a feature addition next rotation to avoid over-indexing on test coverage.
- **Loop-memory file location**: always write to `docs/loop-memory.md`, NOT `.claude/loop-memory.md`. The `.claude/` directory triggers a permission prompt in headless CI.

---

## Run 2026-06-23 (third run)

### State on entry
- 810 tests passing, 2 merged PRs (color-math, set-math+bundle-math).
- Rotation guide from prior run explicitly flagged `product-math.ts` and `material-math.ts` as highest-priority untested modules.
- loop-memory lesson: "Consider a feature addition next rotation to avoid over-indexing on test coverage."

### Area served this run
**Engineering quality** — test coverage for the two largest untested validation modules in the scoring pipeline.

### What was done
Added 66 tests (+876 total, up from 810) across two new test files:
- `__tests__/validation/product-math.test.ts` (517 lines, ~60 tests): `computeProductMathScores` (6 scoring axes: scale, palette, material, value, proportion, lifestyle) + `formatProductMathForPrompt`. Covers output shape/bounds, weighted-sum formula, scale range checks + cm→inch conversion + room-footprint check, palette Delta-E scoring, material property-space matching + wood species + metal temperature conflicts, value vs. tier price range, proportion/height targets, lifestyle flag gating.
- `__tests__/validation/material-math.test.ts` (346 lines, ~30 tests): `computeMaterialBalance`. Covers defaults, wood-species conflict detection (≤2 species = OK, ≥3 = penalised progressively), metal finish warm/cool separation, soft-to-hard ratio against room-type ideal bands (living room [40-60%], bedroom [50-70%]), material property variance for distribution balance, and cross-room apartment-wide constraints.

One fix applied mid-loop after peer review:
- Non-null assertion in material-math test collapsed into a direct `.some(/3 wood species/)` assertion.
- Metal conflict isolation improved: both comparison branches now use the same product and `recommendedMaterials`, varying only `roomMetalFinishes`.

### Lessons learned

1. **Reviewer hallucination on non-existent assertion.** Reviewer A (first pass) flagged a "definite test failure" — alleged assertion `expect(prompt).toMatch(/Lifestyle fit.*1\.00/i)` against a base fixture without `lifestyle_axes`. That assertion did not exist. Always re-read the actual file before acting on a reviewer's reported line number; reviewers working from diffs can miscount lines.

2. **lookupMaterial substring matching stores multi-word combos.** When `computeMaterialBalance` tokenises `what_it_needs` specs, two-word combos like "solid maple" get pushed into `allMaterialNames` as "solid maple" (not "maple"). `identifyWoodSpecies` then checks `"solid maple".includes("maple")` → true, so the species is correctly found. But `SOFT_MATERIALS.has("solid maple")` is false even though "solid maple" resolved via substring. Keep soft-item tests using single-word specs ("velvet", "oak") to avoid this ambiguity.

3. **Test isolation requires holding ALL inputs constant.** The metal-conflict comparison initially varied both the product material AND the `recommendedMaterials`, making it impossible to isolate the penalty. Fix: hold product and `recommendedMaterials` constant; vary only `roomMetalFinishes` (warm = conflict, cool = no conflict).

4. **Three pure-test PRs in a row is enough.** Remaining untested modules (`proportion-math`, `spatial-math`, `harmony-math`) are either covered by integration tests or require heavy mock setup. Next run should pivot to a product/UX/latency improvement rather than more unit tests.

### Merge outcome
PR opened with auto-merge enabled (CI-gated squash). Both reviewer subagents approved (Reviewer A approved after fixes; Reviewer B approved first pass).

### Rotation guide for next run
- **Pivot away from test coverage.** The core validation pipeline now has tests. Next run should address something from VISION.md: faster time-to-first-wow, a retention feature (save/revisit designs), or a latency/cost optimisation (pipeline caching, model tier tuning).
- **Remaining untested validation modules**: `proportion-math.ts`, `spatial-math.ts` (sub-module), `harmony-math.ts` (orchestrator — needs mocking). These can wait.
- **Design bar**: any UI change must clear the "warm-editorial" bar before shipping. Open a PR for human review rather than auto-merging visual changes.
