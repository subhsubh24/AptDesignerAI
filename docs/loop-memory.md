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
