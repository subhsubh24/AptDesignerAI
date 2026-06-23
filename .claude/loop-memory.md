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
