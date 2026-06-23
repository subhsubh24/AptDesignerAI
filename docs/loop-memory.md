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

---

## Run 2026-06-23 (fourth run)

### State on entry
- 876 tests passing, 3 merged PRs (color-math, set-math+bundle-math, product-math+material-math).
- Loop memory explicitly said to pivot to feature/UX/latency — test coverage rotation complete.
- VISION.md "share" retention feature was unimplemented despite the ShareButton component existing.

### Area served this run
**Feature / Retention** — public share links for saved designs.

### What was done
- `supabase/migrations/015_saved_designs_sharing.sql`: adds `share_token TEXT UNIQUE` + `is_public BOOLEAN` columns and RLS policy.
- `app/api/saved-designs/[id]/route.ts`: PATCH method generates `randomBytes(16).toString("hex")` share token when enabling, preserves it when disabling. Guards: ownership via `user_id` filter + `!updated` null-check catches TOCTOU window.
- `app/api/shared/[token]/route.ts`: public GET endpoint (no auth) — queries by `share_token AND is_public = true`. Omits `user_id` from response.
- `app/shared/[token]/page.tsx`: editorial public page with sticky logo header, design direction pull-quote, what_it_needs cards, keep/replace sections, product picks, and a warm CTA to signup.
- `app/saved/[id]/page.tsx`: Share/Shared toggle button, share link panel with copy-link + Make private controls. `origin` state initialized in `useEffect` to avoid SSR hydration mismatch.
- `PENDING_OPS.md` created: documents the migration for the owner to apply when connecting real Supabase.

### Lessons learned

1. **In-memory store update returns `{ data: null }` when 0 rows match.** The memory store `execute()` for updates returns `{ data: rows[0] | null, error: null }`. Always check `!updated` (data null) in addition to `error` to catch TOCTOU windows. Reviewer A caught this.

2. **`typeof window !== "undefined"` in derived state causes hydration mismatch.** Next.js App Router SSR's "use client" components on the server. Any computed value that differs between SSR and client renders (e.g. `window.location.origin`) must be initialized via `useEffect` state to avoid React hydration mismatches. Pattern: `const [origin, setOrigin] = useState(""); useEffect(() => setOrigin(window.location.origin), []);`.

3. **Migration + PENDING_OPS pattern works well.** Writing the migration SQL and documenting it in PENDING_OPS.md lets the code ship now while the owner applies the migration when connecting a real Supabase instance. The in-memory store handles the feature in dev without it.

4. **Two-reviewer pattern caught both issues.** Reviewer A found correctness bugs; Reviewer B cleared design/spend/safety. The split is healthy — Reviewer B might have missed the TOCTOU issue; Reviewer A might have missed the RLS policy concern.

5. **Public share page is a marketing surface.** The `/shared/[token]` page is shown to non-users (via share links). The CTA "Try it free" on the page is an acquisition funnel entry. Future improvement: add OG meta tags (`og:image`, `og:title`, `og:description`) to make shares look good when pasted into iMessage/Slack/Twitter.

### Merge outcome
PR opened with auto-merge enabled (CI-gated squash). Both reviewer subagents approved (Reviewer A approved after 1 fix cycle).

### Rotation guide for next run
- **Next high-value areas**: 
  - OG meta tags for the `/shared/[token]` page (high impact for social sharing, low complexity — pure SSR metadata) ← DONE THIS RUN
  - Latency/cost optimization in the analysis pipeline
  - "Fast time-to-first-wow": streaming progress indicators or skeleton states
- **Avoid**: More test coverage additions until the owner signals this is needed.
- **Watch for**: PENDING_OPS.md items — the owner needs to run migration 015 before share links work in production Supabase.

---

## Run 2026-06-23 (fifth run)

### State on entry
- 876 tests passing, 5 merged PRs (color-math, set-math+bundle-math, product-math+material-math, share links).
- Loop-memory explicitly flagged OG meta tags for `/shared/[token]` as the next priority.
- Share page was shipped last run as a `"use client"` component with client-side fetch; had no OG tags.

### Area served this run
**Feature / Social / SEO** — OG and Twitter Card meta tags for the public share page.

### What was done
- Converted `app/shared/[token]/page.tsx` from a `"use client"` client component (useParams + useEffect fetch) to a Next.js 16 server component with `generateMetadata()`. Dynamic title, description (from design direction or room description, truncated to 155 chars), and image (mockup_url or thumbnail_url) are emitted as `og:title`, `og:description`, `og:image`, `twitter:card`, `twitter:image`.
- Extracted the found-design UI into `app/shared/[token]/SharedDesignView.tsx` (client component) to preserve framer-motion animations.
- Created `app/shared/[token]/not-found.tsx` — Next.js calls this + returns HTTP 404 when `notFound()` is invoked, replacing the old inline 200 not-found render.
- Created `app/shared/[token]/loading.tsx` — Loader2 spinner for the navigation loading transition.
- `React.cache` wraps the DB query to deduplicate across `generateMetadata` and the page render within a single request.
- Zero new LLM calls; zero per-request cost increase.

### Lessons learned

1. **`notFound()` from `next/navigation` returns `never` — use it for 404s.** Rendering an inline "not found" JSX block in a server component returns HTTP 200 with the 404 UI, which is a correctness regression (crawlers index it as valid content). Always call `notFound()` for true 404s; put the UI in a co-located `not-found.tsx`.

2. **OG image `width`/`height` should not be hardcoded if the actual dimensions are unknown.** Social crawlers (Facebook, LinkedIn) use declared dimensions to pre-size image boxes. Declaring 1200×630 for images that are actually thumbnails causes cropping/ratio bugs. Omit `width`/`height` when dimensions are not known at render time — crawlers handle undeclared dimensions by measuring the actual image.

3. **`React.cache` from "react" correctly deduplicates across `generateMetadata` + page render in Next.js 15/16.** Next.js documentation explicitly states this pattern. Reviewer A flagged it as wrong (separate async contexts), but this was the reviewer hallucinating incorrect framework behavior. Cite Next.js docs, not reviewer intuition.

4. **Unsafe casts on `snapshot` fields from the DB need a runtime guard.** The `SharedDesign` type declares `assessment` as required, but the DB returns `snapshot` as `any` (memory store or Supabase JSONB). An early `if (!assessment) return null;` guard in the client component prevents crashes on partial/legacy rows.

5. **The PRIORITY_STYLES raw-Tailwind pattern pre-exists in `saved/[id]/page.tsx`.** Both reviewers flagged it but agreed it should not block this PR since it's not newly introduced. Future refactor: move to `Badge` CVA variants.

### Merge outcome
PR opened with auto-merge enabled (CI-gated squash). Both reviewer subagents approved (1 fix cycle).

### Rotation guide for next run
- **Under-served areas**: Latency improvements (pipeline caching, streaming), "Fast time-to-first-wow" UX improvements, new features from VISION.md (floor-plan parsing, more room support).
- **Avoid**: More OG/SEO changes (done for now), test coverage (well-served).
- **Improvements noted but deferred**: Migrate PRIORITY_STYLES to `Badge` CVA variants (both `saved/[id]/page.tsx` and `SharedDesignView.tsx`), add `metadataBase` to root layout for proper relative OG URL resolution.

---

## Run 2026-06-23 (sixth run)

### State on entry
- 876 tests passing, 6 merged PRs.
- Loop memory rotation guide: "under-served areas — latency improvements."
- No sequential-fetch issues had been addressed yet.

### Area served this run
**Latency / Performance** — dashboard returning-user load time.

### What was done
- `app/dashboard/page.tsx`: Converted per-room image fetch from sequential `for` loop to `Promise.all`. For a user with 3–4 rooms, this reduces dashboard `loadExisting()` wall-clock time by ~3–4×. Each `/api/rooms/${id}/images` call is independent; all results are keyed by `room_type` (no ordering dependency). JavaScript single-threaded event loop makes concurrent object writes safe.
- Fixed a pre-existing ESLint `react/no-unescaped-entities` error (`we'll` → `we&apos;ll`) that would have caused CI to fail on the touched file.

### Lessons learned

1. **Pre-existing lint errors surface when you touch a file.** ESLint in CI only runs on touched files. If you touch a file that already had a lint error, CI will fail. Always run `npx eslint <file>` before committing and fix pre-existing errors in the same commit.

2. **`Promise.all` on plain-object writes is safe in single-threaded JS.** Concurrent async arms writing to `obj[key]` (different keys) or setting a boolean to `true` are always safe — JS has no shared-memory parallelism. Reviewer A's analysis confirmed all six safety questions.

3. **`hasAnalysis` flag order is load-bearing in a subtle way.** Moving it *before* the `await fetch(...)` inside each callback is fine because `room.status` is synchronously available. But the key insight: after `Promise.all` resolves, `hasAnalysis` holds the OR of all rooms' statuses, which is exactly what we want.

4. **loadExisting() pattern is common in other client pages.** Check `app/saved/page.tsx`, `app/picks/page.tsx` for similar sequential-fetch patterns that could be parallelized in future runs.

### Merge outcome
PR #7, auto-merge enabled. Both reviewer subagents approved on first pass.

### Rotation guide for next run
- **Under-served areas**: Pipeline caching or streaming improvements; new features from VISION.md (floor-plan parsing improvements, more room support); `picks/page.tsx` or `saved/page.tsx` UX improvements.
- **Deferred**: PRIORITY_STYLES → Badge CVA variants refactor; `metadataBase` in root layout (low-priority — OG images use absolute external URLs).
- **Watch for**: Similar sequential-fetch patterns in other client pages.
