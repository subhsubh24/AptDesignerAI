# Loop memory — AptDesignerAI autonomous engineering loop

Durable lessons across runs. Each run appends; nothing is deleted until a guard makes it redundant.

---

## Run 2026-07-20 (Run 102) — 2 a11y keyboard + mobile side-effect integrity + 2 F2 coverage. 1 a11y candidate DROPPED on review (anti-pattern). PR #670 auto-merge queued.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-58mbe5` == origin default tip `3aae750` (GTM Auditor Run 3 #669 had just merged; my STALE local `origin/...iHAdb` ref showed 1c09a72 and made the branch look +1 — `git fetch` before comparing, per LOOP 4). `npm install` root + mobile. Baseline GREEN: web+mobile tsc, **2179 tests**, determinism, eslint 0 errors (19 warnings all in vendored `.agents/skills/impeccable/**` — out of scope, do not touch).
- **DEEP AUDIT NOT due** (last ran Run 99; next ~Run 103).
- **Scorecard (as_of 2026-07-13) is partly STALE:** its headline `security_rls A+→A` IDOR (mockups POST `product_ids`/`bundle_id` room-binding) is **ALREADY FIXED** at `app/api/mockups/route.ts:554-593` — verify scorecard findings against HEAD before acting, they lag the code. The three human/CI-gated ship-critical dims (functional_reality C, design_taste B, business_case_strength B) are unchanged and NOT loop-buildable.

### Scouting — 6 Haiku lenses
- security/RLS **CLEAN** (54 routes guarded; 20+ tables ENABLE RLS; no secrets), artifact/store-compliance **CLEAN** (pricing/privacy/deletion/permissions/annual-gating consistent), perf **CLEAN** (no non-inert hot-path win; N+1 still inert under memory store). Real finds: 3 keyboard-a11y gaps, 1 mobile partial-payload gap, F2 branch gaps.
- Correctness `BuildingPhoto` res.ok gap = BORDERLINE (decorative photo, `.catch` guards, no fake success) → DEFERRED. F2 candidates VERIFIED before selecting — several scout claims were WRONG (entitlements/web null-period-end ALREADY tested at web.test.ts:88; access-constraints elevator-diagonal boundary ALREADY tested at 105-124). Always grep the test file to confirm a branch is genuinely uncovered before writing a coverage test.

### Shipped (all 2/2-Sonnet-APPROVED) — PR #670
- **A11y (2):** `mockups/page.tsx` lightbox-open + `focus/page.tsx` vision-preview-reopen — both mouse-only `<div onClick>` and the SOLE trigger for their action → `role=button`/`tabIndex`/`aria-label`/`onKeyDown` Enter+Space+preventDefault + `focus-visible:ring-ring`.
- **Mobile F4.1:** `results.tsx` `analyzeRoom()` field-validates the 3 rendered strings + 5 arrays (was object-shape only) → partial 200 now surfaces the existing retryable error instead of blank cards. Same-contract as the server producer → cannot over-reject.
- **F2 (2):** `bundle-math.test.ts` completeness excess penalty (−0.005/item, clamp −0.05; base 0.50 via essential-only coverage + duplicate padding → 0.5/0.48/0.45); `complexity-router.test.ts` classifier SUCCESS path + VERDICT_TO_TIER mapping (the pre-existing "standard" test secretly hit the CATCH fallback — old mock `content:[]` → JSON.parse throws).

### Lessons
1. **An a11y "fix" that duplicates an existing accessible control is a REGRESSION, not a fix.** The dropped ManualScorecardView change added `role=button` to a row that ALREADY had a dedicated keyboard chevron `<button>` (aria-expanded, focus ring) — wrapping that button + a product `<a>` in an outer `role=button` is an ARIA-invalid nested-interactive anti-pattern (extra tab stop, duplicate labels). Before converting a mouse-only clickable div, CHECK whether the action already has a keyboard-accessible control inside/near it; only fix when the div is the SOLE trigger (mockups/focus were). Both reviewers flagged it → reverted even though both APPROVED the batch.
2. **Reviewers can APPROVE and still surface a valid flag** — read the flags, don't just tally verdicts. Acting on the nested-interactive flag was the right call.
3. **Verify scout claims against HEAD.** Scorecard security findings and F2 "untested branch" claims both lagged reality this run; a 2-line grep saved shipping a no-op test or re-fixing a fixed IDOR.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 103** (last ran Run 99) — run the 8-lens sweep BEFORE selecting next run.
- **The three ship-critical dims stay human/CI-gated** (functional_reality C = owner DATA_BACKEND cutover; design_taste B = CI-bound authed axe on diagnosis/mockups/compare + F7 committed screenshots; business_case_strength B = owner annual-billing flip / migration 021). Do NOT re-attempt blind.
- **DEFERRED real items (disjoint, next run):** `BuildingPhoto` res.ok in `app/dashboard/page.tsx` (borderline); more F2 coverage — product-scorer category-calibration branch, calibration.ts computeDynamicBaseline, extract-json unmatched-brace fallback, spend-limiter day-boundary reset (all VERIFY-untested-first). Mobile results palette/materials cards render an empty header on empty payload (minor UX).
- **DO-NOT-RE-FLAG (carry):** mockups IDOR is FIXED; pgvector/N+1 inert under memory store; `--score-*` token swap is churn; ManualScorecardView row already keyboard-accessible via its chevron button (do NOT re-add role=button).

## Run 2026-07-09 (Run 74) — SCORECARD-DRIVEN: data-layer persistence PREPARE (the new #1 ship blocker) + 2 IDOR/security + side-effect-integrity + mobile null-guard. ALL 4 MERGED.

### State on entry
- Cold container, detached HEAD. Reset to origin tip `6361589` (post Run 73 #519-522 + housekeeping #523, + the independent quality grade #524). `npm install` root + mobile (mobile node_modules was ABSENT — installed it, else mobile `npx tsc` pulls broken DOM lib types from root node_modules and false-fails). Baseline gate GREEN: tsc clean, **1889 tests** pass / 11 skip, determinism clean, eslint 0, mobile tsc clean.
- **DEEP AUDIT NOT due** — Run 72 ran the last 8-lens sweep 2026-07-09; next due ~Run 76.
- **QUALITY_SCORECARD (as_of 2026-07-09) DROPPED overall B→C.** THREE ship-critical dims now below A: `functional_reality` **A→C** (the PRODUCTION DATA LAYER is a non-persistent in-memory mock — the #1 blocker), `design_taste` B (unchanged, CI/LLM-bound), `artifact_integrity` **A→B** (preflight GATE 5 red). `security_rls` **A+→A** (one missed IDOR). GROWTH_STATUS pre-launch 0/null → no lever signal. This run worked directly off the scorecard's named gaps.

### Scouting — 3 Haiku lenses + direct scorecard-gap targeting
- The scorecard NAMED the top gaps precisely, so selection was scorecard-driven rather than blind scouting. 3 Haiku lenses (F2 coverage; web correctness/a11y/design; mobile+security-IDOR) confirmed + surfaced the disjoint set.
- **F2 lens:** ergonomics/pairwise-proportions/access-constraints under-covered — BUT their rule helpers are UNEXPORTED (only computeX/formatX exported) and all already have test files; adding non-duplicative branch coverage is murky → SKIPPED this run rather than pad (the scout's "test the private helpers directly" premise didn't hold).
- **Web lens:** `products/page.tsx` `handleEvaluate`/`handleStatusChange` fire-and-forget (no `res.ok` guard) → fake success → shipped #528. (Gallery/palette raw-hex "finding" REJECTED — a palette swatch legitimately renders the literal color; not a token violation.)
- **Mobile+security lens:** confirmed the products/evaluate product↔room IDOR (Run-73 residual) → #530; `results.tsx` unguarded array fields → #529.

### Shipped 4 file-disjoint (integration tree → gated once at 1899 → split into per-change branches; 2 Sonnet reviewers each)
- **#531 (functional_reality — THE #1 SHIP BLOCKER) `DATA_BACKEND` selector.** `lib/supabase/server.ts`: default (`memory`, unset) is byte-equivalent to before (in-memory data + real auth proxied); `DATA_BACKEND=supabase` returns a real user-scoped `@supabase/ssr` client for BOTH auth AND data → persistent Postgres + RLS at runtime. Missing creds under the flag FAIL LOUD in both `createClient()` + `getCurrentUserId()` (no silent memory fallback = the BUILDS≠WORKS trap). Ships INERT (default unchanged); owner cutover = PENDING_OPS `cutover-to-persistent-data`. This is EXACTLY the scorecard's prescription: "PREPARE it (real data client + runtime RLS + persistence test), not a risky cutover." + 7-state wiring test + CAPABILITIES.yml decl. **2 REQUEST_CHANGES → fixed → 2 fresh re-reviews APPROVE** (see lessons).
- **#530 (security_rls A→A+ direction) last 2 IDOR gaps.** `userOwnsRoom` guard on `GET /api/area-analysis` (leaked another user's private diagnosis JSON by client room_id; POST+refine-chat siblings were already guarded — the scorecard named this exact route). Product↔room bind on `POST /api/products/evaluate`: `product.room_id !== room_id` → 404 before the paid scoring (a caller owning room A could pass another user's candidate product_id). Used the direct equality bind, NOT the `userOwnsCandidateProduct` helper — the helper only proves ownership of SOME owned room, not the requested one (a reviewer confirmed the direct check is strictly more correct). + regression tests. Both reviewers APPROVE first pass.
- **#528 (side-effect integrity) products-page silent failure.** `handleEvaluate`/`handleStatusChange` reloaded regardless of `res.ok` → user saw fake success. Guard + `toast.error` (existing pattern) + reload only on success.
- **#529 (mobile) results.tsx array null-guards.** `?? []` on the 5 AI-analysis array fields (was only a top-level object check from #507); prevents an unrecoverable native white-screen crash (no error boundary in `mobile/`).

### Outcome / bookkeeping
- **ALL 4 MERGED** (#528→515c5f1, #529→deeb1d0, #530→f9d9d32, #531→5e08246; required checks verify+build+mobile+lint green; final tip 5e08246). Baseline 1889 → **1899** (+10).
- Housekeeping: reconciled 2 `priority: low` OWNER_ACTIONS (`email-verification-deferred`, `tune-daily-spend-cap`) → `normal` — preflight GATE 5's enum is urgent/high/normal, so `low` failed it → **artifact_integrity B→A** (validated the block parses, 20 items). Added `cutover-to-persistent-data` OWNER_ACTIONS item (referenced by #531).
- **No new ROADMAP ticks** — data-layer is PREPARE-only (Track A stays [ ] until the owner cutover; functional_reality stays C until data actually persists). IDOR/silent-failure/mobile map to already-ticked A/B boxes. No migrations/secrets committed.

### Lessons
1. **"PREPARE, don't cutover" = a flag-gated, inert-by-default REAL path whose default is byte-equivalent.** The whole app + 1889 tests + CI journey-seeding depend on the memory store, so a blind flip to real Supabase would break everything and can't be verified in-sandbox (no real Postgres). A `DATA_BACKEND` selector defaulting to memory ships reviewable persistence code with zero behavior change, and the human owns the actual cutover (apply migrations → set env → flip → verify cold start). This is how you advance a big human-gated blocker without a risky guess.
2. **A code comment must NOT cite a shared-ledger (PENDING_OPS) entry that only lands in the LATER housekeeping PR.** Both C1 reviewers REJECTED on the dangling `cutover-to-persistent-data` slug (didn't exist at C1-merge time). Fix: make the comment SELF-CONTAINED (describe the human steps inline), and add the ledger entry in the same run's housekeeping. Don't assert repo state a code branch can't guarantee.
3. **Fail-loud must be SYMMETRIC across every entry point.** The first C1 had it in `createClient()` but not `getCurrentUserId()` (silently returned the mock UUID under the flag) — a hole in the safety guarantee. Gate EVERY function that reads the creds on the same flag check.
4. **Install `/mobile` deps before running mobile `tsc`** — absent mobile node_modules makes tsc resolve DOM lib types from root node_modules and emit dozens of false lib errors. Not a real failure; `cd mobile && npm install` first.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 76** (Run 72 ran the last 8-lens sweep 2026-07-09).
- **functional_reality (C) is the binding ship blocker and is now OWNER-GATED, not loop-buildable further:** the persistent path is built (#531, DATA_BACKEND flag); it stays C until the owner applies migrations + flips DATA_BACKEND=supabase + verifies a cold start (PENDING_OPS `cutover-to-persistent-data`). Do NOT re-build this — a possible loop follow-on is a persistence INTEGRATION test that runs the money path against a real Postgres when a `SUPABASE_TEST_URL` is provided (skip-gated like the evals), to prove the cutover before the owner flips it — but that needs a test DB the sandbox can't reliably stand up (supabase-local: registry 503 + rlimit per Runs 67-71).
- **design_taste (B) still the other CI/LLM-bound ship blocker** — authed axe on seeded diagnosis/mockups/compare + F7 committed screenshots; not sandbox-verifiable (needs push-and-watch-CI). Unchanged from Run 73.
- **REAL follow-up bugs found this run but NOT fixed (queue for next run, each disjoint):**
  1. **`PATCH /api/products/[productId]` silently drops `status`** — a C3 reviewer found `ALLOWED_KEYS` in that route does NOT include `"status"`, so `handleStatusChange`'s status update returns 200 but never persists (verify before fixing — if real, changing a product's status is a no-op user-facing bug). Disjoint file: `app/api/products/[productId]/route.ts`.
  2. **`products/evaluate-set` product-in-room binding** — Run-73 residual; evaluate-set creates its own products from the body so it's LOWER risk than evaluate was, but double-check no client product_id is read cross-room.
  3. Mobile `results.tsx` palette/materials cards render unconditionally (empty card with just a header on an empty payload) — minor UX inconsistency vs the what-works cards which hide when empty. Low value.
- **DO-NOT-RE-FLAG (carry from Run 73):** #385 embedding pgvector-RPC + all DB/N+1 perf are INERT under the memory data layer UNTIL the cutover above lands (then sequence the pgvector RPC WITH it). `--score-*` token swap is churn (contrast-regression risk). Pro-Annual/migration-021 + share-link gating are OWNER decisions. Palette-swatch raw-hex is NOT a token violation (it renders the literal color).

## Run 2026-07-09 (Run 73) — SECURITY: broken-access-control (IDOR) hardening pass — 3 disjoint security PRs + 1 determinism fix. ALL 4 MERGED.

### State on entry
- Cold container. Reset to origin tip `d6defcd` (post Run 72 #511-515 + housekeeping #516, and gtm Run 7 #518). `npm install` root + mobile. Baseline gate GREEN: tsc clean, **1875 tests** pass / 11 skip, determinism clean, eslint 0 (root), mobile tsc clean.
- **DEEP AUDIT NOT due** — Run 72 ran the last 8-lens sweep 2026-07-09; next due ~Run 76.
- QUALITY_SCORECARD (as_of 2026-07-05, overall **B**, ship_gate false): **design_taste (B) STILL the sole ship-critical dim below A.** Feasibility-scouted its closure this run (below) → confirmed still CI/LLM-bound, correctly deferred. GROWTH_STATUS pre-launch 0/null → no lever signal. No open PRs on entry.

### Scouting — 6 parallel Haiku lenses + a design_taste feasibility probe
- **WEB RELIABILITY lens surfaced the run's anchor: a SYSTEMIC missing-ownership-check (IDOR) cluster.** ~11 API routes call `getUser()`/`getCurrentUserId()` then resolve a room/project/bundle by a **client-supplied id** with NO ownership check. Root cause = the in-memory data layer (`createClient()`→`createMemoryClient()` for data; real Supabase only for auth) whose `QueryBuilder` does NOT auto-scope by user — so tenancy is enforced ONLY by an explicit `userOwnsRoom`/`userOwnsProject` guard. Verified EACH by direct read (`picks` + `rooms/[roomId]/diagnosis` were already correctly scoped; the rest were not). `diagnosis/route.ts` passed a deliberately-unused `_userId` — a reliable smoking gun for a dropped guard.
- **F2 lens:** pairwise-proportions/access-constraints/product-scorer/ergonomics untested branches (deferred — the security cluster was the maximal disjoint value this run).
- **MOBILE lens:** palette chips render `colors.backgroundElement` not the recommended color — but `recommended_palette` holds color NAMES, not hex, so a name-as-CSS swatch isn't a clean fix → deprioritized (uncertain).
- **STORE/ARTIFACT lens:** top items are the known owner-gated Pro-Annual/migration-021 (#487) + a small auth-page-metadata SEO fix (deferred).
- **AI-PIPELINE lens:** `refine-summarizer.ts` `.chat()` missing `seed: DETERMINISTIC_SEED` (shipped #522).
- **design_taste feasibility probe:** diagnosis/mockups axe is NOT hermetically runnable per-PR (needs live LLM or a multi-stage cassette expansion — the cassette's generic JSON stage returns a mockup-prompt body that would fail diagnosis Zod parsing); compare is borderline (needs seeded evaluated products, invisible to the memory-store route unless seeded via the app API); F7 screenshots need committed baselines un-generatable in-sandbox. → design_taste stays correctly deferred (6th+ run confirming).

### Shipped 4 file-disjoint (integration tree → gated once at 1889 → split into per-change branches; 2 Sonnet reviewers each)
- **#519 (SEC-A) read-leak IDORs** — `userOwnsRoom` guard on `GET /api/products`, `GET+POST /api/area-analysis/refine-chat`, `POST /api/saved-designs`. Each previously leaked another user's candidate products / refine chat / a full snapshot of their private diagnosis+products+bundles. + 8-test regression suite (non-owner→404 before any read; owner still passes). **1 REQUEST_CHANGES → added refine-chat POST coverage + owner-happy-path asserts → re-review APPROVE (mutation-tested).**
- **#520 (SEC-B) compute/write IDORs** — `userOwnsRoom` guard BEFORE the paid LLM call on `POST` diagnosis, diagnosis/stream, area-analysis/refine, bundles/evaluate (via bundle.room_id), products/evaluate, products/evaluate-set. refine also now derives the project from the OWNED room (not a client `project_id`). + 2-route regression test.
- **#521 (SEC-C) project-scoped IDORs** — NEW `userOwnsProject` helper (filters projects by BOTH id+user_id) + unit tests; applied to `analyze-apartment` GET+POST and `apartment-research` POST (the latter WRITES building_research back to a client `project_id` → cross-tenant overwrite). apartment-research guards only when project_id is truthy (building-only research touches no project).
- **#522 (determinism)** — `refine-summarizer.ts` `.chat()` was the lone agent call missing `seed: DETERMINISTIC_SEED`; `resolveSeed(undefined)` returns undefined in prod (DETERMINISTIC flag off) → non-deterministic. Added the seed.

### Outcome / bookkeeping
- **ALL 4 MERGED** (#519→597c3b4, #520→c9055c2, #521→36ddc73, #522→81ddd67; required checks verify+build+mobile+lint green; final tip 81ddd67). Baseline 1875 → **1889** (+14). No new migrations/secrets → PENDING_OPS unchanged.
- **No ROADMAP box ticked** — no specific IDOR/access-control checkbox exists; recorded as Track A (secure web app) / Track G (security & abuse hardening) hardening. Parent boxes stay [ ]. design_taste readiness NOT attempted.
- Guards return **404 (not 403)** matching the codebase convention (`products/[productId]`, `refine`) — no existence-enumeration oracle.

### Lessons
1. **The in-memory-store data layer makes EVERY route responsible for its own tenancy.** There is no RLS backstop for data (real Supabase is auth-only), so a route that resolves a resource by a client id without a `userOwns*` guard is an IDOR. Grep pattern to hunt the class: `getUser`/`getCurrentUserId` + `.eq("id"/"room_id"/"project_id", <client value>)` with no `userOwns*` call. A `_`-prefixed unused `userId` param is a smoking gun for a guard that was dropped.
2. **Placement matters:** guard BEFORE the resource read for read-leaks (else you still leak), and BEFORE the LLM/agent call for compute-abuse. For the bundle→room chain the one cheap `product_bundles` lookup is unavoidable (you need room_id to check ownership), but evaluation + product exposure are all gated after it.
3. **Don't trust a client-supplied SECONDARY id even when the primary is owned** — area-analysis/refine took `project_id || room.project_id`, letting an owner of the room feed a different user's project into the prompt; derive it from the owned room instead.
4. **A large same-class security fix splits cleanly by the helper it needs** (room-scoped vs project-scoped) — keeps each PR coherent + file-disjoint while fixing the whole class in one run rather than leaving known holes open across the 6h cadence.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 76** (Run 72 ran the last, 2026-07-09).
- **design_taste (ship-critical, B) is STILL the lone ship blocker** — CI/LLM-bound (authed axe on diagnosis/mockups needs a multi-stage cassette expansion + seeded pipeline data; F7 screenshots need committed baselines). Not sandbox-verifiable; needs push-and-watch-CI infra work, not a blind attempt.
- **IDOR follow-ups (NOT fixed Run 73):** (a) `products/evaluate` + `products/evaluate-set` verify room ownership but NOT that the client `product_id` belongs to that room — the existing `userOwnsCandidateProduct` helper is unused there (already used in `products/[productId]`); (b) SEC-B regression test covers 2 of 6 routes (rest verified by review). (c) Consider a lint/test guard that flags a route resolving a client id without a `userOwns*` call, so this class can't silently reappear.
- **DO-NOT-RE-FLAG / DO-NOT-BUILD (carry):** #385 embedding pgvector-RPC + all "DB payload/N+1" perf are INERT under the in-memory data layer. `--score-*` token swap is churn (contrast-regression risk). #348 entitlement-fail-open already RESOLVED. Mobile palette-swatch needs a name→hex map (not a clean win). Pro-Annual/migration-021 (#487) + share-link gating (#502) are OWNER decisions.

## Run 2026-07-09 (Run 72) — DEEP AUDIT (8-lens) + 5 disjoint value-bar changes: G2 (last write-endpoint validation gap) + G1 (rate-limit sweep) + A1 (public-share reliability) + 2× F2 tests. ALL 5 MERGED.

### State on entry
- Cold container. Reset to origin tip `f2794a2` (post Run 71 #503-509 + housekeeping #510). `npm install` root + mobile. Baseline gate GREEN: tsc clean, **1846 tests** pass / 11 skip, determinism clean, eslint 0 (root), mobile tsc clean.
- **DEEP AUDIT DUE** — Run 69 ran the last one 2026-07-08; rotation guide said "due ~Run 72" → ran the 8-lens sweep this run BEFORE selecting.
- QUALITY_SCORECARD (as_of 2026-07-05, overall **B**, ship_gate false): **design_taste (B) is STILL the SOLE ship-critical dim below A**; its 2 capping items (authed axe on seeded diagnosis/mockups/compare; F7 committed screenshots) remain CI/auth-stack-bound (supabase-local: registry 503 + rlimit-denied container init per Runs 67-71), unverifiable in-sandbox → NOT attempted blind. GROWTH_STATUS pre-launch 0/null → no lever signal.

### DEEP AUDIT (8 Haiku read-only lenses across the WHOLE codebase)
- **SECURITY & RLS: CLEAN through migration 029.** 26 public tables all RLS-enabled; both entitlement paths (RC `server.ts` + Stripe `web.ts`) fail-CLOSED-on-misconfig-in-prod / OPEN-on-outage (so open issue **#348's "entitlement fails open when key unset" is ALREADY RESOLVED in code**); SSRF guarded (product-verify fixed Run 71); no committed secrets; handle_new_user search_path pinned (024). No findings.
- **PERFORMANCE: largely INERT (key realization).** The data layer is the **in-memory store** — `lib/supabase/server.ts` `createClient()` returns `createMemoryClient()` for data and only proxies real Supabase for AUTH ("memory store as the data layer until a full DB migration is done"). So the perf scout's "full-table scan / oversized payload" findings (embedding-index #385, bundles/products nested selects) are **in-process array ops, not DB round-trips** — no pgvector, no network. The pgvector match-RPC fix for #385 would be **DEAD CODE** (MemoryClient has no `.rpc()`) until the real-DB migration lands → correctly NOT built (explains why #385 has stayed open across runs). Payload-narrowing on bundles/products GET would break the client consumers (bundles page renders the nested data) → deferred.
- **CORRECTNESS & DEAD CODE:** dashboard load already guards every fetch with `res.ok` (array-guard finding low-value → dropped); the public shared-design page snapshot deref was a real 500 → shipped #512.
- **A11Y & DESIGN:** the `--score-*` tokens exist in globals.css (light+dark) but are **DEAD** (zero usages) while `verdicts.ts` hardcodes emerald/amber/rose at WCAG-AA-tuned `-700/-800` weights — swapping to the tokens risks regressing the documented contrast → churn, dropped. Design SYSTEM stays A-territory; capped only by the CI-bound axe/screenshots.
- **MOBILE & MONETIZATION:** core native journey + server-side entitlement gating production-ready; only a trivial hardcoded notification-light-color finding (skipped).
- **TEST & EVAL:** MMR reranker + query-exploration rerankers under-covered on real branches → shipped #513/#514. (pairwise-reranker needs provider-mocking → deferred to pure targets.)
- **TRACK-G HARDENING:** G2 had ONE remaining gap (rooms/images POST → #511); G1 had ~9 authed write endpoints with no rate limit (→ #515); G4 login-lockout/password-reset are Supabase-managed (no custom route → no pre-launch fix needed).
- **ARTIFACT FRESHNESS:** PENDING_OPS `as_of` 10 days stale + a phantom "Anthropic" in the spend-caps provider list (app uses Gemini+DeepSeek, not Anthropic) → both fixed in this housekeeping PR. reconcile-canonical-domain `status: done` follows the file's repo-done+owner-followup convention (not a contradiction) → left. Pricing/processors/BUSINESS_CASE_SUMMARY consistent.

### Shipped 5 file-disjoint (integration-tree → gated ONCE at 1869 → split into per-change branches; 2 Sonnet reviewers each)
- **#511 (G2) rooms-images POST validation** — was truthy-only on image_url. Added a pure, unit-tested helper `lib/utils/image-url.ts` `isAcceptableStoredImageUrl` + length bounds on image_type/storage_path/caption. **2 real review catches (2 cycles):** (A) the first https-only `new URL()` check would have 400'd EVERY real upload — the memory-store `getPublicUrl()` returns a RELATIVE `/uploads/<bucket>/<path>` the UI posts back → fixed to accept internal same-origin paths OR absolute https; (B) re-review found `!url.startsWith("//")` was BYPASSABLE via backslash/tab/newline (`/\evil.com`, `/<tab>/evil.com`) which the WHATWG URL parser normalizes to an off-origin host reaching an `<img src>` sink → fixed to `new URL(url, INTERNAL_BASE).origin === INTERNAL_BASE` + regression tests; a 3rd fresh reviewer confirmed closed.
- **#515 (G1) write-endpoint rate limiting** — shared `lib/utils/write-rate-limit.ts` `enforceWriteRateLimit(userId, bucket, config)` (60 writes/min, 30 deletes/min per user, keyed `write:<bucket>:<userId>`, ready 429+Retry-After) wired AFTER the auth guard on projects POST + [id] PUT/PATCH/DELETE, rooms POST + [id] PATCH/DELETE, products POST + [id] PATCH/DELETE, email-preferences PUT, saved-designs/[id] PATCH/DELETE, bundles POST. + helper unit test.
- **#512 (A1) public shared-design reliability** — a public `saved_designs` row with a null/malformed `snapshot` 500'd the shared page (generateMetadata + view both deref `snapshot.assessment`) → pure `isValidSnapshot()` guard (`snapshot-guard.ts`) returns null → clean 404 on a growth-loop surface. + guard unit test.
- **#513 (F2) MMR reranker tests** — pinned the exact `productSimilarity` weighted formula (0.3/0.3/0.2/0.2, hand-verified 0.5/1÷6/0.5/0.2), fractional Jaccard, both-empty→0, maxP=1 price floor; `selectByMMR` λ=0 pure-diversity, k-cap, range=0 normalization edge.
- **#514 (F2) query-exploration tests** — style-synonym swap-in-place vs rebuild-else, budget→"affordable"/high_end→"luxury" tier suffixes, modifier fallback, via a deterministic reproducible room-id scan (the function is pure).

### Outcome / bookkeeping
- **ALL 5 MERGED** (#511→f02be9b, #512→18d6923, #513→7cc0323, #514→f3bb8f4, #515→45d53a6; required checks verify+build+mobile+lint green; final default tip f02be9b). Baseline 1846 → **1875** (+29 tests). No new migrations/secrets.
- **Ticked ROADMAP G2** — the last write-endpoint validation gap (rooms/images) closed + the independent deep-audit G2 lens confirmed validation is comprehensive across ~45 endpoints. **Parent Track G stays [ ]** (G1 has an out-of-scope floor-plan-DELETE gap; G4 login-lockout is Supabase-managed/partial). #512→A1 (already [x]); #513/#514→F2 (already [x]); #515→G1 (stays [ ]).
- Readiness NOT attempted (design_taste still auditor-owned at B; its closure is CI-verifiable-only build work).

### Lessons
1. **VERIFY the data layer before building a "DB perf" fix.** This repo runs entirely on the in-memory store for DATA (real Supabase only for auth). So every "full-table scan / N+1 / oversized payload" perf finding is an in-process array op, NOT a DB round-trip — inert until the real-DB migration. The #385 pgvector-RPC would be dead code AND crash the MemoryClient (no `.rpc`). Confirm `createClient()`'s actual return before acting on a perf audit.
2. **Same-origin URL validation MUST delegate to the platform URL parser against a fixed base** (`new URL(url, base).origin === base`), never a hand-rolled `startsWith("//")`. Backslash (`/\host`) and embedded tab/newline (`/<tab>/host`) are stripped/normalized by the WHATWG algorithm to an off-origin authority — exactly how the browser later resolves `<img src>` — so a prefix check is bypassable. (Two reviewer cycles caught this on #511.)
3. **A validation change that duplicates the app's own value-production path can 400 legitimate traffic.** The first #511 https-only check would have rejected the app's REAL upload URLs (relative `/uploads/...` from the memory store). Trace how the value is actually PRODUCED (upload route → getPublicUrl → client POST) before enforcing a shape on it.
4. **A dead-but-present design-token system tempts a "wire it up" change that can silently regress tuned contrast.** `--score-*` tokens are unused while verdicts.ts hardcodes deliberately WCAG-AA-tuned `-700/-800` weights; swapping in the token hex would change the ratio. Confirm contrast-neutrality before calling a token migration a fix.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 76** (ran this run, 2026-07-09).
- **design_taste (ship-critical, B) is STILL the lone ship blocker** — CI/cassette-bound (extend the render cassette to the text stages → seed authed diagnosis/mockups/compare → authed axe + toHaveScreenshot baselines). Needs push-and-watch-CI, not in-sandbox verification.
- **DO-NOT-RE-FLAG / DO-NOT-BUILD:** #385 embedding pgvector-RPC + all "DB payload/N+1" perf findings are INERT under the in-memory data layer (would be dead code / crash MemoryClient) — defer until the real-DB migration. `--score-*` token swap is churn (contrast-regression risk). #348 entitlement-fail-open is already RESOLVED in code. rooms/images validation (#511), the 9 G1 write-endpoint rate limits (#515), shared-page snapshot guard (#512) are DONE. Security CLEAN through 029.
- **Track G carry:** G1 still [ ] — one out-of-scope gap (`DELETE /api/projects/[projectId]/floor-plan` has no rate limit) + the paid-API endpoints already covered; G4 login-lockout/password-reset are Supabase-managed (document, don't build a custom route). F2 carry: pairwise-reranker (needs provider mock), bundle-math spatial boundaries.

## Run 2026-07-08 (Run 71) — 7 disjoint value-bar changes: 1 SSRF + 2× G2 PATCH validation + 1 A1 dashboard guard + 1 mobile blank-screen guard + 1 F2 test + 1 ship-critical business-case honesty fix (closes #486). ALL 7 MERGED.

### State on entry
- Cold container. Reset to origin tip `8b30d64` (post Run 70 #497-500 + housekeeping #501). `npm install` root + mobile. Baseline gate GREEN: tsc clean, **1840 tests** pass / 11 skip, determinism clean, eslint 0 (root), mobile tsc clean.
- **DEEP AUDIT NOT due** — Run 69 ran the 6-lens sweep 2026-07-08; next due ~Run 72.
- QUALITY_SCORECARD (as_of 2026-07-05, overall **B**, ship_gate_met false): **design_taste (B) remains the SOLE ship-critical dim below A** (functional_reality/correctness/security_rls/store_readiness/artifact_integrity/business_case_strength all A/A+); its 2 capping items (authed axe on seeded diagnosis/mockups/compare; F7 committed screenshots) are CI/auth-stack-bound, unverifiable in-sandbox per Runs 67-70 → NOT attempted blind. GROWTH_STATUS pre-launch 0/null → no lever signal.
- Open-issue scan surfaced **#486 (business-case honesty, ship-critical, GTM-auditor-filed)** as actionable + sandbox-verifiable factory-owned work → became this run's anchor change.

### Scouting — 7 parallel Haiku lenses
- **A1 web correctness:** rich vein in `dashboard/page.tsx` — handleAnalyze silently reverted to setup on a failed apartment analysis (no error), room-notes PATCH console-only → shipped #504 (BuildingPhoto decorative-degradation deferred as before).
- **SECURITY/RLS:** CLEAN through 029 EXCEPT one real NEW SSRF: `computer-use/product-verify` passed a user `product_url` into Browserbase server-side with no `validateExternalUrl()` (sibling ingest guards) → shipped #503.
- **Track G/F hardening:** `rooms/[roomId]` + `products/[productId]` PATCH copied ALLOWED_KEYS straight to the DB with ZERO validation while the sibling POSTs validate (real G2 gap) → shipped #509 + #505.
- **F2 coverage:** `groundConfidence()` (core scorer, 7 penalties, 0 coverage) → shipped #506. Validation formatters (access-constraints/budget-allocation) deferred as lower value.
- **MOBILE:** `results.tsx` analyzeRoom unchecked `as {analysis}` cast → a malformed 200 renders a BLANK dead-end screen → shipped #507.
- **a11y/design:** the toast/badge `info` blue variants (scout-flagged as VISION generic-blue violations) have **NO call sites** (only a doc-comment example) → DEAD → dropped as churn. Topbar emerald step-indicator = defensible semantic (done=green) → deferred.
- **ARTIFACT:** pricing/processors/BUSINESS_CASE_SUMMARY consistent; the sole finding (email-lifecycle omits Pro Annual) is low-value AND entangled with the open #487 owner decision (Pro-Annual transactability pending migration 021) → deferred.

### Shipped 7 file-disjoint changes (integration-tree → split-into-branches; gated once at 1846 tests; 2 Sonnet reviewers each)
- **#503 (security) SSRF** — `app/api/computer-use/product-verify/route.ts` now `validateExternalUrl(product_url)` before `runProductVerifier` (Browserbase server-side fetch), mirroring the sibling ingest route. Reviewers noted the shared-validator residuals (DNS-rebinding, alt IP encodings, redirect-time) are pre-existing on both call sites → future shared-validator hardening, out of scope.
- **#509 (G2) rooms PATCH validation** — string-length + **enum-membership** (room_type per migration 002's replacement constraint, status/budget_mode/sourcing_mode per 001) + **integer** budget_dollars + **non-empty** name/room_type (the only 2 NOT NULL cols) + array bounds → clean 400 instead of a DB 500. **Reviewer A REQUEST_CHANGES (cycle 1) → 3 real gaps fixed (see lessons).**
- **#505 (G2) products PATCH validation** — mirrors the sibling POST bounds exactly (strings ≤2000, arrays ≤100/≤500, dimensions/metadata objects ≤50KB, finite price/user_rating); all 14 ALLOWED_KEYS covered 1:1.
- **#504 (A1) dashboard silent failures** — handleAnalyze failure/throw now `toast.error` + reverts; room-notes PATCH failure now `toast.error` (informs, still navigates — the note is optional; toast persists across client nav via the root ToastProvider singleton).
- **#507 (mobile) blank-screen guard** — `analyzeRoom` throws on a missing/non-object `analysis` so `run()`'s catch shows the existing retry UI instead of a blank stage-'done' screen; type loosened to `analysis?` (tsc narrows after the guard).
- **#506 (F2) groundConfidence tests** — +6 tests: each of 7 signal penalties isolated (catches a mis-wired signal→penalty), stacking, floor clamp to 1, ceiling clamp to 10, `8.85→8.9` rounding.
- **#508 (docs, ship-critical honesty) BUSINESS_CASE #486** — `floor_met_year1: true→false`; `time_to_floor` rewritten to the honest ramp (year-1 exit run-rate ≈$58-60K from the doc's own month-12 pool math, floor ~year 3); $122.9K relabelled steady-state across summary/Scenario B/sensitivity table/honest-statement; arr_year1.base stays 122900 (body+preflight consistent); no inputs inflated. Both reviewers independently re-derived the ~$59K run-rate + confirmed reconciliation.

### Outcome / bookkeeping
- **ALL 7 MERGED** (#503→d519696, #504→f135422, #505→98c79f2, #506→aeefd0d, #507→90429be, #508→219ef4c, #509→a3b93db; required checks verify+build+mobile+lint green; final default tip 98c79f2). Baseline 1840 → **1846** (+6 F2).
- Closed **#486** (fix merged #508) with a reference comment; left the grade to the independent auditor (maker ≠ checker).
- No new migrations/secrets → PENDING_OPS unchanged. **No ROADMAP box ticked** — G2 validation is partial (not every write endpoint re-audited, so G2 stays [ ]); #504→A1, #506→F2, #507→Track B all already [x]; #508 fixes honesty but the DoD business-case box stays [ ] (still needs the maximization levers).
- Readiness NOT attempted (design_taste still auditor-owned at B; CI-verifiable-only closure).

### Lessons
1. **A scout "design violation" in a shared UI primitive must be confirmed to have real CALL SITES before building.** The toast/badge `info` blue variants read as VISION generic-blue violations but had zero usages (only a doc-comment `toast.info(...)` example) → dead code; fixing them would have been churn. Grep for actual call sites, not just the definition.
2. **Server-side validation that duplicates DB CHECK/NOT-NULL constraints must be verified against the ACTUAL current migration.** `room_type`'s live constraint is migration 002's 10-value replacement, NOT 001's stale 5-value list; an over-restrictive allow-list would REJECT legitimate values (a worse regression than the gap). Cross-check the enum against what the app actually sends (getRoomSections, the Select options) before shipping.
3. **A present-but-null value slips past `v !== null`-guarded checks and 500s at a NOT NULL column.** Validate NOT NULL columns (here name/room_type) explicitly with a "present ⇒ non-empty string" check; the generic string-limit loop that skips null is not enough.
4. **The integration-tree → split-into-per-change-branches pattern gates a large disjoint batch ONCE** (7 changes, one tsc/test/determinism/eslint run) then reviews+merges independently — efficient and conflict-free when every change is file-disjoint.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 72** (Run 69 ran the last one 2026-07-08). Run the full sweep BEFORE scouting next run.
- **design_taste (ship-critical, B) is STILL the lone ship blocker** — CI/cassette-bound (extend the render cassette to the text stages → seed authed diagnosis/mockups/compare → authed axe + toHaveScreenshot baselines). Highest-value convergence work but needs push-and-watch-CI, not in-sandbox verification.
- **DO-NOT-RE-FLAG:** product-verify SSRF (fixed #503); rooms/products PATCH validation (fixed #509/#505); dashboard handleAnalyze + room-notes silent failures (fixed #504); mobile results blank-screen (fixed #507); groundConfidence coverage (#506); BUSINESS_CASE floor-timing honesty (fixed #508, #486 closed). Security CLEAN through 029. toast/badge `info` blue variants are DEAD (no call sites). Topbar emerald step-indicator = defensible semantic. email-lifecycle Pro-Annual + share-links-Pro-gating (#502) are entangled with owner decisions (#487/#502) — not unilateral factory fixes.
- **Track G carry:** G2 has more write endpoints to potentially validate (rate-limit-only gaps on projects PUT/email-preferences/bundles/products POST — lower value, RLS-confined); G1 rate-limiting + G4 auth-hardening still open. F2 formatters (access-constraints/budget-allocation) are cleanly testable carry.

## Run 2026-07-08 (Run 70) — 4 disjoint value-bar changes: 1 A1 silent-failure guard on the CORE journey + 1 F2 pure-logic test suite + 2 a11y/design contrast fixes. ALL 4 MERGED.

### State on entry
- Cold container. Reset to origin tip `99fdd9e` (post Run 69 #491-493 + housekeeping #495 + CI auto-migrate #496). `npm install` root + mobile. Baseline gate GREEN: tsc clean, **1822 tests** pass / 11 skip, determinism clean, eslint 0 (root), mobile tsc clean.
- **DEEP AUDIT NOT due** — Run 69 ran the 6-lens sweep earlier today (2026-07-08); next due ~Run 72.
- QUALITY_SCORECARD (as_of 2026-07-05, overall **B**, ship_gate_met false): **design_taste (B) remains the SOLE ship-critical dim below A**; its 2 capping items unchanged (authed axe on seeded diagnosis/mockups/compare; F7 committed screenshots) — both CI/auth-stack-bound, unverifiable in-sandbox (supabase-local: registry 503 + rlimit-denied container init, per Run 67/68/69). NOT attempted blind. GROWTH_STATUS pre-launch 0/null → no lever signal.

### Scouting — 7 parallel Haiku lenses
- **A1 web correctness:** rich vein in the CORE `focus/page.tsx` — 4 handlers swallow failures (see shipped). dashboard photo-load (decorative degradation, deferred — conflicts file-wise with #499 anyway).
- **F2 coverage:** `identifiable-brands.ts` genuinely under-covered (only isAllowListedBrand had 2 asserts) → shipped. `diagnosis-examples.ts` weaker (only 1 exported fn; helpers unexported) → deferred.
- **SECURITY/RLS: CLEAN** through 028/029 (RLS solid, entitlements fail-CLOSED in prod, SSRF guarded, no secrets) → no busywork. **STORE readiness CLEAN.**
- **MOBILE:** #500 linkPrimary blue shipped. **VERIFIED-DOWN a scout false positive:** the "off-brand blue splash gradient, first visual users see" is `AnimatedIcon` (expo-logo + blue gradient) = DEAD template code (exported, never rendered; real splash is on-brand `AnimatedSplashOverlay`) → dropped as churn.
- **DESIGN/A11Y:** #499 dashboard badges shipped (real WCAG AA fail). SharedDesignView priority badges are dark-text-on-light (AA-passing) → taste not a11y, deferred (semantic keep/remove coloring defensible, consistent with prior runs treating semantic feedback colors as acceptable).
- **ARTIFACT:** pricing/processors/README consistent. The share-links-marketed-Pro-but-ungated inconsistency is a monetization DECISION (gate behind Pro vs keep free as a viral loop) touching the business case → deferred, not forced unilaterally.
- **PERF:** all findings inert under the in-memory data layer (topKSimilar N+1 needs a human pgvector migration AND a MemoryClient that supports .rpc → deferred, same as #385). No perf change cleared the bar.

### Shipped 4 file-disjoint changes (each own branch off 99fdd9e; 2 Sonnet reviewers each — 8/8 APPROVE)
- **#497 (C1) fix(a1)** — the core per-room `focus/page.tsx` swallowed failures on 4 action handlers: handleSaveDesign (fake success), handleGenerateMockup (unguarded fetch throw → stuck spinner, no error), handleManualSubmit (console-only), handleSaveAndContinue (the "mark room completed" PATCH was ENTIRELY unchecked → a failed completion still navigated the user away believing the room was done = state/server desync / progress loss). Fixed via the app's existing `toast.error` primitive + block navigation in handleSaveAndContinue unless the completion PATCH succeeds. Reviewers verified against the real PATCH endpoint semantics.
- **#498 (C2) test(f2)** — `identifiable-brands.ts` (product-identifier prompt + confidence-floor gate) had only 2 thin asserts → +18 tests: getIdentifiableBrands env-override parse/merge/dedup-by-lowercase/malformed-filter + never-throw fallbacks (bad JSON / non-array / missing file), lookupBrand case/trim, formatBrandsForPrompt hint-slice + limit boundaries. Real temp file, cleaned up in afterEach; deterministic (no Date.now/random).
- **#499 (C3) a11y** — dashboard Done/Outstanding badges = white on bg-emerald-600/90 (~3.4:1) + bg-amber-500/90 (~1.9:1), both FAILING WCAG AA (10px text; /90 composited over room photos = background-dependent) → solid bg-emerald-700 (~5.5:1) + bg-amber-700 (~5.0:1), semantics kept, In Progress badge untouched.
- **#500 (C4) design(mobile)** — ThemedText `linkPrimary` hardcoded `color: '#3c87f7'` (off-brand blue that ALSO failed WCAG AA ≈3.3:1 on the light bg) overriding the theme → routed through the theme brand `accent` (#b4501e/#d4733e, AA-safe), hardcoded hex removed. Explicit themeColor still wins.

### Outcome / bookkeeping
- All 4 both-Sonnet-APPROVED, auto-merge SQUASH, file-disjoint (focus page / test / dashboard / mobile primitive). **ALL 4 MERGED** (#497→82db90d, #498→c9c869d, #499→99c0018, #500→82a86da; required checks verify+build+mobile+lint green; default tip 82a86da). Baseline 1822 → **1840** (+18 F2).
- No new migrations/secrets → PENDING_OPS unchanged. **No ROADMAP box ticked** (#497 → Track A/A1 already [x]; #498 → F2 already [x]; #499/#500 feed auditor-owned design_taste but don't touch its capping axis) — never mass-tick, never self-grade.
- Readiness NOT attempted (design_taste still auditor-owned at B; its closure is CI-verifiable-only build work, not doable blind in-sandbox).

### Lessons
1. **VERIFY scout claims about "used"/"first visual" before building.** The mobile splash "violation" was `AnimatedIcon` — exported dead template code, never rendered. The real splash (`AnimatedSplashOverlay`) is already on-brand. Cheap Haiku discovery is a LEAD; confirm the component is actually mounted before treating a color as a shipped violation.
2. **An unchecked mutation PATCH immediately before navigate() is the highest-severity silent-failure class** — it's progress-loss / state desync, not just a missing toast. Gate the navigation on the write actually succeeding (early-return on !ok), don't just add a toast.
3. **A translucent badge fill (`/90`) over user-content images makes a static contrast ratio meaningless** — the effective color depends on the photo behind it. Solid fills are both the a11y fix and a determinism win.
4. **design_taste remains the lone ship blocker and is genuinely CI/auth-stack-bound here.** Its closure = the "extend the render cassette to the text stages → seed authed diagnosis/mockups/compare → authed axe + toHaveScreenshot baselines" push (Run-65-flagged), a CI-only-verifiable focused run. Do NOT attempt it blind in-sandbox (supabase-local unrunnable both axes).

### Rotation guide for next run
- **DEEP AUDIT due ~Run 72** (Run 69 ran the last one 2026-07-08).
- **design_taste (ship-critical, B) is STILL the lone ship blocker** — CI/cassette-bound (see lesson 4). Highest-value convergence work but needs push-and-watch-CI, not in-sandbox verification.
- **DO-NOT-RE-FLAG:** focus-page 4-handler silent failures (fixed #497); identifiable-brands coverage (#498); dashboard Done/Outstanding badge contrast (#499); mobile linkPrimary blue (#500). Security CLEAN through 028/029. Perf N+1 inert under the in-memory store. `AnimatedIcon` blue gradient is DEAD code (not a shipped violation). SharedDesignView priority badges pass AA (taste, not a11y). The share-links-Pro-gating inconsistency is an unresolved monetization DECISION (gate vs free viral loop) — needs an owner call, not a unilateral factory fix.
- **A1/F2 carry (lower value):** dashboard building-photo load (decorative degradation); diagnosis-examples.ts (only 1 exported fn, helpers unexported — heavier).

## Run 2026-07-08 (Run 69) — DEEP AUDIT (6-lens) + 3 disjoint value-bar changes (1 mobile null-crash fix + 1 security-critical test + 1 living-artifacts doc). ALL 3 MERGED.

### State on entry
- Cold container. Reset to origin tip `0980830` (post Run 68 #477-483 + housekeeping #484; commits #485-490 since are meta/other-routine syncs — FACTORY_STANDARD/VISION/gtm-audit, NOT factory build runs → this is the first factory run since Run 68 = Run 69). `npm install` root + mobile (mobile deps were ABSENT on entry, so the initial `mobile tsc` "Cannot find module 'expo-router'…" errors were missing-install, not regressions — cleared after `cd mobile && npm install`). Baseline gate GREEN: tsc clean, determinism clean, eslint 0 (root), **1815 tests** pass / 11 skip, mobile tsc clean.
- DEEP AUDIT was DUE (last full audit Run 68 2026-07-06, >24h ago) → ran a 6-lens Haiku sweep BEFORE selecting.
- QUALITY_SCORECARD (as_of 2026-07-05, overall B, ship_gate_met false): **design_taste (B) remains the SOLE ship-critical dim below A**; its 2 capping items unchanged (authed axe on seeded diagnosis/mockups/compare; F7 committed screenshots). GROWTH_STATUS pre-launch 0/null → no lever signal.

### ENVIRONMENT CONSTRAINT (decisive) — authed E2E / design_taste closure NOT verifiable in-sandbox
The design_taste ship-gate closure needs the authed E2E stack. Attempted to stand it up: `npx supabase start` — docker daemon was down; started it (`service docker start`; Docker 29.3.1 came up despite an rlimit warning) — but `supabase start` then FAILED both attempts: (1) ghcr.io / public.ecr.aws image pulls returned **503 through the agent proxy**; (2) even with images cached, container init failed with **`error setting rlimit type 7: operation not permitted`** (the sandbox restricts the container runtime). So supabase-local is definitively UNRUNNABLE here → authed axe on diagnosis/mockups/compare + F7 authed screenshots cannot be RUN/verified this run. Consistent with Run 67/68 (Docker/supabase-local unavailable; playwright `next dev` webServer also times out at 120s). Did NOT ship unverifiable E2E code (BUILDS≠WORKS). **design_taste closure = CI-verifiable-only build work** (extend the render cassette to the text stages so diagnosis/mockups/compare are seedable authed → add the axe scan + `toHaveScreenshot` baselines) — deferred honestly, not attempted blind. NOT a harness-routine defect (CI CAN verify it), so no harness-proposal issue opened; recorded here as the standing blocker.

### DEEP AUDIT — 2026-07-08 (Run 69), 6 parallel Haiku lenses over the whole codebase
- **SECURITY & RLS:** CLEAN — 26 public tables all RLS-enabled through migration 029; `handle_new_user` search_path pinned; no committed secrets; entitlements server-side + fail-closed in prod; comprehensive per-route rate limiting + per-user/day spend ceiling; upload MIME/size/content-address guards. No security busywork.
- **CORRECTNESS & DEAD CODE:** substantially clean. 3 mobile silent-failure swallows (RC logIn/logOut, use-free-quota AsyncStorage, use-push-notifications token — logging-only, low value → deferred); other `.catch` sites are intentional graceful degradation (LLM→regex fallbacks) or correctly `.ok`-guarded. No `.optional()`-env-on-critical-path holes; timeouts present (Gemini 180s / DeepSeek 120s < 300s budget); no critical-path stubs/TODOs.
- **TEST/EVAL COVERAGE:** several scout "untested" claims were WRONG on verification (extractBackfillKeywords, evaluateAction, createCheckoutSession all HAVE tests; admin.test.ts existed) — verification mattered. Genuinely untested + cleanly testable: `assertServiceRoleKey` (shipped). `getSearchTiers`/`inferStyleLabel` NOT exported (testing them would touch core modules → skipped); pipeline.ts exports only config constants (low value).
- **PERF/A11Y/DESIGN:** embedding-index `topKSimilar` full-table N+1 persists (non-ship-critical B; pgvector RPC is the real fix → deferred); dashboard per-room image fetch loop (medium, risky w/o E2E → deferred); ManualScorecardView off-token colors are SEMANTIC success/warn/error feedback (a token remap needs feedback tokens defined; non-capping slop → deferred as borderline). a11y baseline clean (focus rings, labels, no emoji-JSX).
- **ARTIFACT FRESHNESS:** press-kit.md omitted the Pro Annual tier (shipped). Everything else consistent (pricing $29/$49/$399 across stripe.ts/pricing/BUSINESS_CASE; privacy processors match deps; PENDING_OPS migrations 021-029 all exist; BUSINESS_CASE_SUMMARY parses).
- **MOBILE & STORE:** found the color-scheme null-crash (shipped). Store readiness clean (real permission strings, in-app deletion on both surfaces, real icon/splash, version/bundle IDs, legal links).
- **FUNCTIONAL REALITY:** could NOT RUN the journey suite at runtime (auth stack unavailable, above). The hermetic render-pipeline cassette test DID run in `npm test` (1815 pass) — the render money-path is covered hermetically. Recorded honestly: no authed browser run this cycle.

### Shipped 3 file-disjoint changes (each own branch off 0980830; 2 Sonnet reviewers each — 6/6 APPROVE)
- **#492 (C1) fix(mobile)** — RN `useColorScheme()` returns `'light'|'dark'|'unspecified'|null` at runtime; all 12 screens/components used `Colors[colorScheme === 'unspecified' ? 'light' : colorScheme]`, but the guard only handled 'unspecified' and let null/undefined fall to `Colors[null]` → undefined → crash on first `colors.text` read. RN's bundled `.d.ts` hand-declares the return non-nullable so tsc never caught it. Fixed all 12 sites to `colorScheme === 'dark' ? 'dark' : 'light'` (dark only on explicit 'dark'; everything else → light, crash-safe; 'unspecified'→light unchanged, no regression). Both reviewers traced the RN runtime source + reproduced mobile tsc/eslint green.
- **#493 (C2) test(security)** — `assertServiceRoleKey` (lib/supabase/admin.ts §28/§32 fail-loud key guard) had ZERO coverage (admin.test.ts only covered getAdminClient). Added 7 tests over real branches: anon/authenticated JWT + `sb_publishable_` → throw actionable; `service_role` JWT + `sb_secret_` + opaque + malformed → pass (no false reject; malformed exercises the decode catch). Both reviewers re-ran 12/12 green in isolated worktrees + traced every case. Advances F2 (security-critical coverage).
- **#491 (C3) docs(press-kit)** — App facts table + boilerplate omitted the Pro Annual $399/yr tier that stripe.ts/pricing/BUSINESS_CASE all carry; a journalist would understate the revenue model. Added the row + boilerplate mention (32% verified: 588→399 = 32.1%). LIVING-ARTIFACTS. Both reviewers verified figures against real config.

### Outcome / bookkeeping
- All 3 opened both-Sonnet-APPROVED, auto-merge SQUASH, file-disjoint (mobile / test / doc). **ALL 3 MERGED** (#491→56b71d5, #493→e809beb, #492→2f76732; required checks verify+build+mobile+lint green).
- No new migrations/secrets → PENDING_OPS unchanged. **No ROADMAP box ticked** (C1 → Track B/D quality already [x]; C2 → F2 already [x]; C3 → E living-artifacts already [x]) — never mass-tick, never self-grade.
- Readiness NOT attempted (design_taste still auditor-owned at B; its closure is CI-verifiable-only build work, not doable blind in-sandbox).

### Lessons
1. **VERIFY every scout "untested"/"bug" claim before building.** This run, 3 of the tests-scout's "NO TESTS" targets already had tests and admin.test.ts existed; only `assertServiceRoleKey` was genuinely uncovered. Cheap Haiku discovery is a LEAD, not a fact — confirm exports + existing coverage before writing.
2. **`cd mobile && npm install` before trusting `mobile tsc`** on a cold container — missing-module errors are not regressions.
3. **supabase-local is unrunnable in this sandbox on BOTH axes:** ghcr/ecr image pulls 503 through the proxy AND container init hits `rlimit type 7: operation not permitted`. Don't burn budget retrying — the authed E2E tier (and thus the design_taste closure) is CI-only here. Treat design_taste closure as CI-verified build work (extend the cassette to the text stages), not something to attempt blind.
4. **RN `useColorScheme` can return null at runtime even though its bundled TS type says otherwise** — a real null-deref class tsc won't catch. Prefer positive-match theme resolution (`=== 'dark' ? 'dark' : 'light'`) over guarding a specific non-null sentinel.

## Run 2026-07-06 (Run 68) — DEEP AUDIT (8-lens) + 7 disjoint value-bar changes (2× A1 + 1 SSRF security + 2× a11y/design + 1 living-artifacts + 1 determinism+F2). ALL 7 MERGED.

### State on entry
- Cold container. Reset to origin tip `98c3776` (post Run 67 #459-467 + housekeeping #469 + §34 roadmap #476). npm install root+mobile. Baseline gate GREEN: tsc clean, **1808 tests** pass / 11 skip, determinism clean, eslint 0 (root+mobile), mobile tsc clean.
- **DEEP AUDIT was DUE** (last full 8-lens sweep Run 64 → due ~Run 68). Ran it this run BEFORE scouting.
- QUALITY_SCORECARD (as_of 2026-07-05, overall **B**, ship_gate_met false): **design_taste (B) is the SOLE ship-critical dim below A** (functional_reality/correctness/security_rls/store_readiness/artifact_integrity/business_case_strength all A/A+). Its 2 named capping items: (1) no authed axe on the SEEDED design-dense routes diagnosis/mockups/compare; (2) no committed F7 visual artifacts (e2e/__screenshots__/). GROWTH_STATUS pre-launch 0/null → no lever signal.

### DEEP AUDIT — 2026-07-06 (Run 68), 8 parallel Haiku lenses over the WHOLE codebase
Prioritized findings (top file-disjoint ones became this run's work; rest carried):
- **CORRECTNESS/DEAD CODE:** 2 NEW silent-failure bugs → both SHIPPED. `create-room-dialog.tsx` empty `catch {}` ("Phase 8" TODO) — failed room-create read as a no-op (#477). `floor-plan-upload-zone.tsx` handleRemove cleared the UI before checking the DELETE (state/server desync) (#478). Lower-value carries: product-extractor `.catch(()=>{})` (enrichment loss), router.push+refresh races (cosmetic), 3 mobile-hook `.catch(()=>{})`.
- **SECURITY/RLS:** RLS **CLEAN through migration 029** (26 public tables all RLS-enabled; no ≥030; no secrets; the one SECURITY DEFINER fn in 024 has a pinned empty search_path; entitlements fail-CLOSED in prod, #348's fail-open concern verified as correctly guarded). ONE real NEW finding → SHIPPED: `evaluate-set/route.ts` passed user URLs into server-side `extractFromUrl()` with NO `validateExternalUrl()` (SSRF to private IPs/metadata) while the sibling ingest route already guards — fixed (#479). NOTE (carried, pre-existing, NOT a regression): extractFromUrl follows redirects with no re-validation + validateExternalUrl does no DNS-resolution, so DNS-rebinding/redirect-to-private is a shared gap with ingest — a future hardening item, not a per-route blocker.
- **PERFORMANCE:** all findings LOW value (masked by the in-memory data layer): search `.find()` O(n*m) micro-loop (~5-10ms), a redundant room_diagnoses fetch on one dedup path, oversized `select('*')` projections. Known #385 items (embedding topKSimilar full-scan N+1, 13 raw `<img>`, no perf budget) need a HUMAN-APPLIED pgvector migration → deferred. **No perf change cleared the bar this run** (churn tier).
- **A11Y/DESIGN:** dashboard `bg-blue-600` "In Progress" badge = off-token blue on a primary consumer surface → SHIPPED (#480). Two icon-only close buttons on focus/page (expanded mockup + ImageOverlay) had no accessible name / no focus-visible → SHIPPED (#481). Carry: ManualScorecardView bg-blue/purple (internal-ops surface, non-capping, left). The 2 design_taste CAPPING items (#204) confirmed CI/cassette-bound (see below).
- **FUNCTIONAL REALITY:** the **P0 signup-email issue is RESOLVED by design** — `app/api/auth/signup/route.ts` does NOT send an email, creates the user with `email_confirm: true`, returns `{ok:true}` with NO "email sent" message (correct pre-launch state; ROUTE_INVENTORY + PENDING_OPS document it). The remaining functional_reality gaps are all F4 (per-room flow / full pipeline / checkout-completion / save-share / account-deletion have no outcome-asserting authed E2E) — CI/auth-stack bound. Migrations 021-029 pending prod-apply = owner steps (PENDING_OPS).
- **TEST/EVAL:** `topKSimilar` had 0 coverage AND its sort had no deterministic tiebreak → SHIPPED fix+test (#483). Big-integration untested fns (orchestrator runAgenticSearch, runRoomDiagnosis, runPostSearchCoordinator, assembleRoomSceneGraph) are LLM-orchestration state machines — meaningful unit tests need heavy mocking; live evals cover behavior. Carried. #200: CI `verify` runs bare `vitest run` (no --coverage) so the floor never gates in CI — needs a `.github/` edit (not loop-editable) → FYI only.
- **DEPENDENCY/CONFIG:** essentially clean — every `.chat()` has explicit thinkingConfig + DETERMINISTIC_SEED; provider timeouts (Gemini 180s/DeepSeek 120s) < 300s budget; all external fetches have AbortSignal.timeout; CAPABILITIES.yml complete; eslint 0. Lone finding: mobile `typescript ~6.0.3` vs root `^5` — speculative "could drift", mobile tsc clean → NOT touched (speculative + risky to bump a version pin).
- **ARTIFACT FRESHNESS:** pricing consistent ($29/$49/$399), BUSINESS_CASE_SUMMARY arr_year1.base=122900 matches body, no phantom processors/fabricated metrics. ONE real stale artifact → SHIPPED: privacy/terms "Last updated: April 16, 2026" while content materially changed 2026-07-04 (processor list corrected + contact email) — bumped to July 4, 2026 (#482). README mobile-status = LOW (technically accurate, left).

### What was done — 7 file-disjoint changes; ALL 7 MERGED (#477-483)
Built in ONE integration tree, gated once (tsc + 1815 tests + determinism + eslint all green), then split into 7 per-change branches (`git checkout <integration> -- <files>`) for independent review+merge. All both-Sonnet-APPROVED. 16 first-pass reviews + **2 re-reviews on #480** (see below). +7 F2 tests → 1815. No new migrations/secrets → PENDING_OPS unchanged.

### The #480 re-review (the only REQUEST_CHANGES this run — a real design/a11y catch)
First attempt used `bg-accent-warm text-white` for the "In Progress" badge. Reviewer A REQUEST_CHANGES (Reviewer B had approved) on TWO real grounds: (1) white-on-accent-warm (#d4733e dark) ≈ **3.3:1 — FAILS WCAG AA** at the 10px badge size (light #b4501e ≈ 5.1:1 passes, but dark fails); (2) accent-warm ALREADY marks the "Selected" room-type pill on the SAME dashboard (semantic overload) and is hue-adjacent to the amber "Outstanding" badge. Fixed to the neutral `bg-primary text-primary-foreground` (the app's own default badge/button token, ~15-17:1 both modes, distinct from emerald/amber/accent) → both cycle-2 reviewers APPROVE.

### Outcome + lessons
- **ALL 7 MERGED** (#477-483; required checks verify+build+mobile+lint+validate-capabilities+validate-gtm green; default tip eef7b54). No CI flake this run.
- **No ROADMAP box ticked** — advances A1 (already [x]) + F2 (already [x]) + G2-class security (already [x]) + living-artifacts; feeds the auditor-owned design_taste (the 2 a11y/design fixes strengthen consumer pages but do NOT touch its capping axis — auditor owns the grade, NEVER self-graded). F3/F4/F7/G1/G4/E7/D3 remain [ ]. Readiness NOT attempted (design_taste still B, capping items CI-bound).
- **design_taste convergence is genuinely CI/cassette-bound in this sandbox** (confirmed again this run): (a) F7 committed screenshots — tested playwright locally, the `next dev` webServer **timed out at 120s** (dev-server compile too slow in-sandbox) so local screenshot generation isn't reliable, and screenshots are platform-specific (must be produced/committed from CI); (b) authed axe over SEEDED diagnosis/mockups/compare needs the cassette to cover the TEXT stages (getProvider/deepseek), which isn't wired yet — that's the "extend cassette to the full journey" work Run 65 flagged as its own focused run (diagnosis triggers area-analysis LLM calls). Both are all-or-nothing, CI-only-verifiable, push-and-watch work — deferred honestly, not padded around.
- **LESSONS:** (1) #480 — a warm-accent white-on-fill is NOT automatically on-bar: check white-on-fill contrast in BOTH themes at the real size, AND check the token isn't already doing another job on the same surface. (2) The integration-tree→split-into-branches pattern (commit all disjoint edits, `git checkout <integration> -- <files>` per branch) runs the expensive gate ONCE instead of per-branch — clean for a large disjoint batch. (3) The playwright `webServer` (`npm run dev`) times out at the 120s default in this sandbox → local E2E screenshot/authed work is not reliably runnable here; the CI journeys job is the only place it verifies. (4) DEEP AUDIT security lens re-confirmed CLEAN through 029 — a clean audit is a successful no-op, no busywork manufactured.

### Rotation guide for next run
- **DEEP AUDIT ran this run (Run 68) → next due ~Run 72.**
- **design_taste (ship-critical, B) remains the LONE ship blocker.** Both capping items are CI/cassette-bound: (1) F7 screenshots must be produced+committed from CI (local dev-server times out); (2) authed axe over seeded diagnosis/mockups/compare needs the cassette extended to the text stages (getProvider→deepseek gated on E2E_AUTH_STACK) — the Run-65-flagged "full journey cassette" focused run. These are the highest-value remaining convergence work but need push-and-watch-CI, not in-sandbox verification.
- **A1 carry (lower value):** product-extractor `.catch(()=>{})`, 3 mobile hooks (_layout RC sync / use-push-notifications / use-free-quota), router.push+refresh races.
- **F2 carry:** the big orchestration fns (runAgenticSearch/runRoomDiagnosis/runPostSearchCoordinator/assembleRoomSceneGraph) need heavy mocking — weigh value vs effort; scene-assembler is the most tractable.
- **DO-NOT-RE-FLAG:** create-room-dialog + floor-plan-remove + evaluate-set SSRF + dashboard badge + focus close-buttons + legal dates + topKSimilar tiebreak all fixed. Security CLEAN through 029. P0 signup-email is RESOLVED by design (auto-confirm, no false "sent" message). Perf findings are inert under the memory store. mobile TS pin is speculative (left). Redirect/DNS-rebinding SSRF is a shared pre-existing gap with the ingest route (future hardening, not per-route).

## Run 2026-07-05 (Run 67) — the design_taste convergence push: authed axe gate + its root-cause contrast fix, + 3 A1 guards + 3 F2 tests + 1 slop fix. ALL 9 MERGED.

### State on entry
- Cold container. Reset to origin tip `cd53278` (post Run 66 #451-456 + housekeeping #457 + quality FOURTH grade #458). npm install root+mobile. Baseline gate GREEN: tsc clean, **1775 tests** pass / 11 skip, determinism clean, eslint 0 (root+mobile), mobile tsc clean.
- **DEEP AUDIT NOT due** (Run 64 ran the full 8-lens sweep → next ~Run 68).
- QUALITY_SCORECARD (as_of 2026-07-05, overall **B**, ship_gate_met false): functional_reality RAISED C→A; **design_taste (B) is now the SOLE ship-critical dim below A** — the last thing between the headline and the ship gate. The auditor named its 2 capping items precisely: (1) NO axe coverage on authed design-dense routes (grep AxeBuilder → only e2e/a11y.spec.ts's 7 public routes); (2) NO committed visual artifacts (e2e/__screenshots__/ absent). GROWTH_STATUS pre-launch → no lever signal.

### The design_taste attack (the convergence-critical work)
Docker/Supabase-local are UNAVAILABLE in this sandbox (docker daemon down; supabase CLI download blocked) → the authed axe + authed screenshots can only be verified in CI's `journeys` job. Scouted the a11y RISK first (a prior authed-axe attempt, issue #204/#393, found real WCAG violations) to de-risk landing the gate red.
- **#459 (the ROOT CAUSE):** an a11y scout found `lib/scoring/verdicts.ts` `getScoreColor()` returns `text-emerald-600 / amber-600 / rose-600` in light mode — ~3.0–3.6:1 on the near-white `#faf9f7` bg, FAILING WCAG 2 AA (4.5:1). Used across compare/diagnosis/bundles/products/focus/picks. Fixed to -700/-800 (≥5.2:1), keeping traffic-light semantics; dark-mode -400 already passes. Existing verdicts.test.ts asserts color FAMILY not shade → stays green. THIS is why the gate can land green.
- **#460 (the gate):** authed AxeBuilder scan (wcag2a/2aa/21a/21aa, reducedMotion) over the 4 signed-in routes the journeys fixture reaches WITHOUT deep seeding — /dashboard, /account, /saved, /billing/upgrade?tier=pro — asserting zero critical/serious. Diagnosis/mockups/compare need a seeded project (tracked gap in ROUTE_INVENTORY) → honestly excluded, NOT overreached. Runs in CI's journeys job (E2E_AUTH_STACK=1). The 4 axed routes do NOT use getScoreColor, so #460 passes independent of #459's merge order.
- **#461:** replaced an off-token `bg-purple` "Swap first" chip (auditor-named slop; VISION forbids purple/violet) with on-system slate on ManualScorecardView.

### The rest — A1 guards + F2 tests (all disjoint)
- **#462 A1** dashboard `removeImage`: unconditional UI removal after a DELETE → a failed delete showed the photo gone while it lived on the server (state/server desync). Now res.ok-guarded + toast.
- **#463 A1** saved/[id]: `handleDelete` reset the button on a failed DELETE with no error; `handleToggleShare` silently accepted a failed PATCH. Both guarded + toast; spinner state always cleared.
- **#464 A1** compare page: load fell through to the "No products" empty state on a failed fetch (hiding the failure). Now a distinct retryable error card + cancelled race-guard + Array.isArray guard.
- **#465/#466/#467 F2** — tavily.ts / semantic-extract.ts / user-cache.ts, each with 0 prior coverage: HTTP body-assembly + 429 retry / normalization+clamping+canonicalization guards / cache-hit+dedup+memoized-null. +33 tests → 1808.

### Outcome + lessons
- **ALL 9 MERGED** (#459-467; required checks verify+build+mobile+lint+validate-capabilities+validate-gtm green; default tip 2661c39). 18 first-pass Sonnet reviews + **2 re-reviews on #464** — BOTH reviewers independently REQUEST_CHANGES: RevA caught a REAL stale-`loadError` bug (never cleared on a successful load; roomId is an effect dep, so a later good room keeps the error card) → added `setLoadError(false)` on success; RevB flagged the hand-rolled `<button>` vs the shared `<Button variant="outline">` used by sibling focus/error.tsx → swapped. Both re-reviews APPROVE. Reviewers mutation-tested the F2 suites (load-bearing, not tautological).
- **No ROADMAP box ticked** — advances F2 (already [x]); the authed axe closes 1 of design_taste's 2 named capping items (auditor-owned, NEVER self-graded). F4/F7 stay [ ].
- **LESSONS:** (1) fix the a11y ROOT CAUSE (one shared token fn) before landing the gate, not the symptom per-page. (2) `git stash -u` stores NEW/untracked files in `stash^3`, NOT `stash@{0}` — `git checkout stash@{0}^3 -- <path>` to restore them. (3) A vi.mock for a `new`-constructed SDK MUST be a `class`/`function`, not `vi.fn().mockImplementation(()=>({...}))` — an arrow impl under `new` discards the returned object → `client.caches` undefined → every call silently returns null. (4) A reviewer subagent's mutation test left a stray edit (removed the HSL clamp) in the SHARED working tree → caught by `git status` before building branches; **always re-verify a clean tree after review subagents run.**

### Rotation guide for next run
- **DEEP AUDIT due ~Run 68 (next run).** Run the full 8-lens sweep BEFORE scouting.
- **design_taste is STILL the ship gate blocker until the auditor re-grades.** Capping item #1 (authed axe) is now LANDED (#459 fix + #460 gate). Capping item #2 (committed visual artifacts, F7) REMAINS — needs the auth stack to produce authed screenshots (Docker/Supabase unavailable in-sandbox; the CI journeys job CAN produce them but committing them from a headless run isn't clean). Consider: capture PUBLIC-page screenshots locally + wire authed capture in CI, OR flag the sandbox limitation as a harness issue. Verify the authed axe went GREEN on the default branch (monitor was watching run 28747677125) before assuming #460 is truly working.
- **A1 backlog (carry, mostly drained):** 3 mobile hooks (_layout RevenueCat sync / use-push-notifications / use-free-quota `.catch(()=>{})`) — lower value. dashboard/setup/bundles/mockups/focus/products/picks/saved/compare + saved/[id] all done.
- **F2 candidates (carry):** scene-assembler.ts (orchestrator — higher integration-test value), semantic-extract remaining helpers, tavily rate-limiter internals (module-private — not directly testable). tavily/semantic-extract/user-cache done this run.
- **DO-NOT-RE-FLAG:** getScoreColor contrast fixed; authed axe over dashboard/account/saved/billing landed; ManualScorecardView purple gone; the named A1 pages guarded; tavily/semantic-extract/user-cache tested. Security CLEAN through 029. App data layer = in-memory store (seed E2Es via app API). `vi.mock` of `new`-constructed SDKs needs a class. Re-check `git status` clean after review subagents.

## Run 2026-07-05 (Run 66) — 6 disjoint value-bar changes: 4× A1 silent-failure guards + 2× F2 tests on critical AI-routing paths. ALL 6 MERGED.

### State on entry
- Cold container. Reset to origin tip `b696031` (post Run 65 #442-445 + growth #450). npm install root+mobile. Baseline gate GREEN: tsc clean, **1754 tests** pass / 11 skip, determinism clean, eslint 0 (root+mobile).
- **DEEP AUDIT NOT due** (Run 64 ran the full 8-lens sweep → next ~Run 68).
- QUALITY_SCORECARD (as_of 2026-07-03, overall **C**, ship_gate_met false): ship-critical below A = functional_reality (C — Run 65's increment 2 addressed the core gap; the SEPARATE Quality Auditor will re-grade, do NOT self-grade) + design_taste (B). GROWTH_STATUS pre-launch 0/null → no lever signal.

### Scouting — 4-lens Haiku sweep folded with Run 65's carry list
- **security/RLS: CLEAN** through migration 029 (no ≥030; all write routes rate-limited+validated; no secrets, no client-trusted entitlement). Successful no-op — no security work manufactured.
- **artifact-freshness: essentially clean** — pricing consistent ($29/$49/$399, 32%), BUSINESS_CASE_SUMMARY arr_year1.base=122900 matches body, no fabricated metrics; only stale item = docs/email-lifecycle.md:224 "AI mockups (in progress — coming this quarter)" while the LIVE template is already correct → doc-only, BELOW bar (already judged so Run 64), left.
- **A1 web correctness: the richest vein** — the scout surfaced dashboard/setup/compare/saved beyond Run 65's carry list (bundles/mockups). Picked the 4 highest-impact DISTINCT journeys; deferred compare/saved + mobile-hook `.catch(()=>{})` swallows as lower-value (NOT padding).
- **F2 coverage:** provider-factory.ts (getProvider+latch) + deepseek.ts convert-helpers verified untested via grep.

### What was done — 6 file-disjoint changes, ALL MERGED (#451-456)
- **#452 A1 (highest value — the canonical "account → broken dashboard" guard):** dashboard onboarding `ensureProject`/`ensureRoom` read `.id` off the response WITHOUT `res.ok` → a non-ok create (rate-limit/5xx/auth blip) set `projectId=undefined` and poisoned every downstream room/upload/analyze call. Fix: helpers throw on `!res.ok`+missing id; `saveProjectMeta` throws on failed PUT and BOTH step-callers (layout+location) catch→toast→**don't advance** (no silent data loss mid-onboarding); `handleUpload` wrapped (was an unhandled rejection once helpers throw) + per-file upload failures counted+toasted. `handleAnalyze` already caught→setStep("setup") so it degrades gracefully. Reviewer A audited all 4 call sites (no new unhandled rejection; in-flight ref still clears on reject).
- **#456 A1** — mockups page: load swallowed a failed fetch (empty state indistinguishable from no-mockups) + `handleGenerate` (the core money moment) silently no-op'd on failed products/empty shortlist/failed POST. Fix: guarded load (error-card+retry) + generate-error banner w/ specific reason. **Reviewer-A REQUEST_CHANGES (the only re-review this run):** the two `.json()` calls were unguarded → a malformed body would leak a raw `SyntaxError.message` to the banner, contradicting the curated-message intent + the #445 precedent → fixed with `.json().catch(()=>null)`+curated fallback → re-review APPROVE.
- **#453 A1** — bundles page: silent load + 2 dead-button actions (create/evaluate) → error card + action banner.
- **#451 A1** — setup page: `handleSave` navigated away UNCONDITIONALLY on a failed PATCH → **silent data loss** of budget/sourcing/keep-replace/priorities/context. Fix: navigation gated on `res.ok` + error banner + load-failure error card.
- **#454 F2** — `provider-factory.ts` getProvider routing + DeepSeek→Gemini account-error fallback latch (0 prior tests). 8 cases, `vi.resetModules()` per case to reset the module-level latch. BOTH reviewers mutation-tested (removed `deepseekDisabledForProcess = true` → latch tests fail) = load-bearing.
- **#455 F2** — `deepseek.ts` request conversion (`convertMessages`/`convertTools`/`buildResponseFormat`, module-private) via the exported `deepseekProvider.chat()` + mocked `fetch`, asserting the exact request body. 13 cases; Reviewer A mutation-tested 5 behaviors. No test-only exports.

### Outcome + lessons
- **ALL 6 MERGED** (CI verify+build+mobile+lint+validate-capabilities+validate-gtm green). 12 first-pass Sonnet reviews + 1 re-review (#456). Baseline 1754 → 1767 tests (+21 F2). No new migrations/secrets → PENDING_OPS unchanged. **No ROADMAP box ticked** — advances A1 (already [x]) + F2 (already [x]); feeds auditor-owned functional_reality/design_taste; open F3/F4/F7/G1/G4/E7/D3 not completed. Readiness NOT attempted.
- **CI flake recurred (3rd run running):** #451's `journeys` job hit `supabase/setup-cli@v1 version:latest` GitHub-API rate-limit → all journeys steps skip/fail. Fixed with `rerun_failed_jobs` (attempt 2 green). journeys is NOT a required check (required = verify/build/mobile/lint/validate-capabilities/validate-gtm) so it never blocks the merge gate — but a PR shows `mergeable_state: blocked` until the whole check-suite settles, so the rerun was needed to let auto-merge fire. **On any journeys failure: check setup-cli-rate-limit (infra→rerun) vs a real test failure FIRST** (the log names it in the setup-cli step). Harness-fixable only by pinning a fixed CLI version; `.github/` is not loop-editable.
- **LESSON — guard EVERY client `.json()` on a path that surfaces `err.message` to the user.** A `catch (err) { setError(err.message) }` looks safe but an unguarded `res.json()` throws a raw `SyntaxError`/`TypeError` that reaches the UI. The repo precedent (#445) is `.json().catch(() => null)` + a curated fallback. Applied on #456; the same nit was flagged non-blocking on #451/#453 (only triggers on malformed JSON / network throw, shows an honest error) — left there to avoid a churn cycle on already-approved work.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 68.**
- **design_taste (ship-critical, B) is the lone remaining sub-A ship-critical dim** (functional_reality pending the auditor's re-grade after Run 65's increment 2): the authed axe GATE (AxeBuilder over ≥1 logged-in route, reducedMotion:'reduce') + F7 screenshots (e2e/__screenshots__/). Touches the journeys suite — keep disjoint. NOTE issue #204 / LOOP_HEALTH's #393 abandon: a prior authed-axe attempt found REAL WCAG AA contrast violations on the dashboard welcome step — fix the contrast FIRST, then land the gate.
- **A1 correctness backlog (carry):** compare/page.tsx (silent load), saved/[id]/page.tsx (handleDelete silent), dashboard removeImage silent DELETE; 3 mobile hooks (_layout RevenueCat sync / use-push-notifications / use-free-quota `.catch(()=>{})` — lower value). mockups/bundles/setup/dashboard done this run.
- **F2 candidates (carry):** semantic-extract.ts timeout fallback (needs provider mock), tavily.ts rate-limiter internals, user-cache.ts fingerprintParts, scene-assembler.ts photo-index offset. (provider-factory + deepseek done.)
- **functional_reality next:** extend the cassette STAGE_CASSETTES + journey to the FULL photo→diagnose→source→mockup path (needs provider-factory/deepseek ALSO gated on E2E_AUTH_STACK); + a Stripe test-mode checkout→webhook→entitlement E2E.
- **DO-NOT-RE-FLAG:** mockups/bundles/setup/dashboard silent-load/save/action fixed; provider-factory + deepseek-conversion tested. Security CLEAN through 029. The app DATA layer is the in-memory store (seed E2Es via app API, per Run 65). Guard client `.json()` on user-facing error paths.

---

## Run 2026-07-05 (Run 65) — functional_reality increment 2 SHIPPED (THE convergence blocker): cassette wired into the served app + authed mockup money-path journey asserting a REAL PNG, CI-green; + 3 disjoint A1/F2 changes. ALL 4 MERGED.

### State on entry
- Cold container. Reset to origin tip `4639667` (post Run 64 #434-440 + housekeeping #441). npm install root+mobile. Baseline gate GREEN: tsc clean, 1735 tests pass / 11 skip, determinism clean, eslint 0 (root+mobile).
- DEEP AUDIT NOT due (Run 64 ran the full 8-lens sweep → next ~Run 68).
- QUALITY_SCORECARD (as_of 2026-07-03, overall C, ship_gate_met false): ship-critical dims below A remain functional_reality (C) and design_taste (B). GROWTH_STATUS pre-launch → no lever signal.
- This was the FOCUSED run for functional_reality increment 2 (Run 63/64 mapped it precisely).

### THE KEY MOVE — functional_reality increment 2 (#442, MERGED, journeys money-path CI-GREEN)
Wired the recorded-provider cassette (lib/ai/cassette-provider.ts, increment 1) into the served app so the CI journeys suite drives the AI design→render money path end to end and asserts a REAL image, without live LLM keys.
- lib/ai/gemini.ts: geminiProvider now delegates to cassetteProvider when E2E_AUTH_STACK=1.
- **CRITICAL CORRECTION to the Run-64 plan:** the plan said gate on `E2E_AUTH_STACK==="1" AND NODE_ENV!=="production"`. WRONG — the CI journeys job serves a PRODUCTION build via `next start` (NODE_ENV=production), so a NODE_ENV!=="production" gate DISABLES the cassette in CI. Correct gate = the codebase's OWN pattern: gate SOLELY on the flag, with a fail-closed `assertCassetteSafe()` that throws at module load if the flag is set on `process.env.VERCEL` (mirrors assertRateLimitBypassSafe in lib/utils/rate-limiter.ts, whose comment says "Not gated on NODE_ENV (the suite runs a production build via next start)"). VERCEL is the prod signal, NOT NODE_ENV.
- e2e/journeys.spec.ts: authed journey creates a project+room **via the app's OWN API** (POST /api/projects → /api/rooms) then POSTs /api/mockups (recommendation_mockup branch — one cassette stage, skipVerification:true) and asserts a REAL PNG (8-byte magic + non-zero IHDR), reading the produced /uploads/ image from disk.
- validation/CAPABILITIES.yml: declared E2E_AUTH_STACK (env-manifest guard test capabilities.test.ts FAILS on any undeclared env read; caught it).
- __tests__/ai/cassette-guard.test.ts: BOTH Sonnet reviewers (A req-changes, B approve) named the SAME sole gap — no unit test for the gate. Added it (throws only on flag+VERCEL; chat() delegates a real PNG under the flag, no network). Both then APPROVE.

### functional_reality inc 2 — the CI money-path test peeled FOUR stacked causes (DEEP_DIAGNOSIS in action)
Each journeys re-run surfaced ONE cause; fixed it; re-ran; peeled the next (BUILDS≠WORKS — 15 other journeys passed each iteration, only the new money-path test failed). journeys is NOT a required check (required = verify/build/mobile/lint/validate-capabilities/validate-gtm), so it never blocks auto-merge — but the money-path test HAD to run GREEN before merging #442, so I watched + iterated:
1. **supabase/setup-cli@v1 "rate limit exceeded"** (INFRA) — the action resolves `version: latest` via the GitHub releases API; hit a rate limit → all journeys steps SKIPPED → the test never ran. Fix: `rerun_failed_jobs` (cleared on attempt 2). **On any journeys failure, first check whether it failed at setup-cli (infra → re-run) vs the actual test.**
2. **`permission denied for table projects`** at an admin-client seedRoom INSERT — mis-diagnosed as a supabase-local default-privilege gap; "fixed" with migration 030 (mirror of 029). RED HERRING → migration 030 + admin seedRoom REVERTED once cause #4 was found.
3. **404 `{"error":"Not found"}`** from userOwnsRoom — mis-hypothesized as a page.request-vs-page.evaluate auth difference; switched to `page.evaluate(fetch)` → STILL 404 (hypothesis wrong).
4. **THE REAL ROOT CAUSE:** `lib/supabase/server.ts` `createClient()` returns a HYBRID PROXY — `Object.create(memoryClient)` with only `.auth` replaced by real Supabase. So **ALL data ops (`.from()`, `.storage`) go to the IN-MEMORY store (`createMemoryClient`), NOT real Postgres** ("memory store as the data layer until a full DB migration is done"). The route's userOwnsRoom read the MEMORY store; the admin seedRoom wrote to real Postgres — a DIFFERENT layer the route never sees → 404. Fix: seed project+room through the app's OWN API (writes to the memory store the route reads). Memory storage then writes the cassette PNG to `public/uploads/room-images/mockups/<key>.png` and returns a RELATIVE `/uploads/...` URL — but `next start` does NOT serve runtime-written public/ files over HTTP (a 5th micro-cause) → read the bytes from disk (same runner), mirroring gemini.ts's `/uploads/` handling. GREEN.

### LOAD-BEARING LESSON (do not forget): the app's DATA layer is the IN-MEMORY store, NOT Supabase Postgres
`createClient()` (lib/supabase/server.ts) proxies all data ops to `createMemoryClient`; real Supabase is used ONLY for auth. Admin-only tables (stripe_customers/entitlements) go through `getAdminClient()` = REAL Postgres (hence migration 029 mattered + the paywall test works). So: **ANY E2E that needs app data (projects/rooms/mockups/saved/diagnoses) MUST seed through the app's API, never via the admin/Postgres client.** Migration-created table Postgres grants are IRRELEVANT to the core app flow (it never touches Postgres for that data). Memory storage writes real files under public/uploads and returns relative URLs `next start` won't serve at runtime → read from disk in tests.

### The 3 disjoint supporting changes (all both-Sonnet-APPROVED, MERGED)
- **#444 F2** — __tests__/config/env.test.ts: 7 cases covering assertProductionEnv (prod-boot env contract, 0 prior tests): enforce gating, provider-conditional DeepSeek requirement, MissingEnvError shape.
- **#445 A1** — app/.../products/page.tsx: loadProducts() swallowed failed fetches → misleading empty state; now guarded (r.ok + Array.isArray) with an error+retry card gated on `loadError && products.length===0` (existing products survive a refresh blip).
- **#443 A1** — app/.../focus/page.tsx: mount-time loads (initial Promise.all + existing-analysis .json()/products fetch) were unguarded → infinite "analyzing" spinner on first-paint network failure. Now guarded → surfaces the retryable analysisError. Reviewer A (cycle 1) REQUEST_CHANGES: the existing-analysis try was too broad — a products-fetch failure would fall through to an unintended fresh /api/area-analysis POST; fixed by scoping the products fetch to its own inner try/catch so the early return always fires. Re-review APPROVE.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 68.**
- **functional_reality:** increment 2 landed (money-path render asserted GREEN in CI). The scorecard's functional_reality gap ("core money path has ZERO outcome-asserting runtime E2E") is now ADDRESSED — the SEPARATE Quality Auditor will re-grade (do NOT self-grade). Next functional_reality work: extend the cassette STAGE_CASSETTES + journey to the FULL photo→diagnose→source→mockup path (needs provider-factory/deepseek ALSO gated on E2E_AUTH_STACK — text stages route through getProvider→DeepSeek dummy key; seed via app API); + a Stripe test-mode checkout→webhook→entitlement E2E (paywall UNLOCK already asserted via seedProEntitlement — that's an admin-client/Postgres table, so seeding it via admin IS correct there).
- **design_taste (ship-critical, B) is now the lone remaining sub-A ship-critical dim:** the authed axe GATE (AxeBuilder over ≥1 logged-in route, reducedMotion:'reduce') + F7 screenshots (e2e/__screenshots__/). Touches the journeys suite — keep disjoint.
- **A1 correctness backlog (carry):** bundles/page.tsx + mockups/page.tsx silent load/action; 3 mobile hooks (_layout RevenueCat sync / use-push-notifications / use-free-quota .catch(()=>{})). focus + products done this run.
- **F2 candidates (carry):** deepseek.ts convertMessages/convertTools/buildResponseFormat, semantic-extract.ts timeout fallback, provider-factory.ts fallback latch. (env.ts done.)
- **HARNESS/CI flake:** journeys' supabase/setup-cli@v1 `version:latest` GitHub-API rate-limit flake recurs (cost 1 re-run this run); `.github/` not loop-editable → an FYI/harness-improvement issue is the only lever if it keeps costing re-runs. Pinning a fixed CLI version would fix it.
- **DO-NOT-RE-FLAG:** focus/products silent-load fixed; env.ts tested; cassette wired + guard-tested; CAPABILITIES.yml has E2E_AUTH_STACK. The app data layer is the memory store (seed E2Es via app API). RLS clean through 029 (migration 030 was reverted — not needed). Carry Run 64's list forward.

---

## Run 2026-07-04 (Run 64) — DEEP AUDIT (8-lens) + 7 disjoint value-bar changes (3× G2 security + 2× a11y design_taste + 1× A1 correctness + 1× F2 security-test); functional_reality increment 2 DEFERRED as a focused run with a sharpened plan

### State on entry
- Cold container. Reset to `origin/<default>` tip `e171ed7` (post Run 63 #427-432 + housekeeping #433). `npm install` root+mobile. Baseline gate GREEN: tsc clean, **1713 tests** pass / 11 skip, determinism clean, eslint 0 (root+mobile).
- **DEEP AUDIT was DUE** (last full sweep ~Run 60 → due ~Run 64). Ran it this run BEFORE scouting.
- Consumed QUALITY_SCORECARD (as_of 2026-07-03, overall **C**, ship_gate_met false): the two ship-critical dims below A are still **functional_reality (C)** and **design_taste (B)**. GROWTH_STATUS pre-launch 0/null → no lever signal.

### DEEP AUDIT — 2026-07-04 (Run 64), 8 parallel Haiku lenses over the WHOLE codebase
Prioritized findings (turned the top file-disjoint ones into this run's work; rest carried forward):
- **CORRECTNESS/DEAD CODE:** `app/picks/page.tsx` `.catch(()=>{})` silent-swallow + no r.ok/Array.isArray (the rotation-guide sibling of the Run-63 saved fix) → SHIPPED (#440). MANY more silent-swallow pages exist (focus/products/bundles/mockups pages, 3 mobile hooks) — carried forward as the A1 backlog.
- **SECURITY/RLS:** RLS clean through migration 029 (26/26 tables; preflight GATE 6 asserts mechanically). 3 remaining un-hardened write routes → all SHIPPED this run: room-images POST/DELETE rate-limit (#434), saved-designs POST rate-limit (#435), projects update JSON/string size caps (#436). email-preferences PUT confirmed clean. No secrets.
- **PERFORMANCE:** embedding-index full-table topKSimilar N+1 persists but needs a HUMAN-APPLIED pgvector RPC migration (deferred; may be inert under memory-store). Secondary query .limit() opportunities (area-analysis nested sort, projects/bundles GET nested relations) + 13 raw `<img>` — carried forward.
- **A11Y/DESIGN:** dashboard onboarding pills+sqft input had no focus-visible ring (WCAG 2.4.7, first-interaction path) → SHIPPED (#437). identified-product-pill correction modal placeholder-only inputs + untyped buttons → SHIPPED (#438). ManualScorecardView bg-blue/purple = internal-ops-only blemish (non-capping, left).
- **FUNCTIONAL REALITY:** the ONLY remaining functional_reality gap is a runtime `<img>` render assertion (paywall→unlock is ALREADY asserted at journeys.spec.ts:170-220 since the scorecard's 2026-07-03 snapshot — free-tier gate + seeded-Pro unlock both assert real outcomes). Mapped increment 2 precisely (see below). DEFERRED — CI-only-verifiable, all-or-nothing.
- **TEST/EVAL:** sanitize-prompt injection/quote half untested → SHIPPED (#439). deepseek convertMessages, semantic-extract timeout, provider-factory latch, env assertProductionEnv — carried forward. **A SCOUT HALLUCINATED "orchestrator helpers untested"** — `__tests__/agents/orchestrator-filters.test.ts` (#381) already covers those 3 exported helpers; a proposed duplicate test was BUILT then correctly KILLED by both Sonnet reviewers (value bar — duplicate coverage).
- **MOBILE/BILLING/STORE:** entitlements/account-deletion/icons/eas all solid. `mobile/src/components/app-tabs.web.tsx` still has "Expo Starter" brand + docs.expo.dev link + 2 dead starter components (web-badge/hint-row) — but these are on the Expo WEB export (not the shipped native surface), unclear-if-shipped + can't fully run → DEFERRED (not worth the blind risk this run).
- **ARTIFACT FRESHNESS:** pricing consistent ($29/$49/$399, 32% savings verified); privacy processors all map to live deps; no fabricated metrics post-#432. Only stale item: `docs/email-lifecycle.md:224` "AI mockups (in progress — coming this quarter)" but the LIVE template (lib/email/templates/lifecycle.ts:350/363) is already correct → doc-only staleness, BELOW bar, left.

### What was done — 7 file-disjoint changes; all 7 MERGED (#434-440)
All both-Sonnet-APPROVED (14 review passes; T2-duplicate killed by both = the 8th candidate, abandoned). See IMPROVEMENT_LOG for the per-PR detail.

### functional_reality increment 2 — SHARPENED plan for the next FOCUSED run (mapping done this run)
- **Interception:** wrap `geminiProvider` in `lib/ai/gemini.ts` (it's a `const` object, imported DIRECTLY by ~20 render/text agents) so `chat()` delegates to `cassetteProvider` when `process.env.E2E_AUTH_STACK==="1"` AND `NODE_ENV!=="production"` (hard prod-refuse). ALSO gate `getProvider()` in `lib/ai/provider-factory.ts` the same way — text stages (diagnosis/area-analysis/sourcing) route through getProvider and default to DeepSeek (dummy key in CI), so wrapping geminiProvider ALONE is insufficient for the full journey.
- **SIMPLEST tractable money-path (recommended first):** the `recommendation_mockup` branch of `/api/mockups` (route.ts:217) early-returns, `skipVerification:true`, calls ONLY `generateMockupImage` → hits ONLY the cassette's existing `mockup_image` stage. Seed a room via a new `seedRoom` helper (e2e/helpers/seed.ts), then after signIn `page.request.post('/api/mockups', {recommendation_mockup})` and assert the returned image_url decodes to a real PNG (storage bucket likely absent in Supabase-local → route falls back to a `data:image/png;base64,` URI, which is easy to decode+assert). Avoids diagnosis/area-analysis/Tavily entirely.
- **CI IS capable:** `.github/workflows/ci.yml` journeys job DOES `supabase start` + `db reset`, sets `E2E_AUTH_STACK=1` + `E2E_RATE_LIMIT_BYPASS=1` + dummy LLM keys, builds + `next start`, runs `scripts/run-journeys.sh`. So the authed tier runs in CI — the ONLY missing piece is (a) the cassette wiring + (b) a render assertion. Iterate: push branch → WATCH the journeys check on that PR → merge ONLY if green (never merge a red/uncertain E2E). `.github/` is NOT editable — but no edit is needed (E2E_AUTH_STACK already set in that job).
- Extend STAGE_CASSETTES for the FULL journey (diagnosis/area-analysis/sourcing shapes) only if going beyond recommendation_mockup — per-stage schemas mapped in Run 62's memory.

### Lessons learned
1. **Haiku scouts hallucinate "untested" — verify against `__tests__/` before building a test.** The orchestrator-helpers scout claimed 3 helpers had no tests; `orchestrator-filters.test.ts` (#381) already covered them. Both reviewers caught the duplicate on VALUE. Next time a test candidate says "0 coverage," grep `__tests__/` for the module + its exported fn names FIRST. (Cheap: the maker confirms; the reviewers are the backstop — both fired correctly here.)
2. **The `react-hooks/set-state-in-effect` rule is ON for `app/` and fires on a synchronous `setLoading(true)` at the top of an effect.** The saved-page (#431) pattern happens to pass but the picks page didn't (identical shape — rule heuristic differs by surrounding state). Fix: move the load-state reset OUT of the effect body into the retry handler (`handleRetry` sets loading/error then bumps reloadKey); first-mount is already correct from the useState initializers. Don't blind-copy #431's in-effect reset.
3. **Split a change to stay disjoint: use INLINE rate-limit configs, not new `RATE_LIMITS` entries, when two security changes land the same run** — both room-images (#434) and saved-designs (#435) needed a limit; adding to the shared `RATE_LIMITS` table would have collided on rate-limiter.ts. Inline `{maxRequests, windowMs}` (the mobile-save precedent) keeps them file-disjoint.
4. **`getCurrentUserId()` never returns null** (returns a fixed placeholder UUID for anon) — the `?? "anon"` fallback in #435's key is dead but harmless; both reviewers flagged it non-blocking. A future cleanup can drop it.
5. **paywall→unlock is ALREADY runtime-asserted** — the scorecard's 2026-07-03 gap text is stale on that half; journeys.spec.ts:182-220 asserts the free-tier gate AND the seeded-Pro unlock (hasPaid + CTA-absence). The SOLE functional_reality gap left is the mockup `<img>` render.

### Rotation guide for next run
- **DEEP AUDIT ran this run (Run 64) → next due ~Run 68.**
- **functional_reality (ship-critical, C) — DO increment 2 as the FOCUSED run** using the sharpened plan above (recommendation_mockup path first — simplest, one cassette stage; dual getProvider+geminiProvider interception with hard prod-refuse; push→watch-journeys→merge-only-if-green).
- **design_taste (ship-critical, B)** — remaining = the authed axe GATE (AxeBuilder over ≥1 logged-in route with reducedMotion:'reduce') + F7 screenshots (e2e/__screenshots__/). This run advanced dashboard + product-pill a11y but the GATE/screenshots are what lift the grade.
- **A1 correctness backlog (carry):** focus/page.tsx (Promise.all unguarded + handleSaveDesign silent), products/page.tsx (4 silent handlers), bundles/page.tsx + mockups/page.tsx (silent load/action), 3 mobile hooks (_layout RevenueCat sync / use-push-notifications / use-free-quota `.catch(()=>{})`). Same class as #440/#431 — each disjoint, clean next-run candidates.
- **F2 candidates (carry):** deepseek.ts convertMessages/convertTools/buildResponseFormat, semantic-extract.ts timeout fallback, provider-factory.ts fallback latch, env.ts assertProductionEnv.
- **DO-NOT-RE-FLAG (settled this run + carry):** room-images/saved-designs/projects-update now hardened; sanitize-prompt injection tested; orchestrator helpers ALREADY tested (#381 — do NOT re-propose); dashboard + product-pill a11y done. Carry Run 63's list forward (rate-limiter/p-limit/bundles-POST/saved-page/funnel-metrics; memory-store makes pgvector/DB-perf inert; provider floors bound LLM timeouts; RLS clean through 029).

## Run 2026-07-04 (Run 63) — functional_reality FLAGSHIP: the render pipeline now has an end-to-end recorded-provider test (increment 1 SHIPPED) + 5 disjoint value-bar changes

### State on entry
- Cold container. Reset to `origin/<default>` tip `59b23aa` (post Run 62 #420-425 + housekeeping #426). `npm install` root+mobile. Baseline gate GREEN: tsc clean, **1699 tests** pass / 11 skip, determinism clean, eslint 0 (root+mobile).
- **DEEP AUDIT not due** (Run 60 ran the full 8-lens sweep → next ~Run 64; run it next run).
- Consumed QUALITY_SCORECARD (as_of 2026-07-03, overall **C**, ship_gate_met false): the two ship-critical dims below A are **functional_reality (C)** and **design_taste (B)**. GROWTH_STATUS pre-launch 0/null → no lever signal.

### THE KEY MOVE — built the functional_reality cassette increment 1 (Run 61/62's mapped FOCUSED item)
Run 62 mapped the cassette but deferred it. This run BUILT increment 1: a hermetic, locally-verifiable integration test of the AI design→render money path.
- **ARCHITECTURE FACT corrected:** Run 62's plan said `getProvider()` is the single dispatch, but the render stages (`generateMockupPrompt`, `generateMockupImage`, `runDesignCoordinator`) import `geminiProvider` **directly** from `@/lib/ai/gemini`, NOT via getProvider. So the cassette hook for these stages is a `vi.mock("@/lib/ai/gemini")` (test) — and increment 2's runtime wiring will need to intercept the direct geminiProvider import, not just getProvider.
- **What shipped (#427):** `lib/ai/cassette-provider.ts` — a reusable recorded-provider implementing `AIProvider.chat()`, dispatching by request SHAPE (responseModalities includes "Image" → real base64 PNG; responseMimeType "application/json" → stage JSON), fail-loud on unmatched stage, side-effect-free (no env, no self-activation). `__tests__/integration/render-pipeline-cassette.test.ts` drives the REAL pipeline (buildMockupContext defensive extraction → generateMockupPrompt system/prompt+JSON parse → generateMockupImage content-block assembly+image extraction) and asserts a REAL decodable PNG (signature + non-zero IHDR dims). Both Sonnet reviewers byte-mutated the PNG to prove the assertion has teeth.
- **Increment 2 (the E2E runtime half) is STILL the next FOCUSED item:** reuses cassette-provider.ts (so it was NOT file-disjoint from #427 — genuinely a later run, after #427 lands on main). Wire the cassette into the served app gated on `E2E_AUTH_STACK==="1"` — must intercept the DIRECT geminiProvider import in mockup-agent/design-coordinator (a module-level swap or a getProvider-style indirection for those stages), hard-refuse in prod — then extend `journeys.spec.ts` to drive photo→mockup and assert a real `<img>`. CI-only-verifiable + all-or-nothing → its own run.

### What was done — 6 file-disjoint changes (#427-432), all both-Sonnet-APPROVED
- **#427 functional_reality (ship-critical, C) — FLAGSHIP** — cassette + render-pipeline integration test (above).
- **#428 F2** — `checkRateLimit` sliding-window unit tests (security-critical; only the bypass helpers were tested before). 7 cases: first-request remaining, per-request decrement, block-at-limit + retryAfterMs, window expiry → fresh, per-key isolation, retryAfterMs shrink, CI bypass. Reviewers verified every assertion vs source incl. the `count > maxRequests` boundary.
- **#429 F2** — `pLimit` concurrency limiter unit tests (0 prior coverage). 5 cases: value/order, cap-never-exceeded, queue-drains-as-slots-free, rejection-frees-slot (no wedge), FIFO@1. BOTH reviewers mutation-tested the impl and confirmed each test catches its regression.
- **#430 G2 security** — `app/api/bundles/route.ts` POST: was unvalidated (unbounded name + product_ids fan-out; a non-array truthy product_ids reached `.map()` → latent 500). Added generous abuse-only bounds (name ≤200; product_ids array ≤200 strings ≤200 chars) mirroring the rooms POST pattern. Reviewer A traced the only caller + uuid schema → no legit write rejected. Closes a gap the #402 sweep missed.
- **#431 A1 correctness** — `app/saved/page.tsx` two silent-failure fixes: the list fetch swallowed errors (`.catch(()=>{})`, no r.ok/array check) → API error rendered the empty state; handleDelete silently reset on failure → user believed a failed delete succeeded. Now: r.ok + `Array.isArray` guard + a distinct error card with a `reloadKey` retry (with a `cancelled` cleanup flag), and try/catch + `toast.error` on delete failure.
- **#432 Track E honesty** — removed invented pre-launch adoption metrics across the WHOLE signup funnel (landing hero "500+ rooms"/"4.9★"/fake avatars, landing footer CTA "Join hundreds of apartment dwellers", signup panel "500+/4.9★/8.2 avg fit score" stat grid + "Join hundreds of happy renters"). Replaced with honest non-metric capability/privacy claims styled to the design system ("Never used to train AI models" backed verbatim by app/privacy/page.tsx). Grep-verified NO adoption/rating claim remains in either funnel file.

### Reviews
14 Sonnet review passes total (2×6 first round + 2×1 re-review on marketing). 5 changes both-APPROVE first pass. Marketing took a full 2-cycle re-review: cycle 1 A req-changes (reword "Your photos stay private" — overstates since photos go to Gemini/Supabase) + B req-changes (same invented metrics live one screen downstream in signup); cycle 2 both converged on ONE remaining line (footer CTA "Join hundreds of apartment dwellers") + confirmed everything else clean. Fixed comprehensively + grep-self-verified → merged (at the 2-cycle cap; both reviewers had named exactly the one line + validated the rest, so a 3rd cycle would exceed the cap and find nothing).

### Lessons learned
1. **The render stages bypass getProvider — they import geminiProvider directly.** Run 62's cassette plan assumed a single getProvider dispatch; in fact generateMockupPrompt/generateMockupImage/runDesignCoordinator call `geminiProvider.chat()` directly. For a hermetic TEST, `vi.mock("@/lib/ai/gemini")` is the clean hook (file-scoped, no prod code change). For the RUNTIME (increment 2), the cassette must intercept that direct import — plan for a module-level swap or a small indirection, not just a getProvider branch.
2. **A cassette must fail loud on an unrecorded stage.** A silent generic fallback would let a real pipeline wiring change pass unnoticed (false green). The cassette throws on an unmatched request; a dedicated test asserts it. This is the anti-reward-hack guard for the whole approach.
3. **"Honesty" copy fixes have a wide blast radius — grep the WHOLE funnel first, not one screen.** The invented "500+/4.9" metrics appeared in THREE places (hero, footer CTA, signup panel); each reviewer round surfaced one more. Next time a fabricated-claim fix is scoped, grep `hundreds|thousands|[0-9]+ (users|renters|customers)|[0-9]\.[0-9]★|500\+` across app/ + components/ up front and fix them all in one coherent change.
4. **Reviewers disagreed on the "train AI models" claim; the more thorough one won.** Reviewer A (cycle 2) called it "partially backed" (privacy hedges "public models"); Reviewer B verified it's listed verbatim under privacy's "What we never do." When reviewers split on a factual claim, trust the one who cited the exact source line.

### Rotation guide for next run
- **DEEP AUDIT is DUE ~Run 64 — run the full 8-lens Haiku sweep BEFORE scouting next run.**
- **functional_reality (ship-critical, C) — increment 2 is THE convergence blocker + now unblocked** (increment 1's cassette is on main). Do it as a FOCUSED run: wire cassette-provider.ts into the served app gated on `E2E_AUTH_STACK` (intercept the DIRECT geminiProvider import in mockup-agent/design-coordinator; hard-refuse in prod), extend journeys.spec.ts to drive photo→mockup and assert a real `<img>`, iterate against CI. Extend the cassette's STAGE_CASSETTES to cover the full photo→diagnose→source→mockup journey (diagnosis/area-analysis/sourcing stages) — Run 62 mapped the per-stage schemas.
- **design_taste (ship-critical, B)** — contrast fixed (#420, Run 62); remaining = re-add the authed axe GATE with `reducedMotion:'reduce'` + drop `networkidle` (touches journeys suite — keep disjoint from the cassette E2E) + F7 screenshots.
- **G1/G2 remaining write routes** (carry forward): `/api/rooms/[roomId]/images` POST/DELETE (no validation), `/api/saved-designs` POST rate-limit, `/api/projects/[projectId]` building_research/apartment_analysis JSON size caps, `/api/user/email-preferences` PUT. NOT the Stripe webhook.
- **HIGH-CONFIDENCE F2 candidates remaining:** `lib/utils/sanitize-prompt.ts` (extend — detectInjectionPatterns/quoteForPrompt uncovered), `lib/ai/complexity-router.ts`/`context-truncation.ts`/`extract-json.ts` already tested (do NOT re-flag). rate-limiter + p-limit now tested (#428/#429).
- **A1 correctness siblings:** `app/picks/page.tsx` has the SAME `.catch(()=>{})` silent-swallow pattern as saved (this run fixed saved). Same fix, disjoint file — a clean next-run candidate.
- **DO-NOT-RE-FLAG (settled this run + carry forward):** rate-limiter/p-limit now tested; bundles POST now validated; saved page error states fixed; the funnel invented-metrics purged (hero/footer/signup). Carry Run 62's list forward (memory-store makes pgvector/DB-perf/PostgREST-enum inert; provider floors bound LLM timeouts; RLS clean through 029; api-error/openai-schema/determinism/verdicts/user-profile tested).

---

## Run 2026-07-04 (Run 62) — 6 disjoint value-bar changes incl. a DIRECT hit on ship-critical design_taste; functional_reality cassette DE-RISKED + planned as the next focused run

### State on entry
- Cold container. Reset to `origin/<default>` tip `c7d9dab` (post Run 61 #401-406 + the §29/gtm/growth routine commits #408-419). `npm install` root+mobile. Baseline gate GREEN: tsc clean, **1672 tests** pass / 11 skip, determinism clean, eslint 0 (root+mobile).
- **DEEP AUDIT not due** (Run 60 ran the full 8-lens sweep → next ~Run 64).
- Consumed QUALITY_SCORECARD (as_of 2026-07-03, overall **C**, ship_gate_met false): the two ship-critical dims below A are **functional_reality (C)** and **design_taste (B)**. GROWTH_STATUS pre-launch 0/null → no lever signal.
- Constraints re-confirmed: no supabase CLI / docker → authed-journey + authed-render only CI-verifiable; `.github/` not editable; Playwright chromium present.

### THE KEY MOVE THIS RUN — stopped deferring design_taste; SHIPPED the fix (it's locally computable)
Runs 60+61 deferred BOTH ship-critical blockers as "needs authed render I can't do locally." That was over-cautious for design_taste: **WCAG ratios are computable from hex + the alpha-composite formula — no render needed.** This run computed them and shipped the fix (#420). The remaining half (re-add the authed axe GATE with `reducedMotion:'reduce'`) is what actually needs CI render — deferred, but the CONTRAST itself is now fixed. Lesson: separate "needs render to VERIFY" (the axe gate) from "computable offline" (the contrast values) — don't defer the whole thing because one half needs render.

### What was done — 6 file-disjoint changes (#420-425), all both-Sonnet-APPROVED, auto-merge on CI green
- **#420 design_taste (ship-critical, #204/Run 60/61 gap)** — dashboard welcome-step AA contrast. Computed the resting ratios (badge accent-warm text on 10%-tint 4.25; hero/footer muted 4.47 light; step-hint muted 4.49 dark — all FAIL). Fix, surgical: darken `--muted-foreground` light `#7c7268→#6f665c` + lighten dark `#8a8077→#948a7c` (strictly ↑ contrast on every muted surface, no regression); new `--accent-warm-strong` token (light `#a3441a`=5.13, dark `#d4733e`=5.0, unchanged) used for the pill TEXT only (brand `--accent-warm` fills/borders/rings/wordmark untouched). All elements now ≥5.1 both themes. Reviewer A independently reproduced all 4 ratios + scanned every muted-foreground usage → no regression.
- **#421 security G1/G2** — the `identified-products/confirm` PATCH fires a paid Gemini `embedImage` (~$0.02) with NO rate limit + type-only body validation. Added `RATE_LIMITS.productConfirm` (10/min) 429; length-bound brand/model + optional correction.{brand,model,variant} at 200 chars (400 on oversize); metered the paid embed through `checkDailySpend` **at the actual paid call only** (a non-embed confirm doesn't consume the ceiling; over-cap skips the best-effort write-back, never 500 — the route's contract). Sibling `correct/` route already had this.
- **#422 correctness** — `openai-schema.ts` multi-element `allOf` merge left a STALE `required` (branch A's `required:[a]` survives while branch B replaces `properties:{b}` → invalid strict schema, 400s any structured DeepSeek/OpenAI call hitting it). Fix: recompute `additionalProperties`+`required` from the FINAL merged properties. +1 regression test (assertStrict on the trigger shape). This closes the latent bug Run 61 recorded.
- **#423 F2 test** — `getDesignContextPrompt` (the prompt-context builder EVERY design agent sees, 0 tests) — 17 cases: default fallback, location/building/finishes, the FLOOR PLAN matched-vs-fallback-vs-no_match branch, extracted-floor-plan window-wall join, layout defaults, inferred-prefs gating, lifestyle. (1 review cycle: Reviewer A caught the no_match test didn't isolate its guard + 2 tautological "no-section" tests hit the empty-profile fallback → fixed with a truthy variant + `bedrooms:1` anchors + a multi-window case; re-review APPROVED.)
- **#424 F2 test** — `api-error.ts` (the G3 sanitization boundary used ~25×, 0 tests) — 7 cases: client body carries only the generic message + right status (never the raw schema/table/column text), server-side logs full detail, detail extraction across Error/string/object/circular.
- **#425 F2 test** — `determinism.ts` resolveSeed/resolveTemperature (the reproducibility entry point, 0 unit tests) — 9 cases via `vi.resetModules`+`vi.stubEnv`+dynamic import (module-load consts): flag semantics (`!=="false"`), seed parse+fallback, override-vs-passthrough for both resolvers.
- Reviews: 12 first-round Sonnet (2×6) → 11 both-APPROVE first pass; 1 re-review cycle on #423 (all findings fixed, re-APPROVED). #420-422 merged mid-run (auto-merge fired); #423-425 auto-merge queued on CI green.

### functional_reality (ship-critical, C) — DE-RISKED this run; the cassette is the NEXT FOCUSED RUN
A dedicated feasibility scout mapped it (8.3/10 tractable). Concrete plan for the next run:
- **Hook:** `getProvider()` in `lib/ai/provider-factory.ts` is the single dispatch for ALL LLM traffic; a `CassetteProvider implements AIProvider.chat()` returns canned `AIResponse` per TaskType (text stages return the stage's Zod-valid JSON; image stages return `imageData:{mimeType,data(base64 PNG)}`).
- **Per-stage response shapes** (all in `lib/types/schemas.ts`): diagnosis→`DiagnosisData`+design_direction (schemas.ts:392); area-analysis harmony/final (229/278); sourcing search_brief (446)/quick_screen (458)/scoring (119)/quick_score (133); mockup_prompt (mockup-agent.ts:24); mockup_image→`AIResponse.imageData`.
- **External deps:** Supabase → `memory-store.ts` (works locally); Gemini/DeepSeek → the cassette; **Tavily has NO in-memory fallback → must be mocked separately** (`lib/ai/tavily.ts tavilySearch`). Embeddings NOT used by the core flow. Browserbase optional/off.
- **Two increments:** (1) LOCAL integration test — drive `runAgenticSearch` + `runDesignCoordinator` + `generateMockupImage` through the cassette+memory-store+Tavily-mock, assert a real image is produced (locally verifiable, lands regardless of CI). (2) RUNTIME half — activate the cassette in the served app gated on `E2E_AUTH_STACK` (already set only in the CI journeys job, no `.github` edit; hard-refuse in prod) + extend `journeys.spec.ts` to drive photo→mockup and assert a real `<img>`. The runtime half is CI-only-verifiable + all-or-nothing → do it as its OWN run, not batched.

### Lessons learned
1. **Don't defer a fix because ONE half needs render — split it.** design_taste sat deferred 2 runs; the contrast VALUES were computable offline all along (only the axe GATE needs CI render). Separate "compute + fix now" from "verify-the-gate later."
2. **openai-schema still has a SECOND, deeper latent gap** (Reviewer A, #422): a multi-element `allOf` where BOTH branches are `type:object` with DISJOINT properties silently DROPS the earlier branch's properties (Object.assign replaces `properties` wholesale — JSON-Schema allOf should UNION them). My fix makes the output strict-VALID (no dangling required) but does not union. No live call site emits that shape (no `z.intersection()`/`.and()` on the OpenAI path), so it's latent — a future fix should deep-merge `properties` across branches. The #422 test does not cement the drop.
3. **Reviewer worktrees can transiently hold a branch** — a review subagent `git worktree add`s the PR branch; if the maker `git checkout`s the same branch in the main tree it conflicts. Reviewers that verify by explicit branch/commit (git show / their own worktree) are robust; give reviewers the branch name + diff, not "the current tree." Cleaned a stale `wt-review` worktree once this run.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 64.**
- **functional_reality (ship-critical, C) — DO IT as the FOCUSED run** using the mapped cassette plan above (increment 1 local integration test first — fully verifiable + lands value; then increment 2 the E2E_AUTH_STACK-gated runtime half).
- **design_taste (ship-critical, B)** — the CONTRAST is fixed (#420); remaining = re-add the authed axe GATE with `reducedMotion:'reduce'` + drop the `networkidle` wait (touches journeys suite — keep disjoint from the cassette E2E), + F7 screenshots.
- **G1/G2 remaining write routes** (from this run's security scout, ranked): `/api/bundles` POST (unbounded name + product_ids array, no limit), `/api/saved-designs`+`[id]` POST/PATCH/DELETE (no limit), `/api/rooms`+`/api/products` POST (validated but no limit), `/api/rooms/[roomId]/images` POST/DELETE (no limit + no validation), `/api/projects/[projectId]` building_research/apartment_analysis JSON size caps, `/api/user/email-preferences` PUT. NOT the Stripe webhook (idempotency, not a limit).
- **G4 login-enumeration** — a scout flagged login/reset showing raw Supabase errors; VERIFY FIRST whether modern Supabase already returns a generic "Invalid login credentials" for both wrong-password and no-such-user (it likely does) before building — may be a non-issue or need a new server login route (critical-path, careful).
- **HIGH-CONFIDENCE F2 candidates remaining:** `lib/utils/rate-limiter.ts` checkRateLimit sliding-window (security-critical, untested — but coordinate if a change also edits RATE_LIMITS), `lib/utils/p-limit.ts` (concurrency), `lib/agents/room-diagnostician.ts`/`scene-assembler.ts` (heavy mocking — lower confidence).
- **DO-NOT-RE-FLAG (settled this run):** upload/mobile-entitlements + confirm now rate-limited; rooms/products/projects POST validated; verdicts/openai-schema/pagination/image-mime/build-profile/user-profile/api-error/determinism now tested. Carry Run 61's list forward (memory-store makes pgvector/DB-perf/PostgREST-enum inert; provider floors bound LLM timeouts; getCurrentUserId mock not a leak; semantic status colors legitimate; RLS clean through 029).

---

## Run 2026-07-04 (Run 61) — 6 disjoint value-bar changes (security G1/G2 + F2 tests + BUSINESS_CASE COGS + mobile iOS a11y); both ship-critical blockers deferred with precise notes

### State on entry
- Cold container. Reset to `origin/<default>` tip `6e383e4` (post Run 60 #394-397 + housekeeping #392... i.e. `6e383e4`). `npm install` root+mobile. Baseline gate GREEN: tsc clean, **1647 tests** pass / 11 skip, determinism clean, eslint 0 (root+mobile).
- **DEEP AUDIT not due** (Run 60 ran the full 8-lens sweep → next ~Run 64).
- Consumed QUALITY_SCORECARD (as_of 2026-07-03, overall **C**, ship_gate_met false): the two ship-critical dims below A are **functional_reality (C)** and **design_taste (B)**. GROWTH_STATUS pre-launch 0/null → no lever signal (no-op for prioritization).
- Constraints re-confirmed: **no supabase CLI, docker not running** → CANNOT stand up the auth stack locally; authed-journey + authed-render changes are only CI-verifiable. Playwright chromium present. `.github/` is NOT editable (permission-hang) — the CI journeys job env can't be changed by the loop.

### The two ship-critical blockers — assessed NOT-safely-landable blind this run; DEFERRED with precise notes
- **functional_reality (C) — THE convergence blocker.** Needs a real photo→understand→diagnose→source→mockup runtime assertion of a REAL mockup `<img>`. CI's journeys job runs the app with DUMMY LLM keys, so this needs a **recorded-provider (cassette) tier** returning deterministic text + a real committed PNG for image-gen. FEASIBILITY MAP (done this run): image-gen flows through the SAME `AIProvider.chat()` interface (imageConfig) → a cassette must implement the full provider surface. ACTIVATION without a `.github` edit IS possible: gate the cassette on `E2E_AUTH_STACK==="1"` (already set ONLY in the CI journeys job; "prod never sets it", same safety class as E2E_RATE_LIMIT_BYPASS) — so `scripts/run-journeys.sh`/the app would auto-use it in CI with no forbidden edit. WHY DEFERRED: large, multi-file, cost-contract-sensitive (must not trip harness-ratchet; must hard-refuse in prod), and the E2E half is ONLY CI-verifiable (slow iterate). This is Run 60's "FOCUSED-run item" — do it as a dedicated run: build the cassette + unit-test it locally, then extend journeys.spec.ts (upload fixture → pipeline → assert real `<img>` src), watch CI go green, iterate within the cap.
- **design_taste (B) — dashboard welcome-step AA contrast (#204 + Run 60's #393).** Computed the RESTING-state WCAG ratios on the current tokens (`--accent-warm` light #b4501e, `--muted-foreground` light #7c7268 / dark #8a8077): badge accent-warm on its 10%-tint bg = **4.25** (FAIL), hero subtitle `text-lg` muted on page bg = **4.47** (FAIL, marginal), light step-hint on card 4.70 (pass), dark step-hint on card = **4.49** (FAIL, marginal), step-number 5.11/5.23 (pass). So the REAL resting fails are marginal (4.25–4.49); Run 60's reported 1.49–3.22 were framer-motion mid-`StaggerItem` animation-opacity artifacts, NOT resting colors. WHY DEFERRED (same as Run 60): the fix is fiddly + needs render verification I can't do (no authed local render): the badge text+bg BOTH derive from `--accent-warm` (darkening the token darkens both → net contrast change ambiguous → needs a targeted per-element fix, not a token change); `--muted-foreground` must go DARKER in light but LIGHTER in dark (opposite directions) to clear 4.5 in both themes; and the axe GATE has the animation confound (must emulate `reducedMotion:'reduce'` + drop the `networkidle` wait). NEXT RUN (render-capable, or accept CI-only iteration): fix the ~3 marginal elements to ≥4.6 in BOTH themes, THEN re-add the authed axe gate with reducedMotion.

### What was done — 6 file-disjoint changes (#401-406), all both-APPROVED, auto-merge on CI green
- **#402 G2 (security)** — server-side input validation on rooms/products/projects POST (cap free-text strings/arrays/JSON before the DB insert). Type-correct vs `CandidateProduct` (materials/colors `string[]`, dimensions/metadata jsonb objects, price finite number) + generous abuse-only bounds; Reviewer A confirmed no legit-write rejection (checked migration-001 column types + real callers).
- **#403 G1 (security)** — rate-limit `/api/upload` (wired the previously-DEAD `RATE_LIMITS.upload` 20/min) + `/api/mobile/entitlements` (new `RATE_LIMITS.mobileEntitlements` 30/min; proxies a paid RevenueCat REST call). 429+Retry-After, checked after auth before the expensive work.
- **#401 F2 test** — `lib/scoring/verdicts.ts` (score→colour bands ≥8/≥6/else, NaN fall-through, verdict-map completeness; 0 prior tests). 10 cases.
- **#404 F2 test** — `lib/ai/openai-schema.ts` (Zod→OpenAI strict converter; 0 prior tests). 15 cases via hand-built inputs ($ref incl. dangling, anyOf-nullable, allOf/oneOf, keyword-strip vs property-name, strict invariants).
- **#405 BUSINESS_CASE** — COGS recompute: core HIGH-thinking analyses route to `TEXT_TIERS.mid`=gemini-3.1-flash-lite (not base 2.5-flash-lite); at $0.25/$1.50 per 1M → ~$0.002/analysis (was $0.0006). ARR unchanged (COGS moves margin not revenue); summary block still parses, base=122900. `as_of`→2026-07-04.
- **#406 mobile a11y** — iOS VoiceOver `AccessibilityInfo.announceForAccessibility()` on the results loading screen (`accessibilityLiveRegion` is Android-only; the Run 60 cross-platform follow-up). iOS-gated, `[stage]` deps, fire-and-forget (no unmount risk).
- Reviews: 12 first-round Sonnet (2×6), ALL both-APPROVE, 0 re-review cycles. 2 in-cycle self-fixes on already-approved diffs: G1 comment corrected (Reviewer B: "mobile caches client-side" was unverifiable — no mobile call site hits that endpoint, confirmed by grep); BUSINESS_CASE "GA May 2026" softened (Reviewer A: the cited Pricepertoken URL is the "-preview" page; the price is confirmed by the primary ai.google.dev source regardless).

### Lessons learned
1. **Verify scout line-level claims before building — the mobile Haiku scout HALLUCINATED 3 of 6 findings.** It claimed `use-free-quota.ts` and `photo.tsx` had `useEffect` with NO deps array (both already have `}, []);`), and flagged a `markSaved` race already mitigated ("read from AsyncStorage on each call"). Reading the real files killed 3 candidates cheaply. Haiku scouts are for DISCOVERY; the maker must confirm every line-claim against source. (Also: findings 1-2 — paywall-sheet getOfferings / use-entitlements setState-after-unmount — are REAL but marginal: React 18 removed the unmount warning; the stale-overwrite window is narrow → cut as below-bar.)
2. **A cassette provider CAN be activated in the CI journeys job WITHOUT a `.github` edit — gate on `E2E_AUTH_STACK`.** That env is set only in the journeys job and "prod never sets it" (same class as E2E_RATE_LIMIT_BYPASS, which is even fail-closed-guarded on Vercel). This unblocks the functional_reality convergence design without touching the forbidden CI file — the blocker is EFFORT/verifiability, not access.
3. **The dashboard AA-contrast fails are MARGINAL (4.25–4.49) at rest, not 1.5–3.2.** Run 60's low numbers were framer-motion mid-animation opacity artifacts. The real fix is small (nudge ~3 elements past 4.5 in both themes) but still needs render verification because the badge text+bg co-derive from one token and muted-foreground must move opposite directions in light vs dark.
4. **openai-schema has a real latent bug: multi-element `allOf` merge leaves a stale `required`.** `cleanForOpenAI` Object.assigns cleaned sub-schemas; branch A's `required` survives while branch B replaces `properties`, so the emitted schema has `required:[a]` with `properties:{b}` → invalid OpenAI strict mode (would 400). Rare (Zod seldom emits multi-element allOf), so DEFERRED, but a future fix should recompute `required` after the merge. #404's test does NOT assert/cement the stale `required` (it only checks type + properties.b), so a later fix won't break it.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 64.**
- **functional_reality (ship-critical, C) — THE convergence blocker — do it as a FOCUSED run** using the cassette plan above (gate on `E2E_AUTH_STACK`; build+unit-test the recorded provider locally; extend journeys.spec.ts to assert a real mockup `<img>`; iterate against CI).
- **design_taste (ship-critical, B)** — fix the ~3 marginal-AA welcome-step elements to ≥4.6 in BOTH themes (badge needs a per-element darker text and/or a less-transparent bg since text+bg co-derive from `--accent-warm`; `--muted-foreground` darker in light / lighter in dark), THEN re-add the authed axe gate with `reducedMotion:'reduce'` + no `networkidle` wait. F7 screenshots still absent.
- **HIGH-CONFIDENCE, locally-verifiable F2 candidates remaining:** `lib/design-context/user-profile.ts` (getDesignContextPrompt — 10+ conditional blocks incl. floor-plan matched/unmatched; HIGH value), `lib/ai/determinism.ts` (resolveSeed/resolveTemperature + DETERMINISTIC_SEED parse — modest). Skip `provider-factory.ts` (stateful latch).
- **Security G1/G2 remaining (partial this run):** G1 — rate-limit the secondary write routes (projects/rooms/products POST, email-preferences PUT); AVOID rate-limiting the Stripe webhook (idempotency, not a rate limit, is the right fix — a naive limit drops legit Stripe retries). G2 — validation on the remaining write routes (rooms/[roomId]/images, identified-products/confirm correction fields, projects/[projectId] building_research/apartment_analysis size caps). G4 — login lockout/backoff would need a NEW server-side `/api/auth/login` route + rewiring the login page (critical-path, CI-only-verifiable → treat carefully, maybe a focused run).
- **openai-schema latent bug** (lesson 4) — a small, safe, locally-verifiable fix + a test asserting `assertStrict` on the multi-allOf case.
- **DO-NOT-RE-FLAG (settled/verified — carry Run 60's list forward):** memory-store makes pgvector-RPC + DB-perf + PostgREST-enumeration findings inert; gemini/deepseek provider floors bound every LLM call; `getCurrentUserId` mock fallback is not a leak; badge/toast/diagnosis SEMANTIC status colors are legitimate; `handle_new_user`(028) nonblocking is deliberate; RLS migrations CLEAN through 029. PLUS this run: mobile use-free-quota/photo.tsx deps arrays are PRESENT (scout hallucination); the two write routes now validate input (#402) + upload/entitlements now rate-limited (#403).

---

## Run 2026-07-03 (Run 60) — DEEP AUDIT (8-lens) + 4 merged (3× F2 test + mobile a11y) + 2 abandoned on review/CI

### State on entry
- Cold container. Reset to `origin/<default>` tip `440f0e2` (post Run 59 #386-391 + housekeeping #392). `npm install` root+mobile. Baseline gate green: tsc clean, **1596 tests** pass / 11 skip, determinism clean, eslint 0.
- **DEEP AUDIT was DUE** (last full audit Run 57 → ~Run 60). Ran the full 8-lens read-only Haiku sweep (functional-reality/e2e, security-RLS, correctness/dead-code, perf, a11y/design, test-coverage, mobile, artifact-freshness) BEFORE scouting; folded findings into candidate selection.
- Consumed QUALITY_SCORECARD (as_of 2026-07-03, overall **C**, ship_gate_met false): the two ship-critical dims below A are **functional_reality (C)** and **design_taste (B)**. GROWTH_STATUS pre-launch 0/null → no lever signal.
- **KEY ARCHITECTURE FACT (re-confirmed):** the app's DEFAULT runtime uses the in-memory store (`lib/store/memory-store.ts`, "replaces Supabase"), whose `.rpc()` is a no-op (line 400). CI's `journeys` job runs against real Supabase-local. This reframes multiple audit findings (below).
- Tooling: **no supabase CLI, docker not running** → CANNOT stand up the auth stack locally. Authed-journey changes are only CI-verifiable (via the `journeys` job). Playwright chromium present.

### DEEP AUDIT (8-lens Haiku sweep) — key results + triage
- **functional_reality:** the core `photo→understand→diagnose→source→mockup` flow still has ZERO runtime assertion of a REAL mockup `<img>`. Needs recorded/deterministic provider responses (cassettes) since CI uses dummy LLM keys — a multi-file, cost-contract-sensitive architecture piece, unverifiable locally without the auth stack. **DEFERRED as the focused next-run item.** Paywall→unlock half is DONE (#386, Run 59).
- **security_rls: NO-OP (clean).** The scout's "GRANT-gap" (service-role tables lacking explicit table GRANTs like migration 029 added for stripe_customers) was investigated and **DEFERRED, not shipped**: the migration-001 tables AND saved_designs(011) already work in CI journeys (default privileges cover them) — only stripe_customers(018) empirically failed in Run 59. A broad speculative multi-table GRANT migration I cannot verify against `supabase db reset` (no CLI/docker here) is not well-justified; the evidence undercuts the premise. `product_image_embeddings` public read `USING(true)` — inert under memory store. `handle_new_user_nonblocking`(028) swallow — DELIBERATE non-blocking design, do NOT re-raise.
- **correctness:** most "no timeout on gemini.chat()" findings are FALSE-POSITIVE-adjacent — the provider floor already bounds Gemini at 180s (gemini.ts:42) < the 300s route budget. `getCurrentUserId()` mock-fallback (functional scout's "CRITICAL leak") is NOT a leak: single-data-space memory store + middleware already gates protected routes + prod-fail-loud on unset creds (matches why security_rls is A+).
- **perf:** Promise.all/Map wins on search/diagnosis are **inert under the memory store** (in-memory array ops, not DB round-trips). Issue #385's pgvector `match_` RPC is likewise inert (memory-store `.rpc()` no-op) — DEPRIORITIZED (confirms Run 59 note).
- **a11y/design:** the scout's badge/toast/diagnosis "de-emerald to single accent" cluster was REJECTED — those are legitimate SEMANTIC status colors (success/warning/error paired with text+icon), NOT the auditor's named design_taste gap; blanket de-coloring would be a UX regression + churn.
- **test-coverage:** shipped pagination/image-mime/build-profile (all 0 tests). Remaining candidates: `provider-factory.ts`, `memory-store.ts` query builder, `determinism.ts`, `verdicts.ts`, `openai-schema.ts`.
- **mobile:** paywall-sheet `getOfferings()` concurrent-on-remount (candidate, AbortController); use-entitlements/use-free-quota setState-after-unmount (LOW value).
- **artifact:** BUSINESS_CASE.md says COGS dominated by "Gemini 2.5 Flash Lite" but core analyses (apartment/area/diagnosis, DEFAULT_THINKING high) route to TEXT_TIERS.mid = "gemini-3.1-flash-lite" (costlier) → real COGS-model drift worth a recompute (candidate). Page-title brand drift → ATTEMPTED, abandoned (below).

### What was done — 4 merged (#394-397), 2 abandoned (#393, #398)
- **#394 F2 (MERGED)** — `parsePagination` (shared list-endpoint range parser, every paginated route, 0 tests): pinned the INCLUSIVE `rangeEnd=offset+limit-1`, maxLimit clamp+floor, non-positive/NaN/Infinity/"" → default. 17 cases.
- **#395 F2 (MERGED)** — `isGeminiCompatibleImageUrl` (vision-format pre-filter, 0 tests): pathname-scoped matching (query can't fake/hide an ext), case-insensitivity, non-URL catch fallback. 27 assertions.
- **#396 F2 (MERGED)** — `buildDesignProfile` (system-prompt personalisation extractor, 0 tests): characterization test pinning the no-data gate, location-not-triggered-by-state-alone, nested-over-flat lifestyle merge, hasData quirk (bedrooms=0 / bathrooms-alone → undefined). 10 cases.
- **#397 mobile a11y (MERGED, Track B / design_taste)** — the results-screen loading card swapped upload→analyze text with no live region (SR silence 15-30s) → `accessibilityLiveRegion="polite"` + `accessibilityRole="progressbar"` (chose "polite" not "assertive").
- **#393 authed axe (ABANDONED — the gate WORKED, found real bugs).** Added an authed AxeBuilder scan of the signed-in `/dashboard` to close a design_taste ship-critical gap (#204). CI's journeys job ran it and it FAILED on **real serious WCAG 2 AA color-contrast violations** on the welcome step: the intro badge (`text-accent-warm` #c4754e/#f5ece7 = 3.0), the hero subtitle (`text-muted-foreground` = 2.91), and the 3 onboarding step-preview cards' `text-[10px]`/`text-xs` accent+muted labels (1.49–3.22). ALSO: `waitForLoadState("networkidle")` timed out on retry, and axe partly measured MID-`StaggerItem`-animation opacity (the progressively-lighter #d9a990→#e7cabb step numbers are artifacts). Landing the gate requires FIXING the contrast first — a design change I can't safely nail blind (no local auth-stack render, dark-mode parity, animation confound) within the cycle cap → closed the PR, recorded the exact targets on issue #204. Reason code: **gate_test / design_blocked_on_render**.
- **#398 brand-metadata (ABANDONED — review_value).** Page-title AptDesigner→AptDesignerAI across 17 metadata files. BOTH Sonnet reviewers REQUEST_CHANGES (correctly): fixing `<title>` while leaving the marketing footer (© AptDesigner on every page), body prose, shared-design header, mockup watermark, and email templates stale creates NEW visible inconsistency — metric-chasing, not a real fix. Doing it right = a wholesale brand sweep + a `BRAND_NAME` constant (bigger, coordination-heavy).
- Reviews: 12 first-round Sonnet (2×6). 5 both-APPROVE; of those 4 auto-merged green + 1 (#393) failed CI on a real finding → closed. 1 (#398) both-REQUEST_CHANGES → abandoned. No re-review cycles.

### Lessons learned
1. **Know the store before flagging "DB perf" or "RLS enumeration."** The app's default runtime is the IN-MEMORY store; `.rpc()` is a no-op and every `.from()` is an array scan. pgvector-RPC/index/seq-scan findings (incl. #385) and PostgREST-enumeration findings are inert in the real runtime — they matter only in a future real-Supabase migration.
2. **Provider-floor timeouts already bound every LLM call** (gemini 180s / deepseek 120s < 300s route budget). Scout "no per-call timeout" findings are mostly non-issues — check the provider floor before adding a redundant per-call timeout.
3. **A speculative security migration you can't verify is NOT a "security finding that clears the bar."** The GRANT-gap looked systemic, but the evidence (001+011 tables work in CI, only 018 failed) undercut a broad grant migration and there was no local `supabase db reset` to prove per-table need. Deferring an unverifiable speculative migration is disciplined, not a miss.
4. **The authed-axe gate earned its keep — but a11y GATES need render-verification, and this one couldn't run locally.** It found genuine AA contrast failures on the core signed-in screen (great), but I could only discover that via CI, and I can't fix contrast blind (dark-mode parity, taste, the framer-motion opacity confound). Two operational lessons for a11y-gate PRs: (a) an axe scan on an ANIMATED surface must emulate `reducedMotion:'reduce'` (else it measures mid-transition opacity and reports false/inflated contrast fails); (b) drop `waitForLoadState("networkidle")` on the dashboard — it timed out on retry. Land the a11y GATE and the FIX together, in a run where the surface can be rendered/previewed.
5. **Reviewer B on the titles change was exactly right.** A "close the scorecard-flagged count" edit that fixes `<title>` but not the footer/body/watermark on the same pages produces NEW inconsistency. A brand rename must be wholesale (grep `AptDesigner\b` project-wide) behind a single `BRAND_NAME` constant, or not done.
6. **`accessibilityLiveRegion` is Android/TalkBack-only in RN.** #397 (and #369) fix the silent-status gap for Android; iOS/VoiceOver needs `AccessibilityInfo.announceForAccessibility()`. Future cross-platform a11y follow-up.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 64.**
- **design_taste (ship-critical, B) — HIGHEST-VALUE, now with PRECISE targets (issue #204).** Fix the dashboard welcome-step AA contrast (intro badge accent text; hero subtitle `text-lg text-muted-foreground`; the 3 step-preview cards' `text-[10px]`/`text-xs` accent+muted labels + `01/02/03` numbers) to ≥4.5:1 in light AND dark — likely dashboard-scoped local fixes (public pages pass axe with the same tokens), NOT a global `muted-foreground`/`accent-warm` token change. THEN re-add the authed axe gate with `reducedMotion:'reduce'` + no `networkidle` wait so it stays enforced. F7 screenshots to `e2e/__screenshots__/` still open (generate IN the CI journeys job — toHaveScreenshot is env-sensitive).
- **functional_reality (ship-critical, C) — THE convergence blocker.** Remaining lever: a runtime assertion of a REAL mockup `<img>` from the core pipeline, needing a **recorded-provider (cassette) tier** (CI uses dummy LLM keys). Multi-file, cost-contract-sensitive; do it as a FOCUSED run.
- **HIGH-CONFIDENCE, locally-verifiable candidates (file-disjoint):** F2 tests for `verdicts.ts` (score→color boundaries), `determinism.ts`, `openai-schema.ts`, `provider-factory.ts` (routing/latch — cost-contract-adjacent, careful); mobile paywall-sheet `getOfferings()` AbortController; **BUSINESS_CASE.md COGS recompute** (2.5 Flash Lite → core analyses actually route to 3.1 Flash Lite).
- **BRAND SWEEP (if taken):** wholesale only — footer (`components/marketing/marketing-footer.tsx` © line, ~16 pages), body prose (waitlist/terms/faq/gallery/pricing/guides), `app/shared/[token]/SharedDesignView.tsx` header, the mockup watermark, `lib/email/templates/lifecycle.ts` sign-offs — behind a single `BRAND_NAME` constant.
- **DO-NOT-RE-FLAG (settled/verified this run):** memory-store makes pgvector-RPC + DB-perf + PostgREST-enumeration findings inert (#385 deprioritized); gemini/deepseek provider floors bound every LLM call (no redundant per-call timeout); `getCurrentUserId` mock fallback is not a leak; badge/toast/diagnosis SEMANTIC status colors are legitimate (not a design_taste gap); handle_new_user(028) nonblocking is deliberate. Plus prior settled items (post-persist status flips log-only; idempotent DELETE routes; UPDATE-policy implicit WITH CHECK; product-verify maxDuration=300).

---

## Run 2026-07-03 (Run 59) — 6 disjoint changes (ship-critical functional_reality E2E + ship-critical design_taste + 2× F2 test + correctness/spend + money-path hardening)

### State on entry
- Cold container. Reset to `origin/<default>` tip `3cd93d2` (post Run 58 #379-382 + housekeeping #383 + quality grade #384). `npm install` root+mobile. Baseline gate green: tsc clean, **1544 tests** pass / 11 skip, determinism clean, eslint 0.
- **DEEP AUDIT not due** (full audits ran Run 52/56/57 → next ~Run 60). Consumed QUALITY_SCORECARD (as_of 2026-07-03, overall **C**, ship_gate_met false): the ONLY two ship-critical dims below A are **functional_reality (C)** — core money-path journeys had zero outcome-asserting runtime E2E — and **design_taste (B)** — authed axe + F7 screenshots absent. GROWTH_STATUS pre-launch 0/null → no lever signal. Ran a 6-lens Haiku scout sweep (functional-reality / security-RLS / correctness / design-a11y / mobile / test-coverage).
- **KEY RE-FRAME:** prior runs recorded functional_reality as "OWNER-BLOCKED on Supabase-local + Stripe-test in CI." Inspecting `.github/workflows/ci.yml` showed this is STALE — the `journeys` job ALREADY stands up Supabase-local (`supabase start` + `db reset`) with `E2E_AUTH_STACK=1` + service-role env, and runs the AUTHENTICATED journey tier. The real gap was **weak assertions**, not missing infra: `journeys.spec.ts` only asserted "/billing/upgrade renders a heading." That IS buildable now.

### What was done (6 file-disjoint changes, #386-391)
- **#386 functional_reality/F4** — strengthened the authed paywall journey to assert the REAL money-path OUTCOMES (Continue-to-checkout button; free user sees UpgradeCtaCard on /saved; a `seedProEntitlement`-seeded Pro user gets `hasPaid=true` from /api/billing/status AND the CTA disappears — paywall→unlock end to end). Web entitlement lives in `stripe_customers` (migration 018), seedable via the service-role admin client WITHOUT live Stripe. Files: `e2e/journeys.spec.ts` + `e2e/helpers/seed.ts` (+ migration 029, see rework).
- **#387 design_taste/F7** — the room-hub stepper (`app/projects/[projectId]/rooms/[roomId]/page.tsx`, the core signed-in surface) rendered its 6 steps in 6 competing accent colors + hardcoded emerald connector/status → removed the per-step color/bg/completedBg fields (bg was dead) and unified to `accent-warm` + neutral tokens.
- **#388 correctness/spend** — products/evaluate 500'd on the post-persist `candidate_products` status flip; `product_evaluations` has NO unique constraint, so the 500 made the client retry a SUCCEEDED eval → duplicate row + re-burned LLM credits → log-and-continue (settled §32 pattern, mirrors diagnosis/bundles-evaluate).
- **#389 F2 test** — 37 boundary cases for the SSRF `validateExternalUrl` (0 prior tests): private-range edges (172.16-31 vs 172.15/172.32, 192.168 vs 192.167/9, 10/127/169.254/0), IPv6 ULA/link-local vs public, credentials, non-HTTP schemes.
- **#390 F2 test** — 15 cases for `extractJsonObject` (LLM-reply parser every agent routes through, 0 prior tests): each strategy (direct→fence→balanced-brace→repair→fallback) + the brace/escape in-string state machine.
- **#391 money-path hardening** — Stripe checkout had the SDK 80s default timeout + no route maxDuration → `timeout:15s` + `maxNetworkRetries:0` (client) + `maxDuration=20` (route), matching the email/Turnstile timeout discipline.
- Reviews: 12 first-round Sonnet (2×6) + 2 re-reviews (#391) + 2 re-reviews (#386 migration). All merged both-APPROVE on CI green; verified default tip `48d77a0`. +52 tests.

### Lessons learned
1. **"OWNER-BLOCKED" claims decay — re-verify the CI config, not the memory.** functional_reality was carried as owner-blocked for many runs, but `ci.yml`'s `journeys` job already had the full Supabase-local + `E2E_AUTH_STACK=1` auth stack. The blocker was weak test assertions I could fix, not absent infra. Read the actual workflow before assuming a gate is unbuildable.
2. **The functional_reality gate EARNED its keep this run.** #386's first CI run FAILED with `permission denied for table stripe_customers` — a REAL latent gap the strengthened journey caught: migration 018 created the table + RLS but never GRANTed table privileges, and `supabase db reset` does NOT reliably apply Supabase's default-privilege auto-grants to migration-created tables. Both the seed AND the app's own `getWebBillingStatus` (service-role) hit it. Fixed with migration 029 (explicit `service_role` DML + `authenticated` SELECT). `permission denied for table X` is unambiguously an ACL/GRANT error (a failed RLS SELECT returns 0 rows; a failed RLS write says "violates row-level security policy") — so the fix targets the GRANT layer, and GRANT/RLS are independent AND-ed gates (the authenticated SELECT grant is the prerequisite for the own-row policy, not a bypass).
3. **The Stripe SDK auto-retries a timeout (default maxNetworkRetries=2).** A bare `timeout: 15_000` does NOT bound a stalled checkout: `ETIMEDOUT` is not in the SDK's connection-drop retry-bypass list, so with the default it retries ~3×15s+backoff ≈ 45-50s, past any route budget. Must pass `maxNetworkRetries: 0` for a user-initiated checkout. Reviewer A caught this against the installed SDK source — verify SDK retry/timeout defaults, don't assume.
4. **Two scout findings were confident FALSE POSITIVES — verify before shipping.** (a) "UPDATE policies lack WITH CHECK → user_id reassignment": Postgres uses USING as the implicit WITH CHECK for UPDATE, so it's already blocked (settled). (b) "5 DELETE routes return success without a row-count check → fake success": these are ownership-scoped IDEMPOTENT deletes that DO check the in-band error; a 0-row delete of an absent row is correct REST semantics, not a lie. The genuine fake-success pattern is returning success after a real ERROR, which none of them do.
5. **Shared-ledger updates for a code-branch fix still go in the bookkeeping PR.** #386's migration re-reviewer (correctly) asked for a PENDING_OPS entry for migration 029, but the disjoint rule forbids touching shared ledger files in a code branch — the entry belongs in THIS housekeeping PR, which satisfies the concern via the correct file/PR.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 60** (last full audit Run 57) — run the 8-lens read-only Haiku sweep before scouting.
- **functional_reality (ship-critical, C):** the paywall→unlock half is now asserted + CI-green. STILL OPEN: the core `photo→understand→diagnose→source→mockup` flow has no runtime assertion of a REAL mockup `<img>` — that needs recorded/deterministic provider responses (cassettes) since CI uses dummy LLM keys (a larger architecture piece). This is the remaining functional_reality lever.
- **design_taste (ship-critical, B):** the RAISE items are (a) run AxeBuilder over ≥1 AUTHED design-dense route (the journeys job has the auth stack — add an authed-a11y spec run via run-journeys.sh, but FIRST run it to see if authed routes currently have violations, since a hard axe gate could red-block auto-merge), and (b) commit real F7 screenshots to `e2e/__screenshots__/` (needs the running app + auth stack; capture within the journeys job).
- **DB grant gap may be systemic:** migration 029 fixed `stripe_customers`, but if `supabase db reset` doesn't apply default grants, OTHER migration-created tables queried via service_role could hit the same `permission denied` when first exercised by a journey. Watch for it as more authed journeys are added.
- **Migration 028 (`028_handle_new_user_nonblocking.sql`) lacks a PENDING_OPS entry** (pre-existing, not this run's) — owner-safety gap worth closing in a future bookkeeping pass.
- **DO-NOT-RE-FLAG (settled this run):** UPDATE-policy WITH CHECK (implicit from USING); ownership-scoped idempotent DELETE routes (not fake success). Plus prior settled items (pgvector RPC inert under memory-store; product-verify maxDuration=300; search/analyze post-persist status flips log-only).

---

## Run 2026-07-03 (Run 58) — 4 disjoint changes (ship-critical security + eval-regression correctness + F2 test + mobile reliability)

### State on entry
- Cold container. Reset to `origin/<default>` (tip `83ed6ec`, post Run 57 #366-372 + housekeeping #374 + a11y #369 + GTM #375-378). `npm install` root+mobile. Baseline gate green: tsc clean (root+mobile), **1513 tests** pass / 11 skip, determinism clean, eslint 0.
- **DEEP AUDIT not due** (full audits ran Run 52, 56, 57 → next ~Run 60). Consumed QUALITY_SCORECARD (still as_of 2026-07-01, overall C / ship_gate_met:false — the same stale one Run 57 reconciled; ship-critical blocker stays functional_reality C, OWNER-BLOCKED on Supabase-local+Stripe-test in CI). GROWTH_STATUS pre-launch, 0/null across the funnel (engine 100%, awaiting_connect) → no lever signal. Ran a 6-lens Haiku scout sweep (entitlements-security / mobile-reliability / diagnosis-schema / untested-pure-modules / web-perf-correctness / artifact-copy) folded with the open issues (#348, #306) and Run 57's deferred queue.

### What was done (4 file-disjoint changes, #379-382)
- **#379 security/correctness (issue #348, ship-critical)** — `hasProEntitlement` (RC/mobile, `lib/entitlements/server.ts`) and `hasProEntitlementWeb` (Stripe/web, `lib/entitlements/web.ts`) returned `true` — granting Pro to EVERY user — when the secret key was UNSET, in ANY environment (a silent revenue leak + wide-open gate on a deploy misconfig). Now the MISCONFIG branch (key unset) fails CLOSED in production / OPEN in dev (loud `console.error`), while every RUNTIME-OUTAGE branch (key set, RC/DB call errors/times out) still fails OPEN (deliberate, C4). `isEntitlementConfigured()` separates misconfig from `getWebBillingStatus`'s runtime-error null. Mirrors the `lib/supabase/server.ts` prod-fail-loud precedent. **In-cycle rework:** BOTH reviewers independently flagged `app/api/billing/status/route.ts` bypassing the fixed gate (would render "Pro" in prod while enforcement caps saves) → routed it through the same env-aware logic + fixed stale docstrings, re-reviewed → both APPROVE. +4 tests.
- **#380 correctness/eval-regression (issue #306)** — a live diagnosis eval hard-failed because the model returned `room_type_confirmation.matches_declared` as the STRING "true"/"false" not a JSON boolean (`z.boolean()` threw, aborting the whole diagnosis). Added `looseBoolean` (explicit trim/lower "true"/"false"→bool `z.preprocess`) applied to that field. +7 tests incl. the `"false"`→false anti-footgun case.
- **#381 F2 test** — exported (behaviour-neutral) + tested `isLikelyProductUrl` / `isProactivelyBlockedDomain` / `extractBackfillKeywords` in `lib/agents/orchestrator.ts` — the pure helpers that drop non-PDP/non-retailer URLs BEFORE an extraction LLM call + build the fallback query (spend-gating hot path, 0 prior tests). +22 mutation-resistant cases.
- **#382 mobile reliability (Track B)** — `mobile/src/app/results.tsx` fired upload→analyze in a useEffect with NO cleanup; a back→forward remount started a SECOND concurrent PAID `/api/mobile/analyze` while the first was still open (duplicate inference) and could setState after unmount. AbortController held in a ref, aborted on unmount + superseded on retry; post-await setState guarded by `signal.aborted`; `fetchWithTimeout` composes the external signal with its own timeout.
- 8 Sonnet reviews (2×4) + 2 re-reviews (#379); ALL APPROVE. All 4 auto-merged on CI green (verify+build+mobile+journeys); default tip `ca6fc8e`. 1513→1520+ tests. No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box FULLY completes → none ticked. Partial-fix status commented on issues #306/#348.

### Lessons learned
1. **VERIFY a scout's Zod/coercion suggestion before shipping it.** The #306 scout confidently proposed `z.coerce.boolean()` AND wrote a test asserting `"false"`→false — but `z.coerce.boolean()` is `Boolean(v)`, so `Boolean("false") === true`; the suggestion would have silently flipped a genuine "room does not match declared" into "matches" (a correctness bug the eval wouldn't catch). The right fix is an explicit `z.preprocess` string map. The maker (Opus) catching this is exactly why scouts return candidates, not code.
2. **When you change a shared helper's fail-open/entitlement policy, grep EVERY caller in the same PR.** #379 fixed `hasProEntitlementWeb` but the display route `app/api/billing/status/route.ts` calls the sibling `getWebBillingStatus` directly and independently fail-opened — leaving it would have made the UI show "Pro" while enforcement capped the user. Both reviewers caught it independently. `getWebBillingStatus` returns null for BOTH misconfig AND query-error, so the caller must use `isEntitlementConfigured()` to keep fail-open-on-outage while failing-closed-on-misconfig.
3. **Entitlement fail-open has TWO distinct causes that must be handled differently:** MISCONFIG (key unset — a deploy-time constant) should fail CLOSED in prod (loud); a RUNTIME OUTAGE (key set, call fails) should fail OPEN (don't lock out payers). Collapsing them (the old code + the naive fix) is the bug. This mirrors the C4 "fail-open on RC outage" intent while closing the #348 hole.
4. **A review subagent used `git worktree`; instruct reviewers to avoid it too** (not just checkout/stash/reset). It reported the main tree untouched and my uncommitted edits survived, but a worktree on the same repo is a shared-tree hazard — later reviewer prompts explicitly forbade `git worktree`.
5. **`npm install` on this platform dirties package-lock.json** (fsevents `dev:true`). Add SPECIFIC files per commit, never `git add -A` — I caught + amended one spurious lockfile line into #379 before review.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 60.**
- **functional_reality (ship-critical, C) remains the convergence blocker and is OWNER-BLOCKED** (core photo→mockup + paywall→checkout E2E need Supabase-local + Stripe test-mode in CI, `.github/` human-applied). Readiness NOT attempted this run.
- **Issue status:** #306 boolean half FIXED (#380); the `what_is_working: []` half is a MODEL-QUALITY issue (empty array from the model) — needs prompt tightening / a repair pass + eval verification, NOT a schema loosening (the issue itself warns against loosening to go green). #348 entitlement-fail-open half FIXED (#379); its other sub-items remain: social publishing 100% dry-run, live-eval skip-to-green (both `.github`/owner territory).
- **DEFERRED, validated, file-disjoint (take carefully next run):**
  - **products/evaluate status-flip** (`app/api/products/evaluate/route.ts:210-212`) returns HTTP 500 on the POST-PERSIST `candidate_products.status`→"evaluated" flip, inconsistent with the settled log-only pattern (diagnosis:406, bundles/evaluate:163, evaluate-set) → a status-flip failure 500s a SUCCEEDED evaluation, and the retry re-inserts a DUPLICATE evaluation. BUT it reverses a DELIBERATE commented decision and both outcomes have a downside (log-only leaves a stale "pending" status the comment defends). FIRST check whether `product_evaluations(product_id,room_id)` has a unique constraint (would make retry fail instead of duplicate). Medium value; deferred this run to avoid re-litigating a settled-looking judgment call.
  - **other LLM-output boolean fields** (`drop`, `needs_more_work`, `needs_more_rounds`×2, `isValid`, `verified`×3, `user_confirmed`, `embedding_written_back`) could use `looseBoolean` — ONLY if they see a real live failure like #306, never speculatively (a #380 reviewer's note).
  - **mobile marginal reliability** (`use-free-quota`, `use-entitlements`, `use-push-notifications` setState-after-unmount) — React 18 no longer warns; low value; only bundle into a larger mobile pass, never as padding.
  - **free-tier "1 room" copy** — UNDERSELL not oversell (FREE_SAVE_LIMIT_WEB=3 caps SAVES; diagnosis is uncapped); coordination-heavy across 6+ files; deferred again (Run 53-57 all deferred).
- **DO-NOT-RE-FLAG (settled):** search/analyze/refine post-persist STATUS flips (log-only correct — #309); pgvector RPC (inert under memory-store); product-verify maxDuration (=300); preflight RLS+NEXT_PUBLIC+EXPO_PUBLIC gates (present); RLS FOR ALL USING w/o WITH CHECK (safe); next/image for external/blob URLs (deliberate <img>).

## Run 2026-07-03 (Run 57, concurrent with Run 56 #365) — DEEP AUDIT + 7 disjoint changes

### State on entry
- Cold container. Reset to `origin/<default>` (tip `0631906`, post the parallel Run 56's #362-364 + housekeeping #365). `npm install` root + mobile. Baseline gate green: tsc clean (root+mobile), **1495 tests** pass / 11 skip, determinism clean, eslint 0.
- **CONCURRENCY:** a parallel factory instance ran its own "Run 56" in the SAME window (session `…01FRzGE…`): it did an independent 8-lens deep audit and shipped #362 (a11y sourcing), #363 (cosineSimilarity test), #364 (floor-plan SSRF), then merged housekeeping #365. I discovered this only when creating PRs (its work was already merged). My audit + changes (#366-372) were fully **file-disjoint** from its, so no conflict — but two instances overlapping is a scheduling artifact worth noting. I labeled mine **Run 57** to keep the ledger numbering monotonic.
- DEEP AUDIT was due (last full audit Run 52). Ran the full 8-lens read-only Haiku sweep before scouting.

### DEEP AUDIT (8-lens Haiku sweep) — key results
- **security_rls: CLEAN (no-op)** — all public tables RLS-covered, no committed/leaked secrets, admin client correct, SECURITY DEFINER hardened.
- **The QUALITY_SCORECARD (as_of 2026-07-01) is materially STALE.** Verified each of its top_gaps against code and REJECTED three as already-closed: (1) correctness `product-verify maxDuration` → ALREADY `=300` at route.ts:24 + a wall-clock cap at product-verifier.ts:271; (2) tests_evals `refine.eval still a mislabeled runner unit test` → ALREADY a real live eval calling `summarizeRefineChanges` behind `RUN_EVALS=1` with a concrete gold fixture; (3) security_rls `preflight lacks RLS-coverage + NEXT_PUBLIC secret assertion` → ALREADY present as GATE 6. LESSON: consume the scorecard as DATA and re-verify every named gap against the code before acting — it lags reality by multiple runs.
- Findings turned into the 7 shipped changes below. Deferred/rejected items recorded under Rotation.

### What was done (7 file-disjoint changes, #366-372)
- **#366 correctness** — both search routes (`app/api/search/route.ts` + `stream/route.ts`) swallowed the PRIMARY `candidate_products` insert failure (supabase-js returns DB errors in-band): on failure `savedProducts` is null and the route still returned HTTP 200 `products_found:0` / a `done` SSE event — a fake "found nothing" after the full agentic search already burned cost, with no error and no reason to retry. Now: mark the agent-run failed + surface an error (500 non-stream / `send("error")`+`closeStream()`+return stream, mirroring the existing orchestrator-error handler). Distinct from the settled #309 post-persist STATUS-flip pattern (those correctly stay log-only — this escalates only the PRIMARY persistence). A reviewer parity nit dropped a redundant `console.error` (apiError already logs).
- **#367 F2 test** — `lib/scoring/drift-monitor.ts` (score-drift surveillance; `checkForDrift` gates the model-degradation early-warning; 0 dedicated tests) → new `__tests__/scoring/drift-monitor.test.ts`, 18 mutation-resistant cases. Isolated each threshold with its exact boundary: clustering `stddev<1.2`, high_median `median>7.5` (strict — 7.5-exact asserts none), low_spread `range<3` (strict — range-3-exact asserts none); MIN_SAMPLE_SIZE=10 both sides; confidence_score exemption; NaN hygiene; recordBundleScores alias; even/odd median interpolation; MAX_BUFFER_SIZE=5000 eviction; resetScoreBuffer. Source unchanged.
- **#368 a11y web** — login + signup error banners were role-less `div` (screen-reader silent on an auth failure) → `role="alert"` (implies assertive+atomic).
- **#369 a11y mobile** — auth-screen error Views → `accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"`; 5 role-less action Pressables → `accessibilityRole="button"`; submit buttons → `accessibilityState` busy/disabled. Single-text buttons kept label-free (RN aggregates child Text — per Run 54 lesson 1).
- **#370 mobile reliability** — Settings "Sign out" was `() => void supabase.auth.signOut()` (discarded the in-band error AND a thrown network error → session stays live while the user believes they're signed out; a shared-device trust gap) → `handleSignOut` awaits, checks the in-band error, Alerts on failure (mirrors the delete-account pattern).
- **#371 security gate** — preflight GATE 6 had a NEXT_PUBLIC_* secret-leak grep but NO EXPO_PUBLIC_* equivalent; EXPO_PUBLIC vars inline into the shipped mobile BINARY (unrevocable) → added the mobile mirror over `mobile` + `.env.example`. Passes clean today; verified it catches a planted `EXPO_PUBLIC_STRIPE_SECRET`. Closes the mobile half of the security_rls A+ item.
- **#372 hardening** — identified-products confirm route awaits a remote Gemini `embedImage` before its `room_diagnoses` DB write but had NO `maxDuration` (Vercel short-default platform-kill aborts the confirmation write, not just the best-effort learning signal) → `maxDuration=300`, matching 17 sibling routes (and its `correct/` sibling).
- 14 Sonnet reviews (2×7); ALL 7 APPROVE both reviewers. #366/#367/#368/#370/#371/#372 auto-merged on CI green; #369 (mobile a11y) both-approve + auto-merge queued (mobile CI green pending at bookkeeping time). Combined +18 tests (1495→1513). No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box fully completes → none ticked.

### Lessons learned
1. **The independent QUALITY_SCORECARD can lag the code by several runs — re-verify every named top_gap against source before building it.** This run, 3 of the scorecard's actionable gaps (product-verify maxDuration, refine.eval, preflight RLS/NEXT_PUBLIC gates) were ALREADY closed by prior runs; only the EXPO_PUBLIC half of the security gate was genuinely open. Chasing a stale scorecard item is wasted work + risks re-adding what exists. (Mirrors Run 54 lesson 3.)
2. **Two factory instances can run concurrently in one scheduling window.** A parallel instance had already merged its Run 56 (#362-365) before I created my PRs. Because both audits produced file-DISJOINT change sets there was no collision, but: always `git fetch` + reset to the true `origin/<default>` tip right before branching (the tip had already advanced past what the cold container cloned), and check `gh/list_pull_requests` for concurrently-merged work so bookkeeping numbering/labels stay coherent.
3. **A swallowed PRIMARY persistence is a side-effect-integrity bug even when the sibling post-persist STATUS flip is correctly log-only.** The distinguishing test: did the write commit the user's actual result (products/diagnosis) or only a secondary marker? Primary-loss masquerading as 200 = surface it; secondary status flip after commit = log-only is correct (#309). Don't let the "search route writes already logged" settled note (Run 55) blanket-suppress the primary-insert case — verify which write it is.
4. **The app's data layer is the in-memory memory-store, not Postgres** (per the parallel Run 56's audit: `lib/supabase/server.ts createClient()` swaps only `.auth` to real Supabase; `.from`/`.storage`/`.rpc` hit createMemoryClient()). My #366/#372 fixes are correct against both backings (the memory-store also returns in-band insert errors; the maxDuration protects the real remote embedImage regardless), so no rework — but this explains why a pgvector-RPC perf fix is inert and was rightly abandoned there. Keep this in mind before proposing any Postgres-only optimization.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 60** (full audits ran Run 52, and twice at Run 56/57).
- **functional_reality (ship-critical, C) remains the convergence blocker and is OWNER-BLOCKED** (core photo→mockup + paywall→checkout E2E need Supabase-local + Stripe test-mode wired into CI, `.github/` human-applied). Do NOT fabricate a change that can't run green in-container. Readiness NOT attempted this run.
- **DEFERRED, validated, file-disjoint (take carefully next run):**
  - **artifact/honesty — free-tier copy.** The gate question is now RESOLVED with evidence: `FREE_SAVE_LIMIT_WEB=3` (lib/entitlements/web.ts) caps SAVED DESIGNS only; diagnosis is only rate-limited (5/min), NOT count-capped. So "1 room diagnosis" / "designs one full room" (app/pricing, app/faq, BUSINESS_CASE:41, store-listing, press-kit, email-lifecycle) is a mild UNDERSELL, not an oversell, and the business-case funnel keys on 4% conversion "after the 3rd save" (BUSINESS_CASE:300), NOT numerically on "1 room" (line 41) — so fixing the copy needs NO funnel recompute. BUT before rewriting, AUDIT the full free-vs-Pro feature gating (are AI mockups / sourcing free, or Pro-only?) — "designs one full room end-to-end" for free may itself overstate if mockup/sourcing are gated. Getting this wrong swaps an undersell for an OVERSELL (worse for store trust). One coherent change across those 6 files once the feature matrix is confirmed.
  - **side-effect integrity — mobile signup "Check your email / We sent a confirmation link"** (mobile/src/components/auth/signup-screen.tsx:80-81) vs WEB signup which explicitly sends NO confirmation email ("we never claim to send an email we can't send"). Whether mobile actually sends one depends on the Supabase project's email-confirmation setting (owner/config, not code). If confirmations are OFF, the mobile "check your email" screen is a fake-success (undelivered email behind a "sent" message = release-blocking). VERIFY the real mobile signup behavior + Supabase config before acting; may be a copy fix or a PENDING_OPS owner note.
  - **mobile reliability — results.tsx unmount cancellation** (AbortController/mounted flag on the analyze fetch) — medium value, bigger change; both #370-adjacent scouts flagged it.
  - **perf — projects-list `select('*')`** ships the large unused `apartment_analysis` JSON column to the dashboard (which reads only building_research + scalars). Modest payload win; column-narrow carries a "did I enumerate every consumer" risk (dashboard is the sole list-GET consumer). Standalone only.
  - **dep — TS version split** (root `typescript ^5`→5.9.3 vs mobile `~6.0.3`) — config debt; risky to unify, defer.
- **DO-NOT-RE-FLAG (settled this run):** product-verify maxDuration (=300); refine.eval (real live eval); preflight RLS + NEXT_PUBLIC gates (present — GATE 6); search/analyze/refine post-persist STATUS flips (log-only correct — #309); embedding-retry thrown-path (marginal); paywall offerings-once-per-session (low impact); RLS FOR ALL USING w/o WITH CHECK (safe); pgvector-RPC perf (inert under memory-store).



### State on entry
- Cold container at default tip `9de8422` (post Run 55 #337-342 + GTM/FACTORY commits #343-361). `npm install` root+mobile. Baseline gate green: tsc clean (root+mobile), **1483 tests** pass / 11 skip, determinism clean, eslint 0.
- **DEEP AUDIT due** (last Run 52, 4 runs ago). Ran the full 8-lens read-only Haiku sweep FIRST (correctness/dead-code, security-RLS, performance, a11y-design, test-eval, dependency-config, artifact-freshness, functional-wiring-mobile) — findings in the DEEP AUDIT block below.
- Consumed QUALITY_SCORECARD (as_of 2026-07-01, overall C / ship_gate_met:false): sole ship-critical blocker stays **functional_reality C** (core money-path outcome-asserting E2E) — OWNER-BLOCKED (needs Supabase-local + Stripe test-mode in CI, `.github/` human-applied). Did NOT attempt the ready issue.

### DEEP AUDIT (Run 56) — prioritized findings
TAKEN this run: floor-plan SSRF (#C2), sourcing icon-button a11y (#C3), cosineSimilarity F2 tests (#C5).
Scout FALSE POSITIVES verified & rejected (Haiku over-report, Run 55 lesson 3): product-verify maxDuration ALREADY=300 (#283, scorecard stale); search route insert "silent loss" ALREADY logs every in-band write (#309 pattern); diagnosis/rooms GET "no try/catch" — Next catches → 500 (standard); gemini undefined-key — assertProductionEnv fails loud in prod.
Verified-but-DEFERRED (reasons): free-tier "1 room" copy vs FREE_SAVE_LIMIT_WEB=3 — scout RESOLVED the fact: diagnosis is UNGATED, only SAVES gated at 3, so copy UNDER-sells; but the business-case conversion model references "1 free room" as the paywall trigger → needs a coordinated recompute, owner/business-case-routine territory, do NOT unilaterally edit. BUSINESS_CASE cost tier (2.5 base vs diagnosis→mid 3.1) — business-case doc is auditor-graded A; changing COGS is the business-case routine's job. next/image (loop deliberately uses <img>+eslint-disable for external/blob URLs, Run 26). Decorative-only aria-hidden micro-changes (anchor: standalone-only, never batch padding). Provider response Zod validation (casts throw→caught→500, not silent; churn risk). Next DEEP AUDIT ~Run 60.

### What was done (3 file-disjoint changes)
- **#C3 a11y (Track F/A2, PR #362 MERGED)** — ManualSourcingForm remove-URL icon-only Button (size=icon, only a Trash2 icon) had NO accessible name → WCAG 4.1.2 failure. aria-label (humanized category label reused from the visible heading, not the raw snake_case key) + aria-hidden on the Trash2 + the adjacent decorative Plus. Reviewer A REQUEST_CHANGES on the raw-slug label (fixed: hoisted `categoryLabel`); Reviewer B APPROVE.
- **#C5 test (Track F2, PR #363 MERGED)** — cosineSimilarity (the retrieval-gating vector math; topKSimilar drops priors below minSimilarity with it) had NO dedicated test. New __tests__/ai/embeddings.test.ts, 12 mutation-resistant cases (identical=1, scale-invariance, orthogonal=0, opposite=-1, known non-trivial cosine, symmetry, [-1,1] bound; zero-norm→0-not-NaN split into 3 cases to catch a `||`→`&&` mutation; dim-mismatch exact-message throw). Both reviewers APPROVE (A re-derived all values in Node; B mutation-tested the source).
- **#C2 security (Track G, PR #364, both reviewers APPROVE + auto-merge queued)** — floor-plan POST passed image_url to runFloorPlanExtraction → fetchAsBlob, which does a raw fetch() on absolute URLs → SSRF (169.254.169.254/localhost/private IPs). Guard: allow relative "/uploads/..." (no "..", local-disk read, no fetch) OR https on our own Supabase host; reject else 400. FIRST draft (https-host-only, copied from mobile/analyze) was a would-be REGRESSION — see lesson 2/3.

### Abandoned this run (value/architecture — the value bar + review working)
- **perf/embedding-pgvector-rpc (ABANDONED, never pushed)** — proposed a pgvector `match_product_embeddings` RPC (migration 029) to replace topKSimilar's full-table scan (the scorecard's named perf gap). BOTH C1 reviewers REQUEST_CHANGES after discovering the KEY ARCHITECTURAL FACT: `lib/supabase/server.ts createClient()` returns the IN-MEMORY memory-store for ALL data ops (only `.auth` swapped for real Supabase) — the app is NOT on real Postgres yet ("memory store as the data layer until a full DB migration is done"). So `.rpc` always returns the mock `{data:null}`, the RPC path is INERT, and the "N full-table scans" are over an in-process JS array (fast), not Postgres. The perf gap doesn't BIND until a separate, unscheduled data-layer→Postgres migration. Shipping inert code + a must-apply migration for ZERO current benefit = premature/speculative → abandoned. Revisit ONLY after the memory-store→Postgres data-layer cutover.

### Lessons learned
1. **THE APP RUNS ON AN IN-MEMORY DATA LAYER (memory-store), not Postgres — `lib/supabase/server.ts` proxies only `.auth` to real Supabase; `.from`/`.storage`/`.rpc` all hit createMemoryClient().** This invalidates any change premised on "real Postgres" TODAY: (a) a pgvector/RPC/index perf fix is INERT (memory-store.rpc returns {data:null}); (b) image_urls are RELATIVE "/uploads/..." disk paths (memory-store getPublicUrl), NOT https://supabase.co URLs — so a Supabase-host-only URL guard 400s every legit upload (this bit the first #C2 draft). ALWAYS trace a change's runtime client through server.ts before assuming Supabase semantics. Migrations 021-027 ship "apply-later" safely because they back FEATURES that work via the memory store in dev and activate on apply; a pure PERF/index migration is different — it only pays off at Postgres scale that doesn't exist yet.
2. **fetchAsBlob (lib/ai/files-cache.ts) has two branches: relative "/uploads/..." → local-disk read (no network, no SSRF); absolute URL → raw fetch() (the SSRF surface).** The correct SSRF guard for any image_url→extraction route ALLOWS the relative disk path and only host-restricts absolute URLs — mirroring both fetchAsBlob shapes, not just the mobile /api/analyze one (mobile uploads go direct to real Storage, so its https-only guard is safe THERE but wrong for the web /api/upload flow).
3. **Adversarial 2-reviewer review caught a would-be REGRESSION, not just a nit.** The first #C2 draft (copied verbatim from the mobile guard) would have 400'd every legitimate floor-plan upload. Reviewer A traced the real upload URL shape and caught it. Copying a "proven" guard across routes is unsafe when the routes have different upload paths — verify the actual data shape each route receives.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 60.**
- **functional_reality (ship-critical, still C) is the convergence blocker and is OWNER-BLOCKED** — do NOT fabricate a change that can't run green in-container.
- **Queued/validated, file-disjoint, NOT taken (revisit):**
  - **perf embedding RPC** — REVISIT ONLY after the memory-store→Postgres data-layer migration lands (inert until then; see lesson 1). If revisited, ALSO add topKSimilar branch tests (RPC-success/fallback/error mapping) — it has none.
  - **artifact/business-case** — free-tier "1 room" copy + BUSINESS_CASE cost-tier (2.5 vs 3.1): both need the business-case routine / a coordinated recompute, not a unilateral maker edit. Flag to owner rather than churn.
  - **a11y** — decorative aria-hidden on pricing Check / homepage stars / SharedDesignView sparkles: real but micro; only ship if bundled into a genuinely valuable a11y pass, never as batch padding.
  - **dependency** — provider response Zod validation (deepseek/tavily/gemini casts): defensible only if you can show a real uncaught crash (today casts throw → route try/catch → 500, not silent).
- **Readiness:** still blocked — QUALITY_SCORECARD overall C / ship_gate_met:false (functional_reality C binding, human-gated).

## Run 2026-07-02 (Run 55) — 6 disjoint changes (correctness + G2 security + Track-B a11y + 3× F2 agent tests)

### State on entry
- Cold container at default tip `60c6f5c` (post Run 54 #330-334 + FACTORY_STANDARD sync #336). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean (root + mobile), **1444 tests** pass / 11 skip, determinism clean, eslint 0.
- **DEEP AUDIT not due** (ran Run 52 → next ~Run 56). Consumed QUALITY_SCORECARD (as_of 2026-07-01, overall C / ship_gate_met:false): sole ship-critical blocker stays **functional_reality C** — OWNER-BLOCKED (core photo→mockup + paywall→checkout E2E needs Supabase-local + Stripe test-mode in CI, `.github/` human-applied). Ran a 5-lens Haiku scout sweep (security-G / correctness / test-coverage / mobile / artifact-freshness) folded with Run 54's validated rotation-guide queue.

### What was done (6 file-disjoint changes, #337-342)
- **#337 correctness (A)** — `POST /api/diagnosis` room-status→"diagnosed" update ignored supabase-js's in-band error → diagnosis persisted + 201 while the room stayed at its prior status (e.g. "analyzing"), desyncing the UI step indicator with NO server signal. Captured + logged (log-only, NOT 500 — the diagnosis is already committed; failing would force an expensive full-pipeline retry), mirroring bundles/evaluate + search + analyze-apartment.
- **#338 G2 security** — the 3 remaining unguarded `await request.json()` sites (area-analysis refine-chat = 3-5min LLM pipeline; computer-use product-verify = ~$5-20 Browserbase session; saved-designs/[id] PATCH = share-token write) threw → misleading 500 on malformed JSON. try/catch → 400, matching ~30 other routes. **Reviewer B REJECTED the first draft** ("last two" claim was false — the saved-designs/[id] one existed); added it, corrected the claim, re-audited (`grep "const .*= await req*.json()" | grep -v .catch` → NONE). 
- **#339 a11y (mobile, Track B)** — design-tips Collapsible header (used in explore.tsx) was a role-less Pressable → SR announced static text, no toggle affordance/state. accessibilityRole=button + accessibilityState={{expanded:isOpen}}; role alone carries the name (RN aggregates child title Text) so NO redundant label (Run 54 lesson 1).
- **#340 F2** — first unit suite for `shopping-researcher.ts` pure surface: sanitizeSearchQuery (behavior-neutral `export`) + deduplicateCandidates → 15 cases (5-char floor, 120-cap, hex/%-strip, prose-rejection, URL host+path normalization, malformed pass-through).
- **#342 F2** — the junk prefilter EXTRACTED from quickScreenCandidates to a pure exported `prefilterJunkCandidates` (JUNK_*_PATTERNS hoisted to module scope — SAFE because they're non-global regexes so `.test()` is stateless) → 9 cases incl. the `\bnovel\b` boundary guard proving "novelty console table" survives.
- **#341 F2** — the design-coordinator auto-finalize decision (gates a ~50-100K-token harmony/finalize turn) EXTRACTED to a pure exported `evaluateAutoFinalize(state)` → 15 cases pinning 8.5 (inclusive) / 0.2 (strict) / stabilized boundaries, the ≥1-harmony-round gate, the finalAssessmentSettled short-circuit, and reason-string precedence. Behavior-neutral (Boolean() coercion only changes a debug-log undefined→false; `reason ?? undefined` is dead-code at the call site).
- 12 Sonnet reviews (2×6) + 1 re-review; all 6 APPROVE both reviewers. #337-341 auto-merged on CI green; #342 approved + auto-merge queued. Combined +39 tests, tsc/eslint/determinism clean, mobile tsc clean. No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box FULLY completes → none ticked.

### Lessons learned
1. **SHARED-WORKING-TREE HAZARD: a review subagent that runs `git stash`/`git checkout`/`reset` in the repo WIPES the orchestrator's UNCOMMITTED working-tree edits.** A #340 reviewer ran `git stash -u` (reported "working tree restored to prior state"), which silently clobbered my in-progress, uncommitted `design-coordinator.ts` edits — the test then failed with "no exported member evaluateAutoFinalize" (the source edit was gone; only the untracked test file survived). Two guards, both now applied: (a) COMMIT each change's edits BEFORE spawning its reviewers; (b) explicitly instruct every reviewer subagent to use READ-ONLY git only (`git show`/`diff`/`log`, never checkout/stash/reset/clean/switch). Never leave uncommitted edits in the tree while backgrounded subagents run.
2. **A "completeness" claim in a PR is a real correctness surface — Reviewer B rightly rejects a false one.** #338 claimed it closed "the last two" unguarded request.json() sites; a third existed. The fix wasn't to soften the claim but to MAKE it true (add the 3rd guard) + re-audit mechanically. When you assert "all/last/none remain", back it with a grep in the same run, and expect a reviewer to check it.
3. **The correctness scout over-reports already-handled writes.** It ranked search/analyze-apartment/refine unchecked-write "gaps" #1-#2, but all three already log the in-band error (the #309 graceful pattern) — reading "logged but returns 200" as a gap is wrong: log-only IS the accepted handling for a post-persist status flip (returning 500 would misreport a succeeded operation). Verify the actual code before selecting a scout's correctness candidate; diagnosis (#337) was the one genuine remainder.
4. **Extracting an inline decision to a pure exported function is the minimal, review-approved way to unit-test token-gating logic** (evaluateAutoFinalize, prefilterJunkCandidates — both this run; formatStateForAgent #333, mockup buildMockupContext #324 prior). Keep it behavior-neutral: preserve the exact log keys + return shape, and note any immaterial coercion (undefined→false in a debug log) in the PR so the reviewer can confirm.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 56 (this may be it — check the date/last-audit).** If due, run the 8-lens read-only Haiku sweep FIRST.
- **functional_reality (ship-critical, still C) is the convergence blocker and is OWNER-BLOCKED** — do NOT fabricate a change that can't run green in-container.
- **Deselected-pre-build this run (validated, revisit carefully):**
  - **artifact/honesty** — `app/pricing/page.tsx` "1 room diagnosis" + faq "designs one full room" + `docs/BUSINESS_CASE.md` "1 full room analysis" vs the real `FREE_SAVE_LIMIT_WEB=3`. DEFERRED as ambiguous, NOT churn: the code limit is on SAVED DESIGNS (3), not on rooms/diagnoses, so "1 room" may be a legitimate simplification; AND the business-case free→paid conversion model references "1 free room" as the paywall trigger, so changing it could mis-state the funnel + need a recompute. Next run: first determine the ACTUAL free-tier gate (is diagnosis itself capped, or only saves?) before touching copy — getting it wrong risks OVERSELLING (worse than underselling for store trust).
  - **mobile** — `paywall-sheet.tsx` offerings load once per session (`offeringLoaded` never resets), despite the comment "each time the sheet opens". Real comment/behavior mismatch but LOW impact (offerings rarely change mid-session; a failed first load DOES retry since the flag only sets on success). Run 54 also deferred. Take only if you can argue the value (e.g. trial-eligibility can change mid-session).
  - **correctness** — embedding-index retry only covers the `{ok:false}` Result path; a *thrown* connection error still bypasses to the outer catch. Wrapping insertEmbedding in try/catch inside the retry would widen resilience (marginal — supabase returns errors in-band; Run 54 also noted).
  - **test/eval** — remaining untested heavy agents with mockable pure surface: scene-assembler is LOW value (thin surface, reconciliation tested elsewhere — skip); shopping-researcher pure surface now COMPLETE (#340 + #342). A mockup live eval already exists (#334). 
  - **DO NOT re-flag (settled):** search/analyze-apartment/refine unchecked writes (already logged — #309 pattern); mobile paywall accessibilityLabel (RN aggregates child Text — Run 53/54); "AptDesigner vs AptDesignerAI" (intentional display name); RLS `FOR ALL USING` without WITH CHECK (SAFE); G1 rate-limiting (all 26 paid routes covered); G4 login/reset (Supabase-delegated).
- **Non-blocking review nits worth a cheap future tidy:** #340's test comments slightly overstate PROSE_PATTERN precision ("distinct branch" — some overlap; "current" vs "the current") + no 4-char / exact-120 boundary case (would catch a `<5`→`<4` mutation). Cosmetic; not worth a standalone PR.
- **Readiness:** still blocked — QUALITY_SCORECARD overall C / ship_gate_met:false (functional_reality C binding, human-gated). Did NOT attempt the ready issue.

## Run 2026-07-02 (Run 54) — 5 disjoint changes (F2 test + F3 eval + correctness + 2 a11y)

### State on entry
- Cold container at default tip `fabad04` (post Run 53 #324-328). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean (root + mobile), **1413 tests** pass / 9 skip, determinism clean, eslint 0.
- **DEEP AUDIT not due** (ran Run 52 → next ~Run 56). Consumed QUALITY_SCORECARD (as_of 2026-07-01, overall C / ship_gate_met:false): sole ship-critical blocker stays **functional_reality C** — OWNER-BLOCKED (core photo→mockup + paywall→checkout E2E needs Supabase-local + Stripe test-mode in CI, `.github/` human-applied). Ran a full 7-lens Haiku scout sweep (test-coverage / F3-eval / correctness / mobile / security-RLS / web-perf-design / store-artifact).

### What was done (5 file-disjoint changes, all merged #330-334)
- **#333 test (F2)** — `lib/agents/post-search-coordinator.ts` (624 LOC, 0 prior tests). Exported the pure `formatStateForAgent` (behavior-neutral) + 24 mutation-resistant cases on the decision signals that gate the agent's expensive branches (a `re_search_category` = 3-5min / 50-100K tokens): audit-trend bands (STALLED `|delta|<0.3`, REGRESSING `<0` but only OUTSIDE the stall band, improving, improving-strongly `>=1.0`, last-two-entries delta with full trend arrow), saturation (`count>=3 AND scoreMax>=7.0`), diminishing-returns (`re-search>=2`), missing/dropped surfacing, tried-queries `slice(-8)`. Boundaries tested both sides. Both reviewers recomputed the float deltas in Node.
- **#334 eval (F3)** — mockup image generation was the ONLY core pipeline stage without a live eval (understanding/diagnosis/grounding/sourcing/refine all have one). New `evals/__tests__/mockup.eval.test.ts` calls real `generateMockupImage` (asserts real base64 payload / image mime / provider=gemini-image / prompt echo) then round-trips `verifyMockupImage` with a confidence>=0.5 anti-flake floor. Gated `RUN_EVALS=1` (skips in npm test). Gold fixture INLINED — NOT added to `evals/gold/` because `loadGoldCases()` slurps the whole dir and diagnosis.eval + runner.test iterate every file, so a mockup-shaped case would leak into their loops.
- **#332 correctness** — the self-learning embedding write-back (identified-products confirm + correct) is a one-shot side effect: on a transient insert failure it durably persists `embedding_written_back=false` and NOTHING retries it (no backfill job) → permanent loss of a retrieval-prior signal. Added bounded deterministic `insertEmbeddingWithRetry` (3 attempts, fixed 250ms delay, no jitter, injectable delay=0 in tests) in embedding-index.ts + swapped both call sites + 7 tests. Worst-case added latency (DB fully down) ≤500ms.
- **#330 a11y (web)** — diagnosis streaming progress conveyed per-step status (running/done/error) ONLY through a decorative icon (no text equivalent) and had no aria-live region → SR users got neither status nor announcements. Added aria-live=polite to the steps container, aria-hidden on the icons, and an sr-only status text per step.
- **#331 a11y (mobile)** — 11 role-less action Pressables across photo/results/saved (the core capture→analyze→save journey) announced as static text, not buttons. Added accessibilityRole=button + accessibilityState(disabled) on Save. Single-text buttons → NO explicit label (per Run 53 lesson 3: a label would duplicate/stale the visible text; role alone adds the button trait).
- 10 Sonnet reviews (2×5), all APPROVE both reviewers; combined suite 1444 pass/11 skip (+31), tsc/determinism/eslint clean, mobile tsc clean. No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box FULLY completes → none ticked.

### Lessons learned
1. **A React Native Pressable with NO accessibilityRole is still accessible (aggregates its single child Text) but lacks the "button" trait** — so the fix for a role-LESS single-text button is `accessibilityRole="button"` ALONE, never a redundant accessibilityLabel (which would duplicate the visible text or go stale against dynamic text like "Saving…"/"Saved"). This is the mirror of Run 53's room-type case (which needed role+label because its text fragmented across nested ThemedText). Distinguish: role-less single-text → role only; role-less fragmented/icon-only → role + label.
2. **Adding a gold JSON to `evals/gold/` is NOT free** — `loadGoldCases()` slurps the entire dir and both `diagnosis.eval.test.ts` and `runner.test.ts` iterate every case, so a differently-shaped case (e.g. a mockup fixture) leaks into their loops and can crash/mismatch. For an eval whose fixture shape differs from the shared `GoldCase`, INLINE the fixture in the eval file (as grounding/sourcing already do) rather than adding a file to the shared dir.
3. **The independent scorecard can lag reality on evals** — the scout confirmed refine.eval is now a REAL live eval and a live-eval.yml CI job exists, yet the 2026-07-01 scorecard still lists "refine mislabeled / no RUN_EVALS CI job". Consume it as DATA, don't tick a ROADMAP box (F3) off a self-observation that contradicts the independent grade; leave F3 unchecked until the auditor confirms.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 56.**
- **functional_reality (ship-critical, still C) is the convergence blocker and is OWNER-BLOCKED** — do NOT fabricate a change that can't run green in-container.
- **Queued, file-disjoint, validated (not taken this run):**
  - **correctness** — `app/api/diagnosis/route.ts:397` the room-status→"diagnosed" update is unchecked (durable state inconsistency on failure); real but the route is hard to unit-test cleanly (400-line handler) — take with a test harness, or as a log-only graceful fix like #309. `bundles/evaluate/route.ts:159` status update logs but returns 201 (lower value). Several `request.json()` guards missing (refine-chat HIGH; saved-designs/product-verify borderline).
  - **test/eval** — remaining untested heavy agents with mockable pure surface: shopping-researcher (sanitizeSearchQuery/deduplicateCandidates/junk filters, ~14 cases), design-coordinator (auto-finalize guards: 8.5 / velocity 0.2 / stabilized thresholds, ~14). scene-assembler is LOW value (thin pure surface, reconciliation already tested elsewhere) — skip.
  - **embedding retry fast-follow** — the retry only covers the `{ok:false}` Result path; a *thrown* connection error still bypasses it to the route's outer catch. Wrapping insertEmbedding in try/catch inside the retry would widen resilience (non-blocking, noted by Reviewer A).
  - **perf** — embedding-index pgvector match_ RPC (LIVE-DB-only, can't verify in-container). Web perf swept CLEAN this run (search route already narrow-select, dashboards parallelized).
  - **mobile** — paywall-sheet offerings cached once per session (RevenueCat), never refreshed on reopen — verify value before taking (offerings rarely change mid-session).
  - **DO NOT re-flag (settled):** mobile paywall "free trial included" (native-IAP intro trials are store-configured and legitimate — NOT the web/Stripe no-trial surface; ambiguous, owner-decision — Run 53 + Run 54 both deferred); analyze-apartment Promise.all (LLM-dominated, value-rejected Run 53); paywall accessibilityLabel (RN aggregates child Text — Run 53); RLS `FOR ALL USING` without WITH CHECK (SAFE).
- **Readiness:** still blocked — QUALITY_SCORECARD overall C / ship_gate_met:false (functional_reality C binding, human-gated). Did NOT attempt the ready issue.

## Run 2026-07-02 (Run 53) — 5 disjoint changes (F2 test + 2 a11y + mobile reliability + artifact honesty)

### State on entry
- Cold container at default tip `5904746` (post Run 52 #309-314 + GTM commits #315-320). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1392 tests** pass / 9 skip, determinism clean, eslint 0.
- **DEEP AUDIT not due** (ran Run 52, same day → next ~Run 56). Consumed QUALITY_SCORECARD (as_of 2026-07-01, overall C / ship_gate_met:false): the sole ship-critical blocker stays **functional_reality C** (core money-path has no outcome-asserting runtime E2E) — OWNER-BLOCKED (needs Supabase-local + Stripe test-mode wired into CI, `.github/` human-applied; the loop cannot close it). The correctness-B gap the scorecard names (product-verify maxDuration) was already closed #283 (Run 50) → scorecard slightly stale. Ran a full 7-lens Haiku scout sweep (tests / correctness / perf / a11y / security-RLS / mobile / artifact-freshness).

### What was done (5 file-disjoint changes, merged #324-328)
- **#324 test (F2)** — first unit suite for `lib/agents/mockup-agent.ts` (0 prior tests): 18 mutation-resistant cases on the pure `buildMockupContext` (diagnosisSummary/designDirection/palette/materials/textures fallback precedence, `[]`-truthy → empty-array→undefined collapse, action_list→what_it_needs placement-map overwrite order) + 3 on `generateMockupImage` success/no-image/thrown-error result paths (gemini mocked). Reviewer A mutation-verified (flipped fallback + merge order → tests flip red).
- **#325 a11y/design (A2/F4)** — RefineChat partial-success warning (edit applied but summary reply failed to persist) was piped through the RED destructive banner → reads as failure. Split a distinct amber `warning` state (role=status, aria-live=polite; reuses the existing DesignerWarningCard/focus/bundles amber tokens); real errors stay red (now role=alert). Also aria-expanded + aria-label on the collapse toggle + aria-hidden on decorative icons.
- **#326 mobile reliability (Track C)** — results.tsx flipped to "Retry Save" on save failure with NO user-facing explanation (silent error for a paying user). Added an Alert describing the failure, mirroring the post-purchase Alert pattern in the same file. Reviewer A confirmed the paywall (403/subscription_required) branch returns before the catch → no false alert.
- **#327 artifact honesty (D/F5)** — support page's "Pricing & billing" blurb advertised a "trial period" the WEB product doesn't offer (FAQ: "no trial clock"; Explore free forever; stripe.ts sets no trial_period_days). Fixed to "the free tier". Both reviewers verified against FAQ/pricing/Stripe; the mobile paywall's "free trial included" is a separate, already-tracked native-IAP surface.
- **#328 mobile a11y (Track B)** — room-type picker options were unlabeled Pressables with NO accessibilityRole (screen-reader dead-end on a core-journey step, focus fragments across nested ThemedText). Added accessibilityRole=button + accessibilityLabel `${label}. ${hint}`, matching the Back-button pattern already in the file.
- 14 per-change Sonnet reviews (2× each), all APPROVE on the 5 merged; combined gate green: 1413 pass/9 skip (+21), tsc/determinism/eslint clean, mobile tsc clean. No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box fully completes (all 5 incremental within partial Tracks A/B/C/D/F) → none ticked.

### Abandoned this run (Reviewer B value/phase-fit rejections — the value bar working)
- **perf-analyze-apartment (abandoned — review_value)** — parallelize the project+rooms reads via Promise.all. Reviewer B rejected: <0.05% of a 180-300s LLM-dominated route (two indexed reads in the pre-LLM prologue); a real micro-opt but the value isn't there on THIS route. Correct call — don't over-mine the Promise.all pattern onto progressively lower-value spots. (The pattern still ships on genuinely hot user-facing paths, per #265/#277/#290/#310.)
- **a11y-mobile-paywall (abandoned — review_value)** — accessibilityLabel on the paywall pricing radios. Reviewer B rejected: RN's default behavior for an `accessible` Pressable (it already had accessibilityRole=radio) AGGREGATES child Text nodes, so VoiceOver was likely already announcing plan+price+subline — the "radio button, selected only" premise is probably false, AND the explicit label DROPPED the subline ("free trial included"/per-month), a possible regression on a purchase surface. Can't disprove headlessly → abandon. (Contrast #328 room-type: had NO role at all → genuinely a dead-end, so it shipped.)

### Lessons learned
1. **A vitest `beforeEach(() => mock.mockReset())` can make an async-throwing provider mock report a false "unhandled rejection" that FAILS the test even though the function catches it.** The mockup-agent thrown-error test failed with the raw `Error: 429` (not an AssertionError) attributed to the mock's throw line — an unhandled-rejection flag, not a real assertion failure. It reproduced ONLY with `beforeEach(mockReset)` + a prior `mockResolvedValue` test in the same describe; moving the reset INTINE (`mockChat.mockReset()` at the top of each test body, no beforeEach) cleared it. When an async-throw mock "fails" a test whose function demonstrably catches (prove it with a wrapped-in-try repro), suspect the beforeEach/mockReset teardown timing, not your code — reset per-test-body instead.
2. **Reviewer B's value lens is the real limiter, not the scout's enthusiasm.** Two of seven scouted candidates (a Promise.all micro-opt on an LLM-dominated route; a mobile a11y label that RN likely already aggregates) died on Reviewer B value/regression grounds. Both were technically correct and would pass Reviewer A — the value bar is what stopped them. Abandoning 2/7 is the mechanism working, not a shortfall; a 5-change coherent run beats padding to 7.
3. **RN accessibility: a Pressable with an explicit role is ALREADY an accessibility container that aggregates descendant Text** — so adding an accessibilityLabel to a labeled-by-children radio can REDUCE information (drop a subline) rather than add it. Adding a role+label to a role-LESS Pressable (room-type) is the genuinely valuable case. Distinguish "no role → real dead-end" from "has role → already aggregating" before proposing a mobile a11y label.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 56.**
- **functional_reality (ship-critical, still C) is the convergence blocker and is OWNER-BLOCKED** — core photo→mockup + paywall→checkout→unlock runtime E2E needs Supabase-local + Stripe test-mode in CI (`.github/` human-applied; PENDING_OPS). The loop cannot close it; do NOT fabricate a change that can't run green in-container.
- **Queued, file-disjoint, validated (not taken):**
  - **test/eval** — remaining untested heavy agents needing provider mocks (budget ONE done properly per run): scene-assembler (2 chat + judge), post-search-coordinator (agentic loop, 0-LLM-mockable state logic), shopping-researcher (759 LOC; deduplicateCandidates is pure), design-coordinator. A **mockup live eval** (evals/) would move F3 toward complete.
  - **correctness (nuanced, standalone)** — identified-products confirm/correct embedding write-back sets embedding_written_back:false durably on a transient insertEmbedding failure with no in-request retry → soft ML-signal loss. Real but marginal + the fix is nuanced (bounded retry) — Run 51/53 deferred; take carefully, not under a tight cap.
  - **perf** — embedding-index pgvector match_ RPC (LIVE-DB-only). search/route.ts output_json over-fetch (selects whole JSONB, uses 3 fields) — marginal; verify it clears the bar first.
  - **dep health (owner-review, not auto-bump)** — Next.js/ws/protobufjs npm-audit vulns; TS 5/6 root↔mobile mismatch; skipLibCheck.
  - **DO NOT re-flag (settled):** analyze-apartment Promise.all (value-rejected Run 53 — LLM-dominated route); paywall-sheet accessibilityLabel (RN already aggregates child Text — value/regression-rejected Run 53); "AptDesigner vs AptDesignerAI" (intentional display name); RLS `FOR ALL USING` without WITH CHECK (SAFE).
- **Readiness:** still blocked — QUALITY_SCORECARD overall C / ship_gate_met:false (functional_reality C is binding, human-gated). Did NOT attempt the ready issue.

## Run 2026-07-02 (Run 52) — DEEP AUDIT + 6 disjoint changes (2 correctness + perf + a11y + test + quality-gate)

### State on entry
- Cold container. Baseline gate green on the default tip: tsc clean, 1367 tests pass / 9 skip, determinism clean, eslint 0. Default branch advanced under me during the run (concurrent routines merged #304-308) — my 6 disjoint branches auto-merged cleanly on top.
- **DEEP AUDIT was due** (last Run 48, ~4 runs ago) → ran the 8-lens read-only Haiku sweep FIRST, before selecting work.
- Consumed QUALITY_SCORECARD (overall C, ship_gate_met:false): the sole ship-critical blocker is **functional_reality C** (core money-path has no outcome-asserting runtime E2E).

### DEEP AUDIT summary (8 Haiku lenses; findings → this run's work)
- **SECURITY & RLS: CLEAN** (no-op). All 27 migrations reviewed — RLS complete + intentional on every public table; no committed secrets; the "missing WITH CHECK" and "AptDesigner brand" flags were re-confirmed false positives (see Run 51 lessons). A clean security audit is a successful no-op.
- **CORRECTNESS:** two real unchecked-write findings shipped (search_sessions insert #309; refine-chat assistant message #313). The "search route has no outer try-catch" finding was noted but deferred (bigger change, lower value than the targeted guards).
- **PERF:** several independent-read Promise.all opportunities; shipped ONE hot-path one (#310) to avoid batch-padding micro-opts. embedding-index full-table-scan / pgvector-RPC remains LIVE-DB-only (can't verify in-container) — still deferred.
- **A11Y/DESIGN:** icon-only buttons unlabeled (#311). Most other flags were opacity/contrast nitpicks — not shipped.
- **TEST/EVAL:** browserbase-driver.ts (0 tests) was the cleanest 0-LLM target → #312. floor-plan-extractor was ALREADY comprehensively tested (dropped as redundant — CHECK before building). Remaining untested heavy agents: scene-assembler, post-search-coordinator, shopping-researcher, design-coordinator, mockup-agent.
- **DEP/CONFIG:** decorative coverage floors → #314. npm-audit vulns (Next.js/ws/protobufjs) NOT auto-bumped (risky under unattended auto-merge; a broken build is worse) — recorded for owner. skipLibCheck removal + TS 5/6 root/mobile mismatch deferred (nuanced).
- **ARTIFACT FRESHNESS:** A5 ROADMAP annotation was stale ("zero live evals / placeholder URL") — refreshed + ticked this run. F3 was already refreshed by #304.
- **FUNCTIONAL REALITY:** the core photo→mockup + paywall→checkout E2E gap is real but OWNER-BLOCKED (needs Supabase-local + Stripe test-mode wired into CI, `.github/` human-applied) — the loop cannot close it.

### What was done (6 file-disjoint changes, all merged #309-314)
- **#309 correctness** — surface the unchecked `search_sessions` insert error in `search` + `search/stream` (null session → every downstream `session?.id` undefined → `.eq("id",undefined)` orphans the session, never marked completed). Log-only, graceful degradation preserved.
- **#313 correctness / side-effect integrity** — refine-chat: the assistant `refine_messages` insert was unchecked → 200 with `assistant_message: undefined` (vanishes on reload + client null-deref). Fix returns applied analysis + `assistant_message: null` + a warning, run stays completed; client filters the null. (See lesson 1.)
- **#310 perf** — parallelize the independent accepted/rejected reads in `loadUserFeedbackContext` (runs on every search).
- **#311 a11y** — aria-label + aria-pressed on the 3 theme-toggle buttons, aria-label on the floor-plan remove button, aria-hidden on the decorative icons.
- **#312 test** — browserbase-driver.ts 0→23 mock-only tests (env/peer-dep gating, session/CDP wiring, requirePage guard, full action→Playwright mapping incl. scroll sign math + clear-before-type key order, dispose). Reviewer A mutation-verified all 7 mutations flip a test red.
- **#314 quality gate (F2)** — coverage floors 25/19/30/25 → 40/30/42/40 (~10pt under real ≈50/39/54/51).

### Lessons learned
1. **A write-failure guard is not automatically an improvement — check what already committed.** For refine-chat, throwing a 500 on the failed assistant-message insert was WORSE than the fake-success it replaced: the re-analysis had already persisted a new room_diagnoses row, so a 500 hid the applied analysis AND forced an expensive retry that re-ran the full 3-5min pipeline and duplicated the pre-persisted user message. A reviewer (Sonnet) caught this. Right fix: return the applied result + `assistant_message: null` + a warning, keep the run completed. When a maker fixes "swallowed error," verify the surrounding side-effects before choosing throw-vs-degrade.
2. **A config-comment claim is reviewable too — don't assert enforcement you didn't wire.** Both coverage-floor reviewers rejected the comment claiming a regression "fails CI" / is "tracked in PENDING_OPS.md": CI's `verify` job runs bare `vitest run` (NO --coverage), and the PENDING_OPS entry wasn't added yet (and can't be, in a code branch — shared-ledger rule). Reworded to state honestly that the floors gate `npm run test:coverage` only; added the CI-wiring item in THIS bookkeeping PR.
3. **CHECK for an existing test before building one.** floor-plan-extractor looked like a prime 0-LLM target but already had a comprehensive suite — dropped it, moved to browserbase-driver (genuinely untested).
4. **A 17-second "journeys" failure = infra, not the change.** #311's journeys job failed via `supabase/setup-cli` "rate limit exceeded" (GitHub API) at setup, before any test — a transient flake from concurrent jobs sharing the rate window (309's journeys passed at the same time). One empty-commit re-trigger went green. Real journey runs take ~3.5 min; a sub-30s red is a setup/infra failure to re-kick, not diagnose as a code bug.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 56.**
- **functional_reality (ship-critical, still C) is the convergence blocker and is OWNER-BLOCKED** — the core photo→mockup + paywall→checkout→unlock runtime E2E needs Supabase-local + Stripe test-mode in CI (`.github/` human-applied; see PENDING_OPS). The loop cannot close this; do NOT fabricate a change that can't run green in-container.
- **Queued, file-disjoint, validated:**
  - **a11y polish (cheap)** — refine-chat surfaces the partial-success warning via `setError` (red destructive banner); both reviewers noted an amber "warning" style (DesignerWarningCard) would read more honestly. Small client-only change.
  - **test/eval** — untested heavy agents needing provider mocks: scene-assembler (2 chat + judge), post-search-coordinator (loop/turn-limit logic, 0-LLM-mockable), shopping-researcher (4 exports), design-coordinator, mockup-agent. Also a **mockup live eval** would move F3 toward complete.
  - **perf** — embedding-index pgvector match_ RPC (LIVE-DB-only; needs the owner to apply the migration + verify). search/route.ts `output_json` over-fetch.
  - **dep health (owner-review, not auto-bump)** — Next.js/ws/protobufjs npm-audit vulns; TS 5/6 root↔mobile mismatch; skipLibCheck.

## Run 2026-07-01 (Run 51) — 4 disjoint changes (LLM-core test + perf + mobile a11y + docs)

### State on entry
- Cold container at default tip `49c40f1` (post Run 50 #283-286 + housekeeping #287 + FACTORY_STANDARD sync #288). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1353 tests** pass / 9 skip, determinism clean, eslint 0.
- **DEEP AUDIT not due** (last Run 48; next ~Run 52). Consumed the same-day QUALITY_SCORECARD (overall C / ship_gate_met:false — functional_reality C human-gated on E2E_AUTH_STACK; the correctness-B gap it names, product-verify maxDuration, was already closed #283 → scorecard slightly stale, needs an independent re-grade). Ran the full 6-lens Haiku scout sweep (tests / correctness / mobile / security-RLS / store+artifact / perf).

### What was done (4 file-disjoint changes, all merged #289-292)
- **#289 tests_evals (F2/A5-F3, rotation-guide top item)** — first unit suite for `lib/agents/computer-use/verify-search-candidates.ts` (`verifyTopSearchCandidates`), the post-search Computer-Use grounding step (0 LLM calls; mocks the verifier + Supabase admin + the optional `@browserbasehq/sdk` dynamic import). 14 tests pinning: tracking-param-stripping URL cache key + trailing-slash strip, top-1-per-category by `final_item_score`, cache-hit short-circuit (verifier not called, never re-cached), fill-only-empty field merge (never overwrites existing materials/colors; identical price = no change), all-null-dimensions skip, cache-write only on `agent_status==="completed"`, skipped(no url)/failed/verifier-reject paths, Browserbase-unavailable no-op. Reviewer A MUTATED the source (flipped the sort comparator, dropped the fill-empty + completed-cache guards) and confirmed each mutation flips a test red → load-bearing, not tautological.
- **#290 perf (A3)** — evaluate-set fetched the `projects` row and the sibling-`rooms` context sequentially though both key only on `room.project_id` → one `Promise.all` (fixed-position destructure preserves determinism; error-swallow semantics unchanged). Third instance of the #265/#277 pattern.
- **#291 mobile a11y (A2/F4, Track B polish)** — `accessibilityRole="button"` + `accessibilityLabel="Back"` on the "← Back" Pressable across the 3 core-journey screens (photo, room-type, results), matching settings.tsx. Screen-reader dead-end on the primary flow closed. Purely additive.
- **#292 docs (F5 artifact freshness)** — README documents DeepSeek: env.ts requires `DEEPSEEK_API_KEY` in prod unless `AI_PROVIDER=gemini`, but the stack table + env list omitted it (a deployer would hit MissingEnvError at boot).
- 8 per-change Sonnet reviewers (2× each), **ALL APPROVE first pass, zero re-reviews.** Combined suite 1367 pass/9 skip, tsc/determinism/eslint clean. No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box fully completes (all 4 incremental within partial Tracks A/F) → none ticked.

### Lessons learned
1. **Verify a security scout's "CRITICAL" against Postgres semantics before building — the RLS `WITH CHECK` fallback is the classic false positive.** The security scout flagged 13 tenant tables using `for all using (user_id = auth.uid())` WITHOUT an explicit `with check` as an "INSERT escalation" hole and wanted a migration 028. FALSE: Postgres uses the `USING` expression AS the `WITH CHECK` when the latter is omitted on a `FOR ALL` (or INSERT/UPDATE) policy — so inserting another user's `user_id` IS blocked. Migration 001's pattern is correct (Run 48 already confirmed security CLEAN). No migration written. When a Haiku security lens claims a CRITICAL, prove the exposure against the actual DB engine semantics, not the scout's prose — "Haiku over-flags" (Run 48 lesson) applies double to security.
2. **"Brand-name inconsistency" was a false positive — check the brand system before mass find-replace.** The store scout (and several prior rotation guides) flagged ~40 uses of "AptDesigner" (vs "AptDesignerAI") as drift to reconcile. But `docs/brand-kit.md` explicitly defines **Full name: AptDesignerAI / Display name (preferred): AptDesigner** — the wordmark literally is "AptDesigner". Changing them would VIOLATE the documented brand and be a behavior-neutral rename (the exact churn the value bar forbids). Abandoned the branch cleanly. Reading the canonical source (brand kit) before a bulk rename saved a churn change — and this finding should stop recurring in rotation guides.
3. **A clean, well-precedented batch reviews in one pass.** All 4 changes matched an established repo pattern (Promise.all #265/#277, a11y #266/#267/#279, provider-mocked agent test idiom, LIVING-ARTIFACTS doc fix) → 8/8 first-pass approvals, zero re-reviews (matches the Run 47 observation: mechanically-tight + pattern-matching diffs don't churn review).

### Rotation guide for next run
- **DEEP AUDIT DUE ~Run 52 (this is the run to run it)** — run the 8-lens read-only Haiku sweep FIRST before scouting.
- **Highest-value queued, file-disjoint (validated, not taken):**
  - **tests_evals (lib/agents)** — remaining heavy untested agents need schema-valid fixtures + provider mocking (budget a focused run for ONE): room-diagnostician (3 chat + self-consistency), scene-assembler (2 chat + judge/reconcile), mockup-agent, design-coordinator, post-search-coordinator, shopping-researcher. Cleaner next 0-LLM target: `lib/agents/computer-use/browserbase-driver.ts` (263 lines — constructor/defaults + `requirePage()` throw + dispose cleanup + dynamic-import error path; needs Playwright/Browserbase mocking, error-path value only).
  - **correctness (marginal, standalone only)** — `rooms/[roomId]/identified-products/confirm` embedding write-back sets `embedding_written_back:false` durably on a transient embed failure with no retry (a re-run is guarded off) → silent ML-signal loss. Real but the fix is nuanced (defer flag-set / add a retry) — do it carefully, not under a tight cap.
  - **perf** — search/route.ts `output_json` over-fetch (select whole JSON, use 3 fields) + `room_diagnoses select('*')` narrowing across ~6 routes (LOW-MED, verify all consumed fields first). embedding-index pgvector RPC still LIVE-DB-only. next/image on giant dynamic pages = F7 served-app run.
  - **mobile (borderline)** — `_layout.tsx` `Purchases.logIn/logOut().catch(()=>{})` identity desync (RC `logOut()` throws on already-anonymous — must distinguish via RC error codes, NOT naive retry); results.tsx save-error not logged/surfaced (shares results.tsx with #291 — was disjoint-blocked this run).
  - **NOT drift (settled this run — don't re-flag):** "AptDesigner vs AptDesignerAI" is the preferred display name per brand-kit; RLS `FOR ALL USING` without explicit `WITH CHECK` is SAFE.
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job (RUN_EVALS=1 key); F4 Playwright/journey CI wiring + E2E_AUTH_STACK; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; live secrets; SITE_GATE_PASSWORD.
- **Readiness:** still blocked — QUALITY_SCORECARD overall C / ship_gate_met:false (functional_reality C is the binding gate — core-journey + paywall runtime E2E, human-gated on E2E_AUTH_STACK). Did NOT attempt the ready issue.

---

## Run 2026-07-01 (Run 50) — 4 disjoint changes (correctness ship-critical + security preflight guard + mobile monetization + eval completeness)

### State on entry
- Cold container at default tip `7e62a10` (post Run 49 #273-280 + housekeeping #281 + fresh quality grade #282). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1350 tests** pass / 8 skipped, determinism clean, eslint 0.
- **DEEP AUDIT not due** (last Run 48; next ~Run 52). NEW independent QUALITY_SCORECARD landed #282 (as_of 2026-07-01, overall C, ship_gate_met:false): security_rls/store_readiness/artifact_integrity/business_case_strength now **A**; ship-critical dims still < A: functional_reality **C** (core money-path has no outcome-asserting runtime E2E — human-gated on E2E_AUTH_STACK), correctness **B**, design_taste **B**. Used the fresh scorecard as the vetted feed (Run 42/48 lesson) + 3 Haiku scouts (mobile / perf+correctness / untested-agents+eval).

### What was done (4 file-disjoint changes, all merged #283-286)
- **#283 correctness (ship-critical, closes scorecard HIGH-severity gap)** — `app/api/computer-use/product-verify` had no `maxDuration` while driving an agentic Browserbase loop → platform-killed mid-verification (leaked session) once Browserbase creds set. Added `maxDuration=300` (18th/18 pipeline routes now covered) + an optional `maxWallClockMs` budget in the shared agent-loop (checked at top of each turn → clean stop + driver dispose via existing `finally`), passed `270_000` from the computer-use product-verifier (30s headroom). Injectable `now` clock → 3 deterministic tests (normal completion / mid-run trip / no-cap fallback). No-op for existing callers.
- **#286 security (security_rls A→A+ bounded item)** — preflight GATE 6: mechanical per-public-table RLS-coverage (parses BOTH `alter table … enable row level security` AND the dynamic `do $$ … array['t'] … execute format('… enable row level security', t)` loop) + a `NEXT_PUBLIC_*(SECRET|SERVICE_ROLE|PRIVATE)` client-secret-leak grep. Both no-ops on the current 26-table tree; turns a review-only invariant into a mechanical ratchet.
- **#284 mobile monetization (Track C reliability)** — post-purchase entitlement `refresh()` retries 3× w/ backoff + returns `Promise<boolean>`; `results.tsx onPurchaseSuccess` awaits it and shows an honest "may take a moment to sync" alert instead of silently stranding a paying user at `isPro=false`. Server still source-of-truth.
- **#285 tests_evals (A5/F3, scorecard "refine eval mislabeled" gap)** — `refine.eval.test.ts` → real gated live eval calling `summarizeRefineChanges` (5th core stage now live, parity with the other 4); the runner smoke tests moved verbatim to `runner.test.ts` (coverage preserved). Live run still needs the RUN_EVALS=1 job (owner key) — same posture as the existing 4.
- 8 per-change Sonnet reviewers (2× each) + 1 re-review. Combined suite green: 1353 pass / 9 skip, tsc/determinism/eslint clean. No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box fully completes (all 4 incremental within partial Tracks A/C/F) → none ticked.

### Lessons learned
1. **A mechanical security parser can itself have a false-NEGATIVE — adversarial review earns its keep.** GATE 6's first cut harvested EVERY quoted literal in any file containing an RLS loop; Reviewer A built a reproduction (an unguarded table whose name appears as a stray `default 'x'` literal in a file that also has an unrelated dynamic-RLS loop) that the gate would silently pass. Fix: scope the harvest to `array[...]` literals INSIDE a `do $$…$$` block that actually enables RLS. When writing a *security* gate, adversarially test the FALSE-NEGATIVE direction (what it fails to catch), not just that it passes clean — and prefer a design that fails SAFE (over-block) over one that can mask a leak.
2. **The `@google/genai` SDK mock needs a REGULAR function, not an arrow, to be `new`-able.** `vi.fn(() => ({...}))` threw "is not a constructor" when the agent loop does `new GoogleGenAI(...)`; a `function GoogleGenAI(){ return {...} }` inside the factory works (returning an object makes `new` yield it). Combined with the hoist rule (define the mock fn INSIDE the factory, retrieve after import) this is the idiom for mocking the direct-SDK computer-use loop.
3. **The fresh independent scorecard IS the scouting feed (re-confirmed).** #282 (dated today, file-precise) named the exact HIGH-severity correctness gap (product-verify maxDuration), the security_rls A+ item (preflight RLS assertion), and the tests_evals gap (refine eval mislabeled) — 3 of the 4 shipped changes came straight from it; scouts only added the mobile one. Don't re-discover what a same-day scorecard already pinpoints.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 52** (last Run 48).
- **Highest-value queued, file-disjoint:**
  - **tests_evals (lib/agents ~35%)** — remaining untested but HEAVILY-ORCHESTRATED agents: room-diagnostician (3 chat + self-consistency), scene-assembler (2 chat + judge/reconcile), mockup-agent, shopping-researcher (759 lines), design-coordinator, post-search-coordinator. NOTE: these need schema-valid fixtures (RoomSceneGraphResponseSchema etc.) + heavy mocking — budget a focused run for ONE done properly, don't attempt cold under the 2-cycle cap. Cleaner-to-test: `verify-search-candidates.ts` (computer-use, 0 LLM, URL-normalize + cache logic).
  - **performance (non-ship-crit B)** — embedding-index `topKSimilar` full-table `select('*')` N-scan-per-crop → needs a pgvector match_ RPC + migration (LIVE-DB verification only; defer to a live-DB run). next/image on the 11 raw `<img>` are all on the giant dynamic page files (focus 1653 lines / setup / saved) — risky cold; do on an F7 served-app run.
  - **mobile (borderline, standalone only)** — `_layout.tsx` `Purchases.logIn/logOut .catch(()=>{})` identity desync: DO NOT naively retry/log — RC's `logOut()` throws on an already-anonymous user (the swallow is partly intentional); a real fix must distinguish the anonymous-logout error from a transient one via RC error codes. Left this run for that reason.
  - **design_taste (ship-critical B)** — axe on ≥1 authed route + F7 screenshots both need the E2E auth stack / served app (human-gated).
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job (RUN_EVALS=1 key); F4 Playwright/journey CI wiring + E2E_AUTH_STACK; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; live secrets; SITE_GATE_PASSWORD.
- **Readiness:** still blocked — QUALITY_SCORECARD overall C / ship_gate_met:false (functional_reality C is the binding gate — needs core-journey + paywall runtime E2E, human-gated on E2E_AUTH_STACK). Did NOT attempt the ready issue.

---

## Run 2026-07-01 (Run 49) — 8 disjoint changes (2 tests + correctness + security + compliance + mobile + perf+test + a11y)

### State on entry
- Cold container at default tip `62fe48c` (post Run 48 #263-269 + housekeeping #270 + Vercel-deploy #271 + growth-dashboard #272). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1330 tests** pass / 8 skipped, determinism clean, eslint 0.
- **DEEP AUDIT not due** (ran Run 48; next ~Run 52). Open quality issues #199-205 (as_of 2026-06-29, overall C) are STALE — their named gaps were closed by Runs 42-48 (maxDuration #206, G1 #207, privacy #208, not-found #210, toast aria-live #266, referral #226, upsell #238); scorecard needs an independent re-grade (owned by the Quality Auditor, not the factory). Ran a full 7-lens Haiku scout sweep for genuinely-remaining file-disjoint work.

### What was done (8 file-disjoint changes, all merged #273-280)
- **#274 correctness** — products/evaluate flipped candidate_products status "evaluated" with a fully-unchecked write (fake-201 + orphaned pending row + wasted re-score). Guarded via apiError, mirroring the saveError check above. (Distinct from the prior twin-write batch — a genuinely unchecked update, not a near-dup.)
- **#275 security (Track G)** — places/photo (paid Google Places, ~$7/1k) had rate-limit but no checkDailySpend → single authed user could drain the daily budget. Added the breaker, mirroring diagnosis.
- **#276 mobile (Track C)** — restore-purchases honesty: (1) any thrown error showed "No previous purchases found" (blocked retry on transient failures); (2) an empty-but-successful restore fired onPurchaseSuccess + dismissed (fake unlock). Now checks CustomerInfo for the active 'pro' entitlement, keeps the sheet open on empty restore, and distinguishes user-cancel from real error. Server still gates entitlements (no trust-the-client).
- **#277 perf+test (Track A3/F2)** — diagnosis-expansion-pipeline (runs on every streamed diagnosis) awaited fetchSiblingRoomSummaries then buildExpansionBudgetContext sequentially though independent → Promise.all (fixed-position destructure = determinism preserved) + the module's first unit suite.
- **#273 / #278 tests (F2)** — PipelineTracer (pure observability class, 11 tests) + identified-products-pipeline orchestration (5 tests: no-photos/no-crops short-circuits, dedup-by-(brand,model,variant), verify cap by confidence, dropUnverified, token sums).
- **#279 a11y (A2/F4)** — manual-sourcing scorecard header was a `<div onClick>` with no keyboard path (WCAG 2.1.1). Made the chevron a real `<button>` (aria-expanded, aria-label, focus ring), sibling to the product-link `<a>` (no nested-interactive).
- **#280 compliance (Track D)** — privacy page named only 3 processors; the app shares data with 11. Added a "Third-party services" section + completed docs/app-privacy.md (both Apple + Play tables) with all 11 (Gemini, DeepSeek, Supabase, Stripe, RevenueCat, Tavily, Maps/Places, Browserbase, Resend, Turnstile, Vercel Analytics), each with accurate data-scope; reconciled page brand to AptDesignerAI.
- 16 per-change Sonnet reviewers (2× each) + 3 re-reviews. No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP box FULLY completes (all 8 are incremental within already-partial tracks A/C/D/F/G) → none ticked.

### Lessons learned
1. **The privacy-completeness fix took 3 adversarial rounds because the "authoritative" doc (app-privacy.md) was itself stale.** Each reviewer found one more real active processor (Resend → Turnstile → RevenueCat). The terminating move was a MECHANICAL sweep — `grep -rhoE "https://[host]"` over app/lib/mobile/src — to enumerate EVERY external endpoint at once, then reconcile. Lesson: when a task is "disclose all X", don't iterate reviewer-by-reviewer; do the exhaustive mechanical enumeration up front and diff against it. Also keep BOTH the Apple and Play tables in app-privacy.md in sync (a reviewer caught them diverging within the same diff).
2. **Concurrent reviewer subagents CAN switch the shared working-tree branch (Run 43 lesson, re-confirmed the hard way).** Mid-run my `git checkout` landed me on the wrong branch because a reviewer had `git checkout`'d despite instructions. All commits were safely pushed so nothing was lost, but I skipped an optional test-strengthening to avoid risky local git ops while reviewers ran. Lesson: do local git mutations (branch switches/commits) only when NO reviewers are in flight, or use `git worktree`; never trust `git branch --show-current` implicitly during a review fan-out.
3. **The `journeys` CI job flakes on the supabase-cli setup step when many PRs land together** (Run 45 lesson, re-confirmed): #276's journeys failed in ~10s (setup-step rate-limit) while verify/build/mobile passed; `rerun_failed_jobs` cleared it. A ~10s journeys failure = flake, not a real break; a real run is ~3-4 min.
4. **A "twin-write status-flip" candidate is only worth taking when it's a FULLY-unchecked write, not a logged-but-continue sibling.** The correctness scout flagged ~6; only products/evaluate (#274) had a truly discarded update result. The others already log-and-continue (a defensible non-fatal choice) — taking them would have padded the repetitive class Run 47/48 deferred.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 52** (last Run 48).
- **Highest-value queued, file-disjoint:**
  - **tests_evals (lib/agents ~21%)** — still-untested mockable agents: room-diagnostician (3 chat, self-consistency), scene-assembler (3 chat, reconciliation), design-coordinator (agent loop), post-search-coordinator (agentic, 623 lines), mockup-agent (dual-phase), shopping-researcher (759 lines), orchestrator (3300+ lines — split helpers first). pipeline-trace + identified-products + diagnosis-expansion now DONE. Verify "untested" with an ls first.
  - **identified-products test** — add a variant-dedup case (same brand/model, different variant → 2 kept); the current suite doesn't exercise the variant segment of the dedup key (non-blocking gap a reviewer flagged).
  - **perf** — the NON-stream diagnosis/route.ts:305-308 has the SAME sequential sibling+budget fetch as the pipeline module just parallelized (#277) — apply Promise.all there too. embedding-index pgvector RPC still LIVE-DB-only (defer). next/image: no raw <img> on marketing pages (scout confirmed none) — drop it.
  - **mobile** — use-entitlements.ts refresh swallows errors (post-purchase failed refresh → stale isPro=false); _layout.tsx Purchases.logIn/logOut `.catch(()=>{})` swallow (identity desync). Both borderline — standalone only.
  - **artifact-freshness (borderline)** — ~17 other page-metadata titles still say "AptDesigner" vs canonical "AptDesignerAI" (layout.tsx default title, faq/support/guides/etc.); README missing DeepSeek + secondary processors. Real but low-value; a focused scoped find-replace on metadata strings only.
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job; F4 Playwright/journey CI wiring + E2E_AUTH_STACK; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; live secrets; SITE_GATE_PASSWORD.
- **Readiness:** still blocked — QUALITY_SCORECARD as_of 2026-06-29 overall C / ship_gate_met:false (STALE; needs a fresh independent re-grade to reflect Runs 42-49), F4 core-journey runtime E2E + eval CI job still open/human-gated. Did NOT attempt the ready issue.

---

## Run 2026-07-01 (Run 48) — DEEP AUDIT + 7 disjoint changes (store readiness ×2 + perf + a11y ×2 + 2 LLM-core tests)

### State on entry
- Cold container at default tip `d47101c` (post Run 47 #250-258 + GTM commits #259-262). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1308 tests** pass / 8 skipped, determinism clean, eslint 0.
- **DEEP AUDIT DUE** (last Run 44; the Run-47 rotation guide flagged Run 48 as the run to run it) → ran the 8-lens read-only Haiku sweep FIRST, then folded findings into selection (no separate scout sweep needed — the audit WAS the discovery).

### DEEP AUDIT 2026-07-01 (Run 48) — 8 read-only Haiku lenses across the whole codebase
- **Security/RLS: CLEAN** through migration 027. Every public table RLS-enabled with the right posture (tenant on auth.uid() + WITH CHECK; shared/internal RLS-on-no-policy); all ~26 paid LLM endpoints have checkRateLimit + checkDailySpend; secrets env-read; admin client scoped to auth/shared/read-only; SECURITY DEFINER search_path pinned (024). No findings — correct no-op.
- **Correctness:** the twin-write status-flip class still has open members (search/stream, products/evaluate, analyze-apartment, search, evaluate-set — unchecked status updates orphan state). Real but REPETITIVE (Run 47 lesson #4 deferred it); took NONE this run to avoid padding (enough correctness-adjacent value elsewhere). No maxDuration gaps (all heavy routes =300). `getCurrentUserId()` prod mock-fallback (server.ts:80/82) noted but LEFT — tied to the current memory-store data-layer phase; no root middleware; changing auth semantics blindly is risky.
- **Performance:** diagnosis/route.ts serial project+preference reads → BUILT (#265, Promise.all). embedding-index full-table scan needs a pgvector RPC + migration (LIVE-DB, deferred); next/image + a perf budget deferred.
- **A11y/design:** toast close-button no accessible name + wrong announce urgency → BUILT (#266); compare-table <tr onClick> sort with no keyboard access → BUILT (#267). Mobile hardcoded colors (themed-text linkPrimary dead code, animated-icon splash bg) = borderline, deferred.
- **Functional reality:** core pipeline + paywall→webhook→entitlement still have NO outcome-asserting runtime E2E (F4, gated on E2E_AUTH_STACK + deterministic provider fixtures + Stripe test-mode — big/human-gated). NOTE: the webhook route is ALREADY well unit-tested (__tests__/api/billing-webhook.test.ts, 8 cases incl. side-effect integrity + idempotency) and entitlements have server/web tests — so a synthetic vitest "integration" test would add little; dropped that candidate.
- **Mobile:** signup Terms/Privacy not tappable = store-BLOCKER → BUILT (#263). Paywall offerings "stuck loop" = FALSE FLAG (already handled #242 — keeps fallback, warns, CTA alerts on no-package, retries on reopen). Entitlement-refresh swallows errors + quota-constant dup = borderline, deferred.
- **Deps/artifact:** contact email `aptdesigner.app` in 7 UI files vs canonical `.com` → BUILT (#264). Product-name "AptDesigner" vs "AptDesignerAI" in page titles = borderline (deferred). TS root ^5 / mobile ~6.0.3 = low. BUSINESS_CASE optimistic-scenario/escalation-COGS notes = DEFERRED (just re-modeled #258 Run 47; GTM anti-oscillation damper — don't churn it two runs running).
- **Tests/evals:** 12 untested lib/agents modules mapped (orchestrator, shopping-researcher, room-diagnostician, post-search-coordinator, design-coordinator, mockup-agent, scene-assembler, format-floor-plan, user-feedback, diagnosis-expansion-pipeline, pipeline-trace, identified-products-pipeline). Took the 2 cleanest/highest-reuse this run (format-floor-plan #268, user-feedback #269).

### What was done (7 file-disjoint changes, all merged #263-269)
- **#263 store readiness** — signup Terms/Privacy tappable (expo-web-browser, mirrors paywall/settings). **#264 store readiness** — contact email → canonical `.com` across 7 UI files. **#265 perf** — diagnosis project+preference reads parallelized. **#266 a11y** — toast dismiss accessible-name + urgency typing. **#267 a11y** — compare-table keyboard-accessible sort buttons. **#268/#269 tests** — format-floor-plan (13) + user-feedback (9), both provider/DB-mocked, mutation-verified.
- 14 per-change Sonnet reviewers (2× each) + 1 re-review. 13 APPROVE first pass; the user-feedback test took 2 review cycles (Reviewer A + a re-review caught that the rooms-error case was masked by the `!rooms` guard AND then by the no-history branch). No new migrations/secrets → PENDING_OPS unchanged. No ROADMAP boxes fully completed (all 7 are incremental within already-partial tracks A/D/F) → none ticked.

### Lessons learned
1. **A masked branch assertion can be masked TWICE — mutation-test it, don't eyeball it.** The user-feedback rooms-error test first used `data:null` (caught by `!rooms`), then `data:[row]` with no accepted/rejected data (caught by the later "no history" `return ""`). Only `data:[row]` + real accepted/rejected history makes the `""` assertion depend on the `roomsError` guard alone. I proved it by MUTATING the source (drop `roomsError ||`) and confirming the test flips red — the deterministic way to terminate a review loop at the 2-cycle cap without a subjective 3rd round.
2. **The deep audit IS the scouting feed on its due run.** Running the 8 Haiku lenses first and selecting directly from their findings (no separate scout sweep) was the right spend — same discipline as "a fresh QUALITY_SCORECARD is the scouting feed" (Run 42 lesson).
3. **Adjudicate audit findings before building — Haiku over-flags.** Dropped 3 plausible-looking findings after reading the code: paywall "stuck loop" (already fixed #242), a synthetic webhook "integration" test (already unit-tested with side-effect integrity), and the twin-write status-flips (real but a repetitive class Run 47 deferred; taking more would read as padding).
4. **Don't re-model the business case two runs in a row.** The deps/artifact scout flagged BUSINESS_CASE optimistic-scenario traceability + escalation-tier COGS. Real-ish, but #258 (Run 47) just re-modeled it and the GTM anti-oscillation damper exists to stop maker churn on the same doc — deferred to a future run with a fresh independent grade, not touched this run.

### Rotation guide for next run
- **DEEP AUDIT done Run 48 → next due ~Run 52.**
- **Highest-value queued, file-disjoint (validated this run, not taken):**
  - **tests_evals (lib/agents ~21%)** — remaining untested mockable/pure agents: room-diagnostician (3 chat, self-consistency), scene-assembler (3 chat, reconciliation), design-coordinator (agent loop), post-search-coordinator (agentic, re-search budget), diagnosis-expansion-pipeline (pure), pipeline-trace (pure), identified-products-pipeline (glue). Verify "untested" with a file check first.
  - **correctness** — twin-write status-flip guards (search/stream, products/evaluate, analyze-apartment status updates unchecked → orphaned state). Repetitive class; take 1-2 max or fold into a deep-audit finding, don't batch as padding.
  - **performance** — embedding-index pgvector RPC + migration (LIVE-DB verification only); next/image + a perf/bundle budget (none exists).
  - **mobile** — entitlement-refresh error surfacing (use-entitlements.ts swallows errors; after purchase a failed refresh leaves stale isPro=false) + a shared quota constant (mobile/lib duplicate FREE_SAVE_LIMIT=3). Both borderline — standalone only.
  - **business_case** — optimistic-scenario body traceability + escalation-tier COGS honesty (deps scout). Wait for a fresh independent grade / a run NOT adjacent to #258.
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job; F4 Playwright/journey CI wiring + E2E_AUTH_STACK; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; live secrets; SITE_GATE_PASSWORD.
- **Readiness:** still blocked — QUALITY_SCORECARD as_of 2026-06-29 overall C / ship_gate_met:false (STALE; most top_gaps closed by Runs 42-48 — needs a fresh independent re-grade to reflect reality), F4 core-journey runtime E2E + eval CI job still open/human-gated. Did NOT attempt the ready issue.

---

## Run 2026-06-30 (Run 47) — 9 disjoint changes (business-case re-model + 2 security/reliability route-hardening + correctness + 2 mobile + 3 LLM-core agent tests)

### State on entry
- Cold container at default tip `d748572` (post Run 46 #240-247 + GTM commits #248-249). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1278 tests** pass / 8 skipped, determinism clean, eslint 0.
- **DEEP AUDIT not due** (last Run 44; next ~Run 48). QUALITY_SCORECARD as_of 2026-06-29 is now STALE relative to state — most of its top_gaps were closed by Runs 42-46 (maxDuration #206/#214, G1 #207, privacy #208, not-found #210, referral #226, upsell #238). Relied on the Run-46 rotation guide + a full 6-scout Haiku sweep for genuinely-remaining file-disjoint work. Security scout = CLEAN through migration 027 (re-confirmed RLS holds) BUT surfaced unguarded paid-LLM endpoints (a code-surface gap, not a migration gap).

### What was done (9 file-disjoint changes, all merged #250-258)
- **#258 business_case_strength (ship-critical B — the headline)** — the long-deferred re-model (Run 46 lesson #5 deferred it for maker≠checker independence). Re-grounded base-case organic 50%→40% (the doc itself flagged 50% as above its 35-40% benchmark), added a net-margin sensitivity table (35/40/50/65%), and credited the now-BUILT referral (#226) + web upsell (#238) levers with GrowSurf referral benchmarks + the Apple SBP 15% margin upside. **ARR unchanged ($122.9K) — organic share moves marketing COST/margin, not revenue, so the floor stays cleared and nothing was gamed upward.** Both Sonnet reviewers independently recomputed every table row + confirmed the anti-gaming posture.
- **#250 / #251 reliability+security route-hardening** — #250: maxDuration=300 on 4 product/bundle LLM routes the #206 batch missed + checkDailySpend on the 2 (ingest, bundles/evaluate) lacking it. #251: the two FULLY-unguarded paid LLM endpoints (floor-plan extraction, product correction) got rate-limit + daily-spend + maxDuration (real G1-class unbounded-spend holes; 2 new RATE_LIMITS entries).
- **#252 correctness (side-effect integrity)** — mockups generation-path job insert was unchecked → id:undefined fake-success while the expensive pipeline ran + status updates no-op'd. Now 500s before the work; cache-path insert non-fatal.
- **#253 / #254 mobile reliability** — save-design (30s) + account-delete (15s) fetch timeouts (raw fetches → frozen-button dead-ends).
- **#255 / #256 / #257 LLM-core agent tests** (tests_evals; lib/agents ~21%) — room-architecture-extractor (11; reviewer measured 94%/83%), mockup-verifier (11, incl. the self-correction retry loop), product-verifier (8, incl. the 0.75 threshold gate + structured→text fallback). All provider-mocked, assert the determinism contract.
- 18 per-change Sonnet reviewers (2× each) — **ALL APPROVE first pass, ZERO re-review cycles** (cleanest review run to date). Reviewers independently re-ran the 3 test suites + recomputed the business-case arithmetic + verified links 200. 6 Haiku scouts. No new migrations/secrets → PENDING_OPS unchanged.

### Lessons learned
1. **The vi.mock factory CANNOT reference a top-level `const mockChat` even with the `mock` prefix** — it threw `Cannot access 'mockChat' before initialization`. The robust repo idiom (product-extractor.test.ts) is: inline `vi.fn()` INSIDE the factory, then after the import grab `const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>`. Use that for every provider-mocked agent test; don't fight the hoist.
2. **The business-case re-model was safe to do solo BECAUSE the per-change 2-reviewer split IS the maker≠checker independence** Run 46 was worried about. The honest move that cleared adversarial review: re-ground to the defensible benchmark, show the margin sensitivity HONESTLY (admit break-even at 40%), credit only ACTUALLY-BUILT levers with cited research, and DO NOT move ARR. Reviewer B explicitly checks "was anything moved to flatter the number" — keeping ARR fixed while making margin honest is what passes it.
3. **The disjoint rule forces hardening to be grouped by FILE-FAMILY, not by concern.** maxDuration (reliability) and checkDailySpend (security) are different concerns, but products/ingest + bundles/evaluate needed BOTH — so one coherent "production-harden these routes" PR per file-family beats splitting by concern (which would collide files). Reviewers accepted the file-family coherence.
4. **Deferring the repetitive twin-write status-flip guards was the right call.** diagnosis/route.ts + evaluate/route.ts status-flips are real bugs but near-identical to ~8 already shipped; with mockups (a DISTINCT side-effect-integrity bug) + 2 security PRs covering the correctness/risk category, adding more status-flip near-clones would have read as padding. Queue them for a thinner run.
5. **A full 9-change run with zero re-reviews is achievable when each change is mechanically tight + matches an established repo pattern.** The clean-tree-between-branches discipline (explicit `git add <path>`, never `git add -A`; checkout base before each new branch) held — no stray-file leakage this run (Run 46 lesson #1 applied).

### Rotation guide for next run
- **DEEP AUDIT DUE ~Run 48 (this is the run to run it)** — last ran Run 44; run the 8-lens read-only Haiku sweep FIRST before scouting.
- **Highest-value queued, file-disjoint:**
  - **tests_evals (lib/agents ~21%)** — remaining untested mockable agents: scene-assembler (3 calls + self-consistency), post-search-coordinator (multi-turn tool agent, 623 lines), shopping-researcher (759 lines, 2 calls), room-architecture-extractor is now DONE. Verify "untested" with a file check first.
  - **correctness (deferred this run)** — diagnosis/route.ts + products/evaluate/route.ts unchecked status flips (real but repetitive class — take 1 max, or fold into a deep-audit finding).
  - **performance** — embedding-index pgvector RPC + migration (LIVE-DB verification only); next/image + a perf/bundle budget (no Lighthouse gate exists).
  - **business_case** — now honest at 40% organic; next lever to BUILD (not just model) per the doc: a referral REWARD mechanic (not just attribution) or an annual-tier conversion surface, to push effective organic share past 50% with margin.
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; live secrets; SITE_GATE_PASSWORD; canonical-domain decision.
- **Readiness:** still blocked — QUALITY_SCORECARD overall C / ship_gate_met:false (and stale; a fresh independent re-grade is needed to reflect Runs 42-47), DoD boxes unchecked/human-gated. Did NOT attempt the ready issue.

---

## Run 2026-06-30 (Run 46) — 8 disjoint changes (2 correctness twin-write guards + 2 mobile reliability/monetization + 4 LLM-core agent tests)

### State on entry
- Cold container at default tip `b03bbc1` (post Run 45 #232–239). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1249 tests** pass / 8 skipped, determinism clean, eslint 0.
- **DEEP AUDIT not due** (ran Run 44; next ~Run 48). QUALITY_SCORECARD as_of 2026-06-29 overall C / ship_gate_met:false — its top_gaps mostly closed by Runs 42–45. Worked the Run-45 rotation guide + a 5-scout sweep (Haiku) for remaining real, loop-buildable, file-disjoint gaps. Security scout = CLEAN no-op (migrations 026/027 RLS verified, all paid LLM endpoints guarded, no secrets — confirmed Run-44 audit holds).

### What was done (8 file-disjoint changes, all merged #240–247)
- **#240 / #241 correctness (twin-write status drift)** — search/stream evalRows-insert + candidate_products status flip both unchecked (the #233 pattern, flagged in the Run-45 rotation guide) → guarded; analyze-apartment per-room Promise.all (diagnosis insert + room status flip) both unchecked → sequenced + checked + `continue` on insert failure (silently dropped a room's analysis before). Both via logServerError.
- **#242 mobile/monetization** — paywall getOfferings failure was swallowed; the FALLBACK_OPTIONS carry null packages so "Start Free Trial" silently dismissed (dead CTA, lost conversion) on a configured build. Split the guard (dev-mode vs configured-no-pkg → "Pricing unavailable" alert, sheet stays open) + log the failure.
- **#243 mobile reliability** — saved-designs share fetch had no timeout; a hung endpoint never rejects → frozen Share button. 15s AbortController → routes through existing fallback.
- **#244 / #245 / #246 / #247 agent tests** (tests_evals; lib/agents ~21%) — furniture-cropper (9: clamp/tiny-box/per-photo resilience/room-hint/determinism), product-identifier (7: tiered confidence floors), floor-plan-extractor (7: enum/number coercion + fail-open), mockup-prompt-validator (6: prompt build + schema-fail + fail-open). All provider-mocked, assert the determinism contract.
- 16 per-change Sonnet reviewers (2× each) + 4 re-reviewers. 2 REQUEST_CHANGES, both addressed: (a) share-timeout `let resp` use-before-assign → restructured response handling inside the inner try; (b) product-identifier test comment implied MIN_CONFIDENCE_IN_LIST is enforced (it's `void`-ed) → clarified + derived the out-of-list threshold. 5 Haiku scouts. No new migrations/secrets → PENDING_OPS unchanged.

### Lessons learned
1. **`git add -A` swept STRAY untracked test files into the wrong PR.** Two new test files written on their own branches (mockup-prompt-validator, product-identifier) were present as untracked files when I switched back to `fix/mobile-share-timeout` to apply a review fix; `git add -A && commit` swept BOTH into that commit. Net: #243 (share-timeout) merged with 3 files instead of 1; #246 then merged EMPTY (its file already upstream); #247 went `mergeable_state: dirty` (file already on base) and had to be rebased (dropping its now-upstream first commit) + force-pushed to land only the review-fix delta. Content was unaffected (every file was independently reviewed+approved before merge) but it broke the clean 1-PR-per-file mapping. **FIX next runs: stage explicit paths (`git add <file>`), never `git add -A`, when other branches' untracked files may be in the tree — or `git stash -u` / clean before switching branches.**
2. **Re-derive the threshold constant in tests, don't hardcode the magic number.** Reviewer B (correctly) flagged a bare `0.50` for the out-of-list floor; importing `MIN_CONFIDENCE_OUT_OF_LIST` and computing `- 0.35` keeps the test in sync if the constant moves.
3. **A test comment can be a review-blocking defect even when the assertion is correct.** The product-identifier "soft enforcement" comment implied a constant participated in the filter when the source explicitly `void`s it — misleading future readers. Comments are part of the diff reviewers judge.
4. **Restore both lockfiles after a cold `npm install`** (root + mobile) before each commit (Run 44/45 lesson, re-confirmed).
5. **Business-case re-grounding (50%→35% organic) is NOT a safe unilateral maker edit this run.** The scout confirmed it's a clean single-file edit, but re-grounding flips net margin negative (−$11K; ARR stays $122.9K, above the $100K floor). That's a high-stakes framing change (more honest, but exposes a sustainability gap) better handled with built-lever (referral #226 + upsell #238) modeling on a focused run, where maker≠checker independence matters. DEFERRED, noted below.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 48.**
- **business_case_strength (ship-critical B)** — the queued, named, buildable work: re-model the case at the defensible 35–40% organic benchmark WITH the now-built referral (#226) + web upsell (#238) levers credited (conversion/CAC uplift), so the honest case clears the floor WITH margin rather than flipping negative. Substantive single-file rewrite of docs/BUSINESS_CASE.md + its machine-readable summary; ground every input (no inventing). Do on a focused run.
- **tests_evals (lib/agents ~21%)** — remaining untested mockable single-call agents: `mockup-verifier` (thin LLM core + generateWithVerification orchestrator), `product-verifier`, `scene-assembler`, `post-search-coordinator`, `diagnosis-expansion-pipeline`, `shopping-researcher` (759 lines, 3 calls). Verify "untested" with a file check first.
- **correctness (minor, deferred this run to avoid repetitive near-identical PRs)** — evaluate/route.ts unchecked status flip (#3 from scout), diagnosis/route.ts room-status flip (#4), mockups/route.ts insert returning `id: undefined` on failure (#6/#7, a fake-success/side-effect-integrity gap). All file-disjoint; pick the strongest 1–2 next run.
- **performance** — embedding-index pgvector RPC + migration (LIVE-DB verification — do on a live-DB run); next/image + a perf/bundle budget (no Lighthouse gate exists).
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job (RUN_EVALS key); F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; live secrets; SITE_GATE_PASSWORD; canonical-domain decision.
- **Readiness:** still blocked — QUALITY_SCORECARD overall C, ship_gate_met:false, DoD boxes unchecked/human-gated. Did NOT attempt the ready issue.

---

## Run 2026-06-30 (Run 45) — 7 disjoint changes (web upsell lever + 3 LLM-core agent tests + 3 correctness)

### State on entry
- Cold container at default tip `aa63bc1` (post Run 44 #222–228 + GTM/auth commits #229–231). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1231 tests** pass / 8 skipped, determinism clean, eslint 0.
- **DEEP AUDIT not due** (ran Run 44; next ~Run 48). QUALITY_SCORECARD as_of 2026-06-29 overall C / ship_gate_met:false — but its top_gaps were largely already closed by Runs 42–44 (maxDuration #206/#214, G1 spend guards #207, privacy page #208, 404 #210, referral #226). Used the Run-44 rotation guide + a focused 6-scout sweep for the remaining real, loop-buildable, file-disjoint gaps.

### What was done (7 file-disjoint changes, all merged #232–238)
- **#238 web upsell surface** (`business_case_strength` ship-critical lever) — reusable `UpgradeCtaCard` + `GET /api/billing/status` + `/saved` wiring. The server-side 402/403 limit already existed; this is the missing in-product expansion surface (web parity with the mobile paywall). No new secret/migration.
- **#235 / #236 / #237 agent tests** (tests_evals; lib/agents ~21%) — requirement-validator (7), category-planner (5, incl. the structured→tools-only fallback), correction-planner (6, mocks `getProvider`). All provider-mocked, assert the determinism contract (seed + cheap thinking), fail-open + schema-fail branches.
- **#232 / #233 correctness** — diagnosis-stream room-status write error surfaced; evaluate-set twin-write status-drift guard. **#234 mobile** — photo.tsx `getPendingResultAsync` `.catch`.
- 14 per-change Sonnet reviewers (2× each) — ALL APPROVE first pass, zero re-review cycles. 6 Haiku scouts. No new migrations/secrets → PENDING_OPS unchanged.

### Lessons learned
1. **Launching N PRs at once can rate-limit the `journeys` CI job.** `supabase/setup-cli@v1` resolves the "latest" release via an unauthenticated GitHub API call; 7 concurrent CI runs collectively exhausted the shared 60/hr limit and 2 of 7 `journeys` jobs failed at the setup step (`Failed to resolve latest Supabase CLI release: rate limit exceeded`) in ~15s. The other 5 got through and passed. Fix this run: `rerun_failed_jobs` on the 2 failed runs (re-runs land on fresh runner budget and pass). Can't pin the CLI version (would edit `.github/`, forbidden). For next runs: expect occasional setup-step flakes on `journeys` when many PRs land together; re-run the failed job rather than assume a real failure.
2. **`journeys` IS a required check** (PR sits `mergeable_state: blocked` until it's green) — distinct from `verify`/`build`/`mobile`. A transient setup-step failure there blocks auto-merge even though all other gates pass; must be re-run to clear.
3. **The re-run `journeys` job is slower** (~7 min vs ~4): a re-run re-does ephemeral Supabase start + migrations (~2 min) before build + the playwright journeys. Budget the wait accordingly.
4. **Restore both lockfiles after a cold `npm install`** (root + `mobile/package-lock.json`) before each commit — the mobile install churns its lockfile too (Run 44 lesson #4, re-confirmed; `git checkout <base> -- package-lock.json mobile/package-lock.json`).
5. **Privacy-page processor list + brand/domain are NOT loop-fixable this run.** Scout re-confirmed the privacy page is now correct (Gemini + DeepSeek only; #208 holds). The .com/.ai/.app domain + AptDesigner/AptDesignerAI brand split is genuinely owner-gated (already in PENDING_OPS `reconcile-canonical-domain`); reconciling it would invent a canonical decision — left alone.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 48.**
- **Highest-value queued, file-disjoint:**
  - **business_case_strength (ship-critical B)** — extend the new `UpgradeCtaCard` to a second high-intent surface (e.g. a graceful 403→paywall modal when a free user hits the save limit from the focus/dashboard flow — needs touching the giant pages, so do it on an F7 served-app-visual run); re-ground the 50%→35-40% organic-share input in the business case.
  - **tests_evals (lib/agents ~21%)** — more untested mockable single-call agents remain: `mockup-prompt-validator`, `floor-plan-extractor`, `product-identifier`, `furniture-cropper`, `mockup-verifier`, `room-architecture-extractor` (image+structured; mock the provider). The 4 named Run-44 candidates are now 3-done (req/cat/corr); `mockup-prompt-validator` is the remaining one.
  - **performance** — embedding-index pgvector RPC + migration (needs Supabase MCP / live-DB verification — do on a live-DB run); `next/image` adoption + a perf/bundle budget (no Lighthouse gate exists).
  - **correctness (minor)** — `search/stream` has the same insert-then-status twin-write pattern as evaluate-set (#233) — apply the same guard; `diagnosis/stream` minor non-fatal status logs.
- **Human-gated (unchanged):** apply migrations (incl. 026 + 027); A5/F3 eval CI job (RUN_EVALS key); F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; all live secrets; SITE_GATE_PASSWORD; canonical-domain decision (.com vs .ai vs .app).
- **Readiness:** still blocked — QUALITY_SCORECARD overall C, ship_gate_met:false, multiple DoD boxes unchecked/human-gated. Did NOT attempt the ready issue.

---

## DEEP AUDIT 2026-06-30 (Run 44) — holistic, 8 read-only Haiku lenses across the whole codebase

Due this run (last ran Run 40). Findings distilled + prioritized (→ what became this run's work):
- **Security/RLS: CLEAN.** Re-audited all migrations 001–025: every public table has correct RLS (tenant on `auth.uid()`; shared/internal RLS-on-no-policy), secrets env-only, admin client used only on service-role tables behind auth gates, SECURITY DEFINER search_path pinned (024), spend/rate guards on paid LLM endpoints. No findings — a clean no-op, the right outcome.
- **Correctness: 2 real bugs → FIXED.** (a) `extractFromImage` LLM call missing `seed: DETERMINISTIC_SEED` (determinism gap the harness-ratchet misses) → PR #222. (b) `apartment-research` `projects.update()` ignored the in-band `{error}` → fake-200 + lost research → PR #223. The scout's `waitlist/confirm` "unchecked update" finding was a FALSE POSITIVE (the code already checks `error || !data || data.length === 0`); `diagnosis/stream` status-flip is a minor non-fatal log (deferred).
- **Mobile: real gap → FIXED.** `results.tsx` upload+analyze fetches had no AbortController → indefinite-spinner dead-end → PR #224 (`fetchWithTimeout`). Also queued: `photo.tsx` `getPendingResultAsync` has no `.catch`; mobile back-button a11y labels (minor).
- **Business-case lever: BUILT.** Scorecard `business_case_strength` (ship-critical B) names referral + expansion as listed-not-built. Built the **waitlist referral loop** (PR #226) as the most verifiable + pre-launch-appropriate slice. The web in-app upsell/paywall surface is DEFERRED to a run with served-app visual verification (touching the 1653-line focus page + 898-line dashboard cold is risky without F7).
- **Store/compliance: real gap → FIXED.** CAN-SPAM opt-out: lifecycle emails linked to /account but no store/UI/gating → PR #227. Privacy-page processor list re-verified CORRECT (PR #208 holds). Domain drift (.com/.ai/aptdesigner.ai) remains owner-gated. README missing secondary processors = minor, deferred.
- **Performance: mostly deferred.** embedding-index full-table-scan (needs a pgvector RPC + LIVE-DB verification → can't verify cold, deferred again); next/image + perf budget + serial-await micro-opts are real-but-modest; the area-analysis grounding pair was already parallelized (#213). No shippable-cold high-value perf this run.
- **A11y/design: mostly over-flagged churn** (hardcoded landing-page swatch colors, icon-button aria-label-where-title-exists, framer reduced-motion) — consistent with prior-run adjudications; the one genuine small a11y win (share-button copy aria-live) was folded into the referral share card instead.
- **Tests/eval: lib/agents ~21%.** Closed `area-analysis-validator` (722-line deterministic core patcher) → PR #225, 11 branch tests. NOTE: the test scout wrongly reported `material-math` + `ergonomics` as untested — BOTH already have test files; always verify "untested" claims with a file check before writing.

DUAL-AXIS VISION VERDICT (F7): not performed — F7 screenshot artifacts still not built (depends on F4 served-app wiring, human-gated). No screenshots to judge yet.

---

## Run 2026-06-30 (Run 44) — 6 disjoint changes (referral lever + CAN-SPAM compliance + 2 correctness + mobile reliability + agent test)

### State on entry
- Cold container at default tip `77280ee` (post Run 43 #213–216 + owner/loop-health commits #217–221). `npm install` (root + mobile); reset to `origin/<default>`. Baseline gate green: tsc clean, **1208 tests** pass / 8 skipped, determinism clean, eslint 0.
- **DEEP AUDIT due** (last Run 40) → ran it first (8 Haiku lenses; summary above). QUALITY_SCORECARD as_of 2026-06-29 overall C / ship_gate_met:false — but several of its top_gaps were ALREADY closed by Runs 42–43 (maxDuration, G1 spend guards, privacy page, 404, serial grounding); this run worked the remaining real, loop-buildable, file-disjoint gaps + audit findings.

### What was done (6 file-disjoint changes, all merged #222–227)
- **#226 referral loop** (business_case_strength lever) — migration 026 + `lib/waitlist/referral.ts` + `/api/waitlist` + waitlist form share card. 6 helper tests.
- **#227 CAN-SPAM opt-out** (store_readiness) — migration 027 `user_email_preferences` + `isMarketingOptedOut()` (fail-closed) + `/api/user/email-preferences` + /account `role=switch` + gated win-back/activation sends. 5 helper tests.
- **#222 determinism** — `extractFromImage` seed. **#223 correctness** — apartment-research write-error surfaced. **#224 mobile** — upload/analyze fetch timeouts. **#225 tests** — area-analysis-validator (11 branch tests).
- 12 per-change Sonnet reviewers + 3 re-reviewers (3 changes hit REQUEST_CHANGES, all resolved in-cap). 8 Haiku audit scouts. Migrations 026+027 human-applied (PENDING_OPS).

### Lessons learned
1. **Re-reviewers reading a single isolated diff false-flag cross-branch facts.** Email-prefs Reviewer B called "migration 027 skips 026" a defect — but 026 is the sibling referral migration shipping the SAME run (consecutive per the disjoint-rule numbering convention). When two changes each add a migration, expect an isolated reviewer to flag the "gap"; keep the numbering, don't renumber into a collision.
2. **The "blocking: add a PENDING_OPS entry for the migration" review ask is satisfied by PROCESS, not the code branch.** All shared-ledger edits (PENDING_OPS/ROADMAP/etc.) go in the ONE bookkeeping PR; adding them to a code branch violates the disjoint rule and collides the two migration PRs. Tell re-reviewers this explicitly.
3. **Verify "untested module" scout claims before writing the test.** The test scout listed `material-math` + `ergonomics` as untested; both already had test files. A 2-second `ls __tests__/...` saved writing a duplicate. (Pivoted to `area-analysis-validator`, genuinely untested.)
4. **`git add -A` after a cold `npm install` sweeps a `package-lock.json` "dev":true churn line into the first commit.** Two reviewers flagged it as noise. Restore the lockfile from base (`git checkout <base> -- package-lock.json`) before committing, or scope `git add` to the intended files.
5. **A real correctness bug surfaced via adversarial review of an astronomically-improbable path:** the referral collision-retry could, after 3 collisions, fall through to the email-duplicate handler and tell a never-inserted user "already subscribed". Probability ~0, but a wrong code path — fixed with a post-loop 500 guard. Adversarial reviewers earn their keep on the tail.

### Rotation guide for next run
- **DEEP AUDIT done Run 44** → next due ~Run 48.
- **Highest-value queued, file-disjoint:**
  - **business_case_strength (ship-critical B)** — the **in-app web upsell / paywall surface** (web parity with the proven mobile paywall): graceful structured 402 on the saved-designs limit + a reusable `PaywallCard` + a dashboard upgrade CTA. DEFERRED this run because it touches the 1653-line focus page + 898-line dashboard cold; do it on a run with F7 served-app visual verification, or scope to the server-402 + card first.
  - **tests_evals** — more mockable single-LLM-call agents: `category-planner`, `requirement-validator`, `correction-planner`, `mockup-prompt-validator` (provider-mocked, like product-extractor). lib/agents still ~21%.
  - **performance** — embedding-index pgvector RPC + migration (needs Supabase MCP / live-DB verification before shipping — do it on a live-DB run); `next/image` adoption + a perf/bundle budget (no Lighthouse gate exists).
  - **correctness (minor)** — mobile `photo.tsx` `getPendingResultAsync` `.catch`; `diagnosis/stream` non-fatal status-flip log.
- **Human-gated (unchanged):** apply migrations (now incl. 026 + 027); A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; all live secrets; set SITE_GATE_PASSWORD; canonical-domain decision (.com vs .ai).
- **Readiness:** still blocked — QUALITY_SCORECARD overall C, ship_gate_met:false, multiple DoD boxes unchecked. Did NOT attempt the ready issue.

---

## Run 2026-06-29 (Run 43) — 4 disjoint changes (perf + reliability + 2× F2 LLM-core tests)

### State on entry
- Cold container at default tip `637e18e` (post Run 42 #206–212). `npm install` (root); reset working branch to `origin/<default>`. Baseline gate green: tsc clean, **1187 tests** pass / 8 skipped (RUN_EVALS-gated), determinism clean, eslint 0.
- **DEEP AUDIT not due** (last Run 40; next ~Run 44).
- Used the independent **QUALITY_SCORECARD (#198, overall C, ship_gate_met:false, dated today)** as the vetted candidate pool again (Run 42 lesson). Run 42 had already taken 6 of its gaps (maxDuration #206, G1 #207, privacy #208, 404 #210, search-stream #209, a test #211); this run worked the REMAINING top_gaps. No 8-scout sweep (the dated, file-precise scorecard is the feed).

### What was done (4 file-disjoint changes — #213/#214/#215 merged, #216 auto-merge queued gate-green)
- **#213 performance** — `app/api/area-analysis/route.ts`: the two photo-grounding LLM calls (`verifyWhatShouldGoAgainstPhotos` for `what_should_go`, `verifyWhatWorksAgainstPhotos` for `what_works`) ran serially though they write distinct fields with no cross-dependency → `Promise.all`, results applied in fixed order. ~2× this stage's latency on the core paid path. Closes the scorecard `performance` top_gap (serial grounding calls).
- **#214 reliability** — `area-analysis/refine-chat` POST re-runs the full 3–5 min `runAnalysis` pipeline but had no `maxDuration` (the one heavy route #206 missed) → `export const maxDuration = 300`. Closes the scorecard `correctness` gap on that route.
- **#215 / #216 tests (F2 / scorecard tests_evals critical gap, lib/agents ~21%)** — `whatitneeds-enricher.test.ts` (12: pure `hasSpecificity` truth table + `enrichWhatItNeeds` branches) and `product-extractor.test.ts` (7: `extractFromImage` parse/validate/fail-soft + room-photo order/cap; `extractFromUrlBatch([])` short-circuit).
- 8 per-change Sonnet reviewers + 1 re-reviewer. 7 of 8 APPROVE first pass; product-extractor Reviewer A REQUEST_CHANGES (1 vacuous assertion) → fixed + re-reviewed APPROVE in-cap. No new migrations or secrets → PENDING_OPS unchanged.

### Deselected at SELECTION (not abandoned mid-build)
- **embedding-index pgvector RPC + migration** (scorecard `performance`: `topKSimilar` full-table `select('*')`, ivfflat index unused) — DEFERRED: a pgvector RPC cannot be runtime-verified cold (no live DB), the value is latent pre-catalog-seed, and it is `ship_critical:false`. Shipping an unverifiable DB function violates BUILDS≠WORKS. Do it on a run where Supabase MCP can verify against the live DB.
- **toast aria-live** (scorecard `design_taste`) — DROPPED as a false flag: the toast is built on Radix `ToastPrimitive`, which announces via its built-in Provider aria-live region; manual aria-live risks double-announcement. (Confirms Run 42's adjudication.)
- **maxDuration on `rooms/[roomId]/diagnosis`** — DROPPED: that route is a plain DB GET (no LLM, no long work), so it needs no maxDuration. The rotation-guide mention conflated it with the diagnosis *pipeline*.

### Lessons learned
1. **When asserting "no external call on a short-circuit", mock the collaborator the function ACTUALLY calls.** Reviewer A correctly rejected `extractFromUrlBatch([])`'s `expect(geminiProvider.chat).not.toHaveBeenCalled()` — that path uses `getProvider("extraction").chat` + `tavilyExtract`, so the assertion passed regardless of the guard (vacuous). Fix: assert `results.size===0` + `tavilyExtract` not called. Grep which provider/dependency a function reaches before writing a "not called" assertion.
2. **Per-change reviewer subagents run `vitest`/`tsc` in the SHARED working tree and can re-stage files mid-run.** While the 8 reviewers ran, the grounding branch's working tree kept showing staged copies of the two test files (committed safely on their own branches). Clean the working tree only AFTER all reviewers finish, or a hard-reset just races them. Tell re-reviewers explicitly "do NOT switch git branches / modify files — review only."
3. **`AgentResult<T>` is NOT a discriminated union** (`success: boolean; data?: T`), so `if (!result.success) throw` does NOT narrow `result.data`. Guard `if (!result.success || !result.data) throw` to access data in tests. (tsc caught it; fixed before CI.)
4. **The scorecard-as-feed split cleanly across two runs.** Run 42 took 6 gaps; Run 43 took the remaining performance/correctness/tests gaps. A dated, file-precise independent scorecard is a better candidate pool than re-discovering with scouts — but VERIFY each gap at the source first (the pgvector + toast gaps were correctly deferred/dropped after source inspection).

### NEW code finding for next run (real, queue it)
- **`extractFromImage` (lib/agents/product-extractor.ts ~L726) omits `seed: DETERMINISTIC_SEED`** while the sibling `extractFromUrlBatch` LLM calls pass it — a real determinism-contract gap the harness-ratchet does NOT catch (it only checks `thinkingConfig`). 1-line fix + add `expect(mockChat.mock.calls[0][0]).toHaveProperty("seed")` to the success test. (Surfaced by product-extractor Reviewer A.)

### Rotation guide for next run
- **DEEP AUDIT due ~Run 44** (last Run 40) — run the full read-only sweep before scouting.
- **Highest-value queued, file-disjoint:**
  - **correctness** — the `extractFromImage` missing-seed fix above (1 line + test assertion).
  - **performance** — embedding-index pgvector RPC + migration: needs LIVE-DB verification (Supabase MCP) before shipping; also the two `area-analysis/route.ts` grounding calls are now parallel (done #213), so the remaining perf there is none — move on to `next/image` adoption + a perf budget (no Lighthouse/bundle gate exists).
  - **business_case_strength (ship-critical, B)** — referral mechanic + an expansion/upsell in-app surface are listed-not-built; re-ground the 50%-organic-share input. Meaty feature work — give it a focused run.
  - **tests_evals** — more mockable-agent tests (category-planner, requirement-validator, mockup-prompt-validator, correction-planner — all single-LLM-call + schema, like this run's two); RUN_EVALS=1 CI job still human-gated.
  - **design** — a11y axe on ≥1 authed route (needs the E2E auth stack); commit baseline screenshots (F7, needs a served app).
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; all live secrets; set `SITE_GATE_PASSWORD`; decide the canonical domain (`.com` vs `.ai`) + reconcile `mobile/app.json` associatedDomains + `lib/email` from-address.
- **Readiness:** still blocked — QUALITY_SCORECARD overall C, ship_gate_met:false, multiple DoD boxes unchecked. Did NOT attempt the ready issue.

---

## Run 2026-06-29 (Run 42) — 6 disjoint changes (correctness + security G1 + store-compliance + design + reliability + F2 test)

### State on entry
- Cold container; local working branch had DIVERGED from origin (50/50) — `git reset --hard origin/<default>` to recover, then `npm install` (root). Baseline gate green: tsc clean, **1183 tests** pass / 8 skipped (RUN_EVALS-gated), eslint 0.
- **DEEP AUDIT not due** (last Run 40; next ~Run 44).
- **First real QUALITY_SCORECARD landed (#198, overall C, ship_gate_met:false).** Used its `top_gaps` as the independently-vetted candidate pool and verified each gap directly against the code, rather than re-running the 8 Haiku scouts to rediscover what the fresh independent audit already surfaced (spend discipline; the scorecard is dated today and is file-precise). All 8 top_gaps confirmed real.

### What was done (6 file-disjoint changes, all merged #206–211)
- **#206 correctness/reliability** — `export const maxDuration = 300` on the 9 heavy LLM routes (none had one → Vercel short-default kills the 3–5 min pipeline mid-run). Scorecard high-severity correctness gap.
- **#207 security/G1** — rate-limit + daily-spend guards on `products/evaluate` + `evaluate-set` (the last two unguarded paid-LLM endpoints; evaluate-set fans out many LLM calls). Reviewer A confirmed all three scoreProduct/evaluateBundle routes now gated.
- **#208 store-readiness** — privacy page falsely named Anthropic/OpenAI as photo processors; corrected to the real ones (Gemini + DeepSeek), matching the already-correct docs/app-privacy.md. (Did NOT touch the owner-gated domain decision.)
- **#210 design** — `app/not-found.tsx` design-system 404 (was Next default template). Mirrors app/error.tsx tokens/components.
- **#209 reliability** — search/stream double-close (`!result.success` branch close + `finally` close → throw in finally) fixed with the #191 `streamClosed`/`closeStream` latch; +maxDuration here (disjoint from #206).
- **#211 F2 test** — refine-summarizer provider-mocked suite (token-sum, slim()/low-thinking prompt, empty-text + error fallbacks) for the ~21%-covered lib/agents core.
- 12 Sonnet reviewers (2/change), all APPROVE first pass. No scout sweep this run (scorecard served as the vetted candidate pool). **No new migrations or secrets** → PENDING_OPS unchanged.

### Lessons learned
1. **A fresh independent QUALITY_SCORECARD IS the scouting feed.** When the scorecard is dated today, file-precise, and lists 8 verified `top_gaps`, re-running 8 Haiku discovery scouts is redundant spend — verify each gap directly and build. (Deep audit still runs on its own ~4-run cadence for the holistic lens.)
2. **The disjoint rule split maxDuration cleanly across two PRs.** search/stream needed both the double-close fix (#209) and maxDuration; rather than collide with the 9-route maxDuration PR (#206), maxDuration for search/stream rode along in #209. Every heavy route still got covered, zero file overlap.
3. **Local branch can silently diverge from origin on a cold start** (saw 50/50). Always `git reset --hard origin/<default>` before trusting `git log`/test counts — a stale tip wastes a cycle (Loop-4 hill-climb note, reaffirmed).
4. **maxDuration was a latent "builds-green, killed-in-prod" ship blocker.** grep for maxDuration was 0 repo-wide while the core pipeline is documented at 3–5 min; no test catches it because it only manifests under the Vercel serverless budget. Classic BUILDS≠WORKS — the kind of gap the functional-reality lens exists for.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 44** (last Run 40).
- **Remaining QUALITY_SCORECARD top_gaps NOT yet taken (file-disjoint, high-value):**
  - **performance** — `lib/store/embedding-index.ts` topKSimilar does a full-table `select('*')` (N scans per identify, ivfflat pgvector index unused) → needs a pgvector RPC + migration; AND the two photo-grounding LLM calls in area-analysis/route.ts:961,976 run serially though independent (Promise.all → ~2× stage latency). NOTE: the grounding fix collides with area-analysis/route.ts — sequence after any change on that file.
  - **business_case_strength (ship-critical)** — referral mechanic + an expansion/upsell in-app surface are listed-not-built; re-ground the 50%-organic-share input. Meaty feature work — give it a focused run.
  - **tests_evals** — RUN_EVALS=1 CI job is human-gated; locally vendor gold images + a real refine eval; lib/agents still ~21% (more mockable-agent tests: room-diagnostician, product-extractor, shopping-researcher, post-search-coordinator, correction-planner).
  - **design** — toast has NO aria-live BUT Radix Toast already announces via its Provider region (adjudicate before building — likely a false flag); a11y axe coverage on ≥1 authed route (needs E2E auth stack); commit baseline screenshots (F7, needs a served app).
  - **correctness** — maxDuration not yet on the lighter `area-analysis/refine-chat` route or `rooms/[roomId]/diagnosis` (reviewer-noted, lower priority).
- **G1 NOT ticked** — the scorecard's specific G1 gap (the two evaluate routes) is now closed, but the ROADMAP G1 box covers the WHOLE endpoint surface; leave it for the next independent re-grade to confirm.
- **Readiness:** still blocked — QUALITY_SCORECARD overall C, ship_gate_met:false, multiple DoD boxes unchecked. Did NOT attempt the ready issue.

---

## Run 2026-06-29 (Run 41) — 6 disjoint changes (correctness + reliability + 2× F2 tests + 2× a11y)

### State on entry
- Cold container at default tip `93cac2d` (post Run 40 #183–188 + the journey-gate CI commits + Growth Agent #189/#190). `npm install` (root + mobile); reset working branch to `origin/<default>`. Baseline gate green: tsc clean, **1164 tests**, determinism clean, eslint 0.
- DEEP AUDIT **not due** (ran Run 40; next ~Run 44). QUALITY_SCORECARD still all-null → readiness gate cannot pass; did NOT attempt the ready issue.
- 7-scout Haiku sweep (tests/F2, reliability, mobile, security/RLS, perf, web-a11y, correctness). Security scout = **CLEAN** through migration 025 (expected no-op).

### What was done (6 file-disjoint changes, all merged #191–196)
- **#195 correctness** — surfaced 4 unchecked supabase-js writes on core paths (errors returned in-band, not thrown): fatal `room_diagnoses` inserts in area-analysis POST + refine now 500 + mark the run failed (were faking 200 with data that vanished on reload); search completion-path `Promise.all` batches + bundles status-flip now log. Same class as #185.
- **#191 reliability** — diagnosis SSE `sendEvent` had no closed-controller guard → a client disconnect produced a triple-throw (enqueue, then `sendEvent("error")` in the catch, then `controller.close()`), uncaught + un-finalized run. Added a `streamClosed` latch + idempotent `closeStream()` (search/stream precedent).
- **#196 / #194 F2 tests** — `search-cache.test.ts` (10: LRU/TTL/key/bypass) + `harmony-math.test.ts` (9: orchestrator aggregation + lighting + cross-room gating + formatting).
- **#192 web a11y** — dashboard map iframes given accessible `title`s (WCAG 4.1.2).
- **#193 mobile a11y** — photo-picker preview Pressable given `accessibilityRole`/`accessibilityLabel`.
- 12 per-change Sonnet reviewers + 1 re-reviewer; 7 Haiku scouts (20 subagents). 5 of 6 APPROVE first pass; search-cache needed 1 re-review cycle (in-cap).

### Lessons learned
1. **Perf candidates collided with higher-value correctness on the SAME files — correctness won cleanly via the disjoint rule.** The perf scout proposed parallelizing `area-analysis/refine` fetches and trimming `area-analysis` POST `select("*")`; the correctness scout found unchecked inserts in those exact two files. One change per file → took the data-loss fixes, dropped the modest (35–50ms) perf + the risky `select("*")` trim. The disjoint rule is the tiebreaker, not a constraint to work around.
2. **supabase-js mutation errors are in-band on inserts/updates too, not just `.single()`.** An unchecked `.insert()`/`.update()` does NOT throw on a DB error — it resolves `{ error }` which, if ignored, yields fake success (200 + lost write). Confirmed by tracing: the area-analysis insert sits inside the outer try, but since it doesn't throw, the catch never fires and the route returns the result. Fix mirrors the diagnosis/stream save-error precedent (mark run failed + surface a 500), not a try/catch.
3. **FATAL-vs-LOG severity split keeps the correctness fix honest without wasting compute.** Data-loss inserts (diagnosis/refinement) fail with a 500 so the user retries; non-fatal completion-path writes (status flips, already-persisted results) log-and-continue so an expensive computed result isn't thrown away. Reviewers explicitly validated this distinction.
4. **A test that mocks a module-level `const` must restore it in teardown, not `vi.doUnmock`.** The search-cache bypass test set `DETERMINISTIC=true` then `vi.doUnmock`'d — which drops the mock entirely, so a reordered run could leak the real flag (true in CI) into the other 9 tests. Reviewer A caught it; fix = an `afterEach` that re-`doMock`s `false` + `resetModules`. `doUnmock` ≠ restore.
5. **Haiku a11y scouts still over-flag — adjudicate before building.** The web-a11y scout flagged a theme-toggle "missing aria-label", but it already has `title` (a valid accessible name on a `<button>`), so it was dropped as borderline/churn; only the genuine no-accessible-name violation (iframes with no `title` at all) was built. Same discipline as Run 40 lesson 1.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 44** (last ran Run 40).
- **Highest-value queued, file-disjoint (validated this run, not taken):**
  - **Mockable-agent tests** — `room-diagnostician.ts`, `product-extractor.ts`, `shopping-researcher.ts`, `design-coordinator.ts`, `post-search-coordinator.ts` (provider-mocked; the tests scout mapped branch counts). Pure modules still open: none major left (harmony-math, search-cache, proportion-math, lookups, spatial-math now covered).
  - **Reliability** — `app/api/search/stream/route.ts` has the SAME triple-throw shape as the diagnosis stream just fixed (raw `controller.close()` after a `send("error")` that can throw on disconnect) — apply the identical `streamClosed`/`closeStream` guard. Webhook email-failure audit table (needs a migration + RLS).
  - **Perf (borderline, standalone only)** — `area-analysis/refine` fetch parallelization (~35–50ms) now unblocked (correctness landed on that file this run); `area-analysis` POST `select("*")` trim only if the consumed-fields claim is re-verified.
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; all live secrets; set `SITE_GATE_PASSWORD`; decide the canonical domain (`.com` vs `.ai`) + reconcile `mobile/app.json` associatedDomains + `lib/email` from-address.
- **Readiness:** still blocked — QUALITY_SCORECARD all-null + many DoD boxes unchecked. Do NOT attempt the ready issue.

---

## DEEP AUDIT 2026-06-29 (Run 40) — holistic, 8 read-only Haiku lenses across the whole codebase

Due this run (last ran Run 36). Findings distilled + prioritized (→ what became this run's work):
- **Security/RLS: CLEAN.** Re-audited every migration (001–025): every public table has correct RLS
  (tenant on `auth.uid()`; shared/internal RLS-on-no-policy). Secrets all env-read; admin client used only
  on service-role tables behind auth gates; SECURITY DEFINER search_path pinned (024); error hygiene holds
  (no raw DB errors to clients). No findings — a clean no-op, the right outcome.
- **Mobile/store (Track D): real gaps → BUILT.** (a) No in-app account deletion — Apple 5.1.1(v) REQUIRES it;
  the web `/api/user/delete` is cookie-based, unreachable from mobile → built Bearer endpoint + Settings screen
  (PR #186). (b) Paywall Terms/Privacy were plain text (App Store/Play require accessible legal at purchase) →
  tappable in-app-browser links + a11y (PR #187). Deferred (queued): quota-constant naming unification across
  mobile/web/server; restore-purchases should refresh entitlements; paywall fallback-pricing guard.
- **Correctness: one real bug → FIXED.** `POST /api/bundles` items-insert had no error check → silent empty
  bundle (PR #185). The audit's `.single()`→`.maybeSingle()` finding on products/evaluate + bundles/evaluate
  was OVERSTATED — supabase-js `.single()` returns the error in-band (no throw) and the code already uses
  `diagnosis?.…` optional chaining, so it does NOT 500; dropped as churn. Stream backpressure guard + webhook
  email-failure audit table = real-but-lower-priority, queued.
- **Tests/F2: math-module gaps → 2 closed.** Added `proportion-math.test.ts` (#184) + `lookups.test.ts` (#183).
  Still queued (pure, deterministic, headless): `harmony-math.ts`, `search-cache.ts`; mockable agents
  (orchestrator, room-diagnostician, design-coordinator, shopping-researcher, product-extractor); route-level tests.
- **AI pipeline / cost contract: one finding was a TRAP — correctly REJECTED.** Audit flagged "Gemini context
  caches not bypassed under DETERMINISTIC." But `DETERMINISTIC = process.env.DETERMINISTIC_MODE !== "false"`
  defaults to TRUE, so bypassing caches under it would DISABLE context caching in normal production = a real
  COST-CONTRACT regression; and context caches return identical content (no output non-determinism — distinct
  from the semantic/embedding caches the determinism rule targets). Did NOT change it. thinkingConfig/seed/HIGH
  usage/timeouts/sort-tiebreakers all CLEAN.
- **Artifact freshness: one real owner-decision drift.** Canonical domain is inconsistent: code defaults +
  store-listing + privacy docs use `aptdesignerai.com` (dominant), but `mobile/app.json` associatedDomains use
  `aptdesignerai.ai` and `lib/email` from-address uses `aptdesigner.ai`. Universal Links + email deliverability
  silently break if the registered domain ≠ the configured one. Did NOT guess-edit (needs the owner to confirm
  which domain is registered) → recorded as an OWNER_ACTION in PENDING_OPS. Pricing/privacy/ARCHITECTURE = CLEAN
  (BUSINESS_CASE_SUMMARY parses, arr_year1.base 122900 matches body).
- **Perf: borderline.** Completion-path DB-write parallelization (diagnosis/analyze-apartment/bundles-evaluate,
  ~50ms each) + GET payload trims (analyze-apartment/area-analysis fetch `room_*(*)` but return a computed summary
  — server-side-only trim, safe). All real but modest; deferred as not the highest-value disjoint work this run.
- **A11y/design: minor.** Mobile `themed-text` `linkPrimary` hardcodes `#3c87f7` (off warm-editorial brand, used
  only in +not-found); web `badge` amber-100/800 ~4.2:1 borderline AA. Both small; deferred (avoid churn).

DUAL-AXIS VISION VERDICT (F7): not performed this run — F7 screenshot artifacts are not yet built (F7 still `[ ]`,
depends on F4 wiring which is human-gated). No screenshots to judge yet; recorded so the next audit knows.

---

## Run 2026-06-29 (Run 40) — DEEP AUDIT + 5 disjoint changes (Track D store readiness + correctness + F2 tests)

### State on entry
- Cold container at default tip `3d07e03`; `npm install` (root + mobile). During the run the remote default
  advanced (`e13d114` rate-limiter fail-closed bypass, then `#182`/`487483f` made **lint + journeys REQUIRED CI
  checks**) — re-based the working base to the latest each time. Baseline gate green: tsc, **1131 tests**,
  determinism, eslint 0.
- DEEP AUDIT due (last Run 36) → ran it first (8 Haiku lenses). QUALITY_SCORECARD still all-null → readiness
  gate cannot pass; did NOT attempt the ready issue.

### What was done (5 file-disjoint changes, all merged #183–187)
- **#186 Track D** — mobile in-app account deletion (Apple 5.1.1(v)) + Settings screen + Bearer `DELETE /api/mobile/account`.
- **#187 Track D** — mobile paywall tappable Terms/Privacy (in-app browser) + a11y + honest trial copy.
- **#185 correctness** — bundles items-insert silent-failure fix.
- **#184 / #183 F2 tests** — proportion-math (13) + lookups (20).
- 10 per-change Sonnet reviewers + 4 re-reviewers; 8 Haiku audit scouts. 4 of 5 needed a 2nd review cycle (all
  resolved in-cap). Gate green on merged default.

### Lessons learned
1. **Verify audit findings against the source before building — three of the eight lenses produced plausible-but-wrong
   findings.** (a) The "cache-bypass under DETERMINISTIC" was a cost-contract TRAP (DETERMINISTIC defaults true →
   would kill prod context caching). (b) `.single()`→`.maybeSingle()` "500" was wrong (supabase-js returns the error
   in-band, code already null-safe). (c) app.json `privacy` "URL" field doesn't exist (privacy URLs live in App Store
   Connect / Play Console, not app.json). Haiku audit lenses are great at SURFACING; Opus must adjudicate before coding.
2. **Mobile cannot call cookie-based web routes.** `/api/user/delete` uses `createClient()`+`getUser()` (cookies);
   mobile sends a Bearer token. A mobile delete needs its own Bearer-authed endpoint (mirror `/api/mobile/saved-designs`:
   parse `Authorization`, `anonClient.auth.getUser(token)`, resolve the id from the JWT — never client-supplied).
3. **Reviewers reading the on-disk file can false-positive on branch state.** A reviewer claimed the `index.tsx` entry
   point "wasn't applied" — but it was committed on the branch; the working tree just happened to be on a different
   branch. The DIFF is authoritative; verify with `git show <branch>:<file>` before acting on such a claim.
4. **Per-change reviewers are still worth it on tests.** Reviewer A caught a category-key mismatch
   (`"coffee table"` vs `"coffee_table"`) that made two rug tests pass for the wrong reason (the extension branch never
   fired). Fixed to the real key + honest expected values. Tests can be green and still not exercise the branch they claim.
5. **`expo lint` flags duplicate same-module imports as warnings** (`import/no-duplicates`). When editing an import
   block, consolidate split imports from the same path — clears warnings within the change's own scope (F1).
6. **In-app browser, not `Linking.openURL`, for mobile external links** — the repo has `ExternalLink`/`openBrowserAsync`
   (expo-web-browser) precisely so taps don't eject the user to Safari mid-flow. Reviewers enforce this.

### Rotation guide for next run
- **DEEP AUDIT done Run 40** → next due ~Run 44.
- **Highest-value queued, file-disjoint (from this audit):**
  - **Math/agent tests** — `harmony-math.test.ts`, `search-cache.test.ts` (pure, like this run); then mockable agents
    (orchestrator, room-diagnostician, design-coordinator, shopping-researcher, product-extractor) + route-level tests.
  - **Mobile polish (Track D/C)** — unify the free-save-limit constant naming across mobile/web/server; restore-purchases
    → refresh entitlements; paywall fallback-pricing guard. (Each touches `paywall-sheet.tsx`/`results.tsx`/entitlements —
    watch disjointness.)
  - **Reliability** — diagnosis/stream `controller.enqueue` backpressure guard + ensure `completeAgentRun` on all paths;
    webhook email-failure audit table.
  - **Perf (borderline, standalone only)** — analyze-apartment/area-analysis GET payload trims (server-side-only, safe).
- **Human-gated (unchanged):** apply migrations; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys;
  EAS init/projectId + Apple/Play accounts; all live secrets; set `SITE_GATE_PASSWORD`. **NEW: decide the canonical domain
  (`aptdesignerai.com` vs `.ai`) and reconcile `mobile/app.json` associatedDomains + `lib/email` from-address — see PENDING_OPS.**
- **Readiness:** still blocked — QUALITY_SCORECARD all-null + many DoD boxes unchecked. Do NOT attempt the ready issue.

---

## SYNC 2026-06-28 — staged auto-migrate-on-deploy (kill recurring "apply migrations" toil)
- **Why:** migrations were hand-applied every time the factory adds one (recurring owner step). Staged a `migrate` CI job (in docs/ci/PROPOSED_CI.md) that runs `supabase db push` post-merge, default-branch-only, after verify+build pass — forward-only, never reset.
- **Safety rails baked in (auto-applying to prod is the risk the manual step avoided):** default-branch + post-gate only; migrations still go through the 2-reviewer + RLS gate pre-merge; recommended owner net = Supabase PITR/backups before enabling. Tradeoff (removes the human schema checkpoint) is stated in the doc + the OWNER_ACTION so the owner applies it consciously.
- **Owner one-time:** 3 GitHub secrets (SUPABASE_ACCESS_TOKEN/PROJECT_REF/DB_PASSWORD) + enable PITR + apply the job (workflow scope). Then migrations self-apply forever. Tracked: OWNER_ACTION `auto-migrate-on-deploy` (normal, optional).
- **Lesson:** the loop can stage even the deploy-time DB automation; the irreducible owner part shrinks to "set 3 secrets + apply 1 workflow, once." Still can't touch .github/ (headless permission prompt) — staged, human-applies.

---

## SYNC 2026-06-28 — enforce loop gates as REQUIRED CI checks (staged; .github/ is human-applied)
- **Gap (harness proposal "gates not enforced in CI"):** only verify/build/mobile are required checks; the functional JOURNEY suite (BUILDS≠WORKS) + lint are NOT — so a broken-for-a-user or lint-dirty change can auto-merge.
- **Did (product side, mine):** added a TEST-ONLY rate-limit bypass `rateLimitBypassedForTest()` (gated on `E2E_RATE_LIMIT_BYPASS`, which PROD NEVER sets; logs loud if set) into `lib/utils/rate-limiter.ts` + the signup + waitlist inline limiters — so the self-seeding journey suite from one CI IP doesn't trip per-IP limits. Prereqs already existed (journey suite + ROUTE_INVENTORY + run-journeys.sh + lint F1).
- **Staged (human-applies, can't touch .github/):** `docs/ci/PROPOSED_CI.md` — exact `lint` + `journeys` GitHub Actions jobs (supabase start → db reset → build → start :3100 → run-journeys.sh + lint) + the branch-protection required-checks list + the two gotchas: (a) set localhost base-URL env so auth redirect resolves (Supabase: NEXT_PUBLIC_SITE_URL/PLAYWRIGHT_BASE_URL; next-auth: AUTH_TRUST_HOST/AUTH_URL); (b) `E2E_RATE_LIMIT_BYPASS=1` only in the journeys job. + VERIFY-GREEN-BEFORE-REQUIRING (never make a flaky check required).
- **Tracked:** OWNER_ACTION `enforce-ci-required-checks` (high) + LOOP_HEALTH `harness_proposals_open: 1` + a `loop: harness improvement proposal` issue (the META channel — the only way the loop's CI/rules improve, since it can't edit .github/).
- **Lesson:** the loop can build the whole gate (suite + bypass + exact workflow) but the final `.github/` apply + branch-protection is irreducibly human (workflow scope). Stage everything, make the owner step one paste + a checkbox, and never require a check until it's proven green.

---

## SYNC 2026-06-28 — LOOP HEALTH metric + abandoned-change classification (measure "is the loop getting better")
- **Gap (vs loop-engineering best practice):** we had no measurable "is the loop improving" signal, and abandoned build-changes weren't classified/stored (risking re-attempting dead-ends).
- **Added:** `docs/autonomous-loop/LOOP_HEALTH.md` — seeded machine-readable block the factory updates EVERY bookkeeping run with REAL counts: changes shipped vs abandoned (+classified `abandoned_reasons`), verify/review failures, circuit-breaker trips, rolling reverts + readiness attempts/rejections, recurring_failures, harness_proposals_open, and a `signal` (bootstrapping|improving|steady|churning|stuck). Dashboard-readable; observability only, NOT a ship gate; honest counts only.
- **Wired:** FACTORY_STANDARD §10b ("Loop health") + ROADMAP LIVING-ARTIFACTS/bookkeeping note. Two enforced rules: (1) classify every abandoned change so the loop doesn't repeat the failed path; (2) churning/stuck → open ONE `loop: harness improvement proposal` (the META channel — the only way the loop's own rules improve, since it can't edit its routine/.claude).
- **Why seeded (not bootstrapped):** like QUALITY_SCORECARD, a brand-new file risks the loop never creating it — seeded with zeros so the loop just updates it.

---

## SYNC 2026-06-28 — visual verification is now DUAL-AXIS (functional + design), not design-only
- **Gap closed in spec:** the screenshot + vision-judge harness (F7 / FACTORY_STANDARD §6) was framed for DESIGN only; functional verification was DOM-only (blind to visibly-wrong/empty/placeholder/broken outcomes the DOM "passes"). Now the same journey screenshots are vision-judged on TWO axes: (A) FUNCTIONAL — does the screen visibly show the INTENDED OUTCOME of that step (populated working screen, the REAL produced artifact e.g. an actual rendered mockup not a placeholder, correct data/state); (B) DESIGN — clears the VISION bar. A FAIL on EITHER axis is release-blocking even if DOM assertions pass.
- **Scope broadened:** capture at every page AND every key STEP of every end-to-end journey + key states, at mobile AND desktop widths.
- **Edited:** FACTORY_STANDARD §6 "SEE WHAT THE USER SEES" + ROADMAP F7 (DoD now records a dual-axis verdict). preflight GATE 1c artifact guard is unchanged (axis-agnostic — it just blocks fake-ticking; the dual-axis verdict is enforced by the deep audit + readiness auditors). Still built by the factory in order, not hand-built.

---

## SYNC 2026-06-28 — F7 (visual verification) spec hardened + preflight honest-tick guard (build deferred to the loop)
- **Decision:** do NOT hand-build F7 (screenshot-every-page + vision-judge). It's normal repo test/infra code = the factory's job; it depends on F4 being fully wired (screenshots are captured BY the journey suite), so it should be built in order. Hand-building it would erode the autonomy thesis and invert priority. Instead, HARDEN the spec + gate so the loop builds it correctly and can't fake-tick it.
- **ROADMAP F7 DoD sharpened:** BOTH required — (1) ARTIFACTS: a real committed NON-ZERO PNG in `e2e/__screenshots__/` for EVERY route/state in ROUTE_INVENTORY, captured by the suite (`page.screenshot()` + `playwright.config.ts` screenshot on); (2) VISION VERDICT: the deep-audit design lens + readiness gate actually OPEN each PNG on the vision model and RECORD a per-screenshot verdict (loop-memory for the audit; readiness evidence for the gate). Capture-and-forget does NOT satisfy F7.
- **preflight GATE 1c added:** if F7 is `[x]` but `e2e/__screenshots__/` has <5 non-zero PNGs → FAIL (blocks fake-ticking). No-op while F7 is `[ ]` (doesn't block current runs). bash -n clean; behaviour verified.
- **Division of labor:** I harden spec + guard; the factory writes the F7 code in order; the gate keeps it honest. Same pattern to relay to the other factories.

---

## Run 2026-06-28 (Run 39) — 7 disjoint changes (E8 site gate ✓ + reliability + perf + correctness + monetization + store-compliance + tests)

### State on entry
- Default tip `90a0b03` (post Run 38 #167–172 + Growth Agent commits: activation-email cron + migration 025, FACTORY_STANDARD S9/PMF). Cold container → `npm install` (root) + `cd mobile && npm install`; reset to `origin/<default>`.
- Last DEEP AUDIT: Run 36 → **not due** this run (every ~4 runs; next ~Run 40). No deep audit.
- QUALITY_SCORECARD still all-null (independent auditor hasn't run) → readiness gate cannot pass; did NOT attempt the ready issue.
- Baseline gate green on entry: tsc clean, **1094 tests**, determinism clean, eslint 0 errors (1 known pre-existing warning in mobile/app.config.ts).

### Area served this run
7-scout Haiku sweep across the phase needs. Lowest fully-loop-buildable incomplete item was **E8 (pre-launch site gate)** — A5/D3/F3/F4 completion is human-gated, E7 is growth-agent-owned + owner-blocked. Selected the maximal file-disjoint, value-bar-clearing set: **E8 site gate, places/photo timeouts, search N+1, request.json guards ×3 routes, mobile free-save limit, privacy-doc Vercel Analytics, spatial-math tests.** 7 changes, all merged #173–179. Security scout = CLEAN (no findings).

### What was done (all merged, gate green per PR)
- **#173 E8 → E8 TICKED** — `lib/security/site-gate.ts` + middleware wiring. Env-driven (`SITE_GATE_PASSWORD`); non-exempt browser routes → `/waitlist`, API → 503; exempt = marketing/legal/waitlist (login/signup stay gated); unlock via `?gate=<pw>` → httpOnly SHA-256-token cookie. Ships inert when unset. 17 tests.
- **#174 reliability** — `AbortSignal.timeout(5000)` on the 2 Google Places fetches (the last external fetches missing a timeout; closes the Run 38 rotation item).
- **#175 perf** — `Promise.all` for project+diagnosis after room on the `/api/search` hot path.
- **#176 correctness** — `request.json()` try/catch on analyze-apartment + diagnosis + diagnosis/stream (400 not 500); completes the #160 class.
- **#177 monetization** — mobile free-save limit 1→3 to match server (`FREE_SAVE_LIMIT=3`) + web; mobile users were paywalled after 1 save.
- **#178 store** — disclosed Vercel Web Analytics in app-privacy.md (both store tables) + corrected the stale "no third-party SDK" notes.
- **#179 tests** — `spatial-math.test.ts` (32 assertions, parseDimensions + computeSpatialConstraints).
- 14 per-change Sonnet reviewers, all APPROVE. 7 Haiku scouts + 14 reviewers = 21 subagents (well under the 50 ceiling).

### Lessons learned
1. **The middleware entrypoint here is `proxy.ts` (Next 15 naming), not `middleware.ts`** — it imports `updateSession` from `lib/supabase/middleware.ts`. Site-gate/auth logic lives in `updateSession`. A `find middleware.ts` at root returns nothing; don't conclude "no middleware."
2. **Edge-runtime crypto: `crypto.subtle.digest` works in Next middleware** (async). Used it for the site-gate SHA-256 token so the raw password is never stored in the cookie. Reviewers confirmed valid in the Edge Runtime.
3. **A scout-flagged collision must be resolved by MERGING concerns or DROPPING one.** The reliability scout proposed parallelizing `diagnosis/stream` AND the AI scout proposed a `request.json` guard there — same file. Dropped the lower-value perf change, folded diagnosis/stream into the json-guard PR (3 routes, one coherent class). Keeps the disjoint rule intact without losing the higher-value fix.
4. **E8 became tickable because it was pure loop work** (the gate code), with the password value the only human-applied piece (PENDING_OPS already had a `set-site-gate-password` item — I updated its `how` to match the real behavior, since the placeholder said "prompts for the password" but the implementation redirects + uses `?gate=`). When a doc describes unbuilt behavior, fix it to reality the same run the behavior ships.
5. **Auto-merge fired fast on disjoint PRs** — 6 of 7 merged within ~minutes of CI green; the open-PR list emptying is the reliable signal (Vercel commit-status is NOT a required check — `verify`/`build`/`mobile` are).

### Rotation guide for next run
- **DEEP AUDIT due ~Run 40** (last ran Run 36). Run a full read-only sweep before scouting.
- **Highest-value queued, file-disjoint:**
  - **Route/agent tests** — the test scout mapped large untested critical modules: `lib/agents/orchestrator.ts`, `room-diagnostician.ts`, `design-coordinator.ts`, `shopping-researcher.ts`, `product-extractor.ts`, `post-search-coordinator.ts` (mock providers); pure math modules `harmony-math.ts`, `proportion-math.ts`, `lookups.ts` (deterministic, like spatial-math this run); route-level tests for `diagnosis`, `mockups`, `rooms`, `upload`.
  - **G4** — login lockout/backoff (needs a server-side login route; login is still client-side Supabase). NOTE: there is NO password-reset flow at all, so the password-reset enumeration guard is moot until one is built.
  - **AI robustness** — AI scout's lower-sev finds: in-flight coalescing on `area-analysis` rejecting forever on an early throw (verify), zero-product-for-category diagnostic signal in orchestrator.
- **Human-gated (unchanged):** migrations 021/022/023/024/025 apply; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys (both forms); EAS init/projectId + Apple/Play accounts; all live secrets; **NEW: set `SITE_GATE_PASSWORD` + flip `GROWTH_STATUS.site_gate_up: true` to activate the E8 gate.**
- **Readiness:** still blocked — QUALITY_SCORECARD all-null + many DoD boxes unchecked. Do NOT attempt the ready issue until the independent scorecard is populated and ship-critical dims are A/A+.

---

## SYNC 2026-06-28 — Growth Agent: strategic outreach (curated, human-reviewed drafts only)
- **Repo:** added docs/growth/OUTREACH.md (the strategic-outreach playbook — draft-only, human sends; high-confidence + named + researched targets only; never a cold-blast; never an invented/scraped contact; honest + CAN-SPAM/GDPR-clean; pre-launch links to the waitlist; maker!=checker review). Added a "Strategic outreach" pointer to docs/growth/ANALYSIS_PLAYBOOK.md and an `outreach` block to docs/growth/GROWTH_STATUS.md (drafted_7d, owner_sent_7d, replies_7d, signal — 0/none, replies owner-reported, YAML parseable).
- **Routine:** Growth Agent routine gains a STRATEGIC OUTREACH capability (create Gmail DRAFTS for the owner to review+send; the agent never sends — the Gmail tool is create_draft only) + OUTREACH.md in its read list.
- **Why:** 1:1 curated outreach (press/partners/community) is high-leverage, esp. pre-launch, and safe because it's draft-only + human-sent. Rails prevent the failure modes (mass cold-blast, fabricated/scraped contacts, busywork, dishonest claims).

---

## Run 2026-06-28 (Run 38) — 5 disjoint changes (reliability + G3 ✓ + G5 ✓ + 2× critical-path tests)

### State on entry
- Default tip #166 (post Run 37). Cold container → `npm install` (root) + `cd mobile && npm install`.
- Last DEEP AUDIT: Run 36 → **not due** this run (every ~4 runs; next ~Run 40). No deep audit.
- QUALITY_SCORECARD still all-null (independent auditor hasn't run) → readiness gate cannot pass; did NOT attempt the ready issue.
- No open PRs/issues blocking. Baseline gate green: tsc clean, 1061 tests, determinism clean.

### Area served this run
Worked the Run 37 rotation guide + a 7-scout Haiku sweep. Selected the maximal file-disjoint, value-bar-clearing set: **external-fetch timeouts (ROADMAP hard rule), G3 SSE/webhook tail, G5 signup CAPTCHA, billing-checkout+user-delete tests, internal growth-metrics+social-queue tests.** 5 changes, all merged #167–171. Gate on merged default: tsc clean, **1094 tests**, determinism clean.

### What was done
- **#167 reliability** — `AbortSignal.timeout` on Tavily(15s)/Resend(10s)/Turnstile(5s); the 3 external fetches that had none. Closes the ROADMAP "every external/LLM call needs a timeout" rule for these. (Scout noted 2 more in `places/photo` — left for a future run.)
- **#168 G3 tail → G3 TICKED** — genericized the 2 SSE routes + products/evaluate-set + Stripe webhook sig error (logServerError + generic client message; SSE shape unchanged). Also `.ai`→`.com` webhook email fallback. Full app/api `.message`-in-response sweep = clean.
- **#169 G5 signup CAPTCHA → G5 TICKED** — added `<Turnstile>` to the signup form (server `/api/auth/signup` already verified the token). Both public forms now covered in code; inert until owner keys. Fixed the now-stale PENDING_OPS note (signup is no longer Supabase-dashboard-side).
- **#170 tests** — +14 for billing/checkout + user/delete (money + Apple-required deletion).
- **#171 tests** — +19 for internal growth-metrics + social-queue.
- 10 per-change Sonnet reviewers, all APPROVE. 7 Haiku scouts.

### Lessons learned
1. **The local default branch can be STALE — ALWAYS branch from `origin/<default>`, never the local branch.** On a cold container I `git reset --hard origin/<default>` (detached HEAD at the real tip), but then created a feature branch via `git checkout claude/... && git checkout -b ...` — the LOCAL `claude/...` branch was 100+ commits behind (no `app/api/billing` yet!), so my edits landed on a stale base and the first webhook Read failed with "file does not exist." Fix: `git branch -f claude/... origin/claude/...` once, and create every branch with `git checkout -b <name> origin/claude/ai-apartment-design-app-iHAdb` (explicit origin ref). The detached-HEAD-from-reset trick worked for the FIRST branch only by luck.
2. **Haiku scouts over-call a11y/"missing aria-label" findings.** All 3 flagged buttons already had accessible names (visible text content, or an existing `aria-label="Dismiss error"`). A `<button>` with child text needs no aria-label. Verified each at the source and ABANDONED the a11y change rather than ship churn — better a quiet 5-change run than padding to 6.
3. **G3/G5 became tickable this run because the LAST piece was loop-buildable.** G5's old note said "signup CAPTCHA is Supabase-dashboard owner config" — but signup had since moved to a server route that verifies the token, so the loop could own it. When a checkbox is blocked "owner-side," re-check whether the blocker still holds before deferring again.
4. **Reviewers want the SSE event SHAPE preserved.** Genericizing SSE `error` events is safe only if the client still gets `{ error: "<string>" }` (clients do `throw new Error(data.error)` / `setSearchError(data.error)`). Confirmed before editing.
5. **Auto-merge on disjoint PRs is fast** — all 5 squash-merged within ~minutes of CI green; the open-PR list emptying is the reliable signal (confirm with `git log origin/<default>`).

### Rotation guide for next run
- **DEEP AUDIT due ~Run 40** (last ran Run 36). Run a full read-only sweep before scouting.
- **Highest-value queued, file-disjoint:**
  - **Reliability tail** — `app/api/places/photo/route.ts` has 2 Google Places fetches with no timeout (scout-confirmed); same one-line `AbortSignal.timeout` fix.
  - **More route/agent tests** — orchestrator/room-diagnostician with mocked providers (scout mapped these); other internal/agent paths.
  - **G4** — login lockout/backoff (needs a server-side login route; login is still client-side Supabase) + password-reset enumeration guards (owner email pipeline-gated).
  - **A11y/design tokens** — badge.tsx/toast.tsx semantic colors → `--score-*` tokens (BORDERLINE — scout said colors already match the tokens, so it's pure routing → likely churn; skip unless paired with a real need).
- **Human-gated (unchanged):** migrations apply; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys (now cover BOTH forms); EAS init/projectId + Apple/Play accounts; all live secrets.
- **Readiness:** still blocked — QUALITY_SCORECARD all-null + many DoD boxes unchecked. Do NOT attempt the ready issue until the independent scorecard is populated and ship-critical dims are A/A+.

---

## Run 2026-06-28 (Run 37) — 6 disjoint changes (security + tests + perf + correctness + a11y + artifacts)

### State on entry
- Default tip #159 (post Run 36 #149–155 + owner FACTORY_STANDARD/growth commits #157–159 + the signup email-verification fix). Cold container → `npm install` (root) + `cd mobile && npm install`; `git reset --hard origin/<default>`.
- Last DEEP AUDIT: Run 36 → **not due** this run (every ~4 runs; next ~Run 40). No deep audit run.
- QUALITY_SCORECARD still all-null (independent auditor hasn't run) → readiness gate cannot pass; did NOT attempt the ready issue.
- No open PRs/issues blocking. Baseline gate green on entry: tsc clean, 1038 tests.

### Area served this run
Worked the Run 36 rotation guide's queued, file-disjoint candidates (validated + extended by a 6-scout Haiku sweep): **G3 error hygiene, critical-path API tests, perf parallelization, request.json robustness, a11y empty-alt, artifact freshness.** 6 changes, all merged #160–165.

### What was done
- **#164 G3 error hygiene** — `lib/utils/api-error.ts` + ~20 routes: stop returning raw Supabase error strings to clients (log server-side, generic client message). PGRST116→404 + projects field-context log preserved. SSE + Stripe-webhook routes deferred. **G3 substantially advanced (NOT ticked — SSE routes still leak).**
- **#165 critical-path tests** — +23 headless tests: billing/webhook, mobile/entitlements, auth/signup (money / revenue gate / funnel entry, previously zero route-level coverage).
- **#161 perf** — Promise.all on independent DB writes in search + analyze-apartment completion paths.
- **#160 correctness** — try/catch around `request.json()` on 4 routes (400 not 500).
- **#162 a11y** — indexed alt text on 3 room-photo grids (WCAG 1.1.1).
- **#163 artifact freshness** — canonical domain (aptdesignerai.com) + brand-kit subtitle aligned to store-listing.
- 12 per-change Sonnet reviewers + 2 fresh re-reviewers (G3, tests). Gate green throughout; merged result: tsc clean, 1061 tests, determinism clean, eslint 0 errors (1 pre-existing warning in mobile/app.config.ts from #149).

### Lessons learned
1. **Scout greps miss leaks under non-`error` variable names.** The G3 scout matched `error.message`/`String(error)` literally and found 14 routes; a post-fix grep for `<anyVar>.message` in NextResponse found 6 MORE leaking routes (`roomsError`, `saveError`, `bundleError`, `updateErr`…). When sweeping for a pattern, grep the SHAPE (`error: <ident>.message` in a NextResponse), not one variable name — then you fix the whole class in one PR instead of leaving a reviewer to catch the gap.
2. **Disjointness needs cross-scout file reconciliation.** Three scouts independently flagged `products/evaluate-set` (perf + correctness + G3) and `area-analysis/refine` (perf + correctness). Assigning each FILE to exactly ONE change this run (and deferring the other concerns for that file) kept all 6 branches conflict-free. Pick the highest-value concern per contested file; defer the rest.
3. **Fire-and-forget side-effects need `vi.waitFor`, not a single `setTimeout(0)` flush.** The webhook's lifecycle emails are `void maybeSend...` with TWO awaits (getUserById → sendEmail); a one-turn microtask flush races. `await vi.waitFor(() => expect(mockSendEmail)...)` is deterministic. (Suppress-case "not called" assertions are fine with a plain flush — nothing is scheduled.)
4. **Branch-hopping resets the harness Read-tracking AND reverts disjoint files to base** — re-Read every file after `git checkout` before Edit. (Recurring; confirmed again.)
5. **Auto-merge fires fast on disjoint PRs.** All 6 squash-auto-merged within minutes once `verify`/`build`/`mobile` went green; the open-PR list emptying is the reliable signal they landed (confirm with `git log origin/<default>`).

### Rotation guide for next run
- **DEEP AUDIT due ~Run 40** (last ran Run 36).
- **Highest-value queued, file-disjoint:**
  - **G3 tail** — genericize the SSE error leaks (`diagnosis/stream`, `search/stream` `sendEvent("error", {message})`) + the Stripe webhook sig message; then G3 can be ticked. (Careful: streams send to a live client UI — keep a useful generic message.)
  - **More route/agent tests** — billing/checkout, user/delete, internal growth-metrics + social-queue (all headlessly mockable per the scout); orchestrator/diagnostician agents with mocked providers.
  - **Perf** — `analyze-apartment` outer room loop is still serial (per-room calls); the per-room insert/update is now parallel but the loop could fan out (verify ordering/cost first).
  - **A11y/design tokens** — `components/ui/badge.tsx` + `toast.tsx` semantic colors are ad-hoc Tailwind vs the `--score-*` tokens (borderline — only if it's genuinely the best work, not churn).
- **Human-gated (unchanged):** migrations 017–024 apply; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; all live secrets.
- **Readiness:** still blocked — QUALITY_SCORECARD all-null + many DoD boxes unchecked. Do NOT attempt the ready issue until the independent scorecard is populated and ship-critical dims are A/A+.
---
## SYNC 2026-06-28 — PMF as the leading indicator + FACTORY_STANDARD a first-class read
- **Repo:** appended the verbatim PRODUCT-MARKET FIT paragraph to FACTORY_STANDARD §9 (byte-identical across factories); added a "Product-market fit — the leading indicator" section to docs/growth/ANALYSIS_PLAYBOOK.md that GOVERNS the recommendation (pre-PMF → product/retention fixes, NOT scaling acquisition); added a "PMF FIRST" bullet to ROADMAP "GROWTH DATA FEEDS THE BUILD"; added a machine-tracked `pmf` block to docs/growth/GROWTH_STATUS.md (activation_rate, retention_d1/d7/d30, organic_share_rate, signal — 0/null/none pre-launch, YAML verified parseable). AptDesignerAI activation/"aha" = room photo → useful diagnosis+sourcing+mockup; retention = returns to design more / revisit saved.
- **Routines:** added `FACTORY_STANDARD.md` as the FIRST item of the orient read list in the product factory routine AND the Growth Agent routine (read list only; model/cron/sources/allowed_tools/MCP unchanged; byte-verified). Pure digest routines untouched (already disabled).
- **Why:** revenue follows PMF; pouring acquisition into a leaky bucket wastes the run. Pre-PMF the priority is the PRODUCT. Metrics beat the spreadsheet model when they contradict it. Honest measurement only (same anti-gaming rule as the number).

---

## INCIDENT 2026-06-28 — signup required email verification but no email ever sent (DEEP DIAGNOSIS)
- **Symptom (owner-reported):** creating an account showed "Check your email — we sent a confirmation link," but the email never arrived → every new user dead-ended, could not log in.
- **Evidence / root cause (CODE + CONFIG, not a transient):** `app/(auth)/signup/page.tsx` called `supabase.auth.signUp` and UNCONDITIONALLY rendered the "check your email" success screen regardless of whether any email was sent (fake success). The actual send relied on Supabase's built-in auth email, which is unconfigured pre-launch (no custom SMTP/Resend + verified domain — an owner-set secret). So the verification LOOP did not exist: a hard gate was introduced on a dependency that was never wired.
- **Decision:** REMOVE the verification gate (don't gate signup on an email loop that doesn't exist). New server route `app/api/auth/signup/route.ts` creates an already-confirmed user via the admin client (`email_confirm: true` — the same pattern the e2e seeder uses), hardened like the waitlist route (per-IP rate limit + Turnstile + enumeration-safe uniform response). The client then signs in and routes to `/dashboard`. The fake "check your email" screen is gone.
- **Proof:** added an authed journey ("REAL UI signup ... lands on the dashboard (no email verification)") that drives the real form → asserts `/dashboard` + no error boundary + zero "check your email". tsc/eslint/tests green.
- **Lesson (smarter decisions):** never introduce a feature whose dependency loop is unbuilt/unverifiable (email verification with no working email send; a "we sent X" message with no real X). Either wire + round-trip-test the dependency, or don't gate on it. Re-enabling verification later is recorded in PENDING_OPS (`email-verification-deferred`) and must come WITH the round-trip test (F4.1). Ties to FACTORY_STANDARD §6 (SIDE-EFFECT INTEGRITY) + docs/autonomous-loop/DEEP_DIAGNOSIS.md.

---

## Run 2026-06-28 (Run 36) — DEEP AUDIT + 7 disjoint changes

### State on entry
- Default tip #147 (FACTORY_STANDARD visual verification) + #148 (F7 journey screenshots, another routine). Cold container → `npm install` (root) + `cd mobile && npm install`; `git reset --hard origin/<default>`.
- Last DEEP AUDIT: Run 32 → **due this run** (rotation guide flagged ~Run 36). Ran it first.
- No open PRs/issues blocking. Lowest incomplete buildable: **B6** (no mobile/eas.json), then **E7** tail, **F4/G** hardening.

### DEEP AUDIT 2026-06-28 (holistic, 8 read-only Haiku lenses across the whole codebase)
Findings, distilled + prioritized (→ what became this run's work):
- **Security/RLS: CLEAN overall.** Every public table has correct RLS (tenant on auth.uid(); shared/internal RLS-on-no-policy). Real gaps found: (a) `handle_new_user()` SECURITY DEFINER had **mutable search_path** → fixed (PR #151); (b) **G3 error hygiene** — many routes return raw `error.message` (Supabase errors leak schema) — NOT fixed this run, queued; (c) in-memory rate-limiter isn't multi-instance-safe (known; Redis migration already in PENDING_OPS).
- **Mobile B6: real gap** — no eas.json, app.json missing build metadata + env projectId → built (PR #149).
- **E7: hollow plumbing** — templates exist, sends mostly unwired. Built the conversion send (PR #155). Remaining: activation-after-signup + habit-after-first-analysis triggers (need a scheduler/cron + signup/analysis hooks), visitor/trial/conversion analytics pulls (need Vercel/Stripe reporting tokens), per-channel social live clients.
- **Performance:** products/evaluate had 3 serial independent fetches → parallelized (PR #153). Other candidates (bundles/saved-designs deep-nesting payload trim) deferred — risky without verifying client consumers.
- **Artifact freshness:** store-listing missing Pro Annual → fixed (PR #150); mobile paywall fallback prices 4–8× off + ungrounded "7-day" trial → fixed (PR #154). Lower-sev (subtitle brand-kit vs store-listing mismatch; domain aptdesigner.app vs .com in pre-submission-checklist) — queued, not done.
- **Correctness/dead-code:** mostly clean (no TODO/FIXME debt, no dead exports). One real find: deepseek tool-call JSON.parse unguarded → fixed (PR #152).
- **Tests/evals/F4:** biggest standing gap = **route-level API tests** (46 routes, ~4 tested — billing webhook, mobile entitlements, auth callback untested) + **critical agents untested** (orchestrator, diagnostician, etc.). A5/F3 eval files exist but only 2 gold fixtures (Unsplash URLs, not committed). F4 axe a11y spec already exists; core-pipeline + checkout→entitlement E2E need a seeded DB (CI, human-gated). All queued — high-value for next runs.
- **A11y/design-bar:** a few empty `alt=""` on room photos; tier/verdict colors use ad-hoc Tailwind accents vs tokens; global-error.tsx hardcoded hex (likely intentional — renders outside app CSS). Queued, lower priority.

### What was done (7 file-disjoint changes, all merged #149–155)
- **#149 B6** mobile EAS config (eas.json + app.config.ts). **B6 ticked.**
- **#150** store-listing Pro Annual tier.
- **#151** migration 024: pin search_path on handle_new_user (security).
- **#152** deepseek tool-call JSON.parse guard (AI robustness).
- **#153** parallelize products/evaluate context fetches (perf).
- **#154** mobile paywall real pricing + honest trial copy.
- **#155 E7** welcome-to-Pro email on free→paid (conversion send; E7 still partial).
14 reviewers (2 Sonnet per change) all APPROVED. Gate green throughout (tsc, 1036→1038 tests, determinism, lint; mobile tsc+lint).

### Lessons learned
1. **`app.config.ts` overlaying `app.json` is the clean way to env-source `extra.eas.projectId`** without editing the static config or hardcoding an id. `export default ({ config }) => ({ ...config, name: config.name ?? ..., extra: { ...config.extra, eas: id ? {projectId:id} : config.extra?.eas } })` — restate name/slug to satisfy the ExpoConfig required-fields type under strict mode. Verified via `EAS_PROJECT_ID=x npx expo config --json`.
2. **`appVersionSource: "remote"` in eas.json sidesteps the "missing buildNumber/versionCode" finding** — EAS manages versions remotely, so nothing to hardcode/drift. Apple submit creds go in via `$EXPO_*` env interpolation (eas.json supports `$VAR`), keeping secrets out of the repo.
3. **The win-back webhook pattern generalizes cleanly to a conversion send**: read prior status BEFORE upsert, gate on `!wasAlreadyActive` for new→active. Renewals (status stays active) and Stripe redelivery are both suppressed; cancel→re-subscribe legitimately re-fires. Fire-and-forget + helper-never-throws keeps the 200-to-Stripe invariant.
4. **Full test suite is fast (~8s, 1036 tests)** — running the whole gate per web branch is cheap; no need to skimp. Mobile deps must be installed (`cd mobile && npm install`) before mobile tsc/lint works on a cold container.
5. **Deep audit as 8 parallel Haiku lenses → fold into candidate pool** worked well: surfaced exactly the disjoint, value-bar-clearing set. Security/correctness lenses confirmed the codebase is largely clean (few real finds), which is itself a useful signal — most "findings" were no-ops.

### Rotation guide for next run
- **DEEP AUDIT done Run 36** → next due ~Run 40.
- **Highest-value queued (from this audit), all file-disjoint candidates:**
  - **G3 error hygiene** — wrap raw `error.message` returns in generic client messages + server-side logging (a `lib/utils/api-error.ts` helper applied across routes). Security-bar; real gap.
  - **Route-level API tests** — billing webhook, mobile/entitlements, auth/callback (headless, mock DB/providers). Closes the F4/test-coverage gap; high value.
  - **Critical-agent unit tests** — orchestrator/diagnostician with mocked providers + fixtures.
  - **A11y** — empty `alt=""` on room photos; consolidate tier/verdict colors to design tokens.
  - **E7 tail** — activation/habit email triggers (needs a scheduler + signup/analysis hooks — bigger, touches sensitive call sites), analytics pulls (owner tokens).
  - **Artifact** — reconcile brand-kit subtitle vs store-listing; standardize domain (aptdesigner.app vs .com) in pre-submission-checklist.
- **Human-gated (unchanged):** migrations 019–024 apply; A5/F3 eval CI job; F4 Playwright CI wiring; D3 screenshots; Turnstile keys; EAS init/projectId + Apple/Play accounts; all live secrets (RESEND_API_KEY makes the new welcome email actually send).
- **Not yet graded:** docs/quality/QUALITY_SCORECARD.md is still all-null (independent auditor hasn't run). DoD readiness cannot pass until ship-critical dims are A/A+ — do NOT attempt the ready issue until the scorecard is populated and green.

---

## Owner change 2026-06-27 — BUILDS ≠ WORKS: runtime functional journey suite

A green build + green unit tests prove the app COMPILES, not that it WORKS for a user. The gates
never RAN the authed/billing/core journeys; the only E2E covered public pages. A signup that builds
but lands on a dead/"not available" dashboard would pass everything. Closed it:
- `e2e/journeys.spec.ts` (+ `e2e/helpers/seed.ts`, `e2e/ROUTE_INVENTORY.md`, `scripts/run-journeys.sh`):
  OUTCOME-asserting journeys (signup→working dashboard, paywall, nav, authed-vs-anon), public/structural
  tier runs anywhere + authed tier self-seeds a CONFIRMED user via the admin client (signup is double
  opt-in, so UI-only signup can't reach the dashboard — seed + sign in).
- `scripts/preflight.sh` GATE 1b + ROADMAP readiness/deep-audit now require the suite to RUN GREEN with
  the authed tier exercised. "It builds" no longer reaches "ready".

**Three runtime-validation traps this exposed (verify by RUNNING, never by reading code):**
1. **CI-only browser path** — `playwright.config.ts` hardcoded `/opt/pw-browsers/...`, absent off-CI, so
   the suite "built but wouldn't run". Fixed: `existsSync` fallback to the managed browser.
2. **A faithful authed run needs a seeded DB + auth backend** — Supabase GoTrue, not just Postgres.
   Docker was down locally → authed tier is gated to CI (supabase-local); documented in PENDING_OPS.
3. **`reuseExistingServer: true` on the default port silently tested the WRONG app** — GroceryManager was
   on :3000 (NextAuth `/signin?callbackUrl=`), so the run hit it, not AptDesignerAI (on :3001). The
   redirect-to-`/signin` (vs our `/login`) was the tell. Fixed: dedicated local port 3100. Lesson: assert
   app IDENTITY, don't trust the port. Public/structural tier verified GREEN against the real app on 3100.

**Honest-diagnosis rule:** a symptom that doesn't reproduce on a clean, correctly-targeted env is itself a
finding — localize to env/target/migration drift, don't fabricate a code fix. (Here the "broken redirects"
were testing the wrong app, not an AptDesignerAI bug.)

---

## Run 2026-06-27 (Run 35)

### State on entry
- Default tip #135 (post Run 34 + owner ROADMAP/growth changes #127–135, incl. the BUILDS≠WORKS
  journey suite #133). `node_modules` absent on a cold container → `npm install` first; `git reset
  --hard origin/<default>` to be safe.
- Last DEEP AUDIT: Run 32 (same day) → not due (every ~4 runs / ~24h). Next due ~Run 36.
- Lowest incomplete buildable: **Track G** (G1–G6 mostly open; G7 done) + **E7** tail + quality gaps.

### Area served this run
**Track G (G6 CORS ✓, G5 Turnstile partial) + E7.2 (welcome email) + quality (social correctness, F2 admin coverage, dashboard a11y).** 6 file-disjoint changes, all merged.

### What was done
- **PR #136 — social correctness:** `lib/social/queue.ts` enqueuePost + `lib/social/index.ts` validate() both checked RAW `input.body.length` against the platform cap but stored/sent the TRIMMED body — whitespace-padded posts wrongly rejected, two paths disagreed. Fixed both to use `body.length`. Reviewer A caught the sibling index.ts bug (queue.ts alone was half a fix).
- **PR #137 — F2 admin coverage:** `__tests__/supabase/admin.test.ts` for `getAdminClient()` (was zero-coverage). doMock-after-resetModules pattern (a reviewer wrongly flagged hoisted vi.mock + resetModules; switched to vi.doMock to settle it — tests were already green, proving interception).
- **PR #138 — dashboard a11y:** htmlFor/id on 3 onboarding controls (WCAG 1.3.1/4.1.2); one caption `<p>`→`<label>` keeping classes + `block`.
- **PR #139 — E7.2 welcome email:** first lifecycle SEND wired — `app/api/waitlist/confirm/route.ts` sends a one-time welcome (new `lib/email/templates/waitlist-welcome.ts`) after double-opt-in confirm. At-most-once (token cleared on confirm), dry-run-safe, never breaks confirmation on send failure.
- **PR #140 — G6 CORS:** `lib/security/cors.ts` + middleware. ACAO reflected only for allowlist (NEXT_PUBLIC_SITE_URL/APP_URL + localhost), never `*`; OPTIONS 204 pre-auth; additive (server-to-server unaffected). With CSP/HSTS/X-CTO already shipped, **G6 ticked**.
- **PR #141 — G5 Turnstile (waitlist):** `lib/security/turnstile.ts` server verify + `components/ui/turnstile.tsx` widget. Closed-but-inert until owner sets both keys; fail-open on missing key AND on Cloudflare-unreachable; fail-closed on missing/invalid token when enabled. G5 stays unchecked (signup captcha is Supabase-side owner config).

### Lessons learned
1. **Reviewers catch SIBLING bugs.** The same trim-vs-raw length bug existed in a second function (`index.ts validate()`) the diff didn't touch; Reviewer A insisted the fix cover both. When fixing a bug, grep for the same pattern in sibling code paths before claiming it fixed.
2. **`vi.doMock` after `vi.resetModules` (inside the loader) is the unambiguous module-isolation pattern.** Hoisted `vi.mock` + `resetModules` actually works (mock registry survives resetModules), but it reads as suspect to a careful reviewer; doMock-after-reset is self-evidently correct and avoids the debate.
3. **`NEXT_PUBLIC_*` is build-time-inlined — a "ship inert, activate later" client flag silently stays off after a runtime env change until rebuild.** Documented the rebuild requirement in `.env.example` + PENDING_OPS so the owner doesn't set the Turnstile site key and wonder why no widget appears.
4. **Vercel commit-status shows `failure` (deployment rate-limited) but is NOT a required check.** Required gates are the GitHub Actions check-runs `verify` + `build` + `mobile` (+ non-blocking `quality`); auto-merge fires on those. Read check-runs, not the combined commit status, to judge mergeability.
5. **CORS as an ADDITIVE header layer is the safe way to "lock down" without breaking server-to-server.** Reflect ACAO only for the allowlist, never reject a request — Stripe webhook / mobile Bearer / internal API carry no Origin and are untouched; disallowed cross-origin browser reads are blocked by the absent ACAO.

### Merge outcome
PRs #136–141 all merged (verify ✓ build ✓ mobile ✓ quality ✓). Gate green on merged default: 1036 tests, tsc + determinism + lint(full) clean.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 36** (last ran Run 32). Run a full read-only sweep before scouting next run.
- **Track G remaining:** G1/G3 still substantially-done-but-unticked (a future audit should verify coverage across ALL expensive/auth endpoints + error hygiene, then tick); G2 (server-side validation completeness — verify); G4 (login lockout/backoff — needs a server-side login route; password-reset/verification enumeration guards); G5 signup captcha (owner-side Supabase config — see PENDING_OPS).
- **E7 remaining:** wire the rest of the lifecycle sends (activation after signup, upgrade after checkout webhook, habit/win-back) — these touch signup/checkout call sites, review carefully; visitor/trial/conversion analytics pulls (owner-credentialed); per-channel social live clients.
- **Human-gated (unchanged):** migrations 019–023 apply; A5/F3 eval CI job; F4 Playwright CI wiring (suite exists, #133); D3 screenshots; Turnstile keys (PENDING_OPS); all live secrets.

---

## Run 2026-06-27 (Run 34)

### State on entry
- Default tip #121 (post Run 33). Local working branch was STALE on entry (migrations only to 013) — `git reset --hard origin/<default>` fixed it; always reset-to-origin on a cold container, don't trust the local checkout.
- Last DEEP AUDIT: Run 32 (same day) → not due this run (due every ~4 runs / ~24h).
- Lowest incomplete buildable: **E7 (growth execution engine)** remaining sub-items + **Track G** (G4/G5/G6 open).

### Area served this run
**E7 (E7.1 double opt-in, E7.3 social publishing queue, E7.4 churn metrics) + G4 (signup user-enumeration).** 4 file-disjoint changes, all merged.

### What was done
- **PR #122 — E7.1 waitlist double opt-in** (migration 022 + `app/api/waitlist/*` + `/waitlist/confirmed` + lib/email confirmation template + middleware): sign-up stored PENDING with a 64-hex single-use token; confirmed only on emailed-link click. Makes the long-claimed `double_opt_in: true` real. 10 tests. Review fixes: exact-length token regex, 5-min resend throttle (token_sent_at), `/waitlist/confirmed` allowlisted explicitly (not a `/waitlist` prefix).
- **PR #123 — E7.3 social publishing queue** (migration 023 admin-only + `lib/social/*` dry-run providers mirroring lib/email + `app/api/internal/social-queue` + CONNECT.md Step 4): Growth Agent enqueues, app flushes; status-guarded claim prevents double-post; nothing posts publicly without a per-channel credential. 15 tests. Review fixes: NaN flush-limit guard, flush test coverage, CONNECT honesty (credential gates live publishing but live client is a follow-on).
- **PR #124 — G4 signup enumeration** (`lib/auth/signup-errors.ts` + signup page): already-registered now shows the same neutral "check your email" screen as a new signup; only a genuinely-new user fires `signup_complete`. 6 tests.
- **PR #125 — E7.4 churn metrics** (`lib/growth/metrics.ts`): `cancelled_subscribers` + approximate `cancelled_30d` (updated_at proxy) from existing stripe_customers columns; honestly disclosed in 3 places. 8 tests.

### Lessons learned
1. **Reviewers run on a STATIC diff file in scratchpad, not the branch.** Wrote each PR's `git diff origin/<default>...<branch>` to scratchpad and pointed reviewers at it — reviewers (fresh agents) can't see feature branches otherwise. Re-generate the diff file after each fix cycle before re-review.
2. **Branch-switching resets the harness's Read-tracking AND reverts disjoint files to base** — the "file was modified" notes on checkout are just the working tree following the branch; expect to re-Read every file before Edit after a `git checkout`.
3. **Merge API: `merge_method` must be lowercase `squash`** (not `SQUASH`); auto-merge enable only works while checks are PENDING — once CI is already green, merge directly. The "unstable/failing" state right after a push is the checks re-running; confirm via the workflow-run conclusion before assuming a real failure.
4. **Disjointness held perfectly across 4 PRs sharing the `/api/internal/*` + migration namespaces** — two new internal routes (social-queue vs growth-metrics, different files), consecutive migrations 022/023, and the duplicated 6-line `tokenMatches` helper (intentional, to avoid editing growth-metrics route in the social PR). Duplicating a tiny helper beats breaking the disjoint rule.
5. **Honesty caveats for approximate metrics go in 3 places** (JSDoc, the API response `notes`, the owner doc) — Reviewer B specifically checks all consumer-facing surfaces for the "never invented" E7 rule.

### Merge outcome
PRs #122, #123, #124, #125 all merged (verify ✓ build ✓ mobile ✓). Gate green: 997+ tests, tsc + determinism + lint + prod build clean.

### Rotation guide for next run
- **E7 remaining (lowest incomplete):** wire the E4/E6 email lifecycle SEND calls to lib/email (welcome/activation/upgrade/winback triggers — careful, touches signup/checkout call sites); visitor/trial/conversion-rate analytics pulls (need Vercel Analytics API + Stripe reporting API — likely owner-credentialed); per-channel social LIVE API clients (X/IG/TikTok/Reddit — each needs the owner's app + API review). Waitlist welcome email after CONFIRM (currently only the confirm email fires) is a clean next step.
- **Track G remaining:** G4 login lockout/backoff (needs a server-side login route — currently login is client-side Supabase) + password-reset/verification enumeration guards; G5 CAPTCHA/Turnstile on waitlist+signup (waitlist route just changed — now safe to add); G6 CORS allowlist (scouts judged default-deny already adequate — low priority, don't manufacture).
- **Reconcile note:** G1/G3 still appear substantially done but left unticked (coverage not rigorously re-verified); a future audit should confirm + tick.
- **Human-gated (unchanged):** migrations 022/023 apply (PENDING_OPS), A5/F3 eval CI job, F4 Playwright CI wiring, D3 screenshots, all live secrets.
- **DEEP AUDIT:** last ran Run 32. Due again around Run 36 (~4 runs) — run a full codebase audit then.

---

## Run 2026-06-27 (Run 33)

### State on entry
- Detached HEAD at default tip #116 (post Run 32). 952 tests baseline; deps not installed (ran `npm install`).
- Last DEEP AUDIT: Run 32 (previous run) → not due this run.
- Lowest incomplete buildable track: **E7 (growth EXECUTION engine)** — waitlist capture already lived (migration 017 + /api/waitlist), but email send, analytics-pull API, the owner runbook, and the social publishing queue were all unbuilt. Track G also had G4/G5/G7 open.

### Area served this run
**Track E7 (growth execution engine — E7.2 email, E7.4 metrics-pull, E7.5 connect runbook) + Track G7 (paid-API spend circuit breaker).** 4 file-disjoint changes, all merged.

### What was done
- **PR #117 — E7.2 email provider abstraction** (`lib/email/`): Resend REST provider (no SDK), DryRunProvider default until RESEND_API_KEY present, `sendEmail()` validation that never throws, `EmailStage` union mirroring the email-lifecycle docs. 12 tests.
- **PR #118 — E7.4 internal growth-metrics API** (`lib/growth/metrics.ts` + `app/api/internal/growth-metrics/route.ts`): real funnel counts (waitlist total/7d, active subscribers across pro+pro_annual excluding one-time apartment tier, annual subscribers); INTERNAL_METRICS_TOKEN HMAC timing-safe gate, 503-until-configured, IP rate limit, `/api/internal/*` middleware bypass. 8 tests.
- **PR #119 — G7 per-user/day spend circuit breaker** (`lib/utils/spend-limiter.ts`): in-memory per-UTC-day cap (DAILY_PAID_CALL_LIMIT, default 60) across ALL 12 paid routes; discriminated-union result; excludes cheap places/photo + revenue billing/checkout. 10 tests. Ticked G7 in ROADMAP.
- **PR #120 — E7.5 owner connect runbook** (`docs/growth/CONNECT.md` + `.env.example`): ~20-min setup runbook + env contract; capability table honest (email/metrics/spend Built; social publishing NOT built).

### Lessons learned
1. **Reviewers can't see sibling feature branches — pass them a STATIC diff file, and merge code BEFORE doc-that-describes-it.** The CONNECT.md doc (change 4) documented code living on the three sibling branches; both reviewers correctly rejected it round 1 because greps of the working tree (default base) found no `lib/email` etc. Fix: merge the code PRs first, rebase the doc branch onto the updated default, THEN re-review — reviewers then confirm the doc against real on-disk code. Writing diffs to scratchpad files (not inline, not "read the branch") is the reliable reviewer hand-off.
2. **A subscriber count must include EVERY paid tier.** The metrics gatherer first filtered `.eq("tier","pro")`, silently dropping `pro_annual` (migration 021) and conflating the one-time `apartment` tier into "active subscribers". Reviewer A caught it. Rule: when counting by an enum column, enumerate against the migration's CHECK constraint + lib/entitlements, not memory.
3. **Discriminated unions beat boolean-property narrowing for "only valid in the failure case" helpers.** Typing `dailySpendExceededResponse(result: SpendCheckResult & {allowed:false})` failed to narrow at call sites because `SpendCheckResult` was a plain interface with `allowed: boolean`. Converting `SpendCheckResult` to a union discriminated on `allowed` made `if (!spend.allowed)` narrow correctly and made misuse a compile error.
4. **Timing-safe token compare must not early-return on length** — HMAC both sides to a fixed-width digest before `timingSafeEqual`, else the expected token's length leaks via timing.
5. **Branch-switching resets the harness's Read-tracking** — after `git checkout`, the Edit tool requires a fresh Read of each file before editing (the working tree changed under it). Expect to re-Read on every branch hop.
6. **`npm install` is needed on a cold container** before tsc/vitest (deps absent on entry).

### Merge outcome
PRs #117, #118, #119, #120 all merged (verify ✓ build ✓ mobile ✓; the Vercel preview status was rate-limited but is NOT a required merge check). Gate green: 962 tests, tsc + determinism + lint clean.

### Rotation guide for next run
- **E7 remaining (lowest incomplete buildable):** sub-item 1 double-opt-in on waitlist; sub-item 3 **social publishing queue** (server-side queue + provider abstraction, dry-run default — the biggest remaining E7 piece, needs a migration for the queue table); wire the E4/E6 lifecycle send calls to `lib/email`; extend metrics with visitor/trial/conversion (needs Vercel Analytics + Stripe reporting APIs).
- **Track G remaining:** G2 (server-side validation on every write — verify completeness), G4 (auth failure-case hardening + tests: lockout, password-reset + signup enumeration guards), G5 (CAPTCHA/Turnstile on waitlist+signup), G6 CORS allowlist (security headers done, CORS NOT — leave G6 unticked until CORS lands).
- **Reconcile note:** G1/G3 appear substantially done (rate limits + error hygiene across expensive routes) but were left unticked this run because "every endpoint incl. auth" coverage wasn't rigorously verified — a future audit should confirm and tick them.
- **Human-gated (unchanged):** A5/F3 eval CI job, F4 Playwright CI wiring, D3 screenshots.

---

## Run 2026-06-25 (Run 27)

### State on entry
- Context compacted from Run 26 (context window exhausted mid-run). PRs #76–79 confirmed merged on entry.
- 876 tests passing, tsc clean, lint clean on entry.
- Last DEEP AUDIT entry: none found in history → deep audit was overdue.

### Area served this run
**Deep audit (security, a11y, docs) + Track F4 (Playwright E2E + a11y gate).**

### What was done

**Deep Audit — 6 lenses run in parallel before implementation:**
- Security/RLS: found two CRITICAL gaps: (1) middleware missing public paths for billing webhook, share API, mobile API, and marketing pages; (2) migration 019 uses JWT-claim RLS but the app uses column-filter — mismatch breaks all share links after 019 is applied.
- A11y: found CRITICAL — account deletion form label has no `htmlFor` / input has no `id` (WCAG 1.3.1 + 4.1.2 violation).
- Docs: README was still `create-next-app` boilerplate.
- Dead code: no dead code found (clean). Zero test coverage in `lib/billing/`, `lib/entitlements/`, `lib/auth/`, `lib/supabase/admin.ts` — recorded for future work.
- Performance/dependency: Next.js 14 vulnerabilities reported; no critical; defer.

**PR #83 — `security/middleware-public-paths` (CRITICAL)**
- Added `/api/billing/webhook` to `PUBLIC_API_PATHS` (Stripe needs no session cookie)
- Added `/api/shared/` and `/api/mobile/` prefix bypasses (share API uses column-filter auth; mobile API uses Bearer token auth)
- Added `/pricing`, `/faq`, `/privacy`, `/terms`, `/support` to `PUBLIC_PATHS` (exact match)
- Added `/guides` to `PUBLIC_PATH_PREFIXES` list (prefix match — covers sub-routes like `/guides/color-palette-guide`)
- Two reviewers: Reviewer 1 flagged `/api/mobile/` missing bypass; Reviewer 2 flagged `/guides` sub-routes and scope-creep comment. Both incorporated before merge.

**PR #84 — `security/fix-rls-migration-020` (HIGH)**
- `supabase/migrations/020_fix_saved_designs_rls_column_filter.sql`: drops JWT-claim policy from migration 019, adds correct column-filter policy: `USING (is_public = true AND share_token IS NOT NULL)`. UNIQUE constraint on `share_token` ensures enumeration is impossible without the token.
- PENDING_OPS.md updated with combined 019+020 apply instructions (apply both in sequence).

**PR #85 — `a11y/account-form-label` (CRITICAL a11y)**
- `app/account/page.tsx`: `id="confirm-delete"` on input, `htmlFor="confirm-delete"` on label. 2-char fix unblocks screen readers and label-click focus behavior.

**PR #86 — `docs/readme-product-description` (HIGH docs)**
- `README.md`: full product description — what it does, stack table, local dev setup (web + mobile), env var reference, pointers to ARCHITECTURE.md / AGENTS.md.

**PR #87 — `f4/playwright-e2e-accessibility` (Track F4)**
- `playwright.config.ts`: Chromium at `/opt/pw-browsers`; dev server auto-start; 1 retry in CI.
- `e2e/public-pages.spec.ts`: smoke tests — all 7 public marketing pages must load (< 400) and render a visible heading.
- `e2e/a11y.spec.ts`: axe-core WCAG 2.x scan; fails on critical or serious violations with human-readable node HTML summary.
- `package.json`: `@playwright/test@^1.61.1` + `@axe-core/playwright@^4.12.1`; `test:e2e` and `test:e2e:a11y` scripts.
- CI wiring recorded in PENDING_OPS.md (`.github/workflows/` write-blocked in headless runs).

**ROADMAP reconcile:**
- Converted A1–A4, B1–B5, D1–D4 (except D3), E1, E6 from bullet to `[x]` checkbox.
- Ticked Track B and Track C DoD checkboxes (all sub-items merged, gate green in this run).
- Left A5 unchecked (eval files exist but CI job is human-applied).
- Left D3 unchecked (screenshots require human to run app on device).
- Left F4 unchecked (Playwright setup merged, but CI job not yet wired — human-applied).

### Lessons learned

1. **`/api/mobile/*` routes must be in middleware's public-path bypass.** Mobile clients send `Authorization: Bearer` — no session cookie. The middleware's cookie-auth check returned 401 before the route's own `supabase.auth.getUser(token)` ever ran. Any API route that performs its own auth (Bearer, HMAC, API key) needs a middleware bypass with clear documentation of who is responsible for auth.

2. **RLS approach must be verified against the actual Supabase query at the call site.** Migration 019 documented two variants (JWT-claim vs column-filter) but chose JWT-claim without verifying which one the app actually uses. The route uses `.eq("share_token", token)` — a column filter. Always read the route before choosing the RLS variant.

3. **Both reviewers independently found issues the other missed.** Reviewer 1 (mobile API bypass) and Reviewer 2 (/guides sub-routes) each caught one critical gap. Neither caught the other's issue. Two reviewers with different prompts are not redundant — they surface different categories of problems.

4. **`git checkout <base>` in a two-command Bash call switches BACK before the branch creation completes as expected.** When running `git checkout <base> && git checkout -b <branch>` and then another `git checkout <base>` in a SEPARATE Bash call, the second call switches back to base, and the next Write/commit lands on base instead of the feature branch. Always check `git branch` before writing files. Fixed by cherry-pick + `git reset --hard HEAD~1`.

5. **Deep audit found zero dead code / TODO/FIXME debt.** But found zero test coverage for `lib/billing/`, `lib/entitlements/`, `lib/auth/`, `lib/supabase/admin.ts` — these are critical paths (money, auth, identity) with no tests. This is the most impactful coverage gap remaining.

### Merge outcome
PRs #83, #84, #85, #86, #87 all merged (all green: verify ✓ build ✓ mobile ✓ quality ✓).

### Rotation guide for next run
- **Track F remaining:** F3 (full eval suite with CI job — human wire step), F4 (Playwright CI wiring — human wire step). The loop cannot advance F3 or F4 further without the CI jobs being wired. F5 deep audit ran this run (satisfies F5 for now).
- **Track A5 (eval CI):** Human applies the `RUN_EVALS=1` CI job from PENDING_OPS.md. Eval files are complete.
- **Track D3 (screenshots):** Human must run the app on a device. Cannot be resolved autonomously.
- **Coverage gaps (HIGH priority for next audit):** `lib/billing/stripe.ts`, `lib/entitlements/web.ts` + `server.ts`, `lib/auth/ownership.ts`, `lib/supabase/admin.ts` — zero test coverage for money/auth critical paths.
- **Do NOT:** Add new features. The remaining gaps are human-gated (CI jobs, screenshots) or coverage depth. Advance whichever test coverage gap has the highest risk vs. effort ratio if blocked on human steps.

---

## Run 2026-06-26 (Run 31)

### State on entry
- Context compacted from Run 30. PRs #93–98 confirmed merged on entry (952 tests, tsc clean, lint clean).
- Three deliverables assigned: F3 area-analysis eval, F6 preflight script, business case Pro Annual update.

### Area served this run
**Track F quality hardening (F3 eval suite completion + F6 preflight gate) + docs (business case Pro Annual tier).**

### What was done

**PR #105 — `f3/area-analysis-eval`:**
`evals/__tests__/area-analysis.eval.test.ts`: live eval for area-analysis Pass A pipeline stage. Calls `geminiProvider.chat()` directly with the same model (`selectModel("area_analysis")`), prompt (`buildMobilePassAPrompt` exact copy), and params (`max_tokens: 8192`, `seed: DETERMINISTIC_SEED`, `responseMimeType: "application/json"`, HIGH thinking) as `app/api/mobile/analyze/route.ts`. Two tests gated behind `RUN_EVALS=1`: (1) quality assertions — all 8 response fields present, `recommended_palette ≥ 3` entries with at least one warm term; (2) JSON mode regression guard — invalid UTF-8 in image URL returns error, not a crash.
Review bugs fixed: (a) `buildPassAPrompt` initially omitted GOOD/BAD style_name examples and concrete palette/material/texture values from production's prompt — fixed by making the eval function an exact copy; (b) `max_tokens: 2048` too low for HIGH thinking + 8 fields — changed to 8192 to match production.
Completes the 5-eval coverage set: diagnosis + sourcing + grounding + refine + area-analysis.

**PR #106 — `f6/preflight-script`:**
`scripts/preflight.sh`: 5-gate mechanical readiness script.
- Gate 1: Full CI (tsc + npm test + determinism + build + mobile tsc).
- Gate 2: 22 required file existence checks.
- Gate 3: Counts unchecked `- [ ]` DoD boxes in ROADMAP.md via awk.
- Gate 4: 10 critical-path grep checks including `checkout.session.completed` in `lib/billing/stripe.ts` (not `app/api/billing/webhook/route.ts` which has it only in a JSDoc comment), `pro_annual`, `REVENUECAT_SECRET_KEY`.
- Gate 5: Validates BUSINESS_CASE_SUMMARY YAML via Python using env-var injection pattern (`_PREFLIGHT_YAML="$YAML_BLOCK" python3 - <<'PYEOF'`) to avoid `$100K` → `00K` shell expansion in the YAML content.
Review bugs fixed: (a) Gate 5 heredoc `$100K` expansion — YAML passed via env var with quoted heredoc; (b) Gate 4 wrong file for `checkout.session.completed` — changed to `lib/billing/stripe.ts`; (c) dead duplicate `PYTHON_CHECK` assignment from intermediate edit — cleaned up in one final Edit.
Currently exits 1 (8 unchecked DoD boxes) — correct behavior.

**PR #107 — `docs/business-case-annual-tier`:**
`docs/BUSINESS_CASE.md`: Pro Annual tier ($399/yr, ~$33/mo, save 32%) added to pricing table. Revenue formula updated to split Pro into 75% monthly / 25% annual (EffectiveMonthlyChurn_Annual ≈ 2.4%/month from 25% annual renewal churn per Recurly B2C benchmarks). ARR scenarios recomputed: conservative $46.2K, base $122.9K, optimistic $276.8K (+23% across all from annual LTV uplift). Pro Annual LTV comparison section: Annual LTV $1,117 vs Monthly $490 (+128%). YAML summary block updated `as_of: 2026-06-26`.
Review bug fixed: "Honest statement" section referenced $100K ARR (stale) and listed only 4 levers — updated to $122.9K ARR and 5 levers (added: "25% of Pro subscribers choosing the annual plan"; updated churn bullet to cover both monthly ≤7% and annual renewal ≤25%).

### Lessons learned

1. **Eval prompts must be exact copies of production prompts, not summaries.** The first version of `buildPassAPrompt` dropped the inline GOOD/BAD examples for `style_name` and the concrete palette/material/texture values that appear in production's `buildMobilePassAPrompt`. The eval would have tested a weaker prompt variant, masking any regression in the production path. Rule: eval prompt functions should be verbatim copies with an explicit `// Keep in sync.` comment, not abridged versions.

2. **`max_tokens` in eval must match production.** An eval for HIGH-thinking area_analysis with `max_tokens: 2048` would have truncated the 8-field JSON response. Always read the production `.chat()` call to confirm `max_tokens` before writing the eval.

3. **Shell dollar-sign expansion in heredocs is an invisible trap for YAML content.** `$100K` in a heredoc (without quoted delimiter) silently becomes `00K`. Always pass structured text containing dollar signs via environment variables with `<<'PYEOF'` (quoted heredoc), not `<<PYEOF`.

4. **`checkout.session.completed` appears in multiple files — verify the handler, not just the string.** The string appears in a JSDoc comment in `app/api/billing/webhook/route.ts` but the actual `case "checkout.session.completed":` handler lives in `lib/billing/stripe.ts`. Preflight critical-path checks must grep the file that contains the runtime logic, not the first file where the string appears.

### Merge outcome
PRs #105, #106, #107 all merged (all green: verify ✓ build ✓ mobile ✓ quality ✓).

### Rotation guide for next run
- **F3 eval CI wiring:** Eval files are complete (all 5 stages). Human must apply the `RUN_EVALS=1` CI job from PENDING_OPS.md before F3 can be ticked.
- **F4 Playwright CI wiring:** Still human-applied. Cannot advance further autonomously.
- **F6 preflight.sh:** Built and merged. Currently exits 1 (correct — DoD boxes unchecked). Will exit 0 only when all DoD boxes are ticked.
- **Remaining a11y gaps:** Icon-only buttons in `app/saved/page.tsx` (~line 142) and `app/projects/[projectId]/rooms/[roomId]/mockups/page.tsx` (~line 292) still need `aria-label`. Noted since Run 30.
- **Coverage gap:** `lib/supabase/admin.ts` still has zero test coverage.
- **Track D:** `screenshots` (D3) still require a human on a device.

---

## Run 2026-06-27 (Run 32)

### State on entry
- Context compacted from Run 31 mid-task: refine-chat/route.ts import was added but POST handler rate limit check was NOT yet inserted.
- 952 tests passing, tsc clean on entry (PRs #105–107 confirmed merged from Run 31).
- Deep audit was overdue (last ran Run 27, 5 runs ago; due every ~4 runs). DEEP AUDIT BLOCK ran at session start via parallel Haiku scouts.
- Primary actionable: Track G (pre-launch security & abuse hardening, G1-G7) entirely untouched.
- Secondary: 2 a11y gaps from rotation guide (icon-only delete + download buttons).
- Artifact inconsistency: `engine_built: false` in GROWTH_STATUS.md despite E1-E6 all merged.

### Area served this run
**Track G (G1/G2/G3/G6 — rate limiting, error hygiene, CSP header) + A11y rotation (2 icon-aria gaps) + artifact correction (GROWTH_STATUS engine_built).**

### What was done

**PR #111 — `g1-g3/rate-limits-error-hygiene`:**
`lib/utils/rate-limiter.ts`: 7 new RATE_LIMITS constants for all previously-unprotected expensive routes: `analyzeApartment` (5/hr), `apartmentResearch` (3/hr), `computerUseVerify` (2/hr), `billingCheckout` (10/hr), `userDelete` (3/day), `areaAnalysisRefineChat` (20/min), `areaAnalysisRefineFull` (5/5min).
All 7 routes updated: `analyze-apartment`, `apartment-research`, `computer-use/product-verify`, `billing/checkout`, `user/delete`, `area-analysis/refine`, `area-analysis/refine-chat` — each with per-user 429 + Retry-After guard immediately after auth check.
Error hygiene (G3): raw LLM/Stripe/Supabase messages in HTTP responses replaced with generic strings in `computer-use/product-verify`, `billing/checkout`, `analyze-apartment`, `apartment-research`, `area-analysis/refine` catch block, `area-analysis/refine-chat` DB error + catch block.
Reviewer 1 caught: `user/delete` missing Retry-After; 2 refine-route error leaks. Reviewer 2 caught: same Retry-After gap; noted in-memory rate limiter resets on cold start (acceptable pre-launch, flagged for Redis/Upstash migration before scale). All fixed before merge.

**PR #112 — `a11y/icon-aria-labels-r32`:**
`app/saved/page.tsx`: Delete button (Trash2 icon) → `aria-label={\`Delete ${design.title}\`}`.
`app/projects/.../mockups/page.tsx`: Download button → `aria-label={\`Download mockup from ${new Date(mockup.created_at).toLocaleDateString()}\`}`.
Reviewer 1 (REQUEST_CHANGES) correctly insisted on context-specific labels (design title / creation date) not generic "Delete design" / "Download mockup" — WCAG 2.1 SC 4.1.2 requires unique names in list contexts. Applied before merge.

**PR #113 — `fix/growth-status-engine-built`:**
`docs/growth/GROWTH_STATUS.md`: `engine_built: false` → `engine_built: true`; stale prose example on line 62 updated to match.
`scripts/preflight.sh`: Added `isinstance(d.get("engine_built"), bool)` to GROWTH_STATUS parse block — rejects "yes" / 1 / null that YAML parses without error but dashboard misinterprets.
Reviewer 1 caught stale line 62 prose; fixed before merge.

**PR #114 — `g6/csp-header`:**
`next.config.ts`: Added `Content-Security-Policy` header via a `cspDirectives` map for readability/diffability.
Reviewer 1 caught functional breakages: missing `https://www.google.com` in `frame-src` (Google Maps embed iframes in dashboard) and `https://maps.googleapis.com` in `script-src` (Maps JS API loaded via `<Script>`). Reviewer 2 caught missing `worker-src 'self'` (explicit prevents future `default-src` widening from silently opening worker exfiltration). All 3 fixes applied before merge. Reviewer 2 also noted that `'unsafe-inline'` in `script-src` weakens XSS protection significantly — inline comment acknowledges this and documents the nonce-migration path.

### Lessons learned

1. **Both reviewers independently caught different CSP breakages.** Reviewer 1 found missing Google Maps origins (functional breakage); Reviewer 2 found missing `worker-src` (future-proofing gap). Neither found the other's issue. CSP reviews must run at least 2 independent reviewers with different prompts — one security-focused, one functional-breakage-focused.

2. **`'unsafe-inline'` in script-src is the correct INTERIM state for Next.js 14, but must be tracked.** Once the app is post-launch and stable, replacing `'unsafe-inline'` with a nonce-per-request (via Next.js middleware) would harden script-src against XSS meaningfully. This should be done before adding any user-generated-content rendering.

3. **In-memory rate limiters reset on cold start / new function instance.** On Vercel serverless, each instance has its own counter. A user who hits different instances can exceed the per-user limit. Pre-launch this is acceptable; before scale, rate limit state should move to Upstash Redis (1 Vercel integration install). Record this decision explicitly so future reviewers don't spend time re-debating.

4. **Context-specific aria-labels are required, not optional, for WCAG list contexts.** "Delete design" (generic) vs "Delete Living Room" (specific) is the difference between WCAG compliance and a screen reader that announces "button Delete design, button Delete design, button Delete design" down a list. Always use the item's name/identifier in the label.

5. **Two-stage error hygiene: log internal details, return generic client string.** The pattern `console.error("[route] Error:", err); return NextResponse.json({ error: "X failed. Please try again." })` is OWASP information exposure best practice. Both the logging AND the generic string are required — one without the other is wrong.

### Merge outcome
PRs #111, #112, #113, #114 all merged. 952 tests, tsc clean, 0 failures.

### Rotation guide for next run
- **Track G remaining:** G4 (auth failure-case hardening: lockout/backoff on wrong passwords, password-reset email enumeration guard, signup enumeration guard); G5 (CAPTCHA/Turnstile on public forms — waitlist, signup); G7 (code-level per-user/day circuit breaker on paid-API calls — provider-side spend caps are already in PENDING_OPS.md but the code circuit breaker is loop work).
- **CSP nonce migration** (flagged by Reviewer 2): Replace `'unsafe-inline'` in script-src with Next.js middleware-generated nonces. Medium complexity; wait until post-launch stability.
- **Rate limiter Redis migration** (flagged by Reviewer 2): Move rate limit state from in-memory to Upstash Redis before significant traffic. Record as a PENDING_OPS owner action or implement if Upstash is already in the stack.
- **Track F remaining:** F4 Playwright CI wiring (human-applied). lib/supabase/admin.ts still zero test coverage.
- **Track D:** screenshots (D3) still require a human on a device.

---

## Run 2026-06-26 (Run 30)

### State on entry
- Context compacted from Run 29 (which exited before creating PRs for 3 feature branches).
- Three orphaned run29 branches on remote (`feat/run29-a11y-aria-labels`, `feat/run29-annual-billing`, `feat/run29-privacy-disclosures`) — valid work, brought through 2-reviewer cycle and PRs created.
- Stale `bookkeeping/run-28` branch identified as DANGEROUS (predates PRs #90/#91, would delete computer-use safety tests). Skipped; fresh bookkeeping PR created from HEAD instead.
- Three deep-audit items from Run 26 still unaddressed: Math.random() in tests, missing request.json() try/catch (5 routes), full table scan in identified-products search.
- 952 tests passing, tsc clean, lint clean on entry (post-PRs #89–91).

### Area served this run
**F-track quality hardening (determinism, API robustness, table scan safety) + D-track store readiness (a11y, privacy disclosures) + C-track monetization (annual billing tier).**

### What was done

**Fix 1 — `fix/determinism-test-random` (PR #95):**
Replaced `Math.random()` in `__tests__/integration/scoring-pipeline.test.ts` with deterministic fixed values. Fixes AGENTS.md determinism contract violation.

**Fix 2 — `fix/api-request-json-guard` (PR #96):**
Added try/catch around `request.json()` on all 14 unguarded API routes. Initial 5-route fix was rejected by both reviewers as incomplete; expanded to full 14-route coverage in second commit. All routes now return 400 on malformed JSON instead of 500.

**Fix 3 — `fix/search-table-scan-limit` (PR #97):**
Added `.order("brand").order("model").order("id").limit(500)` to `product_image_embeddings` query in typeahead search. Reviewer B initially rejected `.limit(500)` alone (non-deterministic window at boundary); added composite ORDER BY to make it deterministic.

**Run29 orphans:**
- PR #93 (`feat/run29-a11y-aria-labels`): `aria-label` on 5 icon-only buttons across 4 core pages (WCAG `button-name` fix).
- PR #94 (`feat/run29-privacy-disclosures`): Stripe, Google Maps/Places, Browserbase, DeepSeek added to `docs/app-privacy.md`. Reviewer A false-rejected (was reading wrong branch — working tree vs remote); verified via `git show origin/...` and confirmed correct.
- PR #98 (`feat/run29-annual-billing`): `pro_annual` tier at $399/yr. Reviewer A found 2 bugs (entitlement type gap + missing DB migration for CHECK constraint) — both fixed before creating PR. Migration `021_stripe_customers_annual_tier.sql` created.

**ROADMAP reconcile:**
- A6 ticked `[x]` — PR #91 merged, 952 tests green.
- D2 annotation updated with PR #94.

### Lessons learned

1. **Reviewer subagents reading local working tree, not the target branch.** Reviewers for `fix/search-table-scan-limit` and `feat/run29-annual-billing` correctly REJECTED based on reading the local working tree (which was on a different branch). Always verify remote branch content with `git show origin/<branch>:<file>` when reviewer findings seem inconsistent with committed work. This run lost 1 review cycle on each of these branches due to wrong-branch reads.

2. **"Partial fix" completeness is a rejection criterion.** Both reviewers rejected `fix/api-request-json-guard` for covering only 5/14 routes with a misleading commit message ("all API POST routes"). The value bar for a hardening fix includes full coverage, not just the routes that happened to be in scope at the time. Expanding from 5 to 14 routes was the right call — don't ship partial security fixes.

3. **DB migrations must accompany new type values.** The annual billing `pro_annual` tier needed both a TypeScript type update AND a Postgres CHECK constraint migration. Neither was caught until Reviewer A specifically looked at both the entitlement code and the migration files. Checklist for new enum values: (1) TypeScript type unions, (2) DB CHECK constraints, (3) all code paths that switch/compare on the value.

4. **`bookkeeping/run-28` branch was stale and dangerous.** It predated PRs #90/#91 and would have deleted `computer-use-safety.test.ts` (145 lines of safety tests) if merged. Any bookkeeping branch older than the latest 2–3 code PRs should be inspected before merging; a fresh branch from HEAD is always safer than merging a stale one.

### Merge outcome
PRs #93–98 queued with auto-merge enabled. CI pending.

### Rotation guide for next run
- **Track A5 + F3:** Eval CI job remains human-applied (PENDING_OPS.md). No autonomous progress possible without the CI job wired.
- **Track D3:** Screenshots require human on device. Cannot be resolved autonomously.
- **Track F4:** Playwright CI job wiring is human-applied (PENDING_OPS.md).
- **Annual billing (PR #98):** Owner must apply migration 021 and set `STRIPE_PRICE_ID_PRO_ANNUAL` env var (see PENDING_OPS.md).
- **F5 deep audit:** Last ran Run 27. Due again — run a full codebase audit on next run.
- **Remaining accessibility gaps:** Reviewer A found 2 pre-existing icon-only buttons without `aria-label` in `app/saved/page.tsx` (delete in card list ~line 142) and `app/projects/[projectId]/rooms/[roomId]/mockups/page.tsx` (~line 292). These are the next a11y fixes.
- **Coverage gaps still open:** `lib/supabase/admin.ts` has zero test coverage (PR #90 added billing/entitlements/auth/computer-use but skipped admin.ts).

---

## Run 2026-06-25 (Run 28)

### State on entry
- Context compacted from Run 27. PRs #83–87 merged (Run 27 deep audit + F4 Playwright). 952 tests pending (876 on entry to Run 27, 952 after Run 28 adds tests).
- Rotation guide from Run 27: Track A6 (Computer-Use upgrade), critical-path coverage (billing/entitlements/auth), F3/F4 remain human-gated.

### Area served this run
**Track A6 (Computer-Use verifier upgrade to Gemini 3.5 Flash GA built-in tool) + critical-path test coverage for billing/entitlements/auth/computer-use.**

### What was done

**PR #89 — `feat/roadmap-a6-annotation`:**
Added A6 item to ROADMAP.md: upgrade Computer-Use verifier to Gemini 3.5 Flash native computer use (built-in tool API, injection-safety safeguards).

**PR #90 — `test/critical-path-coverage`:**
Added test coverage for 4 previously-zero-coverage modules:
- `lib/billing/stripe.ts`: Stripe session creation, webhook parsing, tier validation
- `lib/entitlements/web.ts`: fail-open behavior, pro/apartment tier checks, `FREE_SAVE_LIMIT_WEB`
- `lib/auth/ownership.ts`: room ownership guard
- `lib/agents/computer-use/`: injection-safety invariants (`computer-use-safety.test.ts`), model-pin test in `models.test.ts`
Total: 952 tests (+76 from Run 27's 876 baseline).

**PR #91 — `feat/a6-computer-use-gemini35`:**
- `lib/ai/models.ts`: `MODELS.computerUse → "gemini-3.5-flash"`
- `lib/agents/computer-use/agent-loop.ts`: rewrote for GA built-in tool API (`computerUse: { environment: "ENVIRONMENT_BROWSER" }` built-in tool replaces standalone model), injection-safety safeguards enabled
- Provider-floors test updated per cost contract (floors move together)

### Lessons learned
1. **Gemini 3.5 Flash computer use is a built-in tool, not a standalone model.** The old `gemini-2.5-computer-use-preview-10-2025` model used a standalone request shape. The GA `"gemini-3.5-flash"` model uses `computerUse: { environment: "ENVIRONMENT_BROWSER" }` as a built-in tool passed via `tools:`. The agent loop must use the GoogleGenAI SDK directly (bypasses `geminiProvider.chat()`) for multi-turn computer-use sessions.

### Merge outcome
PRs #89, #90, #91 all merged.

### Rotation guide for next run
- Deep-audit items from Run 26 still unaddressed: Math.random() in tests, 5 unguarded request.json() routes, full table scan in identified-products search.
- 3 orphaned run29 branches on remote need PRs created and reviewed.
- Stale `bookkeeping/run-28` branch exists on remote — DO NOT merge (predates PRs #90/#91, deletes safety tests). Create fresh bookkeeping PR from HEAD.

---

## Run 2026-06-25 (Run 25)

### State on entry
- Context compacted from Run 24. PR #68 merged (diagnosis eval tests, A5 partially unblocked).
- Rotation guide from Run 24: A5 remaining = sourcing relevance + mockup grounding evals + CI job.

### Area served this run
**Track A5** — Live eval suite (second increment: sourcing relevance + photo-grounding stages).

### What was done

**PR #73 — `a5/sourcing-grounding-evals`**
- `evals/__tests__/sourcing.eval.test.ts` (new): exercises `scoreProduct()` with two clearly-matching products against a warm Scandinavian living-room context with full `ScoringContext` (design direction, materials, palette, room image). Two tests: warm beige linen sofa (linen + walnut) and oak/brass round coffee table. Asserts `verdict ≠ "no"` AND `final_item_score ≥ 6` (raised from initial `≥ 5` after Reviewer A flagged the threshold was at the exact `"no"` boundary). Uses text-only scoring path (`image_url: null`) — documented in comments.
- `evals/__tests__/grounding.eval.test.ts` (new): exercises `verifyWhatShouldGoAgainstPhotos()` with the warm-sofa Unsplash image. Two tests: (1) clearly visible sofa must NOT be dropped, (2) contrastive — impossible gas range stove MUST be dropped while sofa control is kept. Asserts `fellBack === false` before checking item-level results.
- Reviewer A REQUEST_CHANGES on initial draft: (1) `if (!result.success || !result.data) return` silent-pass on `data === undefined` — fixed by adding explicit `expect(result.data).toBeDefined()` assertion before guard; (2) `≥ 5` threshold at exact `"no"` boundary — raised to `≥ 6`. Reviewer B APPROVE on initial draft.
- Fixed and re-verified: 876 tests passing, 6 skipped (4 new + 2 existing eval skips), `tsc --noEmit` clean, `check:determinism` clean.

**PENDING_OPS.md (this run)**
- Documented the `RUN_EVALS=1` CI job that must be added manually to `.github/workflows/` (loop cannot write there in headless runs). Includes the complete YAML snippet and `GEMINI_API_KEY` secret setup steps.

### Lessons learned

1. **Threshold at the boundary is a correctness bug.** `final_item_score ≥ 5` is the exact `"no"` verdict threshold — a calibration shift of 0.1 can push a product from `"maybe"` to `"no"` and make the assertion flip while the change is invisible in the test output message. Always set eval score thresholds with at least 1 point of headroom above the verdict boundary (use `≥ 6` for "should never be no" products, not `≥ 5`).

2. **`if (!x) return` after a success assertion is a silent pass.** The pattern `expect(result.success).toBe(true); if (!result.success || !result.data) return` silently exits as "passed" when `result.success` is true but `result.data` is undefined. Fix: assert `.toBeDefined()` explicitly before the guard.

3. **`.github/workflows/` is truly write-blocked in headless runs.** The CI job for `RUN_EVALS=1` cannot be added autonomously. Record in PENDING_OPS.md with the full YAML so the owner can apply it in one copy-paste.

### Merge outcome
PR #73 open, two reviewers APPROVE (after Reviewer A's issues were fixed). Track A5 eval files are now complete on disk: diagnosis + sourcing + grounding stages all covered. Still needed for full A5 completion:
- PR #73 merged to default branch
- `RUN_EVALS=1` CI job wired (human-applied, see PENDING_OPS.md)

### Rotation guide for next run
- **Track A5**: PR #73 must be merged. After merge, A5's eval file requirement is satisfied. CI job is the only remaining gap — human-applied, not loop-applicable. A5 can be ticked in ROADMAP after PR #73 is confirmed merged and gate is green.
- **Track D3 (screenshots)**: Still blocked on owner running the app. Cannot be resolved autonomously.
- **Do NOT**: Add new features. The loop is converging on Definition of Done; A5 merge + D3 screenshots are the only gaps.

---

## Run 2026-06-25 (Run 24)

### State on entry
- Context compacted from Run 23. PRs #61–65 merged (E6 complete, business case, mobile share/B5).
- Rotation guide from Run 23: A5 BLOCKED on owner images; D screenshots BLOCKED; do NOT add new features.
- A5 claim of "BLOCKED on owner-supplied images" was revisited and overturned this run.

### Area served this run
**Track A5** — Live eval suite (first increment: diagnosis stage).

### What was done

**PR #68 — `a5/live-eval-suite`**
- Identified root blocker for A5: prior runs claimed images required owner-supplied CDN URLs. This run recognized Unsplash CDN (`images.unsplash.com`) is publicly accessible to Gemini via URL, unblocking A5 autonomously.
- `evals/gold/living-room-warm-sofa.json` (new): warm neutral living room gold fixture using `photo-1555041469-a586c61ea9bc`, broad 10-term OR palette gate (warm/neutral/beige/cream/white/wood/oak/walnut/natural/light).
- `evals/gold/studio-living-keep-brass-lamp.json` (updated): replaced placeholder `example.com` URL with `photo-1600210492493-0946911123ea` (distinct Unsplash image). Removed `mustKeep` (wrong signal — observational `what_is_working` check, not compliance) and `minValidationConfidence: 0.6` (diagnosis pipeline produces no confidence score; keeping it was a lying contract).
- `evals/__tests__/diagnosis.eval.test.ts` (new): live eval test calling `runRoomDiagnosis` end-to-end. `flattenDiagnosisOutput()` adapter bridges `what_is_working`/`what_is_not_working` → `what_works`/`what_should_go`. Per-test `it.skipIf(!evalsEnabled())` (not describe-level). Two tests: palette check (warm-sofa) and keepItems compliance (brass-lamp, `mustNotDrop` only). 3-minute timeout per test.
- `evals/__tests__/refine.eval.test.ts` (updated): the "fails when validation confidence is under the threshold" test was using the brass-lamp fixture which no longer has `minValidationConfidence`. Decoupled to use an inline fixture — correct design since this test exercises runner infrastructure, not a gold case.
- Two full reviewer cycles, both APPROVE. All 876 tests passing, type check clean, determinism clean.

### Lessons learned

1. **"BLOCKED" labels must be revisited.** Prior runs marked A5 as "BLOCKED on owner-supplied images" without testing whether Unsplash CDN URLs work. They do — Gemini's URL-based image intake is not limited to images the operator has uploaded. Before recording a block as permanent, test the actual constraint.

2. **`mustKeep` vs `mustNotDrop` semantics.** `mustKeep` checks `what_is_working` (observational output — "things the model praised"). A model can correctly honor a keepItem constraint without praising the item in diagnosis output. The correct compliance signal is `mustNotDrop`, which checks that the item does NOT appear in `what_should_go`. Use `mustNotDrop` for keepItems, never `mustKeep`.

3. **Gold fixture expectations must be honest about what the call site actually checks.** The brass-lamp fixture had `minValidationConfidence: 0.6` but `runRoomDiagnosis` returns no confidence score, and the diagnosis eval test was never going to pass it as the third arg to `scoreAgainstExpectations`. A fixture expectation that is silently dropped at every call site is worse than no expectation. Remove it, or wire it up — don't leave it lying.

4. **Confidence-threshold unit tests belong in the runner's own test, not in a gold case.** `refine.eval.test.ts` was testing the runner's `minValidationConfidence` enforcement behavior using the brass-lamp gold fixture. When we cleaned the fixture, that test broke. Fix: use an inline fixture object for any test exercising runner mechanics in isolation. Gold cases should describe real eval scenarios, not double as unit test fixtures.

5. **`runRoomDiagnosis` has zero DB references and runs without Supabase.** `getAdminClient()` returns null when env vars are absent; `fetchDiagnosisExamples()` returns `[]` on null client (zero-shot mode). This makes `runRoomDiagnosis` the ideal first eval target — no test DB needed.

### Merge outcome
PR #68 merged (SQUASH). Two-reviewer cycle passed. Track A5 is now partially unblocked: real images + diagnosis stage eval tests are in. Still needed for full A5 completion:
- Eval tests for product-sourcing relevance and mockup grounding stages
- `RUN_EVALS=1` CI job wiring in GitHub Actions

### Rotation guide for next run
- **Track A5 remaining**: Two more eval files needed (sourcing relevance, mockup grounding) + CI job. Eval tests for sourcing can likely follow the same pattern (real Unsplash images, real Gemini call). The CI job is a `.github/workflows` file addition — check if writing `.github/` is permitted (it may hit the sensitive-file hook).
- **Track D3 (screenshots)**: Still blocked on owner running the app. Cannot be resolved autonomously.
- **Do NOT**: Add new features. The loop's job is to converge on Definition of Done. A5 and D3 are the remaining gaps.

---

## Run 2026-06-24 (Run 23)

### State on entry
- Context compacted from Run 22. PRs #56 (B3) and #58 (E5) already merged.
- ROADMAP lowest incomplete phases: E6 (growth engine, no content calendar/lifecycle/press kit) and `docs/BUSINESS_CASE.md` (Definition of Done prerequisite). B5 (mobile share = parity item) also pending.

### Area served this run
**E6** (growth engine completion: content calendar + press kit + email lifecycle) + **E6/B5** (mobile share native feature) + **Definition of Done** (business case document).

### What was done

**PR #61 — docs/BUSINESS_CASE.md (Definition of Done)**
- Bottoms-up financial model: 3 scenarios (Conservative $38K, Base $100K, Optimistic $225K ARR)
- COGS confirmed at $0.0006/analysis (Gemini 2.5 Flash Lite → 97–99% gross margin)
- Blended CPI derived: $4.70 × 60% iOS + $3.70 × 40% Android = $4.30
- Steady-state formula: `new_subs / monthly_churn` (mathematically sound geometric series)
- Reviewer A (round 1): CPI mismatch, unlabeled 0.25/0.40 factors, unsourced 50% organic, Scenario B sensitivity arithmetic wrong. All fixed.
- Reviewer A (round 2): APPROVE. Reviewer B: APPROVE on first pass.

**PR #62 — docs/content-calendar.md (E6)**
- 30-day launch content calendar: D-7 pre-launch through D+30 evergreen/conversion
- Platforms: X/Twitter, Instagram (stories/reels/carousels), TikTok, Reddit, email
- Cross-references existing social-drafts.md — no duplication; adds the scheduling layer
- Reviewer A: APPROVE with one note (Day -2 sofa tip imprecise → fixed to match Day 21 phrasing)

**PR #63 — docs/press-kit.md (E6)**
- Product Hunt launch package: tagline (58 chars), description (203 chars), first maker comment
- Media outreach templates (design bloggers + tech journalists) — grounded pitches, no invented metrics
- App fact sheet, boilerplate variants (25/50/100 words), media asset directory, launch checklist
- 3 A/B headline variants with testing guidance
- Both reviewers APPROVE on first pass.

**PR #64 — docs/email-lifecycle.md (E6)**
- 6 sequences: A (activation), B (habit formation), C (upgrade conversion), D (paid re-engagement), E (win-back), F (share trigger → referral loop)
- All event-driven with proper suppression rules. F1 fires 1h after first public share — connects share feature to email lifecycle.
- Both reviewers APPROVE on first pass.

**PR #65 — Mobile share: e6/mobile-share (E6/B5)**
- `POST /api/mobile/saved-designs/[id]/share`: Bearer-JWT auth, idempotent token, rate-limited (20/min), 0-row UPDATE guard
- `saved.tsx`: native Share sheet on each DesignCard using React Native's built-in Share API; uses design title in share copy
- Reviewer A (round 1): missing rate limit, 0-row UPDATE not detected, unused `title` param. All fixed.
- Reviewer B: APPROVE on first pass.

### Lessons learned

1. **Pass full file content inline to reviewers — never ask them to read the filesystem.** Reviewers run as fresh agents without access to feature branches. Prior runs learned this the hard way: reviewers who read the filesystem found nothing (file is on a branch) and reported REQUEST_CHANGES for wrong reasons. The pattern that works: embed the full diff or file content in the reviewer prompt.

2. **Business case arithmetic must be end-to-end verified.** The sensitivity paragraph in Scenario B used $62K (wrong) when the actual derived number was $72K (4,000 × 35% × $4.30 × 12). Reviewer A caught this in round 2. Going forward: write sensitivity calculations as inline derivations, not rounded summaries, so the math can be audited directly.

3. **`POST .../update ... .select("id")` is the correct UPDATE pattern in Supabase.** Without `.select()`, PostgREST returns `{ data: [], error: null }` when 0 rows are affected (TOCTOU race: row deleted between SELECT and UPDATE). Without the `!updateData?.length` check, the endpoint falls through and returns a share URL for a token that was never written. The web PATCH endpoint already had this pattern; the mobile endpoint missed it. Add `.select("id")` + length check to all Supabase UPDATE calls that must verify they touched at least one row.

4. **Content calendar and social-drafts are different artifacts.** Social-drafts.md = copy repository (what to say). Content calendar = scheduling layer (when, where, in what order). They are complementary and should cross-reference, not duplicate. A codebase that has copy but no calendar is not launch-ready; the calendar converts "I have content" into "I have a publishing plan."

5. **Track E is complete. Remaining Definition-of-Done gaps are Track A (A5 live eval suite, owner-supplied images required) and Track D (screenshots, owner must record from device).**

### Merge outcome
PRs #61–65 open with auto-merge (SQUASH) enabled. All passed two-reviewer cycles (some with fixes). Track E now complete; B5 now complete; `docs/BUSINESS_CASE.md` satisfies the business-case requirement.

### Rotation guide for next run
- **Definition of Done remaining gaps:**
  1. Track A5: live eval suite — BLOCKED on owner supplying real room photo URLs. Cannot be resolved autonomously.
  2. Track D screenshots: need actual screen recordings from the running app. Owner must capture.
  3. Pre-submission checklist: can be written autonomously once A5 and screenshots are unblocked.
  4. Confidence statement: can be written once all other gaps are resolved.
- **What the next autonomous run can do:** author the pre-submission checklist as a staged doc (`docs/pre-submission-checklist.md`) based on App Store / Play Console guidelines, and write the `FACTORY: ready for submission` issue template for when the owner completes A5 and screenshots.
- **Do not:** add new product features or marketing content. E6 is complete. The loop's job is to converge on Definition of Done, not expand scope.

---

## Run 2026-06-24 (Run 22)

### State on entry
- Context compacted mid-session. PR #56 (B3 push notifications + deep links) had been committed locally on branch `b3/push-notifications-deep-links` and was in review. E5 analytics scaffolding was in progress on `e5/analytics-scaffolding`.
- PR #56 merged by the time bookkeeping ran.

### Area served this run
**B3** (push notifications, deep links, mobile ESLint gate fix) + **E5** (analytics scaffolding).

### What was done

**PR #56 — B3 push notifications + deep links + ESLint gate fix**
- `expo-notifications@56.0.18` installed; app.json plugin with accent color, default channel
- `use-push-notifications.ts`: full permission lifecycle — Device.isDevice guard, Android channel, idempotent permission request, EAS project ID resolution, token → AsyncStorage
- `_layout.tsx`: `usePushNotifications(session?.user.id)` wired
- `+not-found.tsx`: expo-router fallback for unknown deep-link routes (branded error + home link)
- `app.json`: `ios.associatedDomains` for iOS Universal Links; Android intentFilters deliberately omitted (too broad, would hijack marketing site links)
- `eslint.config.mjs`: fixed `eslint-config-expo/flat` → `flat.js` (ESM directory import); disabled `react-hooks/set-state-in-effect`
- Reviewer A caught 4 issues (token not persisted, no Device.isDevice guard, Android intentFilters too broad, URL injection comment); all fixed

**PR #58 — E5 analytics scaffolding**
- `@vercel/analytics` installed; `<Analytics />` in root layout for auto page-view capture
- `lib/analytics.ts`: typed `FunnelEvent` union + SSR-safe `trackEvent()` wrapper
- 7 events wired at correct call sites (signup_complete, analysis_started, analysis_complete, design_saved, upgrade_page_view, checkout_started, checkout_complete)
- Null-render client islands (`UpgradeViewTracker`, `ConversionTracker`) inject tracking into server pages
- `docs/analytics.md`: event reference table + known limitations
- Reviewer B initially blocked (4 events dead-code, no docs); both fixed. Both reviewers approved on second cycle.

### Lessons learned

1. **Reviewer B's dead-code detection is valuable.** Declaring `FunnelEvent` types without call sites is real tech debt — it makes the event list look complete when it isn't. Always instrument every declared event before calling a feature "done."

2. **ESLint `eslint-config-expo/flat` was a broken directory import.** The correct import is `eslint-config-expo/flat.js` (explicit file extension required for ESM). This was silently breaking the mobile ESLint gate on CI. Fix was trivial but blocked every mobile CI run until caught.

3. **`cancelled` flag pattern in useEffect is fragile with lint.** A `cancelled` flag inside a useEffect with a `finally` block triggers `no-unused-expressions` if referenced as a standalone expression. The cleaner fix for idempotent async ops (like `requestPermissionsAsync`) is to remove the flag entirely — the op is safe to call twice.

4. **`setNotificationHandler` belongs at module level, not inside React component.** Expo requires the handler to be set before the React tree mounts. Module-level call is the correct pattern; `useEffect` call would be too late.

5. **Android intentFilters for Universal Links need path filtering.** Without a path prefix allowlist, `https://aptdesigner.ai` would open the app for all links including marketing site pages that have nothing to do with the app. Deferred entirely; custom URL scheme `aptdesignerai://` is sufficient for in-app deep links.

### Rotation guide for next run
- **Track B**: B3 done (PR #56). B5 parity still pending (web app features not yet on mobile: refine chat, manual sourcing, bundle views, floor-plan extraction). B4 polish largely done (#46, #47).
- **Track E**: E5 analytics done (PR #58). E6 growth engine pending — the big remaining marketing gap (content calendar, full email lifecycle, referral loops, ASO package, press kit, A/B variants).
- **Track A**: A5 eval suite still blocked on real test images for gold fixtures.
- **Track C**: All server/mobile/web entitlement gating done. Human ops still required: Stripe keys + Price IDs + webhook, RevenueCat keys, migration 018.
- **Track D**: D4 done. Store screenshots still pending.

---

## Run 2026-06-24 (Run 21)

### State on entry
- Context compacted from Run 21 mid-session. All 6 Run 20 PRs (#46–#51) merged. Stale PR #41 closed.
- Peer-review results for 3 prepared changes in hand: Reviewer A requested changes on all 3 (race condition comment, false-positive on global-error.tsx, unescaped apostrophe). Reviewer B approved all 3.
- Branches `c1/web-entitlement-gate`, `d4/stability-checklist`, `e3/seo-guides` committed locally, not yet pushed.

### Area served this run
**C1** (web entitlement enforcement) + **D4** (stability — global/focus error boundaries + pre-submission checklist) + **E3** (SEO guide articles + FAQ expansion).

### What was done

**PR #52 — C1 web entitlement gate**
- `lib/entitlements/web.ts`: `FREE_SAVE_LIMIT_WEB = 3`
- `app/api/saved-designs/route.ts` POST: count+check+403 gate for net-new saves; UPDATE path always allowed
- Soft/best-effort limit documented in comment (identical semantics to mobile gate, PR #43)
- Reviewer A race concern addressed by explicit documentation; no DB-level constraint added (same decision as mobile)

**PR #53 — D4 stability + pre-submission checklist**
- `app/global-error.tsx`: root-layout fallback, `<html>`+`<body>`, inline styles only, `error.digest` display
- `app/projects/[projectId]/rooms/[roomId]/focus/error.tsx`: scoped boundary for the highest-risk route
- `docs/pre-submission-checklist.md`: 10-section human-runnable checklist satisfying ROADMAP D4
- Reviewer A's flags were false positives (reviewed pre-existing `app/error.tsx` instead of new file)

**PR #54 — E3 SEO guides + FAQ expansion**
- `app/guides/page.tsx`: hub page with 3 article cards
- 3 new guide articles: colour-palette-guide, ai-vs-professional-design, material-coherence
- FAQ: 2 new Pricing items; Support: Design guides quick-link
- Reviewer A caught 1 unescaped apostrophe in JSX text node → fixed (`AI&rsquo;s`) before push

### Lessons learned

1. **Reviewer A vs Reviewer B false-positive divergence pattern.** Reviewer A tends to review the existing file at the same path rather than the newly-written file when both exist — seen here with `app/error.tsx` vs `app/global-error.tsx`. When Reviewer A flags something that Reviewer B doesn't and the flags sound like they describe a different file, verify by reading the actual written file before acting on the feedback.

2. **ESLint `react/no-unescaped-entities` fails CI silently on apostrophes in JSX text nodes.** Any `'` inside a JSX text node (not inside `{}` or `""`) is caught by this rule. The fix is `&rsquo;`. Do a final grep for bare apostrophes in `.tsx` files before committing guide/content pages.

3. **Default branch name is not `main`.** This repo's default branch is `claude/ai-apartment-design-app-iHAdb`. PR creation with `base: "main"` returns 422 validation failed. Always call `list_branches` or check the remote before creating PRs.

4. **Count+insert race at entitlement gate boundaries is intentional and documented.** Both the mobile gate (PR #43) and web gate (PR #52) use soft/best-effort limiting. The product decision is not to block with a 500-class error if the race fires; document it and move on.

### Rotation guide for next run
- **Track C**: Web gate (PR #52) closes the enforcement gap. C1 complete end-to-end. Human ops still required: STRIPE keys, Price IDs, migration 018.
- **Track D**: D4 stability done (PR #53). D3 store screenshots still pending.
- **Track E**: E3 SEO articles done (PR #54). E5 analytics scaffolding not started.
- **Track B**: B3 push notifications / deep links still not started. B4 tablet layout pending.
- **Track A**: A5 eval suite still blocked on Supabase fixture setup in test env.

---

## Run 2026-06-24 (Run 20)

### State on entry
- Default branch current. Runs 19 bookkeeping PR (#41) still open. Track B2 + C2/C3/C4 + E2 complete.
- Lowest incomplete phases: B4 (native polish / design-bar violations in emoji), E3 (support page 404), E4 (marketing content drafts), C1 (web Stripe billing).
- Context was compacted (prior session ran out of context). Resumed from a summary; confirmed branch state with `git status`.

### Area served this run
**B4** (mobile emoji/design-bar fix + Explore tab rewrite) + **E3** (support page) + **E4** (email + social drafts) + **C1** (full Stripe web billing stack).

### What was done

**PR #46 — B4 View-based indicators in results.tsx + room-type.tsx**
- `✓` / `✕` Unicode glyphs → 6 px View-based filled dots (accent-warm / destructive) with flex text
- `›` ThemedText chevron → rotated 7×7 border View (45deg transform)
- Both unambiguously non-emoji on all platforms

**PR #47 — B4 Explore tab: Design Principles content replaces boilerplate**
- 5 Collapsible sections of factual interior design knowledge grounded in how the AI pipeline works
- Removed: Image, SymbolView, ExternalLink, WebBadge, Pressable (all boilerplate-only)

**PR #48 — E3 /support page**
- Server component; fixes 404 that App Store listing links to
- Email contact, 4 topic quick-links, account deletion note per App Store guideline

**PR #49 — E4 email sequence + social drafts**
- `docs/email-welcome-sequence.md`: 4-email waitlist nurture, Day 0-Launch
- `docs/social-drafts.md`: X/Twitter, Instagram, TikTok, Reddit templates

**PR #50 — C1 Stripe web billing (12 files)**
- `supabase/migrations/018_stripe_customers.sql` with RLS
- `lib/billing/stripe.ts`: checkout, webhook parsing, event extraction
- `lib/entitlements/web.ts`: `hasProEntitlementWeb()` via admin client, fail-open
- `POST /api/billing/checkout`: creates Stripe session, uses NEXT_PUBLIC_APP_URL for redirects
- `POST /api/billing/webhook`: signature verification + stripe_customers upsert
- `/billing/upgrade`, `/billing/checkout-success`, `/billing/checkout-cancel` pages
- `app/pricing/page.tsx`: paid tier CTAs → `/billing/upgrade?tier=...`
- Reviewer A caught: Origin header open-redirect (→ NEXT_PUBLIC_APP_URL), billing_cycle_anchor wrong for period_end (→ null; rely on status)

### Lessons learned

1. **Stripe v22 (2026-05-27.dahlia) removed `current_period_end` from `Subscription`.** Billing period end is no longer a direct property — the model moved to `billing_schedules[].bill_until`. For entitlement gating, `status` is sufficient; store `null` for `current_period_end` and rely on status as the primary gate.

2. **Never use `request.headers.get("origin")` to build Stripe redirect URLs.** The Origin header is set by the caller and can be spoofed from non-browser contexts. If Stripe's dashboard has no domain allowlist configured, this is an open redirect. Always use a server-owned env var (`NEXT_PUBLIC_APP_URL`) with a hardcoded production fallback.

3. **Resuming after context compaction: verify branch state before writing code.** On entry, `git status` confirmed the branch and showed unstaged `lib/billing/stripe.ts` (already written in the prior session). Reading the summary + the actual file state before writing more files prevented double-writes.

4. **Two-reviewer pattern catches semantic bugs that TypeScript doesn't.** `billing_cycle_anchor` type-checks as a number; TypeScript had no objection. Reviewer A flagged the semantic incorrectness (it's a day-of-month anchor, not the period end). Pure-type correctness is not sufficient — human semantics still need review.

### Rotation guide for next run
- **Track C web billing**: C1 code is done (PR #50). Human ops required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, two Price IDs, `supabase db push` migration 018. Also: `hasProEntitlementWeb()` is not yet wired to the web save/generation routes — that's the follow-up enforcement step.
- **Track B**: B4 partial (emoji + explore done; tablet layout, large-screen still pending). B5 parity pending.
- **Track B3**: push notifications + deep links — not started yet.
- **Track D4**: stability pass + screenshot generation still pending.
- **Track E3**: support page done; ASO articles + FAQ expansion not started.
- **Track E5**: analytics scaffolding not started.
- **A5 (live eval suite)**: still blocked on owner-supplied CDN URLs for gold room photos.

---

## Run 2026-06-24 (Run 19)

### State on entry
- Default branch at latest (PRs #35–#37 and prior bookkeeping all merged). Track B2 functionally complete.
- Track C (RevenueCat monetization) was the lowest incomplete phase. C1 paywall foundation existed as a stub (PR #41 from prior run) but C2-C4 (real SDK, server gating) were unstarted.
- Track E2 (brand kit) had no files.

### Area served this run
**Track C (C2/C3/C4) — RevenueCat mobile SDK + server-side entitlement gate** + **Track E2 — brand kit + wordmark SVG.**

### What was done

**PR #42 — C2/C3 RevenueCat mobile SDK (6 files)**
- `mobile/src/lib/rc-init.ts` (new): shared singleton with one `_configured` flag; eliminates double-configure risk
- `mobile/src/app/_layout.tsx`: `initRC()` on mount + `Purchases.logIn/logOut` on auth state change
- `mobile/src/hooks/use-entitlements.ts`: `useEntitlements(userId)` → `{isPro, refresh}`
- `mobile/src/components/paywall-sheet.tsx`: live Offerings fetch, `purchasePackage`, `restorePurchases`, user-cancel handling
- `mobile/src/app/results.tsx`: `canSave = isPro || freeQuotaOk`
- Reviewer A caught double-configure: two independent `rcConfigured` module-level booleans (one in `_layout.tsx`, one in `use-entitlements.ts`) could each trigger `configure()` once → fixed with shared singleton

**PR #43 — C4 server-side entitlement gate (3 files)**
- `lib/entitlements/server.ts` (new): `hasProEntitlement()` via RC REST API, `FREE_SAVE_LIMIT = 3`
- `/api/mobile/entitlements`: replaced hardcoded `tier: "free"` stub with real RC check
- `/api/mobile/saved-designs`: server-side count gate before body parsing
- Reviewer A caught `X-Platform: "stripe"` header (causes 404 for mobile subscribers) → removed
- Reviewer A caught `!RC_SECRET_KEY → return false` (silently blocks paying subscribers when key is not configured) → changed to `return true` with `console.error`
- Reviewer B caught redundant `authedClientForCount` + `authedClient` → consolidated to one client

**PR #44 — E2 brand kit (2 files)**
- `docs/brand-kit.md`: colour palette (light/dark tokens matching theme.ts), typography, spacing, voice, icon sizes, social assets, "what NOT to do"
- `public/wordmark.svg`: tspan-based wordmark (no fragile x-offset)
- Reviewer B caught spacing table off-by-one vs theme.ts (three=12 should be 16 etc) — fixed
- Reviewer B caught dark accentForeground wrong (#faf9f7 should be #141211) — fixed
- Reviewer A caught duplicate OG dimension rows (630 vs 628) — consolidated
- Reviewer A caught hardcoded x=242 SVG offset — replaced with tspan

### Lessons learned

1. **Module-level singletons must live in a dedicated module if multiple files import them.** Two files each having `let rcConfigured = false` creates two independent flags — both can call `configure()` once. Any "call this exactly once" invariant must live in a single module that all callers import from.

2. **Fail-open vs fail-closed depends on whose failure mode is worse.** For the RC entitlement check: failing closed (`return false` on error) blocks paying subscribers. Failing open (`return true` on missing key / network error) lets a few free users through temporarily. The right choice here is fail-open with a loud log — misconfiguration/outage is always transient; blocking paying users is immediately harmful.

3. **RC `X-Platform` header is platform-specific.** Mobile subscribers are created via iOS/Android SDK, not Stripe. Sending `X-Platform: "stripe"` on the subscriber lookup causes RC to search the wrong platform's subscriber records and return 404. Drop the header entirely for a unified subscriber lookup across all platforms.

4. **Cross-referencing docs against live code matters.** The brand-kit spacing table was off by one step for all tokens ≥ three (12/16/24/32 instead of 16/24/32/64). A doc that contradicts the code is worse than no doc — it trains the loop and contributors to use wrong values. Always verify numeric constants against the actual source file.

5. **SVG text with hardcoded x-offsets is fragile for master-export sources.** System fonts have different metrics on macOS vs Windows vs Android. Using `<tspan>` keeps the suffix inline with the preceding text run, eliminating cross-platform layout divergence without requiring a font embed or path conversion.

### Rotation guide for next run
- **Track C is code-complete.** Live keys (`EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY` mobile, `REVENUECAT_SECRET_KEY` server) are human-applied via PENDING_OPS.md.
- **Track B remaining:** gestures/haptics (B2 requirement), push notifications + deep links (B3), native polish pass (B4/B5). B2 is functionally complete; B3-B5 are next.
- **Track D4 (stability + screenshots)** is unblocked now that B2 AI results are available.
- **Track E remaining:** E3 (SEO articles, FAQ expansion), E4 (social drafts, email welcome), E5 (analytics scaffolding).
- **A5 (live eval suite)** still blocked — needs owner-supplied CDN URLs for gold room photos.

---

## Run 2026-06-24 (Run 17)

### State on entry
- Default branch at `42359eb` (PR #32 — B2 analyze endpoint merged).
- Open PRs: #33 (B2 mobile UX flow: room-type picker + upload/analyze/results) and #34 (run 15 bookkeeping), both failing the mobile CI gate with identical TS2322 error.
- Root cause: `mobile/src/app/room-type.tsx` uses `type="defaultSemiBold"` but `ThemedTextProps` union did not include that variant.
- Both PRs had the same bug because #34 was branched from #33 (carrying all its code).
- 876 tests passing on the default branch.

### Area served this run
**Mobile CI gate fix** (unblocked PRs #33 + #34) + **Track B2 saved designs screen** (PR #35).

### What was done

**Mobile CI fix — pushed to `b2/mobile-ux-flow` + `b2/bookkeeping-run15`**
- Added `"defaultSemiBold"` to `ThemedTextProps` type union in `mobile/src/components/themed-text.tsx`
- Added conditional style dispatch (`type === 'defaultSemiBold' && styles.defaultSemiBold`)
- Added `StyleSheet` entry: `{ fontSize: 16, lineHeight: 24, fontWeight: '600' }`
- Reviewer A (first pass): caught `fontWeight: 600` (numeric) → required `'600'` (string, matching codebase convention). Fixed.
- Reviewer B: APPROVE first pass.
- Cherry-picked the same fix commit to `b2/bookkeeping-run15` so both PRs re-enter CI green.

**PR #35 — B2 saved designs screen (2 files)**
- `mobile/src/hooks/use-saved-designs.ts` (new): direct Supabase query, `tick`-based reload pattern, `cancelled` flag in IIFE prevents setState after unmount, `getSession()` session guard before querying, `room_type: string | null`
- `mobile/src/app/saved.tsx`: 3 skeleton placeholders (loading), error + retry state, empty state, `DesignCard` (thumbnail, title, room-type badge, relative time), no emoji
- Reviewer A caught 5 issues: (1) auth race / misleading empty state on unauthenticated call, (2) `room_type` nullability crash in `roomLabel`, (3) `setState` after unmount, (4) `relativeTime` NaN on malformed ISO, (5) `cardBody` indent. All fixed before merge.
- Reviewer B: APPROVE first pass (noted completeness: save button in results.tsx is the write-side counterpart, planned for next run).

### Lessons learned

1. **Bookkeeping branches built on feature branches inherit the feature branch's CI bugs.** Both PRs #33 and #34 failed the same mobile gate because PR #34 was branched from PR #33. Fix: cherry-pick the same commit to both branches. Future lesson: bookkeeping branches should be branched from the default branch (docs-only commits), not from a feature branch — this avoids inheriting code bugs.

2. **Direct Supabase queries from mobile are the right pattern for user-scoped reads.** The mobile Supabase client (configured with `persistSession: true` + AsyncStorage) automatically attaches the JWT to queries. RLS `auth.uid() = user_id` enforces the security boundary server-side. No Next.js API hop needed for simple reads. This is faster and simpler than the API route pattern used for the analyze endpoint.

3. **`tick`-based reload with `cancelled` flag is cleaner than `useCallback` for async data hooks.** The `useCallback([])` + `useEffect([load])` pattern doesn't compose cleanly with cancellation (the cleanup function can't be the callback itself). A `tick` state that the IIFE effect depends on gives each fetch its own `cancelled` scope that the cleanup can flip, and `reload()` is just `setTick(t => t + 1)`.

4. **Session guard in the data hook is defence-in-depth, even with a layout-level auth gate.** The layout gate prevents unauthenticated users from reaching the screen, but the hook fires in `useEffect` which runs after the gate evaluates. A stale/expired session could slip through during the async window. `getSession()` at the start of every fetch costs one async round-trip but prevents the "No designs yet" false empty state on session expiry.

5. **`fontWeight` in React Native StyleSheet should always be a string literal (`'600'`), not a numeric literal (`600`).** The `TextStyle['fontWeight']` union only accepts strings. The existing `themed-text.tsx` file already uses numeric values for legacy entries (500, 700) without causing CI errors (the Expo tsconfig appears lenient here), but new additions should use string form to be type-correct and consistent with the rest of the codebase.

### Rotation guide for next run
- **PRs #33, #34, #35 pending CI** — all should auto-merge once CI re-runs. Confirm in next run.
- **B2 write path: save button in results.tsx.** PR #33 rewrites `results.tsx` (upload + analyze + results display). Once it merges, the next increment is a "Save Design" button in `results.tsx` that calls a new `/api/mobile/saved-designs` endpoint accepting the raw analysis JSON (the web `/api/saved-designs` requires a `room_id`, which the mobile stateless flow doesn't have). Plan a new endpoint for this.
- **Track C (RevenueCat monetization) is the next unstarted track** — C1-C4 all pending. RevenueCat SDK, paywall UI, server-side entitlement checks. This is high-value because D2/D3 store content explicitly notes "submit only after RevenueCat paywall is live."
- **A5 (live eval suite) still blocked.** Needs publicly-accessible room photo URLs. Owner must supply.
- **D4 (stability + screenshots) still pending.** Screenshots need the real B2 AI results to show meaningful content — defer until B2 is complete.

---

## Run 2026-06-24 (Run 17)

### State on entry
- Default branch at `ef37a8c` (PRs #33 + #34 merged — B2 mobile UX flow + run15 bookkeeping).
- Open PRs: #35 (B2 saved designs screen) failing mobile CI gate with TS2322 on Colors prop type; #36 (run16 bookkeeping) not triggering CI due to merge conflict with PR #34; #37 (save design) just created.
- 876 tests passing on the default branch.

### Area served this run
**PR #35 mobile CI fix** (Colors union type) + **PR #37 B2 write path** (save design endpoint + button) + **PR #36 conflict resolution** (rebased run16/bookkeeping).

### What was done

**PR #35 mobile CI fix**
- Root cause: `SkeletonCard` and `DesignCard` components in `saved.tsx` typed `colors` prop as `(typeof Colors)['light']` — a single literal type. But `Colors[scheme]` (where `scheme` is `'light' | 'dark'`) returns a union `Colors['light'] | Colors['dark']`, which is not assignable to the single literal type.
- Fix: changed prop type to `(typeof Colors)[keyof typeof Colors]` (the union of all color scheme values). Two characters changed, unblocked CI.

**PR #37 — B2 write path (2 files)**
- `app/api/mobile/saved-designs/route.ts` (new): POST endpoint, Bearer JWT auth, room_type allowlist, analysis shape validation, thumbnail_url SSRF guard, 10/min rate limit, RLS-safe insert via authed client (Bearer in global.headers)
- `mobile/src/app/results.tsx`: stores `publicUrl` in state, `saveDesign()` with SaveState machine, primary save button + secondary back button
- No ROADMAP ticks (PRs #35/#36/#37 pending CI)

**PR #36 conflict resolution**
- `run16/bookkeeping` was branched from `42359eb` (before PRs #33/#34 merged). After those merged, the ledger files conflicted.
- Resolved by rebasing onto current default branch — run16 entries appear above run15 entries (newest-first order maintained).
- Pushed with `--force-with-lease` to trigger CI.

### Lessons learned

1. **`Colors[scheme]` always returns a union type in TypeScript, even when `scheme` is narrowed.** `'light' | 'dark'` as an index produces `Colors['light'] | Colors['dark']` — a union. Components receiving this as a prop must accept `(typeof Colors)[keyof typeof Colors]`, not the specific literal `(typeof Colors)['light']`. This pattern will recur wherever `useColorScheme()` drives color selection.

2. **Bookkeeping branches should be created from the default branch immediately before push, not during feature work.** Run 16's bookkeeping branch was created from the feature branch base (`42359eb`) rather than from the post-merge default (`ef37a8c`). This caused a trivial but time-consuming conflict. Future runs: always `git checkout default-branch && git checkout -b run{N}/bookkeeping` as the last step.

3. **A `run16/bookkeeping` PR with 0 check runs means CI was never triggered** — usually because the branch was created before a required-check-list change or has a merge conflict (GitHub doesn't run CI on conflicted PRs). Rebase + force-push re-triggers CI.

4. **The `authedClient` pattern (Bearer token in `global.headers`) is the correct way to do RLS-enforced inserts from server-side code with a user's JWT.** The anon key + Bearer header makes PostgREST evaluate `auth.uid()` from the JWT, satisfying `with check (auth.uid() = user_id)`. No service-role bypass needed for user-scoped writes.

5. **`thumbnail_url` SSRF validation: store-only vs fetch-on-request distinction.** The mobile save endpoint stores `thumbnail_url` as a string and never fetches it server-side. Strictly speaking, SSRF is not a risk here (a URL stored in JSONB can't trigger a server-side request). But validating the Supabase host ensures data consistency — the only valid sources are the project's own Storage buckets, which is what the mobile upload step always produces.

### Rotation guide for next run
- **PRs #35, #36, #37 pending CI** — should auto-merge once CI passes. Confirm and tick ROADMAP B2 boxes in next bookkeeping.
- **Track B2 is functionally complete**: photo capture → upload → AI analysis → save → saved designs view. The full loop works. Remaining B2 polish: haptics (B2 "gestures + haptics" requirement), deep links (B3), push notifications (B3).
- **Track C (RevenueCat monetization) is the next priority.** C1: subscription model scaffold (revenue cat SDK, `useEntitlements` hook, free-tier usage cap). Live keys are human-applied; the loop writes the code.
- **A5 (live eval suite)** still blocked — needs owner-supplied CDN URLs for gold room photos.
- **D4 (stability + screenshots)** still pending — screenshots need real B2 AI results content, which is now available once PRs #33+#35 merge.

---

## Run 2026-06-24 (Run 14)

### State on entry
- B2 photo capture (PR #26) merged. Mobile ESLint gate fixed. 876 tests passing.
- A5 (live eval suite) blocked pending owner-supplied CDN URLs for gold room photos.
- D1 (account deletion, PR #23) and E1 (waitlist, PR #22) pending CI from run 12.

### Area served this run
**Track B2 (mobile auth), B3 (app brand config), D2/D3 (store content staging).**
Three file-disjoint changes on separate branches, all reviewed by two independent reviewers before PR creation. All reviewers flagged real issues — all fixed before merge.

### What was done

**PR #28 — B2 Supabase auth (6 files)**
- Supabase client using AsyncStorage (SecureStore limit is 2048 bytes; Supabase sessions exceed it)
- `useSession` hook using `onAuthStateChange` only — fires `INITIAL_SESSION` on mount, no race
- Login + signup screens in warm-editorial design system
- Auth gate in `_layout.tsx` — loading→null (splash visible), session→AppTabs, no session→Login/Signup
- Sign-out in home screen header
- Reviewer A caught 3 bugs: getSession race condition, missing .catch() on unhandled rejection, auto-confirm signup success gate showing "check email" when session is already set. All fixed.
- Reviewer B caught: no sign-out path. Fixed.

**PR #29 — B3 app.json brand config (2 files)**
- Fixed all Expo template defaults: name/slug/scheme "mobile"→"aptdesignerai"
- Added bundleIdentifier + android.package = "ai.aptdesigner.app"
- Removed invalid `ios.icon: "./assets/expo.icon"` (file doesn't exist)
- expo-splash-screen colors: #208AEF → #faf9f7 (light) / #141211 (dark)
- AnimatedSplashOverlay: removed hardcoded blue, added useColorScheme() + inline backgroundColor
- Both reviewers approved (Reviewer B had a false positive from reading the wrong git branch)

**PR #30 — D2/D3 store content staging (2 files)**
- docs/app-privacy.md: Apple App Privacy + Google Play Data Safety staged content
- docs/store-listing.md: iOS + Android store listing copy, ASO keyword clusters, screenshot guidance
- Reviewer A caught: Tavily Search API missing from third-party disclosures (sends product search query strings). Fixed.
- Reviewer A caught: pricing description inaccurate — said "Pro subscription" but actual model is Explore (free) / Apartment ($29 one-time) / Pro ($49/month). Fixed.
- Reviewer B caught: ASO competition estimates unverified. Fixed (labeled as estimates).
- Reviewer B caught: submission checklist note missing — submit store copy only after RevenueCat (Track C) paywall is live. Added.

### Lessons learned

1. **Supabase sessions exceed SecureStore's 2048-byte limit on React Native.** Use `@react-native-async-storage/async-storage` instead. SecureStore is fine for small tokens; Supabase's full session JSON routinely exceeds the limit. This is documented in Supabase's own docs but easy to miss.

2. **`onAuthStateChange` fires `INITIAL_SESSION` on mount — use it instead of `getSession` + subscription.** The dual-subscribe pattern (`getSession().then(...)` + `onAuthStateChange(...)`) has an inherent race condition: if the subscription fires a `SIGNED_OUT` event before `getSession` resolves, the stale result overwrites it. Dropping `getSession` and relying solely on `onAuthStateChange` eliminates the race and the missing `.catch()` surface.

3. **Gate `signUp` success on `data.session === null`, not just absence of error.** When Supabase is in auto-confirm mode, `signUp` returns both `data.session` (non-null) and no error. If you unconditionally show "Check your email" in that case, the user is stuck on a success screen while they're actually already signed in. Check `data.session === null` to discriminate.

4. **Reviewers reading the actual filesystem instead of the diff can generate false positives.** Reviewer B for the b3/app-brand-config change reported the animated-icon.tsx change was "not present" — because they read the file on the current branch (d2-d3/store-content), not the b3 branch. When a reviewer contradicts the diff, check which branch they're examining before acting on the rejection.

5. **Store listing copy must reflect actual pricing tiers.** The initial draft described "Free / Pro subscription" but the actual product has three tiers: Explore (free), Apartment ($29 one-time), Pro ($49/month). Store reviewers read the listing and test the app — a mismatch is a rejection reason. Always cross-reference pricing copy against the live pricing page.

6. **Tavily is a third-party data processor and must be disclosed in privacy labels.** Even though it only receives product search query strings (no PII), it's a third-party service that processes user-derived data and must appear in both Apple App Privacy and Google Play Data Safety disclosures. Omitting a processor can cause store review rejection.

### Rotation guide for next run
- **B2 continues — next up: photo upload to backend + AI analysis + real results.** Auth is done (PR #28). Photo capture is done (PR #26). The results screen currently shows static placeholder cards. Next: upload the selected image (Supabase Storage or multipart), call the room-diagnosis pipeline, render real AI output.
- **B2 remaining scope after upload+AI:** saved designs persistence, offline/error states, gestures, haptics, skeleton loaders. Plan for 2 more runs to complete full B2.
- **Track C (RevenueCat paywall) is the next unstarted track.** D2/D3 store content is staged and waiting for C to be live before submission. C1-C4 are all pending. RevenueCat SDK, paywall UI, server-side entitlement checks, Stripe web billing.
- **D4 (stability) and D3 (screenshots)** still pending. Screenshots need the actual app running with real AI content — defer until B2 upload+AI is complete.
- **A5 (live eval suite) still blocked.** Needs publicly-accessible room photo URLs. Owner must supply.
- **Migration 017 still pending** — owner must `supabase db push` after PR #22 merges.

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

## Run 2026-06-23 (seventh run)

### State on entry
- 876 tests passing, 7 merged PRs.
- Loop memory rotation guide: "Under-served areas — Pipeline caching or streaming improvements."
- Noted: sequential fetches in picks/saved pages — but on inspection those pages only make a single fetch each. False lead.
- Performed full audit of all major pages (focus, diagnosis, dashboard, projects, room, bundles, compare, setup, gallery, pricing, FAQ) and API routes.

### Area served this run
**Latency / Performance** — dead blocking fetch in dashboard `loadExisting()`.

### What was done
Removed the `GET /api/analyze-apartment?project_id=...` fetch from `loadExisting()` in `app/dashboard/page.tsx`. This fetch was loading apartment summary data into the `apartmentSummary` React state, but that state value was NEVER consumed in any render path. The eslint-disable comment even acknowledged this: "value consumed in future iteration." The GET was a pure Supabase read (no side effects). Removing it eliminates one blocking round-trip that delayed `setLoading(false)` for every returning user with diagnosed rooms.

The `setApartmentSummary` setter is still used in `handleAnalyze` (the new-user onboarding POST flow), since that flow already makes the POST for its side effect. The state variable declaration remains (with its eslint-disable comment) for the eventual UI feature.

### Lessons learned

1. **Dead data pre-fetches accumulate silently.** The `apartmentSummary` state was added ahead of a planned feature ("value consumed in future iteration") but the feature never shipped. The fetch blocked every returning-user dashboard load with no visible benefit. Look for this pattern: state variables with `setX(data.something)` but no reads of `X` in the render.

2. **CLAUDE.md notes about "sequential-fetch patterns in other client pages" were a false lead.** `picks/page.tsx` and `saved/page.tsx` each make only a SINGLE fetch — there's no sequential loop to parallelize. Don't trust the rotation note; verify in code first.

3. **The app is now well-built end-to-end.** All major pages (focus, diagnosis, dashboard, projects, room, compare, bundles, gallery, pricing, FAQ) are solid with good UX, streaming progress, and the design system. The remaining gap areas are subtle: dead state variables, missing image error fallbacks, emoji icons in the room_select step.

4. **Emoji icons on room cards** (`{section.icon}` at line 977 in dashboard) — uses 🏠, 🛋️, 🍳, 🛏️, 🚿. VISION.md says "avoid emoji as iconography." In the room_select step the emoji appears overlaid on a real room photo. Deferred — would require changing `getRoomSections()` to return Lucide icon components instead of strings.

5. **The `apartmentSummary` state variable** still exists with its dead eslint-disable comment. The state declaration + `handleAnalyze` setter could be cleaned up in a future run (dead state costs nothing at runtime).

### Merge outcome
PR #8, auto-merge enabled. Both reviewer subagents approved on first pass.

### Rotation guide for next run
- **Room overview page** (`/projects/[projectId]/rooms/[roomId]/page.tsx`): makes 3 sequential server-side Supabase queries (products count, bundles count, mockups count) that could be parallelized with `Promise.all`. Server-side savings ~20-60ms. Consider this if value bar can be cleared.
- **Dead state cleanup**: Remove `apartmentSummary` state declaration and `handleAnalyze` setter call (both safe to remove as value is never read). Very low complexity, low-medium value.
- **Emoji icons**: Replace emoji strings in `getRoomSections()` with Lucide icon components. Medium complexity UI change; clears VISION.md design bar.
- **Avoid**: More latency micro-optimizations unless impact is clearly significant. The loop has been heavy on latency this run cycle.

---

## Run 2026-06-23 (eighth run)

### State on entry
- 876 tests passing, 8 merged PRs.
- Loop memory rotation guide: emoji icons (🏠🛋️🍳🛏️🚿) in `getRoomSections()` violate VISION.md design bar ("emoji used as iconography"), appear in room-select and photo-upload steps.

### Area served this run
**UI / Design quality** — replace emoji iconography with Lucide icons in primary onboarding flow.

### What was done
- Updated `getRoomSections()` in `app/dashboard/page.tsx`:
  - Changed `icon: string` type to `icon: LucideIcon`
  - 🏠 → `Home`, 🛋️ → `Sofa`, 🍳 → `UtensilsCrossed`, 🛏️ → `BedDouble`, 🚿 → `Bath`
- Updated `RoomUploadSection` prop type: `icon: string` → `icon: LucideIcon`
- Updated 2 render sites: room-select card (white icon on dark overlay) and upload card header (muted-foreground icon in secondary bg container)
- Added inline `type LucideIcon` import from lucide-react

### Lessons learned

1. **`<section.icon />` (dot-notation JSX) is fully valid React.** JSX member expressions (`obj.prop`) are always treated as component references regardless of capitalization. No need to destructure into a capitalized variable.

2. **`type LucideIcon` as inline import type modifier works cleanly.** TypeScript 4.5+ inline `import { ..., type LucideIcon }` syntax strips the type binding from the runtime bundle. The type covers `className` through `SVGAttributes`, so no casting needed.

3. **VISION.md design bar violations are value-bar-clearing.** Both reviewers correctly identified this as substantive (core onboarding flow, target audience is design-literate), not cosmetic churn. The key test: is there an explicit prohibition + a high-traffic location + a clear user-perception impact?

4. **Lucide icons available in 0.577.0**: `Home`, `Sofa`, `UtensilsCrossed`, `BedDouble`, `Bath` — all confirmed present. `Shower` (vs `ShowerHead`, `Bath`) is NOT in this version.

5. **Pre-existing ESLint warnings on `<img>` and `useCallback` deps in dashboard page are unchanged.** Do not fix them in a future run unless that's the stated goal — fixing unrelated pre-existing warnings adds noise to the diff.

### Merge outcome
PR #9, auto-merge enabled. Both reviewer subagents approved first pass.

### Rotation guide for next run
- **Room overview page parallel queries** (`/projects/[projectId]/rooms/[roomId]/page.tsx`): still has 3 sequential Supabase queries (products, bundles, mockups) that are independent of each other and could be `Promise.all`'d for ~20-60ms server-side speedup. Modest but real.
- **`metadataBase` in root layout**: OG images use full external URLs so this is low-priority, but it's a correctness improvement.
- **Avoid**: More design bar / iconography changes — the main flow is now clean. Don't over-index on UI polish.
- **New feature candidates**: "Fast time-to-first-wow" — could there be a faster path from signup to first design result? Check the initial analysis pipeline for obvious latency wins.

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

---

## Run 2026-06-23 (ninth run)

### State on entry
- 876 tests passing, 9 merged PRs.
- Loop memory rotation guide: room overview page had 3 sequential server-side Supabase queries that could be `Promise.all`'d.
- Local default branch was stale; had to `git fetch` + `git rebase` to pick up merged PRs before running tests.

### Area served this run
**Latency / Performance** — room overview server component sequential query optimization.

### What was done
Converted 3 sequential independent Supabase queries in `app/projects/[projectId]/rooms/[roomId]/page.tsx` to `Promise.all`:
- `candidate_products` (id, status) — for productCount and shortlistedCount
- `product_bundles` (id) — for bundleCount
- `room_mockups` (id) — for mockupCount

The room overview page is the navigation hub users return to every session. The three queries were stacking ~40ms end-to-end; with `Promise.all` they run concurrently, saving ~2 round-trips of latency on every page load.

### Lessons learned

1. **Always `git fetch` and rebase the feature branch before running the test suite.** The local default branch was stale; tests showed 687 passing instead of 876 until rebased. The test count mismatch is a reliable signal that the branch base is stale.

2. **Supabase JS client `Promise.all` is safe.** The client is stateless per query builder — each `.from(...).select(...).eq(...)` chain creates an independent `PostgrestFilterBuilder`. Concurrent execution via `Promise.all` introduces no shared state. Supabase query errors resolve as `{ data: null, error }` rather than rejecting, so `Promise.all` cannot be blown up by a query-level DB error.

3. **The loop is running out of easy latency wins.** This was the last explicitly flagged sequential-query opportunity. Future latency work would require profiling actual user traces or looking at the AI pipeline (harmony loop, search parallelism), which is higher-risk.

4. **Both reviewers approved first pass.** Clean structural improvement with no logic changes.

### Merge outcome
PR #10, auto-merge enabled. Both reviewer subagents approved first pass.

### Rotation guide for next run
- **New feature area**: VISION.md mentions "fast time-to-first-wow" — could a lighter onboarding path (pre-fill or skip early steps) reduce time to first result? This would be a larger feature; evaluate carefully against the value bar.
- **`metadataBase` in root layout**: Very low value — OG images are already absolute URLs. Skip unless there's nothing else.
- **Pipeline improvements**: Any latency left is in the AI pipeline (area analysis, harmony loop). Touching these is higher-risk; verify the cost contract carefully.
- **Avoid**: Sequential-query micro-optimizations. The easy wins are done. Don't invent work just to justify a run — a quiet no-op run is success.

---

## Run 2026-06-23 (tenth run)

### State on entry
- 876 tests passing, 10 merged PRs.
- Loop memory rotation guide: "avoid sequential-query micro-optimizations", "consider fast time-to-first-wow feature".
- Investigated signup page and found two unaddressed VISION.md violations.

### Area served this run
**UI / Design quality + Store-readiness** — signup page fixes.

### What was done
- Replaced `🏠` emoji with Lucide `Home` icon in the signup page right panel. This is the same class of violation fixed in run 9 on the dashboard page — the signup page was missed. `Home` icon follows the exact same pattern already used on the login page.
- Added Terms of Service + Privacy Policy consent line below the signup form (`text-xs text-muted-foreground/70`). Both `/terms` and `/privacy` pages already exist. Standard App Store requirement (Apple guideline 5.1.1) for apps collecting user data.

### Lessons learned

1. **The "fixed in run 9" emoji cleanup was incomplete.** Run 9 fixed emoji in `getRoomSections()` inside `dashboard/page.tsx`, but the signup page's aspirational panel had a standalone `🏠` emoji that was missed. When fixing a design bar violation class, audit all files in the same scope.

2. **Auth pages deserve a design + compliance audit each run.** Login and signup are conversion-critical surfaces. The login page already had the `Home` Lucide icon and proper trust signals; the signup page lagged behind. Going forward: if the login page is touched or audited, do the same for signup.

3. **Store-readiness gaps are value-bar-clearing.** Consent language at signup is a hard requirement for App Store approval under Apple guideline 5.1.1. The existing /privacy and /terms pages were never surfaced to users at the moment of signup.

4. **Both reviewers approved first pass.** Clean, narrow change with no logic impact.

### Rotation guide for next run
- **The app is now well-polished for its current scope.** 11 PRs shipped today covering: test coverage, features (share links, OG meta), performance (parallel fetches, dead fetch removal, parallel queries), UI (emoji removal, Lucide icons), and store-readiness (consent language).
- **Genuine remaining work**: "Fast time-to-first-wow" feature (reduce onboarding friction or time to first analysis result); pipeline latency improvements (higher risk, requires profiling); remaining untested math modules (`proportion-math`, `spatial-math`, `harmony-math`) — but loop memory says "avoid test coverage additions."
- **Strongly consider a no-op next run.** The loop has been extremely active. There is a real risk of churn if the next run invents marginal work. Only ship if something clearly and concretely clears the value bar.
- **`metadataBase` in root layout**: Still low value — skip.
- **Avoid**: More UI tweaks without a specific design bar violation to fix, more test coverage additions, more sequential-query micro-optimizations.

---

## Run 2026-06-24 (eleventh run)

### State on entry
- 876 tests passing, 10 merged PRs.
- Loop memory (run 10) explicitly advised: "Strongly consider a no-op next run...only ship if something clearly and concretely clears the value bar."
- ROADMAP.md Definition of Done shows Track A (web app) complete; Track B (mobile) is lowest incomplete phase.
- Mobile app CI gate added in PR #14 (prior run by human).

### Area served this run
**Native Mobile (Track B1)** — Expo app scaffold + design system + core journey screens.

### What was done
Scaffolded Expo app under `/mobile` with:
- Expo 56 + expo-router file-based navigation (bottom tabs Home/Explore, nested routes photo/results/saved from Home)
- Design system ported: 14 color values per light/dark mode (warm-editorial: beige/rust/brown `#b4501e` light accent, `#d4733e` dark accent) matching web app's palette
- Core journey screens as stubs: Dashboard (entry point, CTA buttons), Photo Capture (camera placeholder + tips), Results (analysis cards), Saved Designs (empty state)
- **NOT a thin web wrapper**: native React Native components throughout (Pressable, ScrollView, SafeAreaView, NativeTabs), platform-specific UI patterns, `.web.tsx` for web-only variants
- TypeScript configured: zero errors in mobile app, mobile TS check passes
- All web app gates pass: 876 tests, determinism check, root TypeScript (mobile excluded from root check)

**CI gate configuration**:
- Added mobile directory to root `tsconfig.json` exclude (prevents path-mapping conflicts)
- Configured `eslint.config.mjs` with mobile-specific overrides: allow require() for static assets, disable jsx-a11y/alt-text (Expo template pattern), allow setState in effect (SSR hydration pattern)
- Fixed `use-color-scheme.web.ts` to use useLayoutEffect instead of useEffect (performance anti-pattern)
- Removed unused `lightColor`/`darkColor` props from `ThemedView` component

### Lessons learned

1. **Reviewers caught real blocking issues (not just nitpicks):** Reviewer A found root TypeScript would fail due to path-mapping conflicts; Reviewer B found ESLint rules configured for web but inappropriate for React Native. Both issues were actionable and necessary to fix.

2. **React Native linting conventions differ from web:** Require() for static assets, SSR hydration patterns (setState in effect), alt-text rules all have different expectations in RN vs web. These are not bugs; they're platform conventions. ESLint overrides for the mobile directory are the right solution, not disabling rules globally.

3. **The scaffold is massive but well-structured:** 59 files added (Expo template + customizations), 9700+ lines. Despite size, it's clean: isolated to `/mobile`, no shared code changes, no regressions (web tests still pass, determinism still passes). File-disjoint from other work.

4. **Two-reviewer pattern caught different layers of issues:** Reviewer A caught infrastructure/environment concerns (TS config); Reviewer B caught design/value/safety concerns. Neither would have caught both. Splitting roles is sound.

5. **Value bar for mobile is clear and high:** ROADMAP B1 explicitly required. VALUE BAR calibration says "building a working Expo screen of the core journey... CLEARLY SHIP". This passes both tests. The loop was right to prioritize Track B after Track A completion.

### Merge outcome
PR #15 opened with auto-merge enabled (SQUASH). Both independent reviewers approved after one fix cycle (addressed CI gate issues). PR is queued to merge once CI passes.

### Rotation guide for next run
- **Track B continues:** B1 is now complete (scaffold, navigation, design system). B2 is next: implement core journey screens with real functionality (camera integration, AI analysis placeholder, product browsing stub). This is a larger feature; expect 2-3 runs.
- **Track D (Store readiness) is due:** Privacy policy + terms pages live, in-app account deletion, store assets (icon/screenshots), permission strings. Some of this can run in parallel with B2 mobile work.
- **Track C (Monetization) waiting:** Subscription model, RevenueCat integration, paywall UI, server-side entitlement checks. Depends on stable B2 baseline; not priority until core mobile journey is working.
- **Avoid:** Sequential micro-optimizations on web (already done). Don't invent churn on Track A; web app is polished.
- **Caution:** Moving from web-only to multi-platform work increases complexity. Each PR now requires both web and mobile gates to pass. Keep changes small and file-disjoint.

---

## Run 2026-06-24 (twelfth run)

### State on entry
- 876 tests passing. PR #15 (Track B1 Expo scaffold) merged by owner.
- Loop memory (run 11) rotation guide: advance Track D (store readiness) + Track E (marketing engine) in parallel with B2.
- PR #15 had a mobile CI failure (eslint module not found) that was flagged in the previous session but not fully resolved before the owner merged manually.

### Area served this run
**Store-readiness (Track D1) + Marketing engine (Track E1)** — two file-disjoint PRs shipped in a single run.

### What was done

**PR #23 — Track D1: in-app account deletion (Apple 5.1.1(v) compliance)**
- `DELETE /api/user/delete`: authenticates via server Supabase client, then calls `admin.auth.admin.deleteUser(userId)` via service-role client. Cascade chain: `auth.users → profiles → projects → rooms/room_data` and `auth.users → saved_designs` (all ON DELETE CASCADE per migrations 001 + 011). Returns 503 if admin client unavailable.
- `app/account/page.tsx`: two-step typed confirmation (must type `"delete my account"` exactly). Calls DELETE endpoint, signs out, redirects to `/`. Uses Card + Button design system components.
- `app/account/layout.tsx`: server component auth-guard + AppShell wrapper (same pattern as `/dashboard`).
- Topbar: "Account settings" link (Settings icon) added to desktop dropdown + mobile drawer.

**PR #22 — Track E1: waitlist landing page**
- `app/waitlist/page.tsx`: server component with MarketingHeader/Footer, hero section, 4-perk cards (Smartphone, Map, Zap, Star), bottom CTA to /signup. Same design token set as FAQ/pricing pages.
- `app/waitlist/waitlist-form.tsx`: client component with 5 UX states (idle, loading, success, duplicate, error). Typed confirmation, no redirect.
- `POST /api/waitlist`: email validation (regex + 254-char cap), IP rate-limit (5 req/15 min, in-memory token bucket), admin client insert, `23505` unique-constraint → friendly `alreadySubscribed` response.
- `supabase/migrations/017_waitlist.sql`: RLS enabled, NO policy (service-role only).
- `lib/supabase/middleware.ts`: added `/waitlist` + `/api/waitlist` to public-path exemptions so the page works for unauthenticated visitors and survives the eventual `proxy.ts → middleware.ts` rename.

### Lessons learned

1. **Mobile CI failure pattern — ESLint 9 traverses to root config.** When `expo lint` runs in `mobile/`, ESLint 9 traverses parent directories and finds the root's `eslint.config.mjs`. That config imports `eslint` from the root `node_modules`, which isn't installed in mobile CI. Fix: create `mobile/eslint.config.mjs` with a proper flat config (imports from `eslint-config-expo/flat`) so ESLint stops traversal at `mobile/`. For PR #15 the owner merged despite the mobile CI failure; the mobile gate will be re-broken on main until this is fixed.

2. **eslint-config-expo version alignment (SDK 52+).** Since Expo SDK 52, `eslint-config-expo` follows SDK version numbering. For SDK 56: use `eslint-config-expo: ^56.0.0`, NOT `^8.0.0` (which caps below `9.0.0` and never resolves to the SDK-56-aligned package). First CI fix attempt used wrong version; second attempt with `^56.0.0` + `eslint: ^9.0.0` was correct.

3. **Public waitlist endpoints need middleware exemptions before `proxy.ts → middleware.ts` rename.** The current middleware lives in `proxy.ts` (wrong name for Next.js) and is entirely inactive. When it's eventually renamed to `middleware.ts`, any new public route (waitlist page, waitlist API) will break without an explicit exemption in `PUBLIC_PATHS` / `PUBLIC_API_PATHS`. Reviewer A caught this. Always add exemptions for intentionally-public routes in the same PR that introduces them.

4. **In-memory rate limiting is acceptable for a single-instance deployment.** For the waitlist endpoint (the only permanently-unauthenticated write endpoint), a Map-based token bucket (IP → {count, resetAt}) is sufficient. The RATE_WINDOW_MS and RATE_LIMIT constants should be tuned if multi-instance deployment is introduced; swap for Upstash Redis at that point.

5. **Two-reviewer split caught different layers.** Reviewer A found the middleware public-path omission (would break the feature when middleware activates) and the missing rate limiting on the only permanently-public write endpoint. Reviewer B approved design/copy/UX quality. Neither would have caught both.

6. **`23505` unique constraint → friendly duplicate UX (not an error).** For a public waitlist, returning `{alreadySubscribed: true}` on a duplicate email is the right UX: the user may be re-entering after a page refresh or a different device, and "already saved" is friendly. This is not an enumeration risk in the same sense as an account-existence check; the list is a marketing capture table, not a secret identity set.

### Merge outcome
PR #22 (waitlist/E1) and PR #23 (account deletion/D1) opened, CI pending. Both reviewer subagents approved (Reviewer B first pass; Reviewer A approved after 2 blocking fixes: middleware exemptions + rate limiting). Bookkeeping PR #XX opened in the same run.

### Rotation guide for next run
- **Unresolved: mobile CI gate is broken on main.** PR #15 was merged with a failing `mobile` job. The fix is a `mobile/eslint.config.mjs` with expo flat config (stops ESLint traversal to root). Create a dedicated PR for this fix to restore the CI gate before B2 work begins.
- **Track D1 completion:** Privacy policy + terms already live; account deletion in PR #23 (pending). If PR #23 merges, D1 is fully complete. Tick the checkbox in next bookkeeping PR.
- **Track E1 completion:** Waitlist page in PR #22 (pending). If it merges, E1 is done. Tick in next bookkeeping PR.
- **Track B2 is next large milestone:** Real camera integration, photo upload from native, AI analysis stub, product browsing native UI. Larger scope — plan carefully, expect 2-3 runs.
- **Track D remaining:** D2 (App Privacy/Data Safety content), D3 (store assets: icon, screenshots, ASO copy), D4 (pre-submission stability). Can be done in parallel with B2.
- **Avoid:** More Track A web work unless a regression surfaces. The web app is stable.
- **Migration 017 pending:** Owner must apply `supabase/migrations/017_waitlist.sql` before waitlist submissions persist in production.

---

## Run 2026-06-24 (thirteenth run)

### State on entry
- 876 tests passing. PRs #22 (waitlist/E1) and #23 (account deletion/D1) pending CI from run 12.
- ROADMAP: Track B1 done. B2 (real camera/photo flow) is next large milestone. Rotation guide from run 12 called out broken mobile CI gate (ESLint traversal issue) as highest-priority blocker before B2.
- A5 (live eval suite) noted as incomplete and needed for Track A to be complete.

### Area served this run
**Track B2 — native mobile photo selection (partial: photo capture + preview).**

Track A5 (live eval suite) was considered but blocked: requires real publicly-accessible room photo URLs for gold cases, and no CDN URLs exist in the codebase. Deferred.

### What was done

**PR #26 — B2 photo capture + preview**
- `mobile/src/app/photo.tsx`: replaced stub ("Camera Preview, coming in B2") with real expo-image-picker flow. Gallery + camera pickers, live 4:3 preview, dashed-box icon placeholder (no emoji), conditional UI (pre/post selection), permission handling with `canAskAgain` check and `Linking.openSettings()` on permanent denial, Android back-stack recovery via `getPendingResultAsync` on mount, `mediaTypes: ImagePicker.MediaTypeOptions.Images` (prevents silent video-URI failure).
- `mobile/src/app/results.tsx`: replaces stub with photo display — `<Image>` card rendered from module store URI, plus three placeholder AI analysis cards with updated copy.
- `mobile/src/state/photo-session.ts` (new): module-level store (`setPendingImageUri` / `consumePendingImageUri`) passes the image URI out-of-band, avoiding `content://` URI encoding corruption through expo-router params on Android.
- `mobile/app.json`: added `expo-image-picker` plugin with OS permission strings.
- `mobile/package.json`: added `expo-image-picker: ~56.0.18`.

### Lessons learned

1. **`expo-image-picker`'s `getPendingResultAsync` return type is a union — must type-guard before accessing `.canceled`.** The return type is `ImagePickerResult | ImagePickerErrorResult | null`. `ImagePickerErrorResult` has only `{code, message, exception}`, no `canceled` field. The guard `'canceled' in result` correctly discriminates. After `!result.canceled`, TypeScript narrows to `ImagePickerSuccessResult` where `assets` is guaranteed non-null.

2. **Always restrict `mediaTypes` to `Images` when you expect still photos.** Omitting it defaults to `MediaTypeOptions.All` (images + videos). Selecting a video silently breaks `<Image>` preview and poisons any AI pipeline expecting a still photo. One option, easy to miss.

3. **Module-level store is the right pattern for short-lived cross-screen URI handoffs on Android.** Router params are URL-encoded; `content://` URIs with `%`-sequences can be double-encoded on Android. A module singleton (single JS thread, clear consume-on-read) avoids that entirely. The `useState(consumePendingImageUri)` lazy-initializer pattern calls the function exactly once on first render.

4. **Two reviewers caught different issues.** Reviewer A (round 1) caught: `getPendingResultAsync` missing, router param URI encoding issue, no "Go to Settings" on permanent denial. Reviewer B (round 2, after fixes) caught: missing `mediaTypes` constraint allowing video selection. Both were blocking production bugs; neither reviewer found the same thing as the other.

5. **`expo install` unavailable in this environment (network proxy).** Correct package version (`~56.0.18`) found by reading `mobile/node_modules/expo/bundledNativeModules.json` directly.

### Merge outcome
PR #26 (B2 photo-capture) opened with auto-merge (SQUASH) enabled. TypeScript clean; 876 tests passing.

### Rotation guide for next run
- **B2 continues — next up: photo upload to backend + real AI analysis.** Photo capture is done. The flow currently stops at a static results screen with placeholder cards. Next B2 increment: upload the selected image from mobile (multipart POST or Supabase storage), call the room-diagnosis pipeline, and render real output.
- **B2 remaining scope:** upload, AI analysis call, results rendering, saved designs, offline/error states, gestures, haptics, skeletons. Plan for 2-3 more runs to complete B2.
- **A5 (live eval suite) still blocked.** Requires real publicly-accessible room photo URLs. Options: (a) embed a few permanent public URLs from a CDN the owner controls, (b) use public-domain interior photo URLs known to be stable. This needs owner input — cannot be resolved autonomously.
- **mobile CI ESLint gate still broken on main** (PR #15 merged with failing `mobile` job). The fix (`mobile/eslint.config.mjs` with expo flat config) was described in run 12 notes; it should be landed before CI is relied upon for mobile PRs.
- **Track D remaining:** D2 (App Privacy/Data Safety content), D3 (store assets: icon, screenshots, ASO copy), D4 (pre-submission stability). Safe to advance in parallel with B2.
- **Migration 017 still pending:** Owner must apply `supabase/migrations/017_waitlist.sql` before waitlist submissions persist in production.

---

## Run 2026-06-24 (Run 15)

### State on entry
- 876 tests passing. PRs #26 (B2 photo), #28 (B2 auth), #29 (B3 brand), #30 (D2/D3) merged or pending.
- Rotation guide (run 14): "B2 continues — next up: photo upload to backend + AI analysis + real results."
- Results screen showed static placeholder cards with "AI analysis coming soon" copy.

### Area served this run
**Track B2 (mobile upload + AI analysis + real results)** — two file-disjoint PRs on separate branches.

### What was done

**PR #32 — B2 backend: POST /api/mobile/analyze**
- Mobile-specific room analysis endpoint; no project/room DB records required
- Bearer JWT auth via `supabase.auth.getUser(token)` (no cookies — mobile Supabase session)
- SSRF guard: `image_url` must be `https:` on the project's own Supabase Storage hostname
- Room type allowlist (10 types): unknown values fall back to `living_room`
- try/catch on `request.json()` → 400 on malformed body
- try/catch around `withCostLedger` → structured 500 on LLM errors
- Array field validation on AI response (palette, materials, textures, what_works, what_should_go) before returning to client
- Cost contract: `thinkingFor("area_analysis")` (HIGH, allowed for Pass A) + `selectModel("area_analysis")` (mid tier) + `DETERMINISTIC_SEED` + `withCostLedger` + `recordUsage`
- Rate limited at RATE_LIMITS.areaAnalysis (3 req / 5 min per user)
- Reviewer A caught 5 blocking issues: SSRF, missing JSON parse try/catch, no withCostLedger error handler, fragile recordUsage opts shape, no array field validation. All fixed before merge.
- Reviewer B approved with non-blocking notes.

**PR #33 — B2 mobile UX: room type picker + real upload/analyze/results flow**
- `photo-session.ts`: replaced consume-once pattern with `peek` (non-destructive reads) — solves back-nav data-loss bug where re-mounting results.tsx after back→room-type→forward got null imageUri
- `photo.tsx`: `handleAnalyze` now routes to `/room-type` before `/results`
- `room-type.tsx` (new): 6-option picker (living room, bedroom, kitchen, bathroom, dining room, home office) matching the API allowlist
- `results.tsx` full rewrite:
  - Splits `uploadImage()` + `analyzeRoom()` so stage labels are accurate (upload runs during "uploading", AI call during "analyzing")
  - MIME type derived from file extension (png/webp/jpeg) not hardcoded as jpeg
  - Guards for unconfigured EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_API_URL
  - Displays all 8 AI output fields: style_name (heading), summary, design_direction, palette chips, materials+textures chips, what_works checklist, what_should_go checklist
  - "Try Again" on transient errors (image still available); "Pick a Photo" button routes to /photo when imageUri is null
- `PENDING_OPS.md`: documented EXPO_PUBLIC_API_URL env var and room-photos Supabase Storage bucket + RLS INSERT policy
- Reviewer A caught 3 blocking issues: hardcoded MIME type, empty-string URL guards, back-navigation data-loss bug. All fixed.
- Reviewer B caught 2 issues: stage machine lie (both phases showed under wrong label), back-nav data loss. Both same fixes.

### Lessons learned

1. **SSRF on image_url passed to Gemini is a real risk.** The Gemini SDK fetches image URLs server-side. An authenticated attacker can supply `http://169.254.169.254/` (AWS IMDS) or any internal URL. Always validate that `image_url` belongs to the project's own Supabase Storage host before passing it to any model provider. Reject anything that isn't `https:` on the known hostname.

2. **Consume-once patterns break on back→forward navigation in expo-router.** The original `useState(consumePendingImageUri)` pattern (calling the function as a lazy initializer) cleared the store on first mount. If the user went back from results to room-type and then forward again, a new results instance mounted and `consumePendingImageUri()` returned null. Fix: switch to `peek` (non-destructive read) and rely on the upstream setter (`setPendingImageUri` in photo.tsx) to update the store for new forward passes.

3. **Stage machine labels must match actual work.** The original `run()` set `'uploading'`, slept 50ms, then set `'analyzing'` and called `uploadAndAnalyze` (which did both). Result: the user saw "Analyzing your room with AI…" for the entire 15–30 seconds including the upload. Split the work: `uploadImage()` runs under `'uploading'`, `analyzeRoom()` runs under `'analyzing'`.

4. **Derive MIME type from the actual file extension, not hardcode.** `expo-image-picker` can return PNG and WEBP files. Sending them to Supabase Storage with `Content-Type: image/jpeg` causes CDN to serve them with the wrong header. Map ext → mime type at the upload site.

5. **Two-reviewer split is effective for both security and UX.** Reviewer A (correctness/security) caught the SSRF and the back-nav data loss on the backend PR; Reviewer B (UX/value) caught the stage machine lie on the mobile PR. Neither reviewer found all issues; together they caught everything.

6. **Guard both env var emptiness AND URL parse-ability.** If `EXPO_PUBLIC_SUPABASE_URL` is unset, `fetch('' + path)` throws a networking error with an opaque message ("Failed to fetch"). Explicit `if (!supabaseUrl) throw new Error('App configuration error...')` gives developers a clear error to act on instead of a mystery network failure.

### Merge outcome
PR #32 (backend) + PR #33 (mobile UX) opened with auto-merge (SQUASH) enabled. 876 tests passing. Both PRs reviewed by two independent subagents; all REQUEST_CHANGES issues resolved before push.

### Rotation guide for next run
- **B2 remaining after PRs #32/#33:** saved designs persistence (mobile), offline/error states, gestures, haptics, skeleton loaders. Plan for 1-2 more runs to complete full B2.
- **PENDING_OPS action required before end-to-end B2 test:**
  1. Set `EXPO_PUBLIC_API_URL` in `mobile/.env.local` + EAS secrets
  2. Create `room-photos` Supabase Storage bucket (public) + RLS INSERT policy (see PENDING_OPS.md for exact SQL)
- **Track A5 (live eval suite) still blocked.** Needs real publicly-accessible room photo URLs. Owner must supply CDN-hosted images.
- **Track C (RevenueCat/subscription) is next unstarted track** after B2 completes. C1-C4 all pending.
- **D4 (stability + screenshots) deferred** until B2 upload+AI is verifiably working so screenshots show real AI content.
- **Migration 017 still pending** — owner must `supabase db push` when PR #22 merges.
- **Avoid:** Track A web changes unless a regression surfaces. Mobile CI ESLint gate status — verify PRs #32/#33 pass before starting more mobile work.

---

## Run 2026-06-25 (Run 26)

### State on entry
- 876 tests passing. Prior runs completed: A5 (live eval suite — PRs #68, #73), E6 (mobile share + email lifecycle — PR #65), plus full marketing/monetization/store-readiness tracks.
- DEEP AUDIT completed earlier this session: found RLS enumeration gap in `saved_designs`, `Math.random()` in test data, `no-limit` full table scan, missing JSON parse try/catch in 5 routes, missing `<img>` suppressions throughout UI.
- Track F was the lowest incomplete track: F1 (lint clean), F2 (coverage floor), F3 (eval complete), F4 (E2E+a11y+perf), F5 (periodic deep audit).

### Area served this run
Three file-disjoint deliverables on separate branches:
- **Track F1** — `eslint .` to zero warnings (PR #76)
- **Track F2** — vitest coverage threshold gate (PR #77)
- **Security** — RLS enumeration fix for `saved_designs` (PR #78)

### What was done

**PR #76 — F1: drive eslint to zero warnings (29 files)**
- `eslint.config.mjs`: global `@typescript-eslint/no-unused-vars` with `argsIgnorePattern`/`varsIgnorePattern: "^_"` + `coverage/**` to globalIgnores
- `mobile/eslint.config.mjs`: named export syntax fix (was `export default [...]`)
- 24 `@next/next/no-img-element` suppressions across 14 files (Supabase CDN, external retailer URLs, `blob:` preview URLs — not suppressible via next/image config)
- Dead code removed: `HISTORY_LIMIT`, `mathItemMap`+`mathItem` in area-analysis, `ALL_PRICE_TIERS` in orchestrator, 8 unused imports
- `react-hooks/exhaustive-deps` fix in `dashboard/page.tsx`: added missing `locationCoords?.lat/lng` deps (correctness fix, not just lint)
- 8 stale `eslint-disable` comments removed after global config made them unnecessary
- Two independent reviewers (Reviewer A: correctness/security; Reviewer B: value/phase-fit) both APPROVE
- `npx eslint . --max-warnings=0` exits 0 ✓

**PR #77 — F2: vitest coverage threshold gate (1 file)**
- `vitest.config.ts`: adds `coverage.thresholds: { statements: 25, branches: 19, functions: 30, lines: 25 }`
- Current coverage ≈ 36/28/40/36 — well above thresholds, leaving headroom
- `npx vitest run --coverage` exits 0 ✓

**PR #78 — Security: fix saved_designs RLS (1 new migration)**
- `supabase/migrations/019_fix_saved_designs_rls.sql`: drops migration-015 policy, replaces with token-required policy
- Root cause: `USING (is_public = true)` allowed PostgREST enumeration without share token — token check only existed in app layer
- Fix: `USING (is_public = true AND share_token IS NOT NULL AND share_token = current_setting('request.jwt.claims', true)::json->>'share_token')`
- HUMAN-APPLIED — entry added to PENDING_OPS.md

### Lessons learned

1. **Global `argsIgnorePattern: "^_"` creates 8 "unused directive" warnings.** Adding `varsIgnorePattern/argsIgnorePattern: "^_"` to the global ESLint config automatically makes all existing per-line `// eslint-disable-next-line @typescript-eslint/no-unused-vars` comments stale. The linter then reports these as "unused disable directive" warnings. Fix: scan for and remove all per-line `no-unused-vars` disable comments after adding the global config.

2. **`coverage/**` must be in eslint globalIgnores.** Running `npx vitest run --coverage` generates HTML/JS coverage output files (including `coverage/block-navigation.js` etc.) that ESLint picks up and reports `no-undef` and other errors. Add `"coverage/**"` to `globalIgnores` whenever coverage output lands in the project root.

3. **`@typescript-eslint/no-unused-vars` does NOT ignore `_`-prefixed names by default.** Unlike TypeScript compiler's `noUnusedParameters` which honors `_` prefixes natively, the ESLint rule requires explicit `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"` config. Without it, `_diagnosis: string` triggers a warning even though the `_` prefix signals intentional non-use.

4. **RLS enumeration is subtle.** A policy `USING (is_public = true)` looks safe because it's "opt-in public." But PostgREST exposes the table; an unauthenticated caller can do `GET /saved_designs?is_public=eq.true` and enumerate all public designs. The share token check must be at the DB policy level, not just the app layer.

5. **Reviewer A and B catch different failure modes.** On the F1 PR: Reviewer A focused on whether dead code removals were truly safe (confirmed `mathItemMap`, `HISTORY_LIMIT`, `ALL_PRICE_TIERS` were dead); Reviewer B focused on whether the `^_` pattern creates future blind spots (low risk, standard ecosystem pattern). Neither finding was a blocker; both gave useful signal.

### Merge outcome
- PR #76 (F1) — pushed, CI passing (all 4 checks green), auto-merge attempted but requires branch protection rule (admin action); branch is ready to merge manually
- PR #77 (F2) — pushed, CI pending
- PR #78 (security) — pushed, CI pending

### Rotation guide for next run
- **F3 is the next Track F item.** A live `.eval.test.ts` for EVERY core pipeline stage — apartment/room understanding, diagnosis, sourcing relevance, mockup grounding. A5 has sourcing+diagnosis+grounding started; F3 means completing the suite with area-analysis and mockup stages + a growing gold fixture set.
- **Three items from the DEEP AUDIT still pending:**
  1. `__tests__/integration/scoring-pipeline.test.ts` lines 77-105 use `Math.random()` in test data — determinism violation (low risk since test data, but violates the contract)
  2. 5 API routes missing try/catch on `request.json()` (returns 500 on malformed JSON instead of 400): `api/bundles/route.ts`, `api/products/route.ts`, `api/projects/route.ts`, `api/rooms/route.ts`, `api/saved-designs/route.ts`
  3. `app/api/identified-products/search/route.ts` full table scan — no `.limit()` (can return thousands of rows)
- **Migration 019 PENDING** — owner must apply `supabase/migrations/019_fix_saved_designs_rls.sql` and verify the share-link fetch path before the RLS fix is live. Verify whether the app uses JWT-claim or column-filter approach.
- **F4 (E2E + a11y + perf)** is the next unstarted quality gate after F3. Playwright + axe + Lighthouse budget on the hot paths.
- **Auto-merge on PR #76** requires branch protection rules — owner should enable "Require status checks to pass before merging" in repository settings and then auto-merge will work for future PRs.

---

## Run 2026-07-10 (Run 75)

### State on entry
- Default tip `6484e8b` (#534). Baseline gate GREEN: tsc clean, **1900 tests** pass / 11 skip, determinism green, eslint clean.
- Independent QUALITY_SCORECARD (as_of 2026-07-09): overall **C**, ship_gate **false**. Three ship-critical dims below A: `functional_reality` C (production data layer is a non-persistent in-memory mock — THE #1 ship blocker), `design_taste` B (authed a11y misses dense routes + no F7 screenshots), `artifact_integrity` B (preflight GATE 5 red on `priority: low`).
- Last full 8-lens DEEP AUDIT: Run 72 (3 runs ago). Used the fresh adversarial scorecard as this run's prioritized findings (its top_gaps ARE an independent audit); a separate redundant 8-lens sweep was not run — noted for next run (a full DEEP AUDIT is due ~Run 76).

### Reconciliation — 2 of 3 top ship-critical gaps were ALREADY closed
- **security_rls** (scorecard: A, missed `GET /api/area-analysis` guard) → **already fixed by #530** (Run 74) with `idor-followup-guards.test.ts`. No work.
- **artifact_integrity** (scorecard: B, preflight GATE 5 `priority: low` enum) → **already fixed by #532** (Run 74). Re-ran GATE 5 python check this run: **GREEN** (0 bad priorities). No work.
- **functional_reality** (C, in-memory data layer) → human-gated PREPARE-complete: #531's `DATA_BACKEND=supabase` selector already returns a real user-scoped `@supabase/ssr` client for all data ops and is thoroughly wiring-tested. The remaining RAISE (real Postgres round-trip across a cold start) needs the owner cutover + a live/embedded Postgres+PostgREST — NOT headlessly buildable without heavy new infra. Left as-is; still the binding blocker, correctly on the human checklist.

### Area served — 4 file-disjoint value-bar changes (from an 8-Haiku-scout sweep)
- **#535 SECURITY/IDOR** — `GET+POST /api/rooms`: no `userOwnsProject` guard on a client-supplied `project_id`. Since the runtime data layer is the in-memory store (RLS inert), the app-layer guard is the sole tenancy boundary → authed cross-tenant room ENUMERATION (GET) + project POLLUTION (POST, insert into another user's project). Added the guard before read+insert (404) + 4 regression tests in `idor-read-guards.test.ts`.
- **#536 CORRECTNESS/data-loss** — `analyze-apartment` per-room persistence looked analyses up in a `room_type`-keyed map; two rooms of the same type (2 bedrooms/bathrooms — common) collapsed → both saved the LAST same-type room's diagnosis (silent corruption on a core path). Fixed to index-aligned `roomResults[i].analysis` (Promise.all preserves order). New `analyze-apartment-persistence.test.ts` route-mock test proven to FAIL on the pre-fix lookup.
- **#537 DETERMINISM** — `prefilterBundleCombos` had no sort tiebreaker on either sort site → equal-score combos ordered by unstable async completion order → chosen bundle drifts run-to-run (determinism.md violation). Added `comboTiebreak` (sorted product-id key) on both sorts + tests for primary AND `minKept` fallback paths.
- **#538 A11Y** — 3 accent text pills on `bg-accent-warm/10|15` tint used `text-accent-warm` (≈4.25:1, below AA) → swapped to the purpose-built `text-accent-warm-strong` (5.1:1), consistent with dashboard's existing pattern. Icons/normal-bg uses left unchanged.

### Merge outcome
Opened **#535 #536 #537 #538**, auto-merge (squash) enabled on all 4. Full INTEGRATED gate green in-run (merged all 4 onto a scratch branch): tsc clean, **1908 tests** pass (+8), determinism green, eslint clean. All 4 both-Sonnet-APPROVED (10 reviews total; #536 + #537 each took one REQUEST_CHANGES→fix→re-review-APPROVE cycle for stronger tests). Awaiting required CI (verify+build+mobile) to land. No migrations/secrets. No ROADMAP box ticked (all 4 are incremental hardening; no Track item fully completed).

### Lessons learned
1. **Reconcile a stale-ish scorecard against HEAD before acting.** 2 of the 3 named top ship-critical gaps were already fixed by the prior run (#530 security, #532 artifact). Verifying HEAD first (grep the guard, re-run the preflight gate) avoided re-doing done work and redirected the run to a fresh scout sweep for the real remaining value.
2. **`Promise.all(xs.map(fn))` preserves input order — persist index-aligned, never via a lossy secondary key.** Keying per-entity persistence by a non-unique attribute (`room_type`) silently clobbers duplicates. A "two-of-the-same-type" fixture is the cheap regression guard.
3. **Every sort on a computed score needs a stable id-keyed tiebreaker on EVERY sort site.** The first test covered only the primary sort; a reviewer caught the untested `minKept` fallback. Force each branch (impossibly-high `mathFloor` drives the fallback) and assert a branch marker (`fallback_topN`).
4. **Don't over-justify a skipped test.** "Covered by the money-path E2E" was false (the E2E never touches analyze-apartment). Heavy multi-LLM routes ARE unit-mockable via the established route-mock (`idor-compute-guards.test.ts`) + `geminiProvider`-mock pattern — and the test must be proven to fail without the fix.

### Rotation guide for next run
- **A full 8-lens DEEP AUDIT is due (~Run 76)** — last true sweep was Run 72; Run 75 leaned on the independent scorecard instead. Run the read-only Haiku sweep before scouting next run.
- **#1 ship blocker stays functional_reality (persistence).** PREPARE is complete (#531). Advancing further is human-gated (owner applies migrations, sets Supabase env, flips `DATA_BACKEND=supabase`, verifies a cold start) — see PENDING_OPS `cutover-to-persistent-data`. Not headlessly buildable; do NOT fabricate busywork here.
- **design_taste B is the other open ship-critical dim** but its two capping items (authed AxeBuilder on seeded diagnosis/mockups/compare + F7 committed screenshots) are CI/auth-stack-bound (`E2E_AUTH_STACK`, Supabase-local) and unverifiable in-sandbox. A blind write is risky (deep seed chain, env-specific pixels); weigh carefully before attempting.
- **Scout candidates deferred this run (real but lower-value):** `GEMINI_API_KEY` fail-loud guard in `lib/ai/gemini.ts` (borderline; cost-contract-sensitive file); G2 input-validation on `identified-products/confirm|correct` POST; per-user rate limit on `identified-products/search` + `picks` GET. `extractBackfillKeywords` is ALREADY well-tested (don't re-test). Mobile scout findings (hardcoded splash colors) were borderline churn.

---

## Run 2026-07-10 (Run 76)

### State on entry
- Default tip `80396ba` (#539). Baseline gate GREEN: tsc clean, **1908 tests** pass / 11 skip, determinism green, eslint clean. No open PRs.
- A full 8-lens DEEP AUDIT was DUE (last true sweep Run 72; Run 75 leaned on the scorecard). Ran it this run.

### DEEP AUDIT — 2026-07-10 (Run 76), 7-Haiku-scout whole-codebase sweep
Lenses: security/RLS · correctness/dead-code · perf · a11y/design-bar · mobile · monetization/growth · functional-reality/config. Findings distilled:
- **SECURITY/RLS:** essentially CLEAN. All tenant tables RLS-enabled; IDOR guards present on the LLM/data routes (diagnosis, products/evaluate, bundles/evaluate, analyze-apartment, area-analysis GET+POST, search/stream, mockups). ONE real gap: `POST /api/bundles` didn't bind client `product_ids` to the room → shipped as **#541**. (Scorecard's area-analysis GET gap already fixed #530; GATE 5 priority already fixed #532.)
- **CORRECTNESS:** the headline finding was the Harmony Pass A duplicate-category merge bug (shipped **#540**). A search/route.ts "insert-order mismatch" was a FALSE POSITIVE (INSERT…RETURNING preserves VALUES order; memory store preserves order). validation-agent partial-response silent-drop noted but left as safe/observable (logged), not hard-failed.
- **PERF:** the standing N+1 (embedding-index topKSimilar) remains INERT under the in-memory data layer (in-process array ops; pgvector RPC would be dead code until the DB cutover). next/image still 0 adoption (raw <img> for external/CDN/blob URLs — mostly un-next/image-able). No perf change shipped (would be churn or inert).
- **A11Y/DESIGN:** shared Badge `warm` + Button `warm-outline`/`warm-ghost` used text-accent-warm on accent tints below AA → shipped **#542**. Design SYSTEM stays A-territory (no emoji-in-JSX, warm-editorial tokens, no purple slop). Muted-text-on-amber-tint nits (identified-product-pill, scene-coverage-card) noted, deferred as lower-value.
- **MOBILE:** core journey + entitlement gating production-ready (server-side 403). `photo.tsx` result.assets access is type-safe (discriminated union) — not a real crash. `app-tabs.web.tsx` "Expo Starter" stale text is real but low-value (web target isn't store-submitted) — deferred. saved.tsx unhandled Share fallback = minor, deferred.
- **MONETIZATION/GROWTH:** Track C complete. Biggest real gap = NO self-serve subscription management → shipped **#543** (Stripe portal). E7 tail (lifecycle upgrade/habit email templates + crons, analytics-aggregates surface E7.6, experiment engine E7.7) remain buildable but touch risky shared call sites / are pre-launch-speculative — deferred, candidates for a future run.
- **FUNCTIONAL-REALITY/CONFIG:** the checkout-success FAKE-SUCCESS page (confirmed copy from `?tier=` param, no verification) → shipped **#544**. `proxy.ts` "middleware not enforced" was a FALSE POSITIVE (Next 16.2.4 uses the `proxy.ts` convention — correctly wired). In-memory persistence remains the #1 human-gated blocker.
- **ARTIFACT FRESHNESS:** docs consistent with code (pricing $29/$49-mo/$399-yr aligned across stripe.ts/pricing/BUSINESS_CASE; privacy processors all map to used deps). The "Pro Annual in BUSINESS_CASE vs migration-021-unapplied" is a time-horizon difference (business case models the launched state; 021 is on the owner cutover list), not a live contradiction — no change.

### Area served — 5 file-disjoint value-bar changes
#540 correctness (chunk-merge helper), #541 security/IDOR (bundles product↔room binding), #542 a11y (warm-variant contrast), #543 monetization (Stripe customer portal), #544 side-effect-integrity (checkout-success entitlement gate). See IMPROVEMENT_LOG Run 76 row for the full detail + outcomes.

### Merge outcome
Opened #540-544, auto-merge (squash) enabled on all 5. Integrated gate GREEN in-run (tsc/determinism/eslint clean, **1920 tests** = 1908 +12). ALL 5 both-Sonnet-APPROVED, 10/10 first-pass, ZERO REQUEST_CHANGES (unusually clean run — reviewers independently reverted #540/#541 to prove the tests fail without the fix, hand-computed #542 ratios, adversarially checked #543 for IDOR/secret-leak). Awaiting required CI (verify+build+mobile). No migrations/secrets; +1 PENDING_OPS owner step (`enable-stripe-customer-portal`). No ROADMAP box ticked (all incremental hardening).

### Lessons learned
1. **VERIFY scout findings against the real stack before acting — two false positives this run.** `proxy.ts` is the CORRECT Next 16 middleware convention (not dead middleware); a single `INSERT…RETURNING` preserves VALUES order (not a reorder bug). A Haiku scout trained on older framework versions will over-flag; a 30-second check (next version, one doc) saved two wasted changes.
2. **An abandoned half-fix is a tell that the real bug survives.** `void group1Keys; void group2Keys` (composite keys built, never used) sat next to a `.find()`-by-category merge that the keys were meant to fix — the duplicate-category bug was still live. When a sibling path already does it right (Final Assessment positional merge), extract+share that, don't re-patch.
3. **Fake-success applies to billing UI too.** A checkout-success page that prints "Welcome to Pro" from a query param is a SIDE-EFFECT INTEGRITY violation as surely as an undelivered email — gate the success on the real downstream effect (entitlement), and fall back to an honest auto-refreshing pending state, never the param.
4. **A clean scorecard-reconcile still needs a fresh scout sweep for the real value.** 2 of the scorecard's 3 named ship-critical gaps were already closed at HEAD (#530/#532); the run's actual value (5 changes) came from the fresh DEEP AUDIT, not the stale named gaps.

### Rotation guide for next run
- **DEEP AUDIT ran Run 76** — next due ~Run 80 (~4 runs). Next run can lean on the scorecard/scouts.
- **#1 ship blocker stays functional_reality (persistence)** — human-gated (`cutover-to-persistent-data`). Not headlessly buildable; do NOT fabricate busywork.
- **design_taste B** — authed AxeBuilder on seeded diagnosis/mockups/compare + F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in sandbox). Still the CI-only-verifiable closure.
- **E7 lifecycle tail is the richest remaining buildable growth work** (upgrade/habit email templates + a habit-emails cron, analytics-aggregates surface E7.6, experiment engine E7.7) — real but each touches shared call sites (signup/analysis) or new migrations; scope carefully, one at a time, file-disjoint.
- **Deferred low-value this run:** `app-tabs.web.tsx` "Expo Starter" text; muted-text-on-amber-tint a11y nits (identified-product-pill, scene-coverage-card); saved.tsx unhandled Share fallback; validation-agent partial-response hard-fail (currently safe/logged).

---

## Run 2026-07-10 (Run 77)

### State on entry
- Default tip `36a9084` (#545). Baseline gate GREEN: tsc clean, **1916 tests** pass / 11 skip, determinism green, eslint clean.
- No DEEP AUDIT due (last was Run 76; next ~Run 80).
- **Discovered #543 (Run 76 Stripe Customer Portal) was still OPEN, not merged** — the Run 76 ledger row listed it under "#540-544 merged" but `app/api/billing/portal/route.ts` did NOT exist on default. Its `journeys` CI check had failed on a `/account` axe color-contrast serious violation.

### #543 recovery (the headline)
- Root cause of the journeys failure: #543's new "Manage subscription" `warm-outline` button rendered `text-accent-warm` (#b4501e) → **4.44:1** on the card tint `#f8ede8`, just below AA 4.5:1. #543 was branched from `80396ba`, which is BEFORE #542 (Run 76) changed `warm-outline`→`text-accent-warm-strong` (#a3441a, ~5.4:1 on that bg).
- Fix = **rebase #543 onto the current default** (now includes #542). No code change. Confirmed the button now resolves to `accent-warm-strong`; tsc + billing-portal tests green; force-pushed → journeys GREEN → auto-merged. The independent CI gate confirmed the contrast fix.

### Changes shipped (all 4 merged)
- **#543** (recovered) — self-serve Stripe Customer Portal on /account.
- **#547 (DETERMINISM)** — `lib/agents/orchestrator.ts`: two per-category score sorts (coordinator state + self-correction state) had no tiebreaker → tied `final_item_score` kept async insertion order → `topPickTitle`/`topPickPrice` fed to `planCorrections()`'s LLM prompt drift run-to-run. Extracted exported `compareByFinalScoreDesc()` (score-desc + `tiebreakProduct` URL tiebreak, the pattern already inline ~8× in the file) + applied at both sites + regression test.
- **#548 (MOBILE)** — `mobile/src/app/settings.tsx`: added a "Manage subscription" row (Apple 3.1.2 / Play) opening RevenueCat `CustomerInfo.managementURL`; honest alert when RC unconfigured / no store sub. Mirrors #543's web portal.
- **#549 (A11Y)** — `app/page.tsx`: landing hero "Designed for you" caption `text-accent-warm/60` (~2.1:1 over the CSS gradient; axe can't flag text over a gradient) → `text-accent-warm-strong` (~5.2:1).

### Merge outcome
Integrated gate GREEN in-run (3 new merged onto a scratch branch): tsc clean, **1919 tests** (+3), determinism green, eslint clean. 6 Sonnet reviews on the 3 new PRs, all APPROVE (#548 had one conditional-APPROVE: Reviewer B caught the code comment citing Apple "5.1.1(i)" — that's the Privacy-Policy guideline, not subscription-management (3.1.2); fixed the comment). #543's prior both-APPROVE held (rebase-only). #548's journeys job flaked once (~12s fail, missing `/tmp/app.log` = app never started; a mobile-only diff can't affect web journeys) → `rerun_failed_jobs` → GREEN. No migrations/secrets; no new PENDING_OPS. No ROADMAP box ticked (all incremental / enhancements to complete Track C/D).

### Lessons learned
1. **Don't trust a prior ledger's "merged" claim — verify the artifact on default.** #543's row said merged; the portal route file was absent and the PR was still open with a red `journeys` check. On entry, `ls` the promised artifact / `git log -- <path>` before assuming a recent PR landed.
2. **A stale base can be the whole bug.** #543 failed an a11y gate purely because it predated the sibling token fix (#542). Rebasing onto the current default fixed it with zero code change — always check the base before hand-patching a red PR from a prior run.
3. **Re-verify scout findings against the code AND the tests.** Two false positives this run: the search/route "insert-order" bug (Run 76 already dismissed it) and a spatial-math "coverage gap" the existing test already covers. A 30-second check of the real file/test avoided two churn changes.
4. **Distinguish an infra flake from a test failure.** A journeys job that dies in ~12s with `/tmp/app.log: No such file or directory` never started the app — it's a setup flake, re-run it. Especially when your diff (mobile-only) structurally cannot touch the failing surface (web journeys).

### Rotation guide for next run
- **DEEP AUDIT due ~Run 80** (last Run 76). Next 1–2 runs can lean on scouts/scorecard.
- **#1 ship blocker stays functional_reality (persistence, in-memory data layer)** — human-gated (`cutover-to-persistent-data`); not headlessly buildable, do NOT fabricate busywork.
- **design_taste B** — authed AxeBuilder on seeded diagnosis/mockups/compare + F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in sandbox).
- **Richest remaining buildable growth work = E7 tail** (E7.6 analytics-aggregates surface, E7.7 experiment engine — both file-disjoint, E7.7 needs new migration 030; deferred this run as larger pre-launch infra with no live data yet). Reviewer-A follow-up nit from #547: two other orchestrator sort sites (~2652 runAudit, ~3243 live-confidence) already inline the tiebreak but could adopt `compareByFinalScoreDesc` for DRY — low value, optional.
- **Deferred low-value this run:** mobile results.tsx `Array.isArray` hardening (already has `?? []`); saved-designs POST parallelization (marginal under in-memory store).

---

## Run 2026-07-11 (Run 78)

### State on entry
- Default tip `2734bcf` (#557). Baseline gate GREEN: tsc clean, **1923 tests** pass / 11 skip, determinism green, eslint clean. No open PRs.
- No DEEP AUDIT due (last Run 76; next ~Run 80). Leaned on a fresh scout sweep + a HEAD-reconcile of the open quality issues.

### Reconcile — all 3 open quality issues are STALE (already fixed at HEAD)
Per the Run 75/76 lesson (verify the scorecard/issues against HEAD before acting):
- **#527** (security_rls A, GET /api/area-analysis IDOR) → `app/api/area-analysis/route.ts` GET already has the `userOwnsRoom` guard before the `room_diagnoses` read (fixed #530); covered by `__tests__/api/idor-followup-guards.test.ts`. Stale.
- **#526** (artifact_integrity B, preflight GATE 5 `priority: low`) → all `PENDING_OPS.md` OWNER_ACTIONS priorities are now high/normal/urgent (fixed #532). Stale.
- **#348** (entitlements fail-open) → `lib/entitlements/server.ts` already fails CLOSED in production, OPEN in dev, on a missing RC key. Stale.
No work on any of these.

### Scout sweep (6 Haiku) + what was rejected
Lenses: security/RLS, correctness, web-a11y, mobile, tests, artifact-freshness.
- **Security CLEAN, artifact-freshness CLEAN** (77 hardening runs + consistent docs; pricing $29/$49-mo/$399-yr aligned across BUSINESS_CASE/pricing/stripe.ts/store-listing).
- **Web-a11y 5 findings — ALL over-flags, rejected.** 4 were ICON circles (Lucide icon on `bg-accent-warm/10`): icons are graphical → WCAG 3:1 bar, and `text-accent-warm` (~4.9:1) passes 3:1 comfortably. The 5th was a text link the scout itself scored ~5.8:1 (passes 4.5:1). Swapping a passing token for `-strong` is cosmetic churn. **Rule of thumb: apply 4.5:1 only to TEXT; icon/graphic circles use the 3:1 bar — don't token-swap passing icons.**
- **Mobile 4 findings — ALL over-flags, rejected.** Each was a `Pressable`/`ThemedText` with a VISIBLE text child; React Native auto-derives the accessible label from child text, so VoiceOver/TalkBack already announce context. `accessibilityLabel` is redundant there. **Rule of thumb: a text-bearing RN Pressable is already labeled — only icon-only controls need an explicit accessibilityLabel.**
- **Tests 4 findings — deferred.** Real branch gaps (token-budget early-exit, degradation gates, tier selection) but embedded in the ~2000-line `runAgenticSearch` (heavy mocking → assertion-light/low-value) or a 6-line private switch. Not the best value this run.
- **Correctness gemini.ts jitter — rejected.** Sensitive cost-contract file; the jitter is retry-BACKOFF timing only (no output/ordering effect); `check:determinism` is green; and the scout's "retry.ts line 85 already gates it" premise is FALSE (no `lib/utils/retry.ts` exists). Not worth churning a floors-guarded file.

### Shipped — 2 file-disjoint determinism-contract fixes
- **#558 (extraction-gate)** — `selectExtractionCandidates` sorted each bucket by `relevanceScore` with no tiebreak; JS stable sort → equal-relevance ties kept incoming array order → WHICH candidates survived the per-bucket `slice(0,cap)` and reached paid Tavily-Extract + LLM scoring depended on upstream order, not the set (→ final bundles drift run-to-run). Added `|| a.url.localeCompare(b.url)` (matches `tiebreakProduct`/reranker.ts) + a test proven to fail without the fix.
- **#559 (identified-products dedup)** — `dedupByBrandModel` sorted deduped products by `confidence` with no tiebreak; ties common (default 0.5) → tied entries kept Map-insertion (= upstream `items`) order, feeding display + the scoring/prompt context (`buildIdentifiedPiecesBlock`) an order that varies with input sequencing. Added the `(brand,model,variant)` key tiebreak via a shared `dedupKey` helper; exported the fn for a focused 4-case test (tie case proven to fail without the fix).

### Merge outcome
Both opened (#558/#559), auto-merge (squash) enabled; awaiting required CI (verify+build+mobile). Integrated gate GREEN in-run (both on a scratch branch): tsc clean, **1928 tests** (+5), determinism green, eslint clean. **Both both-Sonnet-APPROVED** (5 reviews total: #558 A+B; #559 A + two B — one B slot mis-targeted, see lesson). No migrations/secrets; no new PENDING_OPS. **No ROADMAP box ticked** (both incremental determinism hardening; no Track item completed).

### Lessons learned
1. **Reviewer subagents with write access can dirty the working tree AND read the wrong branch.** Two general-purpose reviewers applied/stashed the diff onto the live tree to test it; one Reviewer-B slot then reviewed the DEDUP change instead of the extraction-gate diff I pasted, because the working tree was checked out on the dedup branch and it read the repo rather than the prompt. Fix: cleaned the tree (`git checkout -- . && git clean -fd`), re-ran the missing review as a **read-only, diff-only, do-NOT-modify** reviewer with the correct branch checked out. NEXT RUN: spawn per-change reviewers with the target branch checked out AND an explicit "do not modify/stash/checkout; review only" instruction (or a read-only agent type) so they can't dirty the tree or drift onto the wrong branch.
2. **Icons use the 3:1 contrast bar, not 4.5:1.** A whole class of a11y "AA failures" this run were `text-accent-warm` on Lucide icon circles — those pass 3:1 and need no change. Only TEXT on a tint needs `text-accent-warm-strong`. Verify text-vs-graphic before token-swapping.
3. **Text-bearing RN Pressables are already accessible.** React Native derives a Pressable's accessible label from its visible Text child; adding `accessibilityLabel` there is redundant. Only icon-only controls need it. Don't ship redundant-label churn.
4. **Stable sort hides latent non-determinism, not active drift.** Both fixes this run were sorts where input order is CURRENTLY deterministic (so `check:determinism` is green), but the missing tiebreak makes the output depend on upstream sequencing — a latent violation the contract's blanket rule targets. The meaningful test asserts order-INDEPENDENCE (same set, two input orders → identical output), which fails without the tiebreak even though the pipeline isn't visibly flipping yet.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 80** (last Run 76). Next run can still lean on scouts/scorecard, but a full 8-lens sweep is due within ~2 runs.
- **#1 ship blocker stays functional_reality (in-memory data layer persistence)** — human-gated (`cutover-to-persistent-data`); not headlessly buildable, do NOT fabricate busywork.
- **design_taste B** — authed AxeBuilder on seeded diagnosis/mockups/compare + F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in sandbox).
- **Named determinism follow-up (file-disjoint next run):** the `verifyOrder` sort (~line 164, `lib/agents/identified-products-pipeline.ts`) sorts by `top?.confidence` with no tiebreak — same class as #559 but SAME file, so it was deferred this run. Ship it next run (with a proven-fails-without-fix test).
- **Richest remaining buildable growth work stays the E7 tail** (E7.6 analytics-aggregates surface, E7.7 experiment engine needs migration 030) — but pre-launch with 0/null data and no reachable metrics endpoint, so it stays deferred as speculative until real data/connectivity lands.
- **Deferred low-value this run:** web-a11y icon token-swaps (pass 3:1); mobile redundant accessibilityLabels; gemini.ts retry jitter (sensitive file, timing-only); orchestrator token-budget/tier unit tests (heavy-mock/low-value).

---

## Run 2026-07-11 (Run 79)

### State on entry
- Default tip `26c0bfa` (#561, a GTM routine commit). Baseline gate GREEN: tsc clean, **1928 tests** pass / 11 skip, determinism green, eslint clean. No open PRs.
- No DEEP AUDIT due (last Run 76, ~1 day / ~3 runs ago; next ~Run 80). Leaned on a fresh 6-Haiku-scout sweep + a HEAD-reconcile of the (stale) QUALITY_SCORECARD.

### Reconcile — the scorecard (as_of 2026-07-09) is 2 days stale; both named ship-critical gaps already fixed at HEAD
- **security_rls A gap** (GET /api/area-analysis IDOR) → `app/api/area-analysis/route.ts` GET already has the `userOwnsRoom` guard before the `room_diagnoses` read (fixed #530). Stale.
- **artifact_integrity B gap** (preflight GATE 5 `priority: low`) → all PENDING_OPS OWNER_ACTIONS priorities are high/normal/urgent now (fixed #532). Stale.
- Remaining ship-critical-below-A: **functional_reality C** (in-memory persistence — human-gated `cutover-to-persistent-data`, not headlessly buildable) and **design_taste B** (seeded-AxeBuilder on diagnosis/mockups/compare + F7 screenshots — CI/auth-stack-bound, supabase-local unrunnable in-sandbox). No busywork on either.

### Scout sweep (6 Haiku) + verification
Lenses: determinism/correctness, security/RLS, mobile, web-a11y, tests, AI-pipeline.
- **Security CLEAN** (29 migrations RLS-covered, IDOR guards on every client-id route, no secret leak). **Mobile CLEAN** (journey + entitlement gating + store-compliance entry points all production-ready; only dead-code `HintRow`).
- **Determinism scout** flagged 10: 2 real TIER-1 sort-tiebreak gaps (verify-search, domain-router) + 8 "missing seed" `.chat()` calls. Verified the seed mechanism: `resolveSeed()` forces the seed under the DETERMINISTIC flag but passes the caller's value in prod → the missing-seed calls are invisible to `check:determinism` but real for prod reproducibility.
- **Rejected / deferred:** gemini.ts `GEMINI_API_KEY` fail-loud (borderline, sensitive cost-contract file, delayed-error only — route try/catch 500s either way); analyze-apartment + area-analysis/refine seed additions (zero-seeded files — deferred to avoid over-batching identical seed changes; apartment-research shipped as the clearest partial-migration case); test-scout's `formatExamplesForPrompt`/`formatAccessConstraintsForPrompt` (real but lower-value than `computeDynamicBaseline`).

### Shipped — 5 file-disjoint value-bar changes (all Track F)
- **#562 (DETERMINISM)** — verify-phase priority sort in `identified-products-pipeline.ts`: extracted `compareVerifyPriority()`+`cropSortKey()` (confidence-desc + image/label/box tiebreak) so tied crops don't win the `maxVerifyCalls` budget by fan-out order. +6 tests.
- **#563 (DETERMINISM)** — per-category verify pick in `verify-search-candidates.ts`: extracted `rankCandidatesByEvalScore()` (score-desc + product-id tiebreak) so the browser-verified pick is a pure function of the candidate set. +4 tests.
- **#565 (A11Y)** — `aria-label` on the placeholder-only product-URL `Input` (room products page). WCAG 3.3.2/4.1.2, no visual change.
- **#566 (DETERMINISM)** — seeded the 4 unseeded `chat()` calls in `apartment-research/route.ts` (1 of 5 was already seeded — partial migration). 2 take effect in prod; 2 with `urlContext` tools are inert-but-harmless (provider `!hasUrlContext` seed-drop) — disclosed in the PR.
- **#567 (TESTS)** — 10 branch/boundary cases for `computeDynamicBaseline` (`lib/scoring/calibration.ts`), previously untested directly (existing calibration.test.ts runs with an empty drift buffer).

### Abandoned — #564 (domain-router alphabetical tiebreak) on Reviewer-A REQUEST_CHANGES
The `prioritizeDomains()` sort has no tiebreak, but at the SOLE call site (`shopping-researcher.ts`) the input domain list is deliberately CURATED (category retailers first, then tier defaults) and constant-derived, so JS stable sort already gives run-to-run reproducibility. An *alphabetical* tiebreak would discard that curated Tavily `include_domains` priority (unseen domains all tie at 0.5) with NO offsetting determinism gain; the only regression-free alternative (index/stable tiebreak) is a behavioral no-op = churn. Closed PR, deleted branch. The review process working exactly as intended.

### Merge outcome
All 5 opened + auto-merge (squash) enabled; required CI (verify+build+mobile+lint+journeys) GREEN on all → merged to default. Merged default = **1948 tests** (1928 → +20: verify-order 6 + verify-search 4 + calibration 10; #565/#566 add 0). The all-6 scratch showed 1950 before #564 was abandoned. tsc clean, determinism green, eslint clean. **All 5 both-Sonnet-APPROVED (10 reviews)** — reviewers reproduced each pre-fix failure, confirmed the extracted comparators behavior-equivalent, hand-verified the calibration arithmetic. Reviewers ran READ-ONLY against the diff FILES (per the Run 78 lesson) — no tree-dirtying this run. No migrations/secrets; no new PENDING_OPS. **No ROADMAP box ticked** (all incremental Track-F hardening).

### Lessons learned
1. **The determinism "every score sort needs a tiebreak" rule is NOT universal — it depends on whether the sort's INPUT order is meaningful.** Where the input is a curated, deterministic constant list (domain-router's `include_domains`), JS stable sort ALREADY guarantees reproducibility, and an id/alphabetical tiebreak REGRESSES the curated intent while adding nothing. Apply the tiebreak only where input order is non-deterministic (async fan-out: #562/#563) or semantically irrelevant. #564 was the counterexample; Reviewer A caught it.
2. **Check the scorecard `as_of` before acting on its named gaps.** The 2026-07-09 scorecard (2 days stale) named 2 ship-critical gaps both already closed at HEAD (#530/#532). The real value came from the fresh scout sweep, not the stale gaps — same pattern as Runs 75/76/78.
3. **Passing reviewers the diff as a read-only FILE cleanly avoids the Run-78 tree-dirtying failure mode.** Wrote each branch's diff to a scratchpad file, told reviewers to Read only that file + repo files for context, do NOT modify/checkout. Zero tree contamination, correct-branch reviews.
4. **Verify a provider mechanism before trusting a "missing X" scout finding.** The 8 "missing seed" calls were real contract gaps but the effect is prod-only (resolveSeed forces the seed in test mode) and 2 of the 4 I shipped are inert due to the `urlContext` seed-drop guard — knowing that made the PR honest rather than over-claiming.

### Rotation guide for next run
- **DEEP AUDIT due ~Run 80** (last Run 76). Next run should run a full 8-lens sweep (it will be ~4 runs / >24h since the last true audit).
- **#1 ship blocker stays functional_reality (in-memory data-layer persistence)** — human-gated (`cutover-to-persistent-data`); not headlessly buildable, do NOT fabricate busywork.
- **design_taste B** — seeded AxeBuilder on diagnosis/mockups/compare + F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in-sandbox).
- **Named determinism follow-ups still open:** analyze-apartment (2 calls) + area-analysis/refine (2 calls) are zero-seeded `chat()` files — same contract gap as #566 but deferred this run to avoid over-batching identical seed changes; ship next run if judged value-bar-clearing (each brings a route into contract-compliance; weigh vs churn since no test catches it). Do NOT re-attempt domain-router (#564 abandoned by design — see Lesson 1).
- **Richest remaining buildable growth work stays the E7 tail** (E7.6 analytics-aggregates surface, E7.7 experiment engine needs migration 030) — pre-launch with 0/null data, still speculative.
- **Deferred low-value this run:** gemini.ts `GEMINI_API_KEY` fail-loud (borderline, sensitive file); `formatExamplesForPrompt` / `formatAccessConstraintsForPrompt` tests (real but lower-value than what shipped); dead-code `HintRow` in mobile.

---

## Run 2026-07-11 (Run 80)

### State on entry
- Default tip `fcb167e` (#569, the sixth independent quality grade). Baseline gate GREEN: tsc clean, **1948 tests** pass / 11 skip, determinism green, eslint clean. No open PRs.
- DEEP AUDIT was DUE (last full sweep Run 76; Runs 77-79 leaned on scouts/scorecard). Ran it this run before scouting.

### DEEP AUDIT — 2026-07-11 (Run 80), 8-Haiku-scout whole-codebase sweep
Lenses: security/RLS · correctness/dead-code · perf · a11y/design-bar · mobile · functional-reality/config · tests/eval-coverage · Track-G hardening. Findings distilled:
- **SECURITY/RLS:** CLEAN. Fresh adversarial sweep of all migrations + all 52 API routes resolving a client id — every tenant table RLS-enabled, every IDOR-class route ownership-gated, no SECURITY DEFINER/search_path gap, no secret leak. No change (clean = no-op).
- **CORRECTNESS:** CLEAN. No new logic bug; all `.chat()` carry thinkingConfig, LLM calls timed, `.single()` null-checked. No change.
- **G1 RATE-LIMITING found COMPLETE** (independent enumeration): 33 routes on `checkRateLimit`/`enforceWriteRateLimit` + 2 bespoke per-IP limiters (signup, waitlist) cover every paid/auth/expensive route; billing/webhook correctly unprotected (Stripe-driven), billing/status + identified-products/search are cheap auth reads. **NOT self-ticked** — maker≠checker; the readiness gate should confirm before G1's box flips.
- **PERF:** all inert or already-done. Supabase projection-narrowing (`select("*, nested(*)")` → narrow) is INERT under the default in-memory data layer (no wire payload; same reasoning as the standing embedding-index N+1). The scout's "dashboard N+1" is ALREADY `Promise.all`-parallelized (`dashboard/page.tsx:135`) — false positive. No perf change shipped (would be inert/churn).
- **A11Y/DESIGN:** mostly dead-code/false-positive. `global-error.tsx` inline hex is the CORRECT Next.js pattern (it renders WITHOUT the app stylesheet, so CSS vars are unavailable). `gallery/page.tsx` hex are literal color-swatch DATA, not styling. toast/badge emerald/amber are semantic status colors. The one real cluster (dead Expo-branded mobile code) folded into #571.
- **MOBILE:** the real finding was dead Expo starter-template scaffolding (`AnimatedIcon` native+web + `WebBadge`, all unused; "Expo Starter" brand string; orphaned Expo/React assets) → shipped **#571**. Core journey + entitlement gating stay production-ready.
- **FUNCTIONAL-REALITY/CONFIG:** 4 external-I/O routes lacked an explicit `maxDuration` (places/photo, upload, waitlist, cron/activation-emails) → shipped **#570**. The in-memory persistence blocker is unchanged (human-gated `cutover-to-persistent-data` — not re-filed). Stripe env "silent fail" deferred (throws at call time = arguably already loud; billing-sensitive).
- **TESTS/EVAL:** the scout over-proposed 3 ALREADY-TESTED modules (turnstile, sanitize-prompt, email/preferences all have test files). Only `email/resend` (#572) and `db/diagnosis-examples` (#573) were genuinely untested → shipped both.

### Area served — 4 file-disjoint value-bar changes
#570 reliability (maxDuration on 4 I/O routes), #571 mobile/Track-D (strip Expo template scaffolding), #572 tests (ResendProvider.send), #573 tests (fetchDiagnosisExamples). See IMPROVEMENT_LOG Run 80 row for full detail.

### Merge outcome
Opened #570-573, auto-merge (squash) on all 4. Integrated gate GREEN in-run (all 4 on a scratch branch): tsc clean, **1964 tests** (1948 +16: 7 resend + 9 diagnosis-examples), determinism green, eslint clean; mobile tsc + expo lint clean (installed mobile deps to verify — sandbox lacked them). All 4 both-Sonnet-APPROVED (9 reviews incl. 1 re-review). Awaiting required CI (verify+build+mobile+lint+journeys). No migrations/secrets; no new PENDING_OPS. No ROADMAP box ticked.

### Lessons learned
1. **The tests scout over-proposes already-tested modules every run.** This run it named turnstile, sanitize-prompt, email/preferences — all with existing test files. Always `ls __tests__` / grep for the module before writing a test; verify the gap is real (same discipline as the prior "extractBackfillKeywords already tested" lesson).
2. **Perf projection-narrowing is INERT under the in-memory backend.** A `.select()` payload narrow only helps once real Postgres is over a wire; today it's a no-op. Don't ship it as a perf win until the persistence cutover — Reviewer B would (correctly) call it inert.
3. **`global-error.tsx` inline hex and literal color-swatch hex are correct, not token violations.** global-error renders without the app stylesheet (CSS vars unavailable → inline hex is mandatory); a swatch showing `#b4501e` IS the data. An a11y scout over-flags both.
4. **When a cap runs BEFORE a filter, a test for the filter must place its target INSIDE the cap window.** My #573 "caps+strips" test put the invalid item beyond `slice(0,6)`, so the strip filter had zero coverage (Reviewer A proved it via mutation). A maker-side mutation check (delete the line, see if a test fails) before review would have caught it — do this for any test whose whole purpose is a specific branch.
5. **Reviewer subagents can dirty the shared working tree** (one `git apply`'d a diff onto the wrong branch and left it). Discard-and-continue; keep giving reviewers the diff as a read-only file.

### Rotation guide for next run
- **DEEP AUDIT ran Run 80** — next due ~Run 84. Next few runs can lean on scouts/scorecard.
- **#1 ship blocker stays functional_reality (in-memory persistence)** — human-gated (`cutover-to-persistent-data`); NOT headlessly buildable, do NOT fabricate busywork.
- **design_taste B** — authed AxeBuilder on seeded diagnosis/mockups/compare + F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in sandbox), still the CI-only-verifiable closure.
- **G1 appears COMPLETE** (this run's independent enumeration) — a candidate for the readiness gate to confirm and tick; G4 (login lockout/backoff, password-reset enumeration guard) remains the open Track-G auth-hardening work but needs a server-side login route (larger).
- **Richest remaining buildable growth work stays E7 tail** (E7.6 analytics-aggregates surface, E7.7 experiment engine → migration 030) — pre-launch, 0/null data, still speculative.
- **Deferred low-value this run:** Stripe env fail-loud guard (borderline, billing-sensitive); the named zero-seeded `chat()` files from Run 79 (analyze-apartment ×2, area-analysis/refine ×2) still open — contract-compliance, weigh vs churn since no test catches it; toast/badge semantic-color→score-token routing (cosmetic); mobile `HintRow` dead code (still there).

---

## Run 2026-07-12 (Run 81)

### State on entry
- Default tip `47fc4bd` (#574, Run 80 housekeeping). Baseline gate GREEN: tsc clean, **1955 tests** pass / 11 skip, determinism green, eslint clean.
- No DEEP AUDIT due (ran Run 80; next ~Run 84). Leaned on a fresh 6-Haiku-scout sweep + a HEAD-reconcile of the scorecard (overall C; ship-critical-below-A = functional_reality C [in-memory persistence, human-gated `cutover-to-persistent-data`] + design_taste B [seeded-AxeBuilder + F7 screenshots, CI/auth-stack-bound] — neither headlessly buildable, no busywork).

### RECOVERY — #573 was ledgered as merged in Run 80 but never merged
- Run 80's housekeeping title said "#570-573"; #570/#571/#572 merged, **#573 did NOT**. `git merge-base --is-ancestor 83068d1 HEAD` → NOT merged; `__tests__/db/diagnosis-examples.test.ts` absent at HEAD. The PR sat OPEN with auto-merge enabled and **`total_count: 0` checks** — CI never triggered for that SHA (stale base). So auto-merge waited forever on checks that never came, while the ledger claimed it merged.
- Fix: re-cut the test file onto the current tip as **#575**, closed the stale #573. Verified the recovered test still passes (10/10) at HEAD.
- **Lesson:** auto-merge on a stale base can leave a PR with ZERO CI checks that never fire → verify ACTUAL merge state before ticking, and after opening new PRs confirm their CI actually TRIGGERS (this run's did — CI run #1155 `in_progress`, not the #573 zero-check limbo).

### Scout sweep (6 Haiku) + what was rejected
Lenses: determinism/correctness, security/RLS, tests/coverage, mobile, web-reliability, growth/marketing.
- **Security CLEAN** (fresh adversarial sweep: 30+ migrations RLS-covered, 52 id-resolving routes ownership-gated, no secret leak). **Tests scout** confirmed `db/diagnosis-examples` is the SOLE real coverage gap (all other untested modules are re-exports / static data / heavy-mock infra).
- **Rejected over-flags:** (1) "broken Pro-annual pricing CTA" — `pro_annual` IS fully wired in `stripe.ts`/checkout/webhook; the store-listing omission is a deliberate ASO choice, not a broken checkout. (2) "waitlist coming-soon but app is live" — FALSE; the app is PRE-LAUNCH/pre-submission, coming-soon copy is correct. (3) area-analysis "hardcoded `thinkingLevel:low` → `thinkingFor(HIGH)`" — BACKWARDS vs cheapest-by-default; those subtasks are correctly cheap, raising them increases per-request cost. (4) "wrap `getUser()` on 36 routes" — sprawling + a transient 500 on most is acceptable; picked only the single cleanest OAuth path (#577). (5) gallery hardcoded example scores — framed as "example projects", not testimonials; subjective, deferred. (6) orchestrator logging-only sort tiebreak — logging-only, churn.

### Shipped — 4 file-disjoint value-bar changes
- **#575 (TESTS, recovers #573)** — `fetchDiagnosisExamples` two-tier query, dedup (mutation-proven), <3-item drop, 6-item cap, slice-then-filter strip (mutation-proven), graceful DB-error→[], XML shape. 10 cases.
- **#576 (MOBILE, Track B+D)** — removed a leftover "Docs → docs.expo.dev" `ExternalLink` rendered LIVE in the mobile web-build tab bar (`app-tabs.web.tsx`) + now-dead imports (ExternalLink/SymbolView/useColorScheme/Colors) + `externalPressable` style; deleted unused `hint-row.tsx`. Finishes the same-file cleanup #571 began.
- **#577 (RELIABILITY, Track A)** — wrapped OAuth callback `exchangeCodeForSession` in try/catch (transient throw → graceful `/login?error=auth` instead of uncaught 500). `createClient()` kept OUTSIDE the try (fail-loud misconfig must surface). +5-case test (THROW-degrades fails without the fix).
- **#578 (SEO, Track E)** — landing `app/page.tsx` had NO metadata → inherited the generic root `<title>`; added keyword-optimized title/description/canonical + OG/Twitter, plus `metadataBase` + sitewide OG/Twitter defaults on the root layout. Grounded copy, no fabricated metrics, no missing-image reference.

### Merge outcome
Opened #575-578, auto-merge (squash) on all 4; CI confirmed TRIGGERED (run #1155 `in_progress`). Integrated gate GREEN in-run (all 4 on a scratch branch): tsc clean, **1970 tests** (1955 +15: 10 diagnosis-examples + 5 auth-callback), determinism green, eslint clean; mobile tsc + eslint clean. **All 4 both-Sonnet-APPROVED (10 reviews incl. 1 re-review).** **One review round on #577:** Reviewer A caught the try wrapping `createClient()`'s fail-loud throw → narrowed to just the exchange, re-reviewed → APPROVE. **#578 strengthened** per Reviewer A's note (Next replaces, not per-field merges, a page's `openGraph`) by repeating `siteName` on the landing OG. No migrations/secrets; no new PENDING_OPS. **No ROADMAP box ticked.**

### Lessons learned
1. **A ledgered-merged PR can be un-merged.** #573 was recorded merged in Run 80 but auto-merge stalled on a zero-check stale base. Verify `git merge-base --is-ancestor` / artifact existence before trusting a prior tick; confirm new PRs' CI actually fires.
2. **Verify the checkout wiring before calling a pricing-copy mismatch a bug.** `pro_annual` is fully wired; the flagged "broken CTA" was a store-listing ASO omission.
3. **"Use HIGH thinking" findings are usually backwards here.** Cheapest-by-default: a cheap subtask staying cheap is correct; don't "fix" it into a cost increase.
4. **vitest v4: a `vi.fn()` whose OWN implementation throws mis-surfaces the error across sibling tests** (a client-METHOD throw does not). Test a caught-createClient-throw path via a method that throws, or drop that specific case — I dropped it; the exchange-throw case fully covers the catch.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 84.** Next few runs can lean on scouts/scorecard.
- **#1 ship blocker stays functional_reality (in-memory persistence)** — human-gated (`cutover-to-persistent-data`); NOT headlessly buildable, do NOT fabricate busywork.
- **design_taste B** — authed AxeBuilder on seeded diagnosis/mockups/compare + F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in sandbox).
- **`external-link.tsx` (mobile) is now near-dead** — after #576 its only importer is gone (settings/paywall reimplement inline); a candidate for deletion next run if still unreferenced.
- **Still-deferred low-value:** Stripe env fail-loud (billing-sensitive); the Run-79 zero-seeded `chat()` files (analyze-apartment ×2, area-analysis/refine ×2) — but note the determinism scout confirmed `resolveSeed(undefined)` already forces the seed under the DETERMINISTIC flag, so these are prod-only reproducibility niceties no test catches (weigh hard vs churn); gallery example-score honesty relabel (subjective).

---

## Run 2026-07-12 (Run 82)

### State on entry
- Default tip `1e14f69` (#580, a growth/brand-identity docs commit after Run 81's #579 housekeeping). Baseline gate GREEN: tsc clean, **1970 tests** pass / 11 skip, determinism green, eslint clean. No open PRs.
- No DEEP AUDIT due (ran Run 80; next ~Run 84). Ran an 8-Haiku-scout sweep + verified the scorecard's two ship-critical-below-A dims are still the known human-gated/CI-bound blockers (functional_reality C = in-memory persistence; design_taste B = seeded-AxeBuilder + F7 screenshots) — neither headlessly buildable, no busywork.

### Scout sweep (8 Haiku) + what was rejected
Lenses: tests/eval-coverage (F3), security/RLS, web-reliability/correctness, mobile, monetization, store-readiness/marketing, auth-hardening(G4)/a11y, determinism/cost-contract.
- **Security CLEAN** (29+ migrations RLS-covered, id-routes ownership-gated, entitlements fail-safe, no secret leak). **Web-reliability CLEAN** — the flagged `.single()`-without-error-field sites are all defended by optional chaining (no crash), not real bugs.
- **Rejected/stale over-flags:** (1) Issue #487 "store-listing sells non-transactable pro_annual" is ALREADY RESOLVED — store-listing.md intentionally omits pro_annual with a dated 2026-07-09 note (verified). (2) Issue #502 share-links-tier mismatch is a deliberate OWNER monetization decision (viral growth loop vs paywall lever) — the loop has correctly deferred it since Run 70; do NOT pick a direction unilaterally. (3) G4 login lockout/backoff needs a server-side login route (login is currently client-side supabase) — larger, deferred (still the open G4 work). (4) determinism scout's `social/index.ts` "untested" was a false positive (social-queue.test.ts covers isSocialDryRun/publishPost/validate). (5) "raise thinking to HIGH" — backwards vs cheapest-by-default.

### Shipped — 7 file-disjoint value-bar changes
- **#581 (BILLING/Track C)** — `subscription_data.metadata` at checkout omitted `tier`; Stripe subscription.updated/deleted webhooks see only the SUBSCRIPTION's metadata (not the session's), so `extractBillingInfoFromEvent`'s `?? "pro"` fallback misattributed every pro_annual subscriber to "pro" on renewal/cancel. Added tier + mutation-proven test. Entitlement gating was unaffected; only revenue attribution was wrong.
- **#582 (MOBILE a11y/Track D)** — RN doesn't associate a visible `<Text>` label with a `TextInput`; added `accessibilityLabel` to login/signup inputs, account-toggle Pressables, Collapsible header.
- **#583 (MOBILE/Track B)** — deleted unreferenced `external-link.tsx` (loop-memory Run 81 predicted this; last importer gone in #576).
- **#584 (TESTS/Track F3-F4)** — 19-case unit test for the `updateSession` auth-gating boundary (was untested); mocks `@supabase/ssr`, covers public/protected × page/API, dev-mode, `/guides` prefix + `/guidesX` lookalike-negative, getUser-throw degrade.
- **#585 (SECURITY/Track G)** — per-IP rate limit (60/min) on the unauthenticated `/api/shared/[token]` (only public data route with no limit); new `RATE_LIMITS.sharedDesign`; mutation-proven test.
- **#586 (A11Y/Track F)** — dashboard bedroom/bathroom toggles were color-only selection; added `aria-pressed` + `role=group`/`aria-labelledby`, matching the room-selection buttons already in the file.
- **#587 (DETERMINISM)** — seeded 5 unseeded `.chat()` calls (analyze-apartment ×2, area-analysis/refine ×2, area-analysis coordinator ×1); contract compliance, established pattern (#566/#562/#563).

### Merge outcome
All 7 opened (#581-587), auto-merge (squash), CI confirmed TRIGGERED (queued/in_progress — not the Run-81 zero-check limbo). **All 7 MERGED to default** (verified `git log`: tip 93d7359 carries #581-#587). Integrated gate GREEN in-run (all 7 on a scratch branch): tsc clean, **1994 tests** (1970 +24: 2 billing + 19 middleware + 3 shared-token), determinism green, eslint clean; mobile tsc + eslint clean. **All 7 both-Sonnet-APPROVED (14 reviews)** — reviewers mutation-verified the billing/middleware/shared-token tests catch their regressions. No migrations/secrets; no new PENDING_OPS. **No ROADMAP box ticked.**

### Note on the default-branch push CI "failure"
The push-event CI on the default tip shows a `migrate prod (auto-apply on push to default branch)` job FAILURE — it's the `supabase/setup-cli@v1` step (transient infra), with the apply step SKIPPED (no unapplied migrations; they're human-gated). ALL gating jobs (verify/build/journeys/lint/mobile/validate-*) are GREEN. This is a post-merge deploy-side job, not a PR-required check — my PRs merged on green PR CI. Do NOT treat this as a broken base.

### Lessons learned
1. **Stripe session metadata ≠ subscription metadata.** `checkout.session.completed` sees session `metadata`; `customer.subscription.*` events see only `subscription_data.metadata`. Anything a subscription webhook reads (tier) must be duplicated into `subscription_data.metadata`.
2. **A vitest mock factory using an arrow fn is not `new`-able.** `vi.fn(() => obj)` throws "not a constructor" if the SUT does `new X()`; use a normal function. Prior tests may not catch it if they throw before the `new` (the createCheckoutSession guard threw on missing STRIPE_SECRET_KEY before `new Stripe()`).
3. **`git checkout <file>` during a mutation-check also wipes an uncommitted edit on that file.** After neutering code to prove a test fails, `git checkout` restored HEAD and deleted my un-committed route change — re-apply after, or stash first.
4. **Verify a scout's specific line-count claims.** The determinism scout flagged area-analysis:1915 as unseeded but also implied 541 — 541 already passes a local `seed` var. Grep for the actual field, don't trust the raw line list.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 84** (ran Run 80). Next 1-2 runs can lean on scouts/scorecard.
- **#1 ship blocker stays functional_reality (in-memory persistence)** — human-gated (`cutover-to-persistent-data`); NOT headlessly buildable, no busywork.
- **design_taste B** — authed AxeBuilder on seeded diagnosis/mockups/compare + F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in sandbox).
- **G4 remaining** = login lockout/backoff + password-reset/verification enumeration guards; needs a server-side `/api/auth/login` route (there is none today — login is client-side supabase). A larger, coherent feature for a future run.
- **G1 rate-limiting now covers the last public data route** (#585 shared-design) — a candidate for the readiness gate to confirm-and-tick (maker≠checker; don't self-tick).
- **Still-deferred low-value:** Stripe env fail-loud guard (billing-sensitive); share-links-tier (#502, owner decision); gallery example-score relabel (subjective). Migrations 019/020/021 remain human-gated in PENDING_OPS (share-link RLS + pro_annual CHECK).

---

## Run 2026-07-12 (Run 83)

### State on entry
- Default tip `015317a` on entry (a sibling "emit LLM economics to Margin via @margin/meter" feature commit after Run 82's #588 housekeeping). Baseline gate GREEN after a cold `npm ci`: tsc clean, **1994 tests** pass / 11 skip, determinism green, eslint clean. No open PRs.
- No DEEP AUDIT due (ran Run 80; next ~Run 84). Ran an 8-Haiku-scout sweep + read the QUALITY_SCORECARD (overall C; ship-critical below-A dims unchanged: functional_reality C = in-memory persistence default, design_taste B = seeded-AxeBuilder + F7 screenshots) and GROWTH_STATUS (pre_launch, 0/null funnel, 4 owner blockers open 8+ runs) — both confirmed the known human-gated / CI-bound blockers, neither headlessly buildable.

### Scout sweep (8 Haiku) + what was rejected
Lenses: web-reliability/correctness, security/RLS, tests/coverage, determinism/cost-contract, mobile, monetization/billing, store/marketing artifact-freshness, a11y/design/perf.
- **Security CLEAN** (fresh sweep: RLS on every tenant table, IDOR guards on all id-routes, SSRF/spend-cap/rate-limit intact, no secret leak). **Monetization CLEAN** (webhook signature→DB-write→mark-active ordering, no fake-success, no trust-the-client entitlement, tier attribution correct post-#581). **Web-reliability:** only the signup-maxDuration gap was real.
- **Rejected/verified over-flags:** (1) upload `getPublicUrl()` "missing error check" — FALSE POSITIVE; supabase-js `getPublicUrl` is SYNCHRONOUS and never returns an error. (2) search/route session-insert early-return — deferred; search/route.ts is a 500-line hot path the margin-meter commit just touched, and continuing past a failed AUDIT-session insert is defensible fail-open (weigh vs churn; not obviously a bug). (3) mobile "add Saved tab" — needs a `tabIcons/saved.png` asset (Metro-require would throw, tsc won't catch) + can't verify nav renders headlessly (BUILDS≠WORKS). (4) next/image adoption (32 raw `<img>`) — layout-break risk, not visually verifiable headlessly, perf is non-ship-critical. (5) `<main>` landmark on focus/saved/shared pages — real WCAG 1.3.1 gap but needs the F4 authed axe suite to verify (supabase-local unrunnable here). (6) mobile a11y-label nits — aria-labels/text-children already present. (7) "raise thinking to HIGH" — backwards vs cheapest-by-default (recurring scout error).

### Shipped — 5 file-disjoint value-bar changes
- **#589 (DETERMINISM)** — `lib/scoring/pairwise-reranker.ts` win/score sort returned 0 on double-ties; added `a.id.localeCompare(b.id)` (id > url: id non-null, url nullable → collapses). Mutation-proven tied-case test (non-id input order distinguishes the fix from V8 stable-sort).
- **#590 (RELIABILITY/Track A)** — signup route had no `maxDuration` despite an outbound Turnstile fetch; added `= 20` + guard test. Matches #570.
- **#591 (TESTS/Track F)** — pinned the Margin telemetry egress gate (new 015317a code, sole external-egress path); mutation-proven all three fail-safes.
- **#592 (TESTS/Track F)** — covered the `accentOnly` budget-suppression branch (under-suppressed, over-still-flags); mutation-proven.
- **#593 (DOCS/Track D+F5)** — disclosed Margin processor in `app/privacy/page.tsx` + BOTH Apple/Play tables in `docs/app-privacy.md`; copy verified against real payloads.

### Merge outcome
All 5 opened (#589-#593), auto-merge (squash) enabled, CI TRIGGERED; **all 5 MERGED to default** (tip `ff4007a`). **Base MOVED mid-run** (015317a → 4a952ad, a sibling "consume margin-meter from npm, drop vendored copy" commit touching `lib/observability/margin-meter.ts` — which #591's test depends on) → RE-VERIFIED the whole batch on the NEW base with a fresh `npm ci`: `margin-meter` resolves from npm, #591 passes, tsc clean, **2004 tests**, determinism + lint green. **All 5 both-Sonnet-APPROVED (11 reviews incl. 1 re-review on #593).** No migrations/secrets; no new PENDING_OPS. **No ROADMAP box ticked.**

### Lessons learned
1. **The default branch can MOVE mid-run from a sibling routine.** After building, before trusting the pre-built gate, re-verify the batch on the CURRENT origin tip with a fresh `npm ci` — ESPECIALLY when a sibling commit touched a file your new test depends on (here 4a952ad rewrote margin-meter.ts's import from `@margin/meter`→`margin-meter` npm; behaviour unchanged so #591 held, but it had to be proven, not assumed).
2. **`git add -A` after a branch switch can sweep a stray working-tree file into the wrong commit.** A stray copy of the budget test landed in the privacy commit; caught via `git show --stat` before push, stripped it. Prefer `git add <explicit paths>` and always stat the commit pre-push.
3. **supabase-js `getPublicUrl` is synchronous and never errors** — a scout "unchecked error" flag on it is a false positive; verify the SDK method's actual signature before treating a missing error-check as a bug.
4. **A determinism id-tiebreak is contract-compliant even though V8 sort is stable** — determinism.md mandates a final tiebreaker at EVERY sort site (defense against non-deterministic input order), and a mutation test using non-id input order distinguishes the fix from mere stable-sort preservation.

### Rotation guide for next run
- **DEEP AUDIT is DUE ~Run 84 (next run)** — last ran Run 80. Run one before normal scouting: 8-lens Haiku sweep + RUN the journey suite + reconcile against QUALITY_SCORECARD; record a dated 'DEEP AUDIT' summary here.
- **#1 ship blocker stays functional_reality (in-memory persistence default)** — human-gated (`cutover-to-persistent-data`); NOT headlessly buildable, no busywork.
- **design_taste B** — extend AUTHED_A11Y_ROUTES to seeded diagnosis/mockups/compare + land F7 committed screenshots; CI/auth-stack-bound (supabase-local unrunnable in sandbox). The `<main>` landmark gap on focus/saved/shared (app pages, NOT the marketing pages which already have `<main>`) is a real WCAG 1.3.1 item to fold in when that suite can run.
- **G4 remaining** = login lockout/backoff + password-reset/verification enumeration guards; still needs a server-side `/api/auth/login` route (login is client-side supabase today). Larger feature for a future run.
- **margin-meter is now an npm dep** (`margin-meter`, dropped the vendored copy in 4a952ad) — the privacy/app-privacy.md disclosures (#593) now name Margin; keep them in sync if the telemetry payload ever expands (currently tokens/latency/model/outcome-score only, no PII).
- **Still-deferred low-value:** Stripe env fail-loud guard (billing-sensitive); share-links-tier (#502, owner decision); next/image adoption (needs visual verification); search/route session-insert early-return (hot-path, defensible fail-open). Migrations 019/020/021/025/026/027/029 remain human-gated in PENDING_OPS.

---

## Run 2026-07-13 (Run 84)

### State on entry
- Default tip `4830b8a` on entry. Baseline gate GREEN after cold `npm ci`: tsc clean, **2025 tests** pass / 11 skip, determinism green, eslint clean, mobile `tsc --noEmit` clean. No open PRs.
- **DEEP AUDIT was DUE** (last ran Run 80; we are Run 84) — ran it FIRST before normal scouting.

### DEEP AUDIT (8-lens, whole-codebase, Haiku scouts) — 2026-07-13
Lenses: correctness/dead-code, security/RLS, performance, a11y/design-bar, tests/coverage, mobile+monetization, dep/config-health, artifact/doc-freshness.
- **SECURITY CLEAN** — zero critical. RLS on every tenant table, IDOR guards on all `/[id]` routes, SSRF (private-IP/metadata blocks), per-IP/paid rate limits, no hardcoded secrets, webhook signature-then-write ordering, SECURITY DEFINER hardened (028). One best-practice note (explicit `if(!user)` in saved-designs) — defense-in-depth only, RLS enforces; tied to the memory-vs-supabase question (human-gated).
- **Real findings turned into this run's work:** (1) **pricing/annual money-loss** [artifact + billing scouts converged] → #597; (2) **TAVILY not fail-loud** [dep/config scout] → #596; (3) **waitlist error no live region** [a11y scout] → #595.
- **Verified-and-rejected over-flags (mature codebase → heavy over-flagging):** correctness scout's `.single()`-without-error-field sites are guarded by null checks (`if(!room) return 404`), not bugs; `getPublicUrl` "unchecked error" is a KNOWN false positive (synchronous, never errors — re-confirmed from Run 83); mobile "22 implicit-any TS7031" + "all deps unmet" are FALSE ALARMS (mobile `tsc --noEmit` exits 0 → deps present, zero errors — the scout never ran install); bundle-scorer "untested edge cases" ALREADY covered in `__tests__/scoring/bundle-scorer.test.ts` (FLOOR clamp, spatial-default-5, undefined fallback, geometric compounding, rounding) — only impossible `totalWeight===0` remained (forbidden impossible-case test); mobile saved.tsx "Try again"/"Create Design" buttons already accessible (accessibilityRole=button + visible `<ThemedText>` child auto-derive the label — unlike #582's inputs which genuinely lacked text); most perf "unbounded nested select" flags are RISKY (narrowing `select("*")` fields could drop consumer-read fields → regression) and the sequential-await parallelizations are borderline ~100-300ms micro-opts (money-path mockups route too hot to risk); README "under 10 min" vs press-kit "~30s/room" is NOT a contradiction (full-workflow vs analysis-only, FAQ reconciles); dep-upgrade flags speculative (no concrete CVE, against the no-speculative-upgrade rule).
- **QUALITY_SCORECARD reconcile:** overall C, ship_gate_met false. The two ship-critical below-A dims UNCHANGED and both human/CI-gated: **functional_reality C** = in-memory→Supabase persistence cutover (`DATA_BACKEND` defaults to memory; PENDING_OPS `cutover-to-persistent-data`, needs migrations applied + flag flip + cold-start proof test — NOT headlessly buildable); **design_taste B** = extend AUTHED_A11Y_ROUTES to seeded diagnosis/mockups/compare + land F7 committed screenshots (supabase-local + served-app UNRUNNABLE in sandbox — CI/auth-bound). Neither headlessly buildable → no busywork. Readiness gate CANNOT pass this run (two ship-critical dims below A).

### Shipped — 3 file-disjoint value-bar changes
- **#597 (BILLING/Track C+D)** — gate `pro_annual` checkout end-to-end behind `isAnnualBillingEnabled()` (env `ANNUAL_BILLING_ENABLED`, default OFF) because migration 021 (tier CHECK-constraint extension) is unapplied → a completed annual purchase would charge the customer then fail the webhook upsert (charged, no entitlement). Checkout route refuses annual (charge chokepoint), pricing CTA hidden, `/billing/upgrade?tier=pro_annual` redirects to /pricing. Files: `lib/billing/stripe.ts`, `app/api/billing/checkout/route.ts`, `app/pricing/page.tsx`, `app/billing/upgrade/page.tsx`, `__tests__/api/billing-checkout.test.ts`, `validation/CAPABILITIES.yml`. **MERGED** (2b288ce).
- **#596 (CONFIG/Track A+F)** — `TAVILY_API_KEY` fail-loud at prod boot, exempting the CI journeys cassette-boot via `E2E_AUTH_STACK !== "1"`. Files: `lib/config/env.ts`, `__tests__/config/env.test.ts`, `.env.example`. **Auto-merge enabled, CI running.**
- **#595 (A11Y/Track E+F)** — `role="alert"` on the waitlist submit-error `<p>`. File: `app/waitlist/waitlist-form.tsx`. **MERGED** (6159824).

### Merge outcome + reviews
- #595 + #597 MERGED; #596 queued (auto-merge, pending the `journeys` gate its exemption protects). All 3 both-Sonnet-APPROVED (8 reviews incl. a re-review ROUND on #596).
- **#596 review round:** B1 REQUEST_CHANGES on the FIRST (unconditional `REQUIRED_PROD`) form — the CI `journeys` job boots via `next start` (NODE_ENV=production) with dummy GEMINI/DEEPSEEK but NO TAVILY key, so it would boot-fail that required gate. `.github/` is un-editable by the loop, so fixed IN CODE via the `E2E_AUTH_STACK` exemption (mirrors the DeepSeek conditional). Re-review APPROVED + independently found `gemini.ts assertCassetteSafe()` already fail-closes any Vercel deploy that sets the flag; a fresh 2nd re-reviewer flagged a truthy-vs-`"1"` mismatch → tightened to `!== "1"` to match the cassette guards exactly.
- **No ROADMAP box ticked** — all 3 are billing-safety/reliability/a11y hardening; no full Track item completed. **PENDING_OPS:** amended `apply-migration-021` (now also set `ANNUAL_BILLING_ENABLED=true` in the same deploy) + added `ensure-tavily-key-prod`. No migrations/secrets.

### Lessons learned
1. **A "built feature gated on a human-applied migration" is a LIVE money-loss bug if the UI still advertises it AND the server still serves it.** Annual billing was fully wired (pricing CTA + upgrade page + checkout route + webhook) but the DB constraint (021) was unapplied — a charge-without-entitlement path. Gate the WHOLE path (UI entries + the checkout charge chokepoint) behind a flag until the migration lands; hiding just the pricing link leaves `/billing/upgrade?tier=pro_annual` reachable.
2. **When a fail-loud env change would break the CI journeys production-mode boot and `.github/` is un-editable, exempt the E2E boot IN CODE** via the same `E2E_AUTH_STACK` flag the cassette guards key on — use `!== "1"` (not truthy `!process.env.X`) so it matches `assertCassetteSafe`/`cassetteActiveForTest` exactly and no stray value can silently exempt in prod. The CI `journeys` job is itself the adversarial test of the fix (goes red if wrong).
3. **DEEP-AUDIT scouts on a mature codebase over-flag hard — verify every finding against reality before building.** Run mobile `tsc` before trusting "implicit-any"/"unmet deps"; read the existing test file before trusting "untested"; check the null-guard/SDK signature before trusting "unchecked error". This run, ~70% of scout findings were rejectable over-flags; the 3 shipped came from convergent, verified findings.

### Rotation guide for next run
- **DEEP AUDIT ran Run 84 — next due ~Run 88.** Next few runs can lean on scouts/scorecard.
- **The two ship blockers stay human/CI-gated:** functional_reality (in-memory→Supabase cutover, PENDING_OPS `cutover-to-persistent-data`) and design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — supabase-local/served-app unrunnable in sandbox). Neither headlessly buildable.
- **#596 (TAVILY fail-loud) may still be merging** — confirm it landed; if the `journeys` gate went red, the E2E exemption needs a second look (unlikely — CI journeys sets `E2E_AUTH_STACK="1"`).
- **Annual billing is now safely OFF** — when the owner applies migration 021 they must ALSO set `ANNUAL_BILLING_ENABLED=true` (PENDING_OPS `apply-migration-021`). Until then, do NOT re-expose annual on the pricing/upgrade surfaces.
- **G4 remaining** = login lockout/backoff + reset/verification enumeration guards; still needs a server-side `/api/auth/login` route. Larger feature.
- **Deferred low-value (unchanged):** perf "unbounded select" narrowing (regression risk), sequential-await micro-opts (borderline), share-links-tier (#502 owner decision), next/image adoption (visual verification). Migrations 019/020/021/025/026/027/029 remain human-gated in PENDING_OPS.

---

## Run 2026-07-13 (Run 85)

### State on entry
- Default tip `60e33ad` (#603, a sibling Margin-telemetry feature commit after Run 84's #598 housekeeping + the GTM auditor's #599/#601/#602). Baseline gate GREEN after cold `npm ci`: tsc clean, **2044 tests** pass / 11 skip, determinism green, eslint clean, mobile `tsc --noEmit` clean (after `cd mobile && npm ci` — mobile deps are NOT installed by the root `npm ci`; the raw "cannot find module" errors before install are the Run-84 lesson, not real).
- No DEEP AUDIT due (ran Run 84; next ~Run 88). Ran an 8-Haiku-scout sweep + read QUALITY_SCORECARD (overall C; the two ship-critical below-A dims unchanged: functional_reality C = in-memory→Supabase cutover, design_taste B = authed-axe + F7 screenshots — both human/CI-gated) and GROWTH_STATUS (pre_launch, 0/null funnel, owner-connect blockers open). Confirmed **#600 (business-case honesty B→A) was ALREADY fixed by the sibling #601** (annual gated-off disclosed at BUSINESS_CASE.md:19-22/79-83, without-annual floor corrected to ~$99.9K at :384) — the GTM Auditor owns that grade; no maker action.

### Scout sweep (8 Haiku) + what was rejected
Lenses: security/RLS, web-reliability/correctness, tests/coverage, mobile, monetization/billing, a11y/design-bar, store/marketing-freshness, determinism/cost-contract.
- **Security CLEAN** (RLS on all 29 tenant tables, IDOR guards on every id-route, SECURITY DEFINER hardened w/ `search_path=''`, timing-safe token compares, admin-client uses all legitimate, no secret leak). **Web-reliability CLEAN** (all outbound routes export `maxDuration`; DB `.error` checked before `.data`; no uncaught throw on a critical path). **Billing CLEAN** (webhook signature-then-write, entitlement server-side + fail-closed in prod / fail-open on transient network, no trust-the-client, tier attribution correct post-#581). **Mobile CLEAN** (loading/error/empty states, abort-on-unmount, server-authoritative quota, no dead code, a11y labels present).
- **Rejected/verified over-flags:** (1) rate-limiter `cleanup()` + spend-limiter `maybeCleanup()` "untested" — **DROPPED**: eviction is pure memory-hygiene with NO observable behavior via the public API (`checkRateLimit`/`checkDailySpend` already reset expired entries inline at the read), so a mutation-provable test would require adding a test-only store-size export to PROD code = over-engineering, not value. This is the disciplined "don't pad" call. (2) a11y priority-badge rose/amber/slate "design-bar violation" — **REJECTED**: semantic traffic-light status color (high/med/low), consistent with the same file's emerald/rose keep-remove sections; the proposed terracotta-opacity collapse (15/10/5%) would make the three priorities near-indistinguishable = UX regression. (3) dashboard/saved `<main>` "missing" — **FALSE POSITIVE**: both render inside `components/layout/app-shell.tsx:21` which ALREADY provides `<main>`; a second would be a nested-landmark WCAG regression. Only pages OUTSIDE app-shell (picks — no layout; public shared — no layout) genuinely lacked `<main>`. (4) Terms "last updated July 4 vs code July 10" "stale" — **REJECTED**: the legal-doc date should track CONTENT changes, not any code commit. (5) free-tier "1 room" copy undersell — known-deferred (needs a 6-file coordinated feature-matrix rewrite; conservative undersell, low store risk). (6) determinism scout mis-scoped to `/mobile` only (no backend `.chat()` audit) — non-issue: a missing `thinkingConfig` mechanically fails the harness-ratchet test, and the baseline suite is GREEN, so none exist.

### Shipped — 4 file-disjoint value-bar changes
- **#604 (BILLING/Track C+F)** — pinned `isAnnualBillingEnabled()` (the pro_annual charge chokepoint), previously untested. Enabled ONLY on literal `"true"`; disabled when unset (ships OFF); disabled for any non-`"true"` truthy string. Kills a `Boolean()`-coercion / case-insensitive rewrite that would open the gate and charge for a tier the DB CHECK rejects. File: `__tests__/billing/stripe.test.ts`.
- **#605 (TESTS/Track F3-F4)** — covered two untested `computeAccessConstraints` branches: no-elevator stairwell 36" cap (+ negative w/ elevator), and elevator-cab diagonal depth check `longest*0.7 > elevator_depth` (+ negative). Depth values pinned tight (58/60) around the 58.8" threshold to also kill near-boundary 0.7-factor mutations. File: `__tests__/validation/access-constraints.test.ts`.
- **#606 (A11Y/Track F+design)** — `app/picks/page.tsx`: `aria-pressed` on the color-only room-filter toggles (matches #586) + `<main>` landmark (page renders under root layout, not app-shell). Layout classes moved unchanged onto `<main>`; no visual change.
- **#607 (A11Y/Track F+design)** — `app/shared/[token]/SharedDesignView.tsx` (the PUBLIC share view): added the missing `<main>` landmark (had only `<header>`); the outlier vs every other public/marketing page. No visual change.

### Merge outcome + reviews
- All 4 opened, auto-merge (squash) enabled, CI TRIGGERED; **all 4 MERGED to default** (verified `git log`: tip `2f1a6ea` carries #604-#607, merged 08:37-08:38Z). Integrated gate GREEN before splitting: tsc, **2051 tests** (2044 +7: 3 billing + 4 access), determinism, eslint, mobile tsc.
- Each change **mutation-verified** by neutering the target source branch (stairwell `if(false)`, diagonal `0.7→0.01`, `isAnnualBillingEnabled → return true`) and confirming the new test fails, then restoring source clean.
- **All 4 both-Sonnet-APPROVED (8 reviews).** Reviewers re-derived the access arithmetic (W×D×H parse order, 38+1>36 blocked, 84×0.7=58.8), re-ran the mutations independently, and confirmed the new `beforeEach(vi.unstubAllEnvs)` is block-scoped (no cross-block/cross-file env leak; Node worker/fork pools isolate `process.env`). **One non-blocking nit ACTED ON:** Reviewer A noted the diagonal test's original 50/80 depth values left a wide un-killed factor band → tightened to 58/60 before branching (a pure strengthening, reviewers had suggested it).
- **No ROADMAP box ticked** — all 4 are coverage/a11y/billing-safety hardening; no full Track item completed. **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **An in-memory cleanup/eviction fn whose correctness is ALSO handled inline by the public read path has no observable behavior difference** — it can't be mutation-tested through the public API without adding a test-only prod export. Dropping such a "test candidate" is the disciplined call; adding the export just to test memory-hygiene is over-engineering.
2. **Before flagging "missing `<main>`", check whether a shared layout (`app-shell.tsx`) already provides one.** dashboard/saved get `<main>` from the app-shell; adding a second is a nested-landmark REGRESSION. Only pages that render OUTSIDE the app-shell (picks, public `/shared/[token]`) genuinely lacked it — those are the legit fixes.
3. **Semantic/status colors are not single-accent design-bar violations.** Traffic-light priority badges (high/med/low = rose/amber/slate) and keep/remove emerald/rose are legitimate semantic color, consistent within the file; collapsing them to terracotta-opacity tiers destroys the signal. Distinguish brand-accent misuse from semantic color before "fixing" it.
4. **Mobile deps need their own `cd mobile && npm ci`** — the root `npm ci` does not install them, so a raw `mobile tsc` shows 150+ "cannot find module" errors that vanish after install (re-confirming the Run-84 lesson). Always install before trusting a mobile-gate red.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 88** (ran Run 84). Next couple runs can lean on scouts/scorecard.
- **The two ship blockers stay human/CI-gated:** functional_reality (in-memory→Supabase cutover, PENDING_OPS `cutover-to-persistent-data`) and design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — supabase-local/served-app unrunnable in sandbox). Neither headlessly buildable.
- **G4 remaining** = login lockout/backoff + reset/verification enumeration guards; still needs a server-side `/api/auth/login` route (login is client-side supabase today). A larger, coherent feature for a future run — a genuine value-bar-clearing candidate when a run has budget for a bigger unit.
- **Deferred low-value (unchanged):** rate-limiter/spend-limiter cleanup tests (unobservable — see lesson 1); priority-badge recolor (semantic, not a violation); perf "unbounded select" narrowing (regression risk); next/image adoption (visual verification); share-links-tier (#502 owner decision); free-tier "1 room" copy (needs the 6-file feature-matrix rewrite). Migrations 019/020/021/025/026/027/029 remain human-gated in PENDING_OPS; annual billing stays OFF until 021 + `ANNUAL_BILLING_ENABLED=true` land together.
## Run 2026-07-13 (Run 86)

### State on entry
- Default tip `f2e2276` (#611, a sibling FACTORY_STANDARD doc commit) on entry. Local branch ref was STALE at `2734bcf` (#557) — `git reset --hard origin/...` to the real tip first (lesson: always reset local to origin before trusting `git log`). Baseline gate GREEN after cold `npm ci` + `cd mobile && npm ci`: tsc clean, **2051 tests** pass / 11 skip, determinism green, eslint clean, mobile `tsc --noEmit` clean. No open PRs on entry.
- No DEEP AUDIT due (ran Run 84; next ~Run 88). Ran a 6-Haiku-scout sweep + consumed QUALITY_SCORECARD + GROWTH_STATUS as DATA.

### Scorecard/growth read (DATA)
- **QUALITY_SCORECARD overall C, ship_gate_met false.** THREE ship_critical dims below A, all human/CI-gated EXCEPT the security regression which WAS headlessly buildable: functional_reality C (in-memory→Supabase cutover, human-gated), design_taste B (authed-axe + F7 screenshots, CI/auth-bound), business_case_strength B (without-annual ARR ~$99.9K < $100K floor — clears only with the human-gated annual migration OR a real conversion-lift feature). security_rls had regressed A+→A this cycle on a **named, specific, headlessly-fixable finding**: a missed IDOR guard on the mockups POST route → became this run's #1 change (security always clears the bar).
- **GROWTH_STATUS pre_launch, 0/null funnel, all owner-connect blockers open** (metrics token, resend, site-gate password, social creds) — no headless growth action available; engine already 100%.

### Scout sweep (6 Haiku) + what was rejected
Lenses: web-reliability/correctness, tests/coverage, security/RLS, mobile, monetization/billing, a11y/design-bar.
- **Security CLEAN except the one known mockups IDOR** (independent scout swept all ~22 id-taking routes → all bound via userOwnsRoom/userOwnsProject/eq(user_id); RLS on all ~29 tenant tables; SECURITY DEFINER hardened; no secret leak). **Billing CLEAN** (webhook signature-then-write, server-side entitlement fail-closed-in-prod, annual gate correct) — one low-risk defense-in-depth nit (webhook tier not runtime-validated; requires a LEAKED secret to exploit and the DB CHECK already blocks the bad state) → HELD as sub-bar (padding to fix an already-guarded path).
- **Rejected/deferred over-flags:** web-reliability "45+ routes: getUser() not in try-catch" — DEFERRED (middleware pre-refreshes the session so a handler-level throw is rare; a 45-file non-disjoint sweep violates the one-coherent-unit rule; not clearly a bug). web-reliability "products/evaluate + saved-designs unchecked .error" — HELD (the codebase's established pattern is defensible fail-open reads on these paths; narrowing risks regression without clear user harm — revisit only with evidence). mobile results.tsx save-abort — HELD as borderline (a dev-only setState-after-unmount warning, harmless in prod; not worth a standalone change vs the clearer paywall guard). pairwise-reranker "order not asserted" test — NOT taken (recent #589 already added the stable-tiebreak test; risk of dup).

### Shipped — 4 file-disjoint value-bar changes
- **#612 (SECURITY/Track A+F)** — bind the standard-mode mockup POST's `bundle_id`/`product_ids` to the ownership-verified `room_id` (`app/api/mockups/route.ts`). Before: an owner of room A (passes userOwnsRoom) could pass another user's `bundle_id`/`product_ids` (room B) and have that catalog data fetched, rendered into a mockup, and persisted in `selected_products` — a cross-tenant read leak + paid render on data they don't own (memory-store query is not user-scoped, so the app-layer bind is the only boundary). Fix mirrors `app/api/bundles/route.ts:74-95`: verify the bundle belongs to room_id, and 404 (no enumeration oracle) if any product_id isn't a product of the room — before any render. + `__tests__/api/mockups-product-binding.test.ts` (4 cases: 2 attack→404+no-render, 2 owned→passes-bind).
- **#613 (A11Y/Track F+design)** — add the missing `<main>` landmark to `app/(auth)/login/page.tsx` + `signup/page.tsx` (WCAG 2.1 A / 1.3.1). Both render outside the app-shell (the (auth) layout is a passthrough; root layout provides no `<main>`), so they were the outliers vs every marketing page. Tag-only swap of the outer `<div className="min-h-screen flex">` → `<main …>`; classes unchanged → no visual change.
- **#614 (MOBILE/Track C reliability)** — guard `Purchases.getOfferings()` in `mobile/src/components/paywall-sheet.tsx` against setState-after-unmount with a `cancelled` flag set in the effect cleanup (mirrors `useSavedDesigns`). A late resolve/reject after the sheet is dismissed no longer updates `options`/`selectedIndex`/`offeringLoaded` on a gone component — hygiene on the revenue-critical paywall surface.
- **#615 (TEST/Track F, deterministic layer)** — strengthen the escalation-ladder "all tiers fail" test (`__tests__/agents/escalation-ladder.test.ts`) to assert `chosen`/`tierReached` (tier-0 precedence via the `!best ||` guard) + a new first-non-null-candidate case. Previously only accepted/attempts were checked, so an "overwrite best every iteration" mutation would return the LAST tier's output undetected. Mutation-verified.

### Merge outcome + reviews
- Integrated gate GREEN before splitting (throwaway integration branch of all 4): tsc clean, **2056 tests** pass (2051 +5: 4 mockups + 1 net escalation), determinism green, mobile tsc clean. All 4 merge cleanly against each other (file-disjoint).
- **All 4 both-Sonnet-APPROVED (8 reviews).** Reviewers independently verified: the IDOR fix closes both bundle_id + product_ids paths with no bypass (dup ids deduped by PK+Set, empty→existing 400, uniform 404 non-oracle) and confirmed `product_bundle_items` are only ever written already-room-bound (so verifying the bundle's room is sufficient); the auth `<main>` is genuinely absent (layout passthrough + root has none) with exactly one per page; the paywall `cancelled` flag is closure-captured + checked before every setState with no over-guard; the escalation assertions are correct traces + real mutation killers.
- **Non-blocking nit ACTED ON:** escalation Reviewer A noted the inline comment's mutation description was imprecise ("dropping `!best ||`" literally throws; the 2/tier-1 result comes from an unconditional overwrite) → tweaked the comment to "replacing `if (!best || accepted)` with an unconditional assign", amended + force-pushed #615.
- **No ROADMAP box ticked** — all 4 are security/a11y/mobile-reliability/coverage hardening; no full Track item completed. functional_reality + design_taste + business_case_strength remain the ship blockers (all human/CI-gated or requiring a bigger feature). **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **The local working-branch ref can be badly stale on cold start** (was 54 commits behind origin here). Always `git fetch` + `git reset --hard origin/<branch>` (or verify `git log` matches the detached-HEAD tip you were handed) BEFORE reading test counts / scouting, or you scout an old tree.
2. **A scorecard grade regression can name a SPECIFIC, headlessly-buildable fix** — security_rls A+→A pointed at the exact mockups IDOR with the exact remediation (mirror bundles:74-95). Consuming the scorecard as DATA turned one dimension's drop directly into the run's highest-value change. (The other two below-A dims stayed human/CI-gated — no busywork.)
3. **A cross-tenant IDOR can hide behind a PASSING ownership check** — userOwnsRoom(room_id) was present and correct, but the SECONDARY client-supplied ids (bundle_id/product_ids) were never bound to that room. Owning the parent resource is not owning the referenced children; bind every client-supplied id to the tenant boundary, matching the sibling route that already does.
4. **Don't pad with already-guarded defense-in-depth or non-disjoint sweeps** — the billing webhook-tier-validation nit (needs a leaked secret; DB CHECK already blocks it) and the 45-route getUser try-catch sweep (middleware pre-handles; non-disjoint) were both correctly HELD. A quiet 4-change run beats a padded 6.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 88** (ran Run 84). Next run can lean on scouts/scorecard.
- **Ship blockers unchanged & not headlessly buildable:** functional_reality (in-memory→Supabase cutover, PENDING_OPS `cutover-to-persistent-data`), design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — supabase-local/served-app unrunnable in sandbox), business_case_strength (without-annual ARR ~$99.9K < $100K floor — clears via the human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a REAL conversion-lift feature that honestly justifies >4% paywall/trial conversion; the latter is a genuine value-bar-clearing BUILD candidate for a run with budget for a bigger unit — paywall/onboarding/time-to-wow).
- **G4 remaining** = login lockout/backoff + reset/verification enumeration guards; still needs a server-side `/api/auth/login` route. Larger feature.
- **Named follow-ups (deferred, low priority):** mockups route lacks type/length validation on product_ids/bundle_id like bundles route has (pre-existing, not a security hole now the bind is in — a robustness nicety); billing webhook tier not runtime-validated (needs leaked secret; DB CHECK blocks). Migrations 019/020/021/025/026/027/029 remain human-gated in PENDING_OPS; annual billing stays OFF until 021 + `ANNUAL_BILLING_ENABLED=true` land together.

## Run 2026-07-14 (Run 87)

### State on entry
- Default tip `66f36a0` (#617). Reset local to origin tip first (Run 86 lesson). Baseline gate GREEN after cold `npm ci` + `cd mobile && npm ci`: tsc clean, **2056 tests** pass / 11 skip, determinism green, eslint clean, mobile `tsc --noEmit` clean. No open PRs on entry.
- No DEEP AUDIT due (ran Run 84; next ~Run 88). Ran a 6-Haiku-scout sweep + consumed QUALITY_SCORECARD + GROWTH_STATUS as DATA.

### Scorecard/growth read (DATA)
- **QUALITY_SCORECARD overall C, ship_gate_met false.** Three ship_critical below A, all human/CI-gated & NOT headlessly buildable this run: functional_reality C (in-memory→Supabase cutover), design_taste B (authed-axe + F7 screenshots — sandbox-unrunnable), business_case_strength B (without-annual ARR ~$99.9K < $100K floor). #610 (mockups IDOR, the security_rls A+→A finding) was ALREADY closed by Run 86 #612 — confirmed, no action (scorecard will re-grade; the auditor owns the grade).
- **GROWTH pre_launch, 0/null funnel, all owner-connect blockers open** — no headless growth action.
- **Two fresh §44 live-prod issues on entry:** #618 (root→/login; mobile drops the value-prop panel) → became change #1; #619 (deterministic prod-smoke infra, a larger Layer-A build) → deferred.

### Scout sweep (6 Haiku) + what was rejected
Lenses: security/RLS, web-reliability/correctness, tests/coverage, perf, mobile, a11y/design-conversion.
- **Security CLEAN** (fresh 52-route-class sweep: RLS on ~29 tenant tables, all id-routes bound via userOwnsRoom/userOwnsProject, SECURITY DEFINER hardened w/ empty search_path, timing-safe token compares, no secret leak). **A11y/design CLEAN** except #618.
- **perf #385 (pgvector RPC for topKSimilar full-table scan) — DEFERRED.** The RPC path is INERT until the human-gated Supabase cutover: the memory store is the DEFAULT data layer (functional_reality C) and MemoryClient.rpc is a no-op, so the RPC would fall back to the current full scan and deliver ZERO current benefit — while adding a human-gated migration + determinism risk on a scoring path. Revisit AFTER the persistence cutover.
- **mobile setState-after-unmount ×6 (results/use-entitlements/use-free-quota/login/signup/settings) — HELD.** Dev-only warnings, harmless in prod; per the established taste (#614 was the single clearest one), batching five more of the identical `cancelled`-flag pattern is padding, not value.
- **web-reliability** surfaced exactly one real bug (the diagnosis-sort determinism gap) → taken as change #3; the scout's proposed fix was itself non-deterministic (`return 0`), corrected to a real id tiebreak.

### Shipped — 3 file-disjoint value-bar changes
- **#620 (CONVERSION/Track A)** — mobile-only (`lg:hidden`) condensed value prop above the card on `app/(auth)/login/page.tsx` + `signup/page.tsx`. The desktop aspirational panel is `hidden lg:flex`, so a mobile logged-out visitor (root redirects to /login) saw only the bare form (issue #618). `<h1>` headline (also the pages' first real heading on mobile — CardTitle is a `<div>` — a WCAG/SEO win) + one supporting line, warm-editorial tokens (`text-gradient-warm`, muted), no invented metrics/testimonials; desktop two-panel unchanged.
- **#621 (TEST/Track F)** — 7 boundary cases in `__tests__/validation/pairwise-proportions.test.ts` covering three ZERO-coverage relational rules: dining_table.length ≥ 24×chairs (`perSideCount = max(1, ceil((chairs-2)/2))`), nightstand.height within ±4" of bed top (bed.height−3), side_table.height within ±3" of sofa arm (sofa.height−10). Uses explicit `dimensions` objects (the `W x D x H` specs regex only yields width). Mutation-verified: `>=`→`>`, `<=4`→`<4`, `<=3`→`<3`, `max(1,…)`→`max(0,…)` each fail the matching test.
- **#622 (DETERMINISM)** — `app/api/diagnosis/route.ts` picked a sibling room's latest diagnosis via a `created_at`-only sort with no tiebreaker (non-reproducible on equal timestamps; feeds the seeded LLM cross-room-coherence prompt — a determinism-contract violation). Extracted a pure, unit-tested `pickLatestDiagnosis()` (created_at DESC, id DESC) into `lib/diagnosis/latest-diagnosis.ts`; selected `id` in the sibling query. Mutation-verified (drop tiebreak → permutation test fails); `check:determinism` green.

### Merge outcome + reviews
- Integrated gate GREEN before splitting (throwaway octopus merge of all 3, file-disjoint — 6 files): tsc, **2069 tests** (2056 +13: 7 pairwise + 6 latest-diagnosis), determinism, eslint, mobile unaffected. All 3 opened, auto-merge (squash) enabled, CI TRIGGERED; **all 3 MERGED to default** (verified `git log`: tip `5eeefd8` carries #620/#621/#622, merged ~00:38-00:45Z).
- **All 3 both-Sonnet-APPROVED (6 reviews).** Reviewers independently re-derived the pairwise arithmetic + re-ran the 4 mutations; confirmed the `lg:hidden`/`hidden lg:flex` complement (no double-render, single-h1 per breakpoint, on-brand tokens, no invented claims); and verified the tiebreak helper is correct + non-mutating, preserves non-tie behavior, and the permutation test genuinely asserts order-independence.
- **No ROADMAP box ticked** — all 3 are conversion/coverage/determinism hardening; no full Track item completed. **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **A "clear perf win" can be INERT under the current architecture.** #385's pgvector RPC only helps AFTER the human-gated Supabase cutover — the memory store is the default data layer and `.rpc` is a no-op there, so shipping it now is zero-benefit complexity + determinism risk on a scoring path. Defer perf that only materializes post-cutover; don't be seduced by a high scout rating that ignores the runtime data layer.
2. **A `W x D x H` specs regex with letter suffixes silently yields ONLY width** — the `W`/`D`/`H` letters break the `x`-separator match, so `DIMENSION_REGEX` falls into the single-dim "square" branch. Three furniture-fit rules (nightstand/side_table height, dining depth) therefore likely NO-OP in production, where items carry only `specs` (no `dimensions`). Unit tests using the `dimensions` object still correctly guard the rule contract, but the integration path is a separate REAL bug (a reviewer re-deriving the parse found it). See follow-up (a).
3. **Dev-only setState-after-unmount warnings are borderline.** One clear guard on a revenue surface (#614) clears the bar; batching five more of the identical pattern is padding. A quiet 3-change run beats a padded 8.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 88** (ran Run 84). This run is Run 87 — the audit is DUE next run; run the 8-lens holistic sweep before normal scouting.
- **Two review-flagged, file-disjoint, value-bar-clearing follow-ups (build candidates):**
  - **(a) pairwise rules inert in prod:** `WhatItNeedsItem` (`lib/types/database.ts:494`) has only `specs` (no `dimensions`), and `DIMENSION_REGEX` (`lib/validation/spatial-math.ts:29`) can't parse `90"W x 38"D x 32"H` into 3 dims. Fix the regex to handle letter-suffixed W/D/H (or populate `dimensions` upstream) so nightstand/side_table/dining-depth rules actually fire. The #621 unit tests already guard the rule contract; this makes them reachable in prod.
  - **(b) remaining created_at-only sorts:** reuse the new `pickLatestDiagnosis()` at `lib/agents/diagnosis-expansion-pipeline.ts:118` and `lib/design-context/infer-preferences.ts:178-179,250-251` (the latter feeds an LLM call) — same determinism-contract class as #622, one disjoint fix per change.
- **Ship blockers unchanged & not headlessly buildable:** functional_reality (in-memory→Supabase cutover, PENDING_OPS `cutover-to-persistent-data`), design_taste (authed-axe + F7 committed screenshots — sandbox-unrunnable), business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift feature).
- **G4 remaining** = login lockout/backoff + reset/verification enumeration guards; needs a server-side `/api/auth/login` route. Larger feature. **§34 pre-launch demo (#475) + §11 media-gen adapter (#470)** remain open Track E/F build epics. **Deferred (unchanged):** perf #385 pgvector RPC (post-cutover only); mobile setState hygiene (dev-only); migrations 019/020/021/025/026/027/029 human-gated.

---

## Run 2026-07-14 (Run 88)

### State on entry
- Default tip `b3331f1` (#626). Reset local branch to origin default tip first. Baseline gate GREEN after cold `npm ci` + `cd mobile && npm ci`: tsc clean, **2069 tests** pass / 11 skip, determinism green, eslint clean, mobile `tsc --noEmit` clean. No open PRs.
- **DEEP AUDIT was DUE** (last ran Run 84; this is Run 88) — ran it FIRST before normal scouting.

### DEEP AUDIT (8-lens, whole-codebase, Haiku scouts) — 2026-07-14
Lenses: correctness/dead-code, security/RLS, performance, a11y/design-bar, tests/coverage, mobile+monetization, dep/config-health, artifact/doc-freshness.
- **SECURITY CLEAN** — zero critical. Independent 52-route-class sweep: RLS on ~29 tenant tables, all `/[id]` routes bound via userOwnsRoom/userOwnsProject, SECURITY DEFINER hardened (empty search_path), SSRF private-IP/metadata blocks, timing-safe internal-token compares, webhook signature-then-write ordering, no hardcoded secrets. Two low-sev notes were **FALSE**: places/photo is ALREADY auth-gated + per-user rate-limited (RATE_LIMITS.placesPhoto) + daily-spend-limited; saved-designs "implicit auth" is a code-clarity note, RLS enforces.
- **Real findings turned into this run's work:** correctness scout re-confirmed the two pre-flagged `created_at`-only determinism sorts (→ changes 2,3); a11y scout flagged the not-found landmark (→ change 4); artifact scout flagged the stale pre-submission-checklist migrations + the email "mockups coming soon" claim (→ changes 6,7); perf scout flagged the diagnosis sequential awaits (→ change 5). The DIMENSION_REGEX prod no-op (Run 87 follow-up (a)) → change 1.
- **FALSE POSITIVES caught by verifying against the live tree (NOT shipped):**
  1. dep/config "mobile TypeScript 6.0.3 doesn't exist → mobile CI fails" — mobile `npm ci` AND `tsc --noEmit` both ran clean; TS 6.x is real as of 2026. Haiku reasoned from a stale cutoff.
  2. correctness "products/ingest `.single()` null deref" — the code already uses `room?.project_id` / `room?.room_images` optional chaining, and `userOwnsRoom` above guarantees the row exists.
  3. correctness "product-extractor unguarded JSON.parse (405/410) crashes the pipeline" — the caller (line 652) wraps it in try/catch → the item just resolves `success:false`; graceful, not a crash.
  4. a11y "account/page missing `<main>`" — `/account` renders inside `AppShell`, which ALREADY provides `<main>` (components/layout/app-shell.tsx:21); adding another would be a nested double-main (worse). Reverted before commit.
- **Scorecard/growth (DATA):** overall C, ship_gate_met false; three ship_critical below A unchanged & human/CI-gated (functional_reality C = in-memory→Supabase cutover; design_taste B = authed-axe + F7 screenshots; business_case_strength B = without-annual ARR ~$99.9K < $100K floor). GROWTH pre_launch, 0/null funnel, owner-connect blockers open — no headless growth action.

### Shipped — 7 file-disjoint value-bar changes (all both-Sonnet-APPROVED)
- **(1) VALIDATION/Track F** — `lib/validation/spatial-math.ts` + test: labeled-parse path so `parseDimensions` reads the letter-suffixed retail form (`90"W x 38"D x 32"H`) the pipeline emits (via `formatIdentifiedProductForPrompt` / whatitneeds-enricher). Before, the positional regex stopped at `90"` → mislabeled a 90×90 square → three pairwise furniture-fit rules (nightstand/side_table height, dining depth) silently NO-OP'd in prod. Maps values→axes by W/D/H label, trusts the parse only when both footprint axes present (else positional fallback). +8 tests.
- **(2) DETERMINISM** — `lib/agents/diagnosis-expansion-pipeline.ts`: sibling-room latest-diagnosis `created_at`-only sort → `pickLatestDiagnosis()` + `id` added to nested select. Feeds the seeded cross-room coherence prompt.
- **(3) DETERMINISM** — `lib/design-context/infer-preferences.ts`: two `created_at`-only sorts → `pickLatestDiagnosis()` + `id` in select. Feeds the seeded preference-summary prompt.
- **(4) A11Y/Track F** — `app/not-found.tsx`: `<div>`→`<main>` (root 404, no AppShell, previously no landmark). Verified no parent `<main>` in the root layout chain.
- **(5) PERF/Track A** — `app/api/diagnosis/route.ts`: parallelize two independent best-effort reads (sibling summaries + budget context) via `Promise.all` on the diagnosis hot path; matches the streaming pipeline's existing pattern; results keyed to named vars → determinism preserved.
- **(6) DOC/Track D** — `docs/pre-submission-checklist.md`: stale pending-migration refs (017/018 → dir now through 029). Points to supabase/migrations as source-of-truth + PENDING_OPS for apply notes.
- **(7) DOC/Track E** — `docs/email-lifecycle.md`: "AI mockups (in progress — coming this quarter)" → present tense (mockups shipped + advertised live in store-listing).

### Reviews + merge
- **16 reviews (7×2 + 2 re-review cycles).** Two REQUEST_CHANGES caught real issues:
  - **Change 1** Reviewer A found a bug the first tests missed: the initial `(?![A-Za-z])` axis guard ALSO rejected the `x`/`X` separator, so the compact no-space form `90"Wx38"D` silently dropped axes (the exact bug the parser fixes). Fixed to a positive-boundary lookahead `(?=$|[\s,xX×])` + 2 regression tests (compact form ×3, label-before-value fallback); re-reviewed → APPROVE.
  - **Change 6** Reviewer A: calling PENDING_OPS "authoritative" overstated it (migration 028 had no entry). Softened to name supabase/migrations as source-of-truth; re-reviewed → APPROVE. ALSO added the missing `apply-migration-028` (signup-nonblocking) entry to PENDING_OPS this run.
- Integrated gate GREEN (tsc, **2077 tests** = 2069 +8 spatial, determinism, eslint, mobile tsc). All 7 committed to the run branch; ONE PR to default (single-branch per this run's git constraint). **No ROADMAP box ticked** — all 7 are hardening; no full Track item completed. **PENDING_OPS:** +apply-migration-028. No secrets, no code migrations.

### Lessons learned
1. **Verify EVERY scout claim against the live tree.** 4 of the DEEP AUDIT's flagged items were false positives — a "missing rate limit" already triple-limited, a "null deref" already `?.`-guarded, an "unguarded throw" already caught by the caller, a "missing landmark" already supplied by a parent shell. Haiku scouts reason from stale/partial knowledge; a 30-second grep/Read per candidate prevents a bad change (and a nested double-main regression).
2. **A regex guard that excludes "any letter" also excludes an alphabetic delimiter.** The `x` separator is a letter, so a blanket `(?![A-Za-z])` reintroduced the very bug being fixed on the compact form. When a delimiter is alphabetic, use a positive-boundary lookahead that lists the real separators/terminators. A reviewer re-deriving the regex on adversarial inputs caught it; the original 6 tests didn't.
3. **Two disjoint files with the identical determinism-sort pattern are two coherent changes, not padding** — each removes an independent contract violation on a seeded-LLM path (both reviewers agreed on both).
4. **The Run-87 follow-ups were both real and both shipped** — the pairwise-rules-inert-in-prod regex fix (a) and the remaining created_at sorts (b). Recording specific file:line follow-ups in the rotation guide pays off next run.

### Rotation guide for next run
- **DEEP AUDIT ran Run 88 — next due ~Run 92.** Next few runs can lean on scouts/scorecard.
- **Ship blockers unchanged & not headlessly buildable:** functional_reality (in-memory→Supabase cutover, PENDING_OPS `cutover-to-persistent-data`), design_taste (authed-axe + F7 committed screenshots — sandbox-unrunnable), business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift feature).
- **Pre-existing, untouched bug flagged during change-1 re-review (candidate):** the ORIGINAL positional `DIMENSION_REGEX` mishandles a foot-mark form like `6' x 4'` — the apostrophe isn't in its separator class, so it reads `6'` as a single dim → 72×72 square instead of 72×48. Unrelated to the labeled path; a disjoint one-line fix + test for a future run.
- **Larger open epics (unchanged):** G4 login lockout/backoff + reset/verification enumeration guards (needs a server-side `/api/auth/login` route); §34 pre-launch demo (#475); §11 media-gen adapter (#470); perf #385 pgvector RPC (post-cutover only); mobile setState hygiene (dev-only). Migrations 021/022-023/024/025/026/027/028/029 + DATA_BACKEND cutover remain human-gated in PENDING_OPS.

---

## Run 2026-07-15 (Run 89)

### State on entry
- Default tip `12009a7` (#631); working branch `claude/sleepy-goldberg-zkpp8p` already AT the default tip (0 ahead/0 behind) — no rebase needed. Baseline gate GREEN after cold `npm ci` + `cd mobile && npm ci`: tsc clean, **2077 tests** pass / 11 skip, determinism green, eslint clean, mobile `tsc --noEmit` clean. No open PRs.
- **DEEP AUDIT NOT due** (ran Run 88; next ~Run 92) — ran a normal 7-Haiku-scout sweep, no full audit.

### Scout sweep (7 Haiku) + verification
Lenses: honesty/marketing-claims, web-reliability/correctness, tests/coverage, mobile, perf+determinism, store-readiness/a11y, G4-auth-feasibility.
- **Honesty scout → the run's #1 finding:** a FABRICATED testimonial on `app/(auth)/login/page.tsx` ("Sarah M., Brooklyn NY" + invented quote). Signup + landing pages already explicitly avoid fabrication (verified) — login was the lone violator. Became change **C1**.
- **Store-readiness scout → a real store blocker:** `mobile/app.json` had NO iOS privacy manifest (ITMS-91053 rejection vector). Became **C6**. (The scout's suggested JSON shape was partly wrong — `NSPrivacyAttributeUsageDescription` isn't a real key — so I researched the exact Expo `ios.privacyManifests` schema + Apple reason codes myself.)
- **Perf/determinism scout → C3:** `topFrequent()` count-only sort feeding a seeded LLM prompt from an UNORDERED Supabase select. (Also flagged a search-route parallelization = C5, deferred; and a scene-reconciliation tiebreaker = FALSE POSITIVE.)
- **Mobile scout → C7 + C8:** silent empty-field auth submit (real UX no-op); empty Palette/Materials card shells on the results screen. (Also flagged a11y-labels on photo/results buttons = FALSE POSITIVE.)
- **My own confirmed candidate → C2:** the Run-88 rotation-guide follow-up — the positional `DIMENSION_REGEX` mishandles inline-unit forms (`6' x 4'`, `72" x 36"`) → mis-scores rugs (`6' x 9'`) as squares.

### FALSE POSITIVES caught by reading the live tree (NOT shipped)
1. **scene-reconciliation.ts:257 "broken tiebreaker" `(a[0]<b[0]?-1:1)`** — the preceding `seen` Map dedups to UNIQUE keys, so `a[0]===b[0]` is unreachable; the `:1`-on-equal branch is dead → changing it is behavior-neutral churn.
2. **mobile a11y-labels on ~9 photo/results Pressables** — every one has a visible `<ThemedText>` child, which RN announces as the accessible name; adding an identical `accessibilityLabel` is redundant → churn.

### DEFERRED (real value, but not safely shippable headlessly this run)
- **G4 login lockout/backoff** — feasible (scout mapped the server-route pattern), BUT it requires converting the critical CLIENT-SIDE login (`supabase.auth.signInWithPassword` in the browser) to a server `/api/auth/login` route + cookie handling. Cannot e2e-verify the auth flow headlessly (journey suite needs Supabase creds), and a subtly-broken login auto-merged = catastrophic. Defer to a run that can add/execute a login-flow test. Password-reset/verification enumeration guards remain N/A (no email pipeline pre-launch; verification intentionally OFF).
- **C5 search-route parallelization** (`app/api/search/route.ts`) — real ~300ms win (3 independent serialized fetches: userFeedbackContext, otherRooms, recRuns; otherDiagnoses correctly depends on otherRooms). BUT there is NO route-level test covering the handler orchestration and search can't be runtime-verified headlessly → a subtle regression would land uncaught under auto-merge. Defer to a run that adds a route-orchestration test first.
- **callback maxDuration** (reliability scout) — modest hardening (every other external call has a timeout; `exchangeCodeForSession` doesn't); cut to keep the run tight (try/catch already prevents a 500).

### Shipped — 6 file-disjoint value-bar changes (all both-Sonnet-APPROVED, 12 reviews, zero re-review cycles)
- **C1 (HONESTY/Track A)** `app/(auth)/login/page.tsx` — removed the fabricated testimonial; replaced with 3 verifiable capability highlights (icon+label, `aria-hidden` icons) reusing claims already live on signup/landing/privacy. No new invented claim (reviewers confirmed verbatim reuse).
- **C2 (VALIDATION/Track F)** `lib/validation/spatial-math.ts` +5 tests — rebuilt `DIMENSION_REGEX` (now non-global, single call site) to capture a per-token optional unit for up to 3 axes + a single-trailing-unit fallback, so `6' x 4'`/`72" x 36"`/`6' x 9'` parse as distinct W×D instead of a square. Reviewer A reverted the code and empirically confirmed 3/4 new tests fail pre-fix.
- **C3 (DETERMINISM/Track F)** `lib/design-context/infer-preferences.ts` +1 test — added `|| a.original.toLowerCase().localeCompare(...)` tiebreaker to `topFrequent()` (same idiom as `scripts/check-determinism.ts`). Mutation-verified (10 single-count colours, non-alpha input → alpha top-8). Reviewer nit on the comment ("normalized key" → actually the lowercased surface form) fixed + autosquashed.
- **C6 (STORE/Track D)** `mobile/app.json` — added `ios.privacyManifests` (NSPrivacyTracking:false + UserDefaults CA92.1 / FileTimestamp C617.1 / SystemBootTime 35F9.1 / DiskSpace E174.1). Reviewers verified each reason code against BOTH Apple's table AND the actual `PrivacyInfo.xcprivacy` files in node_modules (RN core, async-storage, expo-device, expo-file-system), and that `app.config.ts`'s `...config` spread preserves it.
- **C7 (MOBILE-UX/Track B)** `mobile/src/components/auth/login-screen.tsx` + `signup-screen.tsx` — empty-field submit now `setError(...)` instead of a silent `return` (button was only disabled while loading). Reuses the existing alert box.
- **C8 (MOBILE-DESIGN/Track B)** `mobile/src/app/results.tsx` — guarded the always-rendered Palette + Materials cards behind `.length>0`, matching the file's What-Works/What-Should-Go pattern (no more empty titled shells).

### Merge outcome + gate
- Integrated gate GREEN: tsc, **2082 tests** (2077 +5), determinism, eslint (web touched files + mobile touched files), mobile `tsc --noEmit`. Six clean commits on the working branch; **single-branch per this run's git constraint → ONE PR to default**. **No ROADMAP box ticked** — all 6 are honesty/correctness/determinism/store/UX hardening; no full Track item completed.
- **PENDING_OPS:** added the App Store Connect privacy "nutrition label" owner note (the manifest is code; the ASC data-collection questionnaire is a human submission step). **No code migrations, no secrets.**

### Lessons learned
1. **Verify EVERY scout claim against the live tree — again.** 2 of this run's candidates were false positives: an "unstable tiebreaker" on a Map that guarantees unique keys (dead branch), and "missing a11y labels" on Pressables that already carry text children RN announces. A 30-second read per candidate prevented two churn changes.
2. **Under unattended auto-merge, "unverifiable headlessly" downgrades a real win to a deferral.** Both G4 (server-login conversion) and C5 (search parallelization) are genuinely valuable, but neither can be runtime-verified this run and neither has a route-level test — a subtle regression would land uncaught. Ship the safe wins; defer the ones that need a test harness first, and NAME the missing harness.
3. **A fabricated testimonial is shippable value, not cosmetics.** It's an FTC-endorsement / App-Store-rejection risk and violates the project's own honesty rule; removing it clears the value bar. The honest replacement must reuse only claims already sourced elsewhere in the app (no NEW marketing claim), or the fix defeats itself.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 92** (ran Run 88). Next couple of runs can lean on scouts + scorecard.
- **Top named build candidates (file-disjoint, value-bar-clearing) for a run that can add a test/verify harness:**
  - **G4 login lockout** — build `/api/auth/login` (mirror `app/api/auth/signup/route.ts`: per-IP rate limit + Turnstile + enumeration-safe neutral error + SSR cookie via `createServerClient`), switch `app/(auth)/login/page.tsx` to POST it, and add a route unit test. Ticks the "login lockout/backoff" half of G4. Needs care: it touches the #1 auth path — verify the session cookie establishes exactly as the client flow does.
  - **C5 search-route parallelization** — `app/api/search/route.ts`: wrap the otherRooms→otherDiagnoses→otherRoomsContext and recRuns→recommendationMockups blocks in helper closures and `Promise.all` them with `userFeedbackContext`; ADD a route-orchestration test first (there is none today).
  - **C2 follow-up (tiny):** singular `"inch"` (no `es`) is still absent from `UNIT_ALT` in spatial-math, so `"6inch x 4inch"` mis-parses as a square — PRE-EXISTING, a disjoint one-line + test.
- **Ship blockers unchanged & not headlessly buildable:** functional_reality (in-memory→Supabase cutover, PENDING_OPS `cutover-to-persistent-data`), design_taste (authed-axe + F7 committed screenshots — sandbox-unrunnable), business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift feature).
- **Larger open epics (unchanged):** §34 pre-launch demo (#475); §11 media-gen adapter (#470); perf #385 pgvector RPC (post-cutover only). Migrations 021/022-023/024/025/026/027/028/029 + DATA_BACKEND cutover remain human-gated in PENDING_OPS.

## Run 2026-07-15 (Run 90) — determinism-jitter gate + win-back E2/E3 cron (Track E7) + 2 validator-coverage + core-flow silent-failure fix. ALL 5 MERGED.

### State on entry
- Cold container. Reset to origin default tip `05dea24` (post Run 89 #632 + Growth Run 10 #631). `npm install` root + `cd mobile && npm install` (mobile node_modules ABSENT — installed first, else mobile `tsc` false-fails on root DOM lib types). Baseline gate GREEN: tsc clean, **2082 tests** pass / 11 skip, determinism clean, eslint 0, mobile tsc clean.
- **DEEP AUDIT NOT due** — ran Run 88 (2026-07-14); next ~Run 92. Ran a normal 7-Haiku-scout sweep.
- **QUALITY_SCORECARD (as_of 2026-07-13, overall C, ship_gate false):** three ship_critical below A, all unchanged & human/CI-gated — functional_reality C (DATA_BACKEND defaults to memory → no persistence; owner-gated cutover), design_taste B (authed-axe + F7 screenshots, sandbox-unrunnable), business_case_strength B (without-annual ARR ~$99.9K < $100K floor; needs migration 021 + ANNUAL_BILLING_ENABLED, OR a real conversion-lift feature). The scorecard's `security_rls A+→A` mockups-IDOR finding was **STALE** — already fixed Run 86 #612 (verified live). GROWTH pre_launch 0/null → no lever signal.

### Scouting — 7 Haiku lenses
- **security/RLS+rate-limit:** CLEAN (no-op) — RLS on all tenant tables, id-routes bound, G1 rate-limits present, G4 auth-enumeration guarded, no secret leak.
- **AI-pipeline/cost/determinism:** found the one real bug — `lib/ai/gemini.ts:660` ungated `Math.random()` retry jitter (→ #633). All `.chat()` have thinkingConfig+seed; maxDuration present; timeouts present.
- **web-reliability/side-effects:** focus/page.tsx silent vision + search failures (→ #637). (The scout's 5 sub-findings collapsed to ONE file.)
- **test/eval coverage:** code-compliance egress+kitchen-outlet (→ #636), outlet-reach hardwired/soft-anchor/vague (→ #635).
- **growth-E7:** win-back E2/E3 cron cleanly disjoint (builders already exist) (→ #634). Habit/upgrade sends + analytics pulls remain (touch signup/analysis call sites — deferred).
- **mobile:** "TS strict error in settings.tsx" was a FALSE POSITIVE (baseline mobile tsc clean); other findings defensive-only → skipped mobile (no padding).
- **a11y/store:** next/image sweep (risky) + iOS-privacy CollectedDataTypes (needs Apple-enum research; empty array is valid) → deferred; landmarks/labels clean.

### Shipped 5 (all file-disjoint; per-change branch → gate → 2 Sonnet reviewers → auto-merge squash)
- **#633 (DETERMINISM/Track F)** — extracted pure `computeRetryDelay()` (`lib/ai/retry-delay.ts`) gating the Gemini 429-jitter under DETERMINISTIC (mirrors `lib/ai/retry.ts`); +6 mutation-provable tests (RNG never called in deterministic mode). No floor/cost change.
- **#634 (GROWTH/Track E7)** — new `app/api/cron/winback-emails/route.ts` + `vercel.json`, win-back E2 (day7)/E3 (day30) for `stripe_customers status='cancelled'` (updated_at proxy), mirroring the activation cron (CRON_SECRET auth, dry-run, idempotency, opt-out); reuses `buildWinBackEmail2/3`. Ships INERT. +7 tests.
- **#635 (TEST/Track F2)** — outlet-reach 3 branches (hardwired chandelier skip, soft-anchor `aSoft||bSoft`, vague-placement benefit-of-doubt). Mutation-provable.
- **#636 (TEST/Track F2)** — code-compliance IRC R310.2.1 egress (all 3 `&&` terms load-bearing incl. width-fail added in re-review) + NEC 210.52(C) kitchen-outlet (48" divisor, `>=`). +9.
- **#637 (RELIABILITY/Track A+F4)** — focus/page.tsx: vision-gen failure now toasts; batch-search failure now shows searchError+Retry (always reaches results step where the banner renders) instead of a blank page. SIDE-EFFECT INTEGRITY.

### Outcome / bookkeeping
- **ALL 5 MERGED** (#633→f06165f, #634→fd8ba44, #635→1166dc4, #636→44193c1, #637→23132af; required checks green; final tip 23132af). Baseline 2082 → **2105** (+23). Merged-result gate re-run GREEN (tsc, 2105 tests, determinism).
- **No ROADMAP box ticked** — all 5 are determinism/retention/coverage/reliability hardening. E7 advanced (win-back E2/E3) but stays [ ] (activation-habit/upgrade sends + visitor/conversion analytics pulls + per-channel social live clients remain). Updated the E7 inline progress note. No migrations, no secrets, no new PENDING_OPS (winback reuses activation's env).

### Lessons
1. **The QUALITY_SCORECARD is DATA and can be STALE.** Its `security_rls A+→A` mockups-IDOR finding (as_of 2026-07-13) was already closed by Run 86 #612 — the code binds `bundle_id`/`product_ids` to `room_id`. Verify every named gap against the live tree BEFORE building, or you burn a change re-fixing a solved problem.
2. **maker≠checker is load-bearing under auto-merge.** BOTH #637 reviewers independently caught a self-introduced regression WORSE than the bug being fixed — my search-error branches set `searchError` but never advanced `step` to `"results"` (the only place the banner renders), so a failed search stranded the user on a blank page. A single self-review would have shipped it. Fixed in one re-review cycle.
3. **A scout claim that contradicts a green baseline gate is a false positive.** Mobile "TS strict error in settings.tsx" vs a clean `mobile tsc` — trust the gate over static reasoning; don't build against it.
4. **`&&`-conjunction validators need symmetric failure coverage.** A boundary-pass test proves `>=` vs `>` but NOT that a term is in the conjunction; #636 needed a per-term failure test (height/width/area each failing alone) to be mutation-complete — a reviewer caught the missing width case.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 92** (ran Run 88). Next couple of runs can lean on scouts + scorecard.
- **Ship blockers unchanged & not headlessly buildable:** functional_reality (DATA_BACKEND cutover, PENDING_OPS `cutover-to-persistent-data`), design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — needs push-and-watch-CI + seeded LLM), business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift feature).
- **E7 follow-ups (disjoint, buildable):** activation-habit sequence (B1–B3 cron — needs habit email builders in lifecycle.ts + a cron querying first-analysis window); upgrade-paywall sequence (C1–C3 — needs a paywall-hit event log to trigger from); design-shared referral email (F1 — trigger after `saved-designs/[id]` PATCH is_public). Each is server-side, dry-run-default; be careful touching signup/analysis call sites.
- **DO-NOT-RE-FLAG:** mockups IDOR (fixed #612); scorecard `security_rls` finding (stale). next/image sweep + iOS-privacy CollectedDataTypes are borderline (layout risk / needs Apple-enum research). #385 pgvector RPC is INERT until the data-layer cutover.

## Run 2026-07-16 (Run 91) — DEEP AUDIT (8-lens, due by 24h rule since Run 88) + 3 disjoint value-bar changes (validation correctness + 2 coverage). ALL 3 MERGED via one PR. 1 candidate DROPPED on Reviewer-B value.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-9xtgao` at origin default tip `4228ea5` (Run 90 #638; fetch confirmed HEAD == origin/ai-apartment-design-app-iHAdb, 0/0). `npm install` root + `cd mobile && npm install` (mobile node_modules ABSENT — installed first). Baseline gate GREEN: tsc, **2105 tests** / 11 skip, determinism, eslint 0, mobile `tsc --noEmit` clean.
- **DEEP AUDIT DUE** — last ran Run 88 (2026-07-14); >24h elapsed → ran the full 8-lens sweep FIRST before selecting.
- **QUALITY_SCORECARD (DATA, as_of 2026-07-13, overall C, ship_gate false):** three ship_critical below A, all unchanged & human/CI-gated — functional_reality C (DATA_BACKEND cutover), design_taste B (authed-axe on diagnosis/mockups/compare + F7 screenshots), business_case_strength B (without-annual ARR ~$99.9K < $100K floor). The scorecard's `security_rls A+→A` mockups-IDOR finding is STALE (fixed Run 86 #612) — re-confirmed CLEAN this run. GROWTH pre_launch 0/null → no lever signal.

### DEEP AUDIT — 8 Haiku lenses, whole-codebase (read-only discovery)
- **CORRECTNESS & DEAD CODE:** CLEAN (67 routes, ownership guards before paid LLM, maxDuration/timeouts present, webhook idempotent, no fake-success fire-and-forget).
- **SECURITY & RLS:** CLEAN (all 29 migrations ENABLE RLS; tenant tables WITH CHECK; shared/internal tables RLS-no-policy; mockups product_ids/bundle_id bound to room_id — re-verified; no secret leak). Confirms the scorecard security_rls finding is STALE.
- **STUBS / CRITICAL-PATH REALITY:** CLEAN (AI pipeline, Stripe checkout/webhook/portal, mobile RevenueCat paywall, saved-designs — all wired to real awaited calls; no stub/TODO/fake-success on a critical path).
- **PERFORMANCE:** found 4 hot-path fetch-parallelization candidates (mockups, search/route, search/stream, area-analysis/refine). Verified: search/stream + search/route have NO handler-orchestration test (their tests replicate logic, not the route) → UNVERIFIABLE headless → DEFER (matches Run 89 lesson). Only mockups has a real handler test (mockups-product-binding).
- **A11Y & DESIGN BAR:** 3 minor CLS/token items (confetti hardcoded hex; hero + modal raw `<img>` missing width/height). All BORDERLINE micro — not shipped (batch-padding risk). Design system itself clean (no emoji-in-JSX, no purple/violet, tokens resolve).
- **TEST & EVAL COVERAGE:** real gaps on the validation/math enforcement layer → became this run's 3 changes (see below).
- **DEPS & ARTIFACT FRESHNESS:** env-var docs gap (STRIPE_PRICE_ID_*, CRON_SECRET, SELF_CONSISTENCY_N, MARGIN_* undocumented in .env.example) — checkout ALREADY fails loud on a missing price ID (stripe.ts:80-85), so this is doc-only/borderline → NOT shipped. Pricing/privacy docs verified CONSISTENT (annual gated-off disclosed in all three; processors accurate).
- Pricing anchors intact: $29 one-time / $49-mo Pro / $399-yr; Pro Annual gated-off consistently.

### FALSE POSITIVES caught by verifying against the live tree (NOT shipped)
1. **Mobile scout "mockups route IDOR (product_ids/bundle_id unbound)"** — STALE; the security scout AND a direct read confirm both are bound to room_id (fixed #612).
2. **Mobile scout "no rate limiting on analyze/diagnosis/search/mockups"** — FALSE; all four carry `checkRateLimit` + `checkDailySpend` (verified each route).
3. **Test scout "parseRoomDimensions singular inch (line 182)"** — the line-182 regex already includes `inch` explicitly AND `in` captures first, so the `|| unit === "inch"` clause is a DEAD branch; the outcome is already correct → not mutation-provable → skipped. (Only the POSITIONAL DIMENSION_REGEX had the real bug — shipped as C1.)
4. **Test scout "bundle-math zero-price mutation `>0`→`>=0` uncaught"** — FALSE; the existing test (bundle-math.test.ts:432) already fails that mutation. The `mean===0` branch (0.3) is unreachable dead code given the `>0` filter → no test possible.

### Shipped — 3 file-disjoint value-bar changes (all both-Sonnet-APPROVED; 6 reviews, zero re-review cycles)
- **C1 (VALIDATION/Track F+A)** `lib/validation/spatial-math.ts` + `__tests__/validation/spatial-math.test.ts` — `UNIT_ALT` used `inches?` which matches "inche"/"inches" but NOT bare "inch", so a positional spec like `6inch x 4inch` matched only "6in", failed the separator, and fell into the single-dimension branch as a 6×6 SQUARE (mis-scoring footprint coverage/clearance). Fix `inches?` → `inch(?:es)?` (kept longest-first before `in`); +3 mutation-provable cases. Both reviewers reverted the char-class and empirically reproduced the 6×6 bug.
- **C2 (TEST/Track F)** `__tests__/agents/escalation-ladder.test.ts` — assert `onTier(i,label,false)` fires on the THROW path (catch branch), so a caller's oscillation/velocity counter still advances on a thrown tier. Existing tests covered onTier on accept/reject + throw-and-continue (return value) but never the catch-site call — a mutation dropping it was uncaught. Cost-contract-critical (deterministic escalation layer). Mutation-verified by both reviewers.
- **C3 (TEST/Track F)** `__tests__/validation/bundle-math.test.ts` — cover the undefined-height auto-pass in the height-based relational scale rules (side_table↔sofa, dining_chairs↔dining_table). Existing scale_balance tests only used width rules (coffee_table/sofa); the height guard was uncovered. Asserts a missing-height bundle scores strictly above a concrete height mismatch (1.0 vs 0.5); dropping the guard (NaN→false) collapses them. Both reviewers hand-checked the arithmetic + ran the mutation.

### DROPPED on review (not shipped)
- **Perf-mockups** `app/api/mockups/route.ts` (room+diagnosis Promise.all) — Reviewer A APPROVED correctness (queries independent, 404 guard preserved, `.single()` never rejects in either backend). Reviewer B **REQUEST_CHANGES on VALUE**: the saved ~1 DB round-trip (~tens of ms) is an imperceptible fraction of the multi-second AI render that follows on that route → marginal, reads as change-count padding. Per the rules (Reviewer-B value rejection I can't raise) → ABANDONED (git reset, clean tree). Correct call — I flagged the same concern at selection.

### Merge outcome + gate
- 3 clean commits on the working branch; **single branch per this run's git constraint → ONE PR to default.** Integrated gate GREEN: tsc, **2108 tests** (2105 +3), determinism, eslint (touched web files). No mobile change this run.
- **No ROADMAP box ticked** — all 3 are validation-correctness / coverage hardening on the enforcement layer; no full Track item completed. F5 (periodic DEEP AUDIT) is a recurring cadence, not a per-run checkbox — left [ ]. **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **A largely-CLEAN deep audit is a valid, successful result — do not pad it.** Correctness, security, and critical-path-reality all came back clean; the only real buildable, headless-safe work was validation-layer coverage + one correctness fix. Shipping 3 solid changes and DROPPING the borderline 4th is the disciplined outcome, not a shortfall.
2. **Verify perf-parallelization candidates have a HANDLER test, not a logic-replica test.** search/stream's "test" copies the extraction logic into the test file — it does NOT exercise the route's DB orchestration, so a parallelization there lands unverified. Only mockups had a real handler test (and that change was still dropped on value).
3. **"Marginal relative to the dominant cost" is a Reviewer-B value rejection even when correct.** A DB round-trip saved before a multi-second render is imperceptible; the maker≠checker split caught the padding instinct I already half-suspected. Perf only clears the bar when the parallelized work is actually on the critical-latency path.
4. **`X?` scopes over the single preceding char.** `inches?` = "inche"+optional-s (never matches bare "inch"); the fix is `inch(?:es)?`. A classic regex footgun on the enforcement layer.

### Rotation guide for next run
- **DEEP AUDIT ran Run 91 (2026-07-16) — next due ~Run 95** (or whenever >24h/~4 runs elapse). Next few runs can lean on scouts + scorecard.
- **Named disjoint follow-ups (verified, buildable):**
  - **LABELED_DIMENSION_REGEX same `inches?` bug** — `lib/validation/spatial-math.ts:70` (the W/D/H-suffixed parser) independently uses `inches?`, so `6inchW` mis-parses; low real-world risk (real labeled specs use `"` marks) but a disjoint one-line + test. Both C1 reviewers flagged it as a non-blocking follow-up.
  - **E7 growth follow-ups (server-side, dry-run-default, INERT):** activation-habit B1–B3 cron (needs habit builders in lifecycle.ts + a first-analysis-window query); upgrade-paywall C1–C3 (needs a paywall-hit event log to trigger from); design-shared referral email F1 (trigger after saved-designs/[id] PATCH is_public). Careful around signup/analysis call sites.
  - **Env-var documentation** (.env.example: STRIPE_PRICE_ID_*, CRON_SECRET, SELF_CONSISTENCY_N, MARGIN_*) — modest config-health; only worth it standalone, not as batch filler (checkout already fails loud, so no correctness angle).
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover, PENDING_OPS `cutover-to-persistent-data`); design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — needs push-and-watch-CI + seeded LLM); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE — the mobile scout named early-paywall-after-first-analysis + onboarding-friction reduction as buildable conversion levers, but both are big risky UX changes hard to verify headlessly; a bounded, testable version is the best next attempt).
- **DO-NOT-RE-FLAG:** mockups IDOR (fixed #612); scorecard `security_rls` finding (stale, re-confirmed clean Run 91); rate limiting on paid routes (present — verified Run 91); parseRoomDimensions "inch" (already handled / dead branch); bundle-math zero-price mutation (already covered); next/image sweep + confetti hex (borderline, layout/behavior-neutral); #385 pgvector RPC (INERT until cutover).

## Run 2026-07-16 (Run 92) — 6 disjoint value-bar changes (E7 habit cron + a11y ×2 + store compliance + mobile correctness + validator coverage). ALL 6 MERGED. 1 candidate DROPPED (redundant), 3 amended after review.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-yxs4ae` at origin default tip `94b9cc5` (Run 91 #639 + FACTORY_STANDARD §50/§51 #640/#641; fetch confirmed 0/0 vs origin default). `npm install` root + `cd mobile && npm install` (mobile node_modules ABSENT — installed first). Baseline gate GREEN: tsc, **2108 tests** / 11 skip, determinism, eslint 0, mobile `tsc --noEmit` clean.
- **DEEP AUDIT NOT due** — ran Run 91 (2026-07-16); next ~Run 95. Ran a normal 7-Haiku-scout sweep.
- **QUALITY_SCORECARD (DATA, as_of 2026-07-13, overall C, ship_gate false):** three ship_critical below A unchanged & human/CI-gated — functional_reality C (DATA_BACKEND cutover), design_taste B (authed-axe + F7 screenshots), business_case_strength B (without-annual ARR ~$99.9K < $100K floor). GROWTH pre_launch 0/null → no lever signal.

### Scouting — 7 Haiku lenses
- **security/RLS:** CLEAN (all 29 migrations ENABLE RLS; mockups product_ids/bundle_id bound to room_id — re-confirmed; SECURITY DEFINER search_path pinned; no secret leak; internal endpoints constant-time token). No-op.
- **test/eval coverage:** 5 candidates on the validation/scoring enforcement layer. Only code-compliance null-guards survived (see DROPPED for product-scorer).
- **web-reliability/side-effects:** saved-designs partial-persistence + mockups data-URI fallback + search/area-analysis unguarded Promise.all — all REAL but need a route-orchestration harness to verify headlessly → deferred (matches the standing Run 89/91 lesson).
- **mobile:** 3 setState-after-unmount candidates (use-entitlements, use-free-quota, photo). Shipped only the paywall-critical one (entitlements); held the other two to avoid batch-padding near-identical guards.
- **growth-E7:** habit B1-B3 named as the top disjoint follow-up (100% new files) → shipped. Upgrade-paywall C1-C3 + referral F1 still remain (touch shared saved-designs call sites).
- **store-readiness:** privacy-vs-code deletion-timeframe contradiction → shipped.
- **a11y/design-bar:** products selects unlabeled + sourcing-mode selector not a real group → both shipped.

### Shipped — 6 file-disjoint value-bar changes (all both-Sonnet-APPROVED; 12 initial reviews + 6 re-reviews across 2 cycles)
- **(1) E7 habit cron** — `app/api/cron/habit-emails/route.ts` (new) + `buildHabitEmail1/2/3` in `lib/email/templates/lifecycle.ts` + `vercel.json` (12:00 UTC) + `__tests__/api/cron-habit-emails.test.ts` (+9). Post-first-analysis B1/B2/B3 (docs/email-lifecycle.md Seq 2) for free-tier users, upselling the $29 Apartment plan. Mirrors activation/winback: CRON_SECRET HMAC auth, first-analysis window via `room_diagnoses.created_at` + `rooms!inner(projects!inner(user_id))` embed, de-dup, `hasProEntitlementWeb` paid drop-out, `isMarketingOptedOut`, per-`(user,stage)` idempotency on `user_email_stages`, `maxDuration=300`, dry-run safe. Copy verbatim from the doc; `habit_1..3` already in the EmailStage union + `stage` is free-text → no migration. Ships INERT.
- **(2) a11y products selects** — `app/.../products/page.tsx`: aria-label on 3 `SelectTrigger`s (Radix combobox gets no accessible name from content).
- **(3) a11y sourcing-mode** — `components/rooms/sourcing-mode-selector.tsx`: role=group + aria-label + per-button aria-pressed. **REVISED after BOTH reviewers rejected role=radio/radiogroup** (promises roving-tabindex + arrow-key nav that wasn't implemented — ARIA anti-pattern). Toggle-button-group matches native button keyboard behavior with zero new JS (same pattern as theme-toggle.tsx).
- **(4) store compliance** — `app/privacy/page.tsx`: "within 30 days"→"immediately and permanently", matching support+account pages AND the immediate `admin.deleteUser()` cascade in `app/api/user/delete/route.ts`.
- **(5) mobile correctness** — `mobile/src/hooks/use-entitlements.ts`: mountedRef+activeUserRef guard on ALL of setCustomerInfo/setIsPro/setIsLoading. **REVISED after Reviewer A** caught that an isLoading-only guard left refresh()'s setters exposed to a userId-change stale-race (a slow getCustomerInfo() for the old user resolving last, clobbering the fresh user's entitlement state). Guard lives inside refresh() so it also protects the post-purchase caller in results.tsx.
- **(6) validator coverage** — `__tests__/validation/code-compliance.test.ts` (+2): egress-window partial-data null guards (only-height / only-width present). Pins all three `winX===null||` guards + the outer `||`. **REVISED after Reviewer A** dropped a redundant 3rd case ({window_height:20}) that pinned no guard (heightOK already false from the real value) + reworded the overclaiming message.

### DROPPED (not shipped)
- **product-scorer category-calibration test** — Reviewer B empirically proved the `if(category)` branch was ALREADY covered by `__tests__/integration/scoring-pipeline.test.ts` (calls computeFinalItemScore with "rug"/"sofa" + asserts calibration; the mutant was already dead pre-diff). Only the case-insensitivity micro-assertion was new → below the value bar → DROPPED entirely (git rebase drop).

### Merge outcome + gate
- 6 clean commits on the working branch (product-scorer test dropped via rebase; 3 commits amended in-place after review, all authored noreply@anthropic.com). Integrated gate GREEN: tsc, **2119 tests** (2108 +9 habit +2 code-compliance), determinism, eslint (touched web files), mobile `tsc --noEmit`. Single-branch per this run's git constraint → ONE PR to default.
- **No ROADMAP box ticked** — E7 advanced (habit B1-B3) but stays [ ] (upgrade-paywall C1-C3 + referral F1 remain); the rest are a11y/compliance/correctness/coverage hardening; no full Track item completed. **No migrations, no secrets** (habit cron reuses CRON_SECRET/RESEND_API_KEY/EMAIL_PHYSICAL_ADDRESS; updated PENDING_OPS set-cron-secret to list all three crons).

### Lessons learned
1. **Check a "coverage gap" against the WHOLE suite, not just the target file.** The product-scorer `if(category)` branch looked dark in product-scorer.test.ts, but the integration test already exercised it with real categories. My scout read only the unit test file. Grep ALL callers/tests before claiming a branch is uncovered — else you ship redundant padding (Reviewer B caught it; dropped).
2. **`role="radio"`/`radiogroup` is an interaction CONTRACT, not a label.** It obligates roving tabindex + arrow-key navigation; declaring it without them is worse than plain buttons (announces a widget that doesn't work). For an independent-toggle set, `role="group"` + `aria-pressed` matches native `<button>` Tab/Enter/Space behavior with zero new code. Both reviewers independently flagged this.
3. **An unmount guard on ONE setter is incomplete.** The same async op's OTHER setters — and a userId-change stale-race (out-of-order resolution clobbering fresh state) — need the same guard. Put it inside the shared refresh(), not just the effect's finally, so every caller (incl. post-purchase) is protected. Reviewer A caught the partial guard.
4. **maker≠checker + a re-review cycle is the safety net under auto-merge.** 3 of 6 shipped changes were materially improved by a reviewer objection (sourcing ARIA, mobile stale-race, code-compliance redundant test), and a 4th was dropped entirely. Zero of these would have been caught by self-review.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 95** (ran Run 91). Next couple of runs can lean on scouts + scorecard.
- **Named disjoint E7 follow-ups (server-side, dry-run-default, INERT):** upgrade-paywall C1-C3 (needs a paywall-hit event log to trigger from — touches saved-designs POST 403 path, careful); referral-share F1 (trigger after saved-designs/[id] PATCH is_public — touches shared endpoint). Both were held this run as they touch shared critical call sites.
- **Reliability candidates needing a harness first (real, deferred):** saved-designs `full`-stage snapshot saves with `bundles:[]`/empty products if the DB read errors (silent partial persistence, F4.1); mockups data-URI fallback on storage-upload failure (fake success on refresh). Both need a route-orchestration test (mock DB error → assert guard) before auto-merge is safe.
- **Held mobile micro-fixes (real but lower stakes):** use-free-quota.ts + photo.tsx unmount guards (same pattern as this run's entitlements fix; held to avoid batch-padding — ship standalone if a run is light).
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover); design_taste (authed-axe on seeded routes + F7 screenshots — sandbox-unrunnable); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + ANNUAL_BILLING_ENABLED, OR a real conversion-lift FEATURE).
- **DO-NOT-RE-FLAG:** mockups IDOR (fixed #612, re-confirmed clean); rate-limits on paid routes (present); product-scorer category branch (already covered by scoring-pipeline.test.ts — do NOT re-add); sourcing-mode role=radio (use group/aria-pressed, done); parseRoomDimensions "inch" (dead branch).

## Run 2026-07-16 (Run 93) — 3 disjoint value-bar changes: 2 side-effect-integrity/reliability fixes (Track F4/F4.1) + 1 entitlement-path robustness fix. ALL 3 MERGED via one PR (#647). Several scout "bugs" DROPPED as intentional design / dead paths / false positives.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-mhgc20` reset to origin default tip `457608a` (Run 92 #642 + FACTORY_STANDARD/ROUTINES #643-#646; fetch confirmed 0/0). `npm install` root + `cd mobile && npm install` (mobile node_modules ABSENT — installed first; reverted a one-line `package-lock.json` install artifact to keep the tree clean). Baseline gate GREEN: tsc, **2119 tests** / 11 skip, determinism, eslint 0, mobile `tsc --noEmit` clean.
- **DEEP AUDIT NOT due** — ran Run 91 (2026-07-16); next ~Run 95. Ran a normal 7-Haiku-scout sweep.
- **QUALITY_SCORECARD (DATA, as_of 2026-07-13, overall C, ship_gate false):** three ship_critical below A unchanged & human/CI-gated — functional_reality C (DATA_BACKEND cutover, PENDING_OPS `cutover-to-persistent-data`), design_taste B (authed-axe + F7 screenshots), business_case_strength B (without-annual ARR ~$99.9K < $100K floor). GROWTH pre_launch 0/null → no lever signal.

### Scouting — 7 Haiku lenses
- **security/RLS:** CLEAN (all 29 migrations ENABLE RLS; tenant tables WITH CHECK; shared/internal tables RLS-no-policy; mockups product_ids/bundle_id bound to room_id — re-confirmed; migration 024 pins search_path on handle_new_user; no secret leak; entitlements/web fails closed on misconfig, open on transient; rate+spend limits present on paid routes). No-op.
- **a11y/store-readiness:** CLEAN (products selects aria-labelled; sourcing-mode role=group+aria-pressed; privacy deletion timeframe "immediately and permanently" consistent; 12 processors accurate; Pro Annual intentionally omitted/gated). No-op.
- **validation/math:** 2 "correctness bugs" that were NOT bugs (see DROPPED) + coverage claims deferred to the coverage scout.
- **web-reliability/side-effects:** 2 REAL finds → shipped both (saved-designs silent partial persistence; products-page silent add-failure).
- **mobile:** setState-after-unmount candidates (use-free-quota, photo, auth screens) — dropped (React-18 no-op, no stale-race; batch-padding per Run-92 lesson).
- **growth-E7:** upgrade-paywall C1-C3 (needs a new migration + shared-route edit), referral F1 (wants a 1hr-delayed send, not an inline send on the shared PATCH endpoint), paid-engagement D1/D2 (D2 has an owner-fill placeholder; weak inactivity proxy) — NONE clean/disjoint/headless-safe → deferred.
- **test/eval coverage:** 5 candidates — only #3 (entitlements/server subscriber guard) survived as a real CODE fix; the rest false-positive/low-value (see DROPPED).

### FALSE POSITIVES / DROPPED (verified against the live tree — NOT shipped)
1. **bundle-math coffee-table `0.5–1.1` "off-by-one"** — the band is INTENTIONAL tolerance slack around the "⅔ to full" guideline (avoids false-positive violations on borderline coffee tables); tightening to 0.667–1.0 would make the validator stricter and change production scoring → NOT a bug.
2. **spatial-math undersized-room clearance `maxAllowed > 0` guard** — a defensive suppression of spurious violations on tiny/mis-parsed rooms; flagging them instead risks false positives on bad room data → defensive-vs-strict judgment, not a clean bug.
3. **LABELED_DIMENSION_REGEX `inches?`** (spatial-math.ts:70, the W/D/H labeled parser) — real regex footgun (`inches?`≠"inch") BUT the pipeline emits the `"`-quote labeled form, so the "inch"-spelled path never fires in production → fixing a dead path = padding.
4. **coverage-scout site-gate prefix + cors null-cast** — site-gate mutation (`startsWith(p)`) is already caught by the `/guidescheat` test; cors "cast" is compile-time only (no runtime mutation) → both FALSE POSITIVES.
5. **coverage-scout web.ts tier-cast + stripe pro_annual** — the `===`→`!==` mutation is caught by the existing apartment test; pro_annual is a gated-off tier (test-only for an inactive path) → low-value → SKIPPED.
6. **mobile use-free-quota unmount guard** — React 18/RN makes setState-after-unmount a safe no-op (warning removed); unlike the Run-92 use-entitlements fix there's NO userId stale-race (the key is device-global) → defensive-only → DROPPED (Run-92 batch-padding lesson).

### Shipped — 3 file-disjoint value-bar changes (all both-Sonnet-APPROVED; 6 reviews, zero re-review cycles)
- **(1) RELIABILITY/Track F4.1** `app/api/saved-designs/route.ts` + new `__tests__/api/saved-designs-full-persistence.test.ts` (+3) — a "full"-stage save read candidate_products + product_bundles with `data ?? []`, so a DB read ERROR (data=null) silently wrote a zero-product snapshot yet returned HTTP 200 — the user believed their 20+ shortlisted products saved but the design reloads empty (silent data loss on the retention-critical journey). Capture both read errors → generic 500 (apiError, Track G3) so the client can retry. Test drives the real POST handler via a thenable-chain mock (mockups-product-binding pattern): products-error→500, bundles-error→500, both-ok→200. Reviewer A reverted the fix and empirically reproduced the 500→200 mutation.
- **(2) RELIABILITY/Track F4** `app/projects/[projectId]/rooms/[roomId]/products/page.tsx` — `handleIngest` (Add Product on the core sourcing journey) acted only on `res.ok` with no else-branch and no catch, so a 400/500/network failure gave the user ZERO feedback (spinner clears, URL stays, silent failure). Mirror the two sibling handlers in the same file — `toast.error("Couldn't add product", body?.error || 'HTTP N')` on `!res.ok` + a network-error catch toast; `finally` still clears the spinner. Follows merged #637 (surface silent failures on the focus page). No component-test harness exists in the repo → inspection-verified against the two already-reviewed sibling handlers (both reviewers confirmed acceptable, cited the #637 precedent).
- **(3) ENTITLEMENTS/robustness** `lib/entitlements/server.ts` + `__tests__/entitlements/server.test.ts` (+4) — `hasProEntitlement` handled network/timeout/5xx/404/parse-error explicitly but read `data.subscriber.entitlements[ENTITLEMENT_ID]` UNGUARDED after a successful parse; a 200 whose body parsed but lacked the expected shape (`{}` / `{subscriber:null}`) threw an uncaught TypeError out of the entitlement check on gated routes (`app/api/mobile/entitlements/route.ts:51`, `app/api/mobile/saved-designs/route.ts:91` — both call it with no try/catch → 500) instead of the documented fail-open. Guard the shape (`const entitlements = data.subscriber?.entitlements; if (!entitlements || typeof entitlements !== "object") return true;`) → fail OPEN, consistent with the parse-error + 5xx paths, so a paying subscriber is never blocked by an RC glitch. Well-formed empty entitlements still returns false (unchanged). Security-reviewed: `rcAppUserId` is the server-derived Supabase user.id (never client-supplied), the malformed body originates from RC's own HTTPS, blast radius bounded to the free-save-limit → NOT a client-triggerable bypass. +4 mutation-provable tests (each throws against the old code).

### Merge outcome + gate
- 3 clean commits on the working branch (author reset to noreply@anthropic.com per the signing hook). Single branch per this run's git constraint → **ONE PR (#647) to default; squash-merged as `59afc19`; required checks (verify/build/mobile) green; auto-merge fired.** Merged-result gate re-run GREEN: tsc clean, targeted suites 19/19, integrated **2126 tests** (2119 +7), determinism.
- **No ROADMAP box ticked** — all 3 are reliability/robustness hardening on critical paths; no full Track item completed. F4/F4.1 stay [ ] (they require the full seeded-E2E harness, not per-fix hardening). **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **A scout "correctness bug" on the validation/scoring layer is a hypothesis, not a fact — verify against the live tree BEFORE building.** Two of this run's top scout finds (bundle-math tolerance band, spatial-math undersized-room guard) were INTENTIONAL tolerance/defensive design; shipping them would have made the validator stricter/noisier and changed production scoring. The maker doing the verification (not just the checker) prevented two bad changes from ever reaching review.
2. **A React-18 setState-after-unmount is a safe no-op — a "mount guard" is defensive padding unless there's a REAL stale-race.** The Run-92 use-entitlements fix was justified by a userId-change clobber (wrong entitlement shown), NOT by unmount. The device-global free-quota hook has no such race → correctly dropped, consistent with the Run-92 batch-padding lesson.
3. **Before fixing a regex/parse path, confirm it FIRES in production.** `inches?`≠"inch" is a real footgun, but the labeled dimension parser's real input uses `"` marks, so the "inch"-spelled branch is dead code → fixing it is churn, not value.
4. **When a phase (E7) offers no CLEAN disjoint headless-safe change, DEFER it — don't force a half-sequence.** Paid-engagement D2 has an owner-fill placeholder; referral F1 wants a 1hr-delayed send (a cron/event-log mechanism), not an inline send on a shared PATCH endpoint. Forcing either would be lower-quality work; a quiet coherent 3-change run beats padding.
5. **CI latency on this repo can be ~15-20 min** — the legacy commit-status API (`get_status`) shows total_count 0 for Actions check-runs; poll `pull_request_read get` for `merged:true` rather than the status endpoint. #647 registered no statuses but merged cleanly ~4 min after the checks completed.

### Rotation guide for next run
- **DEEP AUDIT next due ~Run 95** (ran Run 91). Next run or two can lean on scouts + scorecard.
- **Named disjoint follow-ups still open (verified, buildable, headless-safe):**
  - **saved-designs handler — other unchecked reads** (`rooms` :69, `projects` :140, the `existing` lookup :153) all still ignore their `error` fields (Reviewer A flagged as out-of-scope follow-ups). The `existing` one is the most concerning — an errored existence check falls through to the INSERT branch, risking a duplicate saved_designs row. A disjoint follow-up (same file, so a later run — not this-run-disjoint).
  - **E7 (server-side, dry-run, INERT):** upgrade-paywall C1-C3 needs a NEW paywall-hit event table (human-applied migration) + a shared saved-designs 403-path edit; referral F1 wants an event-log + delayed-send cron (not an inline PATCH send); paid-engagement D1-only is buildable (drop D2's owner-placeholder) but needs a cross-table last-activity inactivity proxy. Each is more involved than a clean cron.
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS `cutover-to-persistent-data`); design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — sandbox-unrunnable, needs push-and-watch-CI + seeded LLM); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE).
- **DO-NOT-RE-FLAG:** mockups IDOR (fixed #612, re-confirmed clean); rate-limits on paid routes (present); bundle-math coffee-table band (intentional tolerance); spatial-math undersized-room guard (intentional defensive); LABELED_DIMENSION_REGEX `inches?` (dead path — real input uses `"`); site-gate prefix + cors cast (already-caught / no-op); web.ts tier-cast + stripe pro_annual coverage (caught/gated); mobile use-free-quota/photo/auth unmount guards (React-18 no-op, no stale-race); product-scorer category branch (covered by scoring-pipeline.test.ts).

## Run 2026-07-17 (Run 94) — 4 file-disjoint value-bar changes: saved-designs read-error integrity (F4.1) + Stripe-webhook tier validation (Track C/G) + 2 core-path coverage tests (F2). ALL 4 both-Sonnet-APPROVED.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-ul7bqs` already at origin default tip `b3fb18b` (Run 93 #647 + housekeeping #648; fetch confirmed HEAD contains default tip). `npm install` root + `cd mobile && npm install` (mobile node_modules ABSENT — installed first; reverted the lockfile install-artifact to keep the tree clean). Baseline gate GREEN: tsc, **2126 tests** / 11 skip, determinism, eslint 0, mobile `tsc --noEmit` clean.
- **DEEP AUDIT NOT due** — ran Run 91 (2026-07-16); next ~Run 95. Ran a normal 6-Haiku-scout sweep.
- **QUALITY_SCORECARD (DATA, as_of 2026-07-13, overall C, ship_gate false):** three ship_critical below A unchanged & human/CI-gated — functional_reality C (DATA_BACKEND cutover), design_taste B (authed-axe + F7 screenshots), business_case_strength B (without-annual ARR ~$99.9K < $100K floor). GROWTH pre_launch 0/null → no lever signal.

### Scouting — 6 Haiku lenses
- **web-reliability/side-effects:** confirmed the Run-93-named saved-designs `existing` unchecked read (duplicate-row hazard) → shipped; a 2nd find (diagnosis project-fetch error) DROPPED (route deliberately uses `project?.` optional chaining throughout → intentional graceful degradation, failing loud would change intended behavior).
- **security/RLS + rate-limiting:** CLEAN (all migrations ENABLE RLS through 029; next number would be 030; all write + expensive/LLM routes carry enforceWriteRateLimit / checkRateLimit + checkDailySpend; no IDOR residuals). No-op.
- **test/eval coverage:** 3 candidates → shipped 2 (durability resolveLifestyleFlags notes/wfh/hosting branches; harmony computePairwisePenalty title-match branch). DROPPED lookupDurability prefix-strip — NOT mutation-provable (the substring fallback at durability-map.ts:125-127 always shadows the exact-match-after-strip, so deleting the strip yields the same output).
- **mobile:** essentially CLEAN — 2 hardcoded-color "design-bar drift" finds DROPPED as low-value token churn (the color values are already correct; the LED one needs non-component restructuring). No-op.
- **store-readiness/a11y/artifact-freshness:** CLEAN (icon buttons aria-labelled; inputs labelled; privacy/processors consistent; README/ARCHITECTURE/pricing match code). No-op.
- **entitlements/monetization/growth:** surfaced the Stripe-webhook tier-cast (→ shipped). DROPPED: web.ts latent invalid-date parse (dead — current_period_end always null, Run-93-style dead-path rule); soft save-count quota race (documented-intentional); cron double-send (DEFERRED — see below).

### DEFERRED / DROPPED (verified against the live tree — NOT shipped)
1. **cron double-send race (activation/habit/winback)** — REAL narrow F4.1 gap (SELECT→SEND→INSERT; a crash after send-before-insert double-sends on an at-least-once cron retry). The correct fix (claim-before-send + compensating-delete on send-failure) spans 3 near-identical route files and carries a genuine drop-vs-duplicate trade-off → its own focused, well-reviewed run, not forced here. Named follow-up below.
2. **diagnosis project-fetch error** — intentional graceful degradation (`project?.` optional chaining throughout diagnosis/route.ts); failing loud would convert tolerated degradation into a hard failure on the core paid path.
3. **lookupDurability prefix-strip test** — NOT mutation-provable (substring fallback shadows it).
4. **mobile hardcoded LED / splash colors** — low-value token churn, values already correct.
5. **web.ts invalid-date parse** — dead path (current_period_end always null); **soft save-count race** — documented-intentional.

### Shipped — 4 file-disjoint value-bar changes (all both-Sonnet-APPROVED; 2 REQUEST_CHANGES caught + fixed → re-APPROVED)
- **(1) RELIABILITY/Track F4.1** `app/api/saved-designs/route.ts` + new `__tests__/api/saved-designs-existing-persistence.test.ts` — two persisted-data reads ignored their `error` field: the `existing` upsert lookup (an errored existence check fell through to the INSERT branch → DUPLICATE saved_designs row, defeating the upsert) and the `rooms` read (an errored read persisted a snapshot titled "Untitled Room" / null room_type). Both now fail loud (500 via apiError) so the client retries; the `project` metadata read is correctly LEFT best-effort. Completes the read-error class Run 93 started (products/bundles) in this file. **Reviewer A REQUEST_CHANGES: the existing-lookup test wasn't mutation-provable** — the table-keyed mock returned the same error for every saved_designs call, so deleting the guard still 500'd via the pre-existing insert-error check (right result, wrong reason; couldn't express SELECT-fails-INSERT-succeeds). Fixed with a call-site-aware `makeClientExistingLookupErrors` (maybeSingle errors, INSERT succeeds) + an `insertSpy` "never called" assertion; empirically re-confirmed: reverting ONLY the `existingError` guard now fails the test.
- **(2) BILLING/Track C+G** `lib/billing/stripe.ts` + `__tests__/billing/stripe.test.ts` — `metadata.tier` from Stripe webhooks was blind-cast to the `BillingTier` TS type (no runtime effect). An invalid/replayed/typo'd tier flowed to the `stripe_customers` upsert → Postgres CHECK-constraint 500 → Stripe retries the event indefinitely (stuck webhook, entitlement divergence). Added `normalizeBillingTier()` validating against the canonical set (mirrors migrations 018+021): checkout → null/no-op on invalid; subscription.updated/deleted → "pro" fallback on invalid/missing (preserves the prior `?? "pro"` intent). **Reviewer A REQUEST_CHANGES: the checkout no-op was now SILENT** (200, no entitlement, no retry, no log — harder to detect than the 500 it replaced). Fixed by logging LOUD only for a PRESENT-but-invalid tier — `console.error` on the checkout path (drops entitlement on a possibly-charged customer), `console.warn` on the subscription path (writes a "pro" fallback) — absent tier stays quiet; + doc nit (001→018). Tests assert the log fires for invalid / stays quiet for absent, mutation-verified.
- **(3) TEST/Track F2** `__tests__/validation/durability-map.test.ts` — cover 3 previously-untested REAL branches of the pure `resolveLifestyleFlags()` (drives product durability/material scoring): free-text `notes` keyword scan → high_traffic (with a negative control), `work_from_home` → high_traffic, `hosting` → entertains (+ the "never" NEGATIVE_PATTERNS branch). Both reviewers empirically mutation-tested (deleting each disjunct fails the matching test).
- **(4) TEST/Track F2** `__tests__/scoring/harmony-composite.test.ts` — cover the untested `title` (3rd-arg) branch of `computePairwisePenalty()` (a core harmony-scoring fn called in prod from validation-agent.ts:1480 with `flag.title`). A "sofa" category conflict keyed on the product title "velvet chesterfield" (title-only match, no substring shadow) + a no-title control; both reviewers empirically mutation-verified the title-disjunct.

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default. Merged-tree gate GREEN: tsc clean, **2136 tests** (2126 +10), determinism, eslint 0 (touched), mobile unaffected. saved-designs test stress-run 25× → 0 flakes (a reviewer's isolated non-repro flake was sandbox jitter; the mock uses fresh per-`.from()` closures + resolved Promises, no race).
- **No ROADMAP box ticked** — all 4 are reliability/billing-robustness/coverage hardening on critical paths; no full Track item completed (F4/F4.1 need the full seeded-E2E harness; F2 already [x]; Track C already [x]). **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **A "returns 500 on a read error" test is only mutation-proof if the mock can express the FAILURE the fix targets.** A blanket table-keyed error made the existing-lookup test 500 via a *pre-existing* insert-error check even with the new guard gone — passing for the wrong reason. The real hazard is SELECT-fails-**INSERT-succeeds** (→ duplicate row); the mock must model that (error on maybeSingle, success on insert) and assert INSERT is never reached.
2. **Converting a loud failure (500 + Stripe retry) into a safe no-op (200) trades one divergence for a HARDER-to-detect one unless you log it.** A validation guard that silently drops a possibly-charged customer's entitlement needs a loud log for the present-but-invalid case (distinct from the routine absent/unhandled case) or the failure vanishes into the unhandled-event bucket.
3. **A test-coverage candidate on a "fuzzy" branch may not be mutation-provable** — lookupDurability's prefix-strip is always shadowed by the substring fallback, so no input/output asserts it; verify a branch is observable before writing a test for it (else it's coverage-theater).
4. **A growth-funnel double-send fix with a real drop-vs-duplicate trade-off across 3 files is its own focused run, not a rushed 5th change** — deferring it keeps the run coherent and high-confidence (Run-93 "don't force a half-sequence" discipline).

### Rotation guide for next run
- **DEEP AUDIT due ~Run 95** (ran Run 91). Next run should run the full 8-lens sweep BEFORE selecting.
- **Named disjoint follow-ups still open (verified, buildable):**
  - **cron double-send (F4.1)** — activation/habit/winback crons use SELECT→SEND→INSERT; on an at-least-once retry a crash between send and insert double-sends. Fix = claim-before-send (INSERT the (user_id,stage) row first; the unique constraint lets one run win) + a compensating DELETE on send-failure so a transient failure still retries. 3 near-identical files; decide the drop-vs-dup policy explicitly. No new migration (constraint exists).
  - **saved-designs remaining unchecked read** — the `project` metadata read (:145) is intentionally best-effort (LEFT), but audit whether any OTHER handler in the file/siblings still ignores an error whose result is persisted.
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS `cutover-to-persistent-data`); design_taste (authed-axe + F7 committed screenshots — needs push-and-watch-CI + seeded LLM); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE).
- **DO-NOT-RE-FLAG:** diagnosis project-fetch error (intentional `project?.` graceful degradation); lookupDurability prefix-strip (not mutation-provable — substring fallback shadows); web.ts invalid-date parse (dead — current_period_end always null); soft save-count race (documented-intentional); mobile hardcoded LED/splash colors (values correct, token churn); + carry Run 93's DO-NOT-RE-FLAG list (mockups IDOR fixed #612; rate-limits present; bundle-math coffee-table band; spatial-math undersized-room guard; LABELED_DIMENSION_REGEX inches?; site-gate/cors; mobile unmount guards; product-scorer category branch).

## Run 2026-07-17 (Run 95) — DEEP AUDIT (8-lens, due) + 4 file-disjoint value-bar changes: perf (A3) + coverage (F2) + config-freshness (F5) + mobile side-effect integrity (F4.1). ALL 4 both-Sonnet-APPROVED.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-2c4ws5` already at origin default tip `fa5613a` (Growth Run 11 #650), 0/0 divergence vs `claude/ai-apartment-design-app-iHAdb`. `npm install` root + `cd mobile && npm install` (mobile node_modules absent — installed; reverted the fsevents `dev:true` lockfile artifact to keep the tree clean). Baseline gate GREEN: tsc, **2136 tests** / 11 skip, determinism, eslint 0, mobile `tsc --noEmit` clean.
- **DEEP AUDIT was DUE** (last ran Run 91; >4 runs / >24h elapsed) → ran it this run BEFORE selecting, per the routine.
- **QUALITY_SCORECARD (DATA, as_of 2026-07-13, overall C, ship_gate false):** three ship_critical below A unchanged & human/CI-gated — functional_reality C (DATA_BACKEND cutover), design_taste B (authed-axe + F7 screenshots), business_case_strength B (without-annual ARR ~$99.9K < $100K floor). The scorecard's security_rls A+→A basis (mockups product_ids/bundle_id IDOR) is STALE — that finding is already fixed (bound to room_id + 404). GROWTH pre_launch 0/null → no lever signal.

### DEEP AUDIT — 8 Haiku lenses (whole codebase, read-only)
- **correctness/dead-code: CLEAN** — consistent defensive patterns, ownership guards, apiError logging, deterministic tiebreaks; prior intentional patterns unchanged.
- **security/RLS: CLEAN** — all migrations through 029 ENABLE RLS (tenant→auth.uid() policy, shared/internal→RLS+no-policy); every getAdminClient site legitimately shared/internal & auth-gated; no IDOR/bypass; rate limits on all write+LLM routes; no secret leak. (Next migration would be 030.)
- **monetization/entitlements: CLEAN** — server-side hasProEntitlement(Web) checks, Stripe webhook HMAC-verified + normalizeBillingTier + idempotent upsert, fail-closed on misconfig / fail-open on outage, tier set canonical, RLS-isolated stripe_customers.
- **performance:** 1 shipped (saved-designs parallelize); DROPPED analyze-apartment ~150ms (negligible vs 300s pipeline) + O(n²) cross-room `.find` at ≤5 rooms (negligible → churn).
- **a11y/design-bar:** ALL DROPPED — global-error.tsx hardcoded colors/focus is an INTENTIONAL CSS-free crash boundary (tokenizing = anti-fix); topbar step-indicator role (decorative, breadcrumbs cover it); emerald success color (intentional, value correct → token churn).
- **test/eval coverage:** 1 shipped (expandScore invalid-mean guard, mutation-provable); core logic otherwise saturated.
- **mobile Expo:** 1 finding (results.tsx renders unvalidated style_name/design_direction) → fixed at the SERVER contract instead (root-cause + testable; mobile has NO test harness).
- **artifact/config:** 1 shipped (.env.example billing vars); DROPPED npm-audit `--force` (pulls canary Next.js 16.3 → not autonomous-merge-safe); README optional-keys note (low value).

### Shipped — 4 file-disjoint value-bar changes (all both-Sonnet-APPROVED; 8 reviews, 0 re-review cycles)
- **(1) PERF/A3** `app/api/saved-designs/route.ts` — parallelize the two independent `full`-stage reads (products + bundles) on the retention-critical save; Promise.all, position-destructured, both `.error` still checked before persist, determinism unchanged. Reviewer A confirmed Supabase builders resolve (never reject) even on transport errors → no unhandled-rejection risk; existing persistence suite (18 cases) exercises the parallelized path.
- **(2) TEST/F2** `__tests__/scoring/calibration.test.ts` — cover expandScore's invalid-mean guard (NaN / <0 / >10 → return score). observedMean flows unvalidated from drift-monitor → calibrateScore → expandScore; both reviewers reverted the guard and confirmed the test fails (also kills the `||`→`&&` operator mutant).
- **(3) DOCS/F5** `.env.example` — README lists STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET/REVENUECAT_SECRET_KEY as required + says "copy .env.example", but the example omitted all 7 billing vars the code reads; added a documented Billing section (empty placeholders; annual gate note mirrors migration 021). Fixed a reviewer nit: unset vars → checkout 500 (throw→catch), not 400/503.
- **(4) RELIABILITY/F4.1** `app/api/mobile/analyze/route.ts` + new `__tests__/api/mobile-analyze-validation.test.ts` — the mobile core-journey endpoint validated summary + arrays but NOT style_name/design_direction (rendered verbatim in their own result cards); a partial LLM response → blank cards, no error, no retry. Now fails loud (500, mirroring the summary guard) so the client's non-200 path shows the retryable error. 6-case route test (vi.hoisted mocks for auth/gemini/extract; real rate/spend limiters w/ unique user id per test); both reviewers independently mutation-verified.

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default. Final merged-tree gate GREEN: tsc clean, **2143 tests** (2136 +7: 6 mobile-analyze + 1 calibration), determinism, `eslint .` 0 (whole repo), mobile `tsc --noEmit` clean.
- **No ROADMAP box ticked** — DEEP AUDIT (F5) is a recurring cadence not a per-run checkbox; A3/F2 already [x]; F4.1 needs the full seeded-E2E harness (not this hardening). **No migrations, no secrets, no new PENDING_OPS** (Stripe price IDs already tracked).

### Lessons learned
1. **A scout "missing field guard" on a client screen is usually best fixed at the SERVER contract, not the client** — the web route has a test harness (mutation-provable) and it's the root cause; mobile/ has NO test harness, so a client-only guard would ship untested. The mobile results-screen blank-card risk was closed by hardening `/api/mobile/analyze` instead.
2. **Intentional CSS-free crash boundaries (global-error.tsx) must NOT be "design-system-ified."** An a11y scout flagged its hardcoded hex/inline styles, but that surface deliberately avoids Tailwind/token dependencies so it renders when the app (and its CSS) has errored — converting it to tokens reduces robustness. Anti-fix, dropped.
3. **Blanket `npm audit fix --force` is not autonomous-merge-safe when the remediation pulls a canary major** (here Next.js 16.2.4 → 16.3.0-canary). A dep-security bump on a runtime framework needs human-in-loop testing; noted, not shipped.
4. **A stale QUALITY_SCORECARD finding may already be fixed** — the as_of-07-13 mockups product_ids/bundle_id IDOR is bound to room_id in the current tree; verify scorecard findings against HEAD before treating them as open work.

### Rotation guide for next run
- **DEEP AUDIT ran Run 95 (2026-07-17) — next due ~Run 99** (or >24h/~4 runs). Next few runs can lean on scouts + scorecard.
- **Named disjoint follow-ups still open (verified, buildable, headless-safe):**
  - **cron double-send (F4.1)** — activation/habit/winback crons SELECT→SEND→INSERT; a crash between send and insert double-sends on at-least-once retry. Fix = claim-before-send (INSERT the (user_id,stage) row first; unique constraint lets one run win) + compensating DELETE on send-failure. 3 near-identical files; decide drop-vs-dup policy. No new migration.
  - **saved-designs `project` metadata read (:145)** is intentionally best-effort (LEFT); audit remains that no OTHER persisted read in the file/siblings ignores its error.
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS `cutover-to-persistent-data`); design_taste (authed-axe on seeded diagnosis/mockups + F7 committed screenshots — needs push-and-watch-CI + seeded LLM); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE).
- **G4 server-side login lockout is buildable but architectural + headlessly-unverifiable** (login is client-side direct-to-Supabase; a server login route's cookie/session handling can't be functionally proven with mocked auth) — DEFERRED, not a safe autonomous-merge bet without the seeded-E2E harness.
- **DO-NOT-RE-FLAG:** global-error.tsx CSS-free crash boundary (intentional); topbar step-indicator + emerald (decorative/intentional token churn); npm-audit --force (canary Next.js, human-gated); mockups product_ids/bundle_id IDOR (FIXED — bound to room_id); + carry prior lists (diagnosis project-fetch `project?.` graceful degradation; lookupDurability prefix-strip not mutation-provable; web.ts invalid-date parse dead; soft save-count race documented-intentional; mobile hardcoded LED/splash colors correct; LABELED_DIMENSION_REGEX `inches?` dead; bundle-math coffee-table band + spatial-math undersized-room guard intentional; product-scorer category branch covered).


## Run 2026-07-17 (Run 96) — 6 file-disjoint value-bar changes: baseline test-fragility fix (F1) + cron double-send claim-before-send (F4.1) + cache-bound coverage (F2) + web auto-renewal disclosure (D4) + web privacy retention disclosure (D2) + account cancel-path dead-end fix (D). ALL 6 both-Sonnet-APPROVED (4 changes needed a 2nd review cycle; every REQUEST_CHANGES was a REAL gap, fixed).

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-x8mxw7` at origin default tip `448efe2` (Run 95 #651), 0/0 divergence vs `claude/ai-apartment-design-app-iHAdb`. `npm install` root. DEEP AUDIT NOT due (ran Run 95; next ~Run 99) → ran a 6-Haiku-scout sweep.
- **BASELINE GATE RED on entry (8 failing tests) — investigated FIRST, before any new work.** `__tests__/ai/deepseek-conversion.test.ts` 8/8 body-asserting tests failed locally with `lastRequestBody()` → undefined. ROOT CAUSE (proven by instrumenting the fetch mock, not guessed): the Margin telemetry emit (#603) fires a TRAILING `fetch` to the ingest endpoint whenever `getMeter()` is live — `MARGIN_INGEST_KEY` set AND not offline (`isOffline()` = `process.env.CI` or `E2E_AUTH_STACK`). Locally MARGIN_INGEST_KEY is set + CI unset → meter live → 2 fetch calls per `.chat()`; the test's `.at(-1)` grabbed the telemetry POST (body `{workflow_id,provider,...}`, no `.messages`), not the DeepSeek request. CI stays green because CI=1 disables the meter. So the suite was green in CI but silently red for any local dev with the key exported — masking real regressions + blocking local verification. **Lesson applied: fix the test, don't paper over "just my env".**

### Scout sweep (6 Haiku lenses, read-only)
- **security/RLS: CLEAN** — all migrations through 029 ENABLE RLS (tenant→auth.uid(), shared/internal→RLS+no-policy); handle_new_user search_path pinned (024); all 30 getAdminClient sites legitimately shared/internal & auth/sig/token-gated; all write/LLM/auth routes rate-limited; no IDOR/secret leak. Next migration 030.
- **web perf: CLEAN** — hot paths already parallelized; remaining sequential awaits are dependent chains; no meaningful win → no churn shipped.
- **cron/side-effect (F4.1):** confirmed double-send in all 3 lifecycle crons (SELECT→SEND→INSERT) → SHIPPED claim-before-send. DROPPED/deferred: webhook fire-and-forget (intentional waitUntil + previousStatus guard); waitlist confirm UPDATE-before-SEND (one-time token, low value).
- **test/eval coverage (F2):** ONE real mutation-provable gap — lookupColorAsync 500-entry cache eviction untested → SHIPPED.
- **mobile Expo:** all candidates belt-and-suspenders/low-value on an untested harness → NONE shipped (consistent with Run 95 lesson).
- **store readiness/compliance (D):** headless-buildable real gaps — web Pro-monthly auto-renewal disclosure MISSING (D4); web privacy page had NO retention section while docs/app-privacy.md documents it (D2); a Gate-2 reviewer surfaced a THIRD: the /account cancel path points only to the gated (502) Stripe portal with a dead-end error → SHIPPED all three. Human-gated (screenshots, iOS plist verification, store-console support email) recorded as already-tracked.

### Shipped — 6 file-disjoint value-bar changes (all both-Sonnet-APPROVED)
- **(1) TEST-FRAGILITY/F1** `__tests__/ai/deepseek-conversion.test.ts` — `lastRequestBody()` now selects the fetch whose URL starts with `https://api.deepseek.com` instead of `.at(-1)`, so a live Margin telemetry emit can't shadow the model request. 13/13 pass locally (were 5/13) AND in CI. No production code touched; guard tests untouched. Both reviewers empirically reproduced the failure + confirmed the fix.
- **(2) RELIABILITY/F4.1** `app/api/cron/{activation,habit,winback}-emails/route.ts` + new `__tests__/api/cron-activation-emails.test.ts` (route had NO test) + habit/winback tests — CLAIM-BEFORE-SEND: INSERT the (user_id,stage) marker BEFORE the send (unique constraint from migration 025 = one winner); duplicate-key → skip (never send); other insert error → skip+error; send-failure → compensating DELETE so a later run retries. Converts at-least-once double-send (crash between send & insert) into at-most-once. **2nd review cycle:** both reviewers flagged a real dry_run-accuracy regression (sendEmail also force-dry-runs a marketing stage when EMAIL_PHYSICAL_ADDRESS is unset — the anticipated near-term deploy state — so a claim-time isEmailDryRun() snapshot records `false` for a suppressed send) → fixed by reconciling dry_run to the authoritative `result.dryRun` after send (targeted UPDATE only on mismatch; unique constraint guarantees the right row), + 2 mutation-provable reconcile tests. +15 tests total.
- **(3) TEST/F2** `__tests__/validation/lookup-color-cache.test.ts` (NEW) — covers the untested 500-entry eviction of the in-process LLM color cache in lookupColorAsync. Mutation-verified (if(size>500)→if(false) fails the eviction test). Both reviewers independently re-ran the mutation + verified the cross-test module-state coupling is sound (no sequence.shuffle, per-file module isolation).
- **(4) COMPLIANCE/D4** `app/pricing/page.tsx` — auto-renewal footnote on the Pro ($49/mo recurring) tier, previously the only recurring tier with NO disclosure. **2nd review cycle:** original "cancel anytime" overclaimed a self-serve portal that's gated (502, PENDING_OPS) → tightened to "Billed monthly. Renews automatically until you cancel." (discloses the auto-renewal fact without the frictionless-self-serve promise; cancellation is real via support).
- **(5) COMPLIANCE/D2** `app/privacy/page.tsx` — new "How long we keep it" retention section, grounded in docs/app-privacy.md. **2nd review cycle:** original single bullet overclaimed item-level deletion for account-data/design-history → split into 4 precise clauses (item-level delete scoped to room photos only, matching the doc + the page's own "Your rights").
- **(6) COMPLIANCE/D** `app/account/subscription-card.tsx` — the account "Subscription & billing" card said "cancel anytime through Stripe's billing portal" but the portal 502s until activated (PENDING_OPS) and the error branch dead-ended with "try again". Now presents the working email-support path (hello@aptdesignerai.com) in both the copy and the failure state. **2nd review cycle:** first version collapsed 401/429/500/502 into one "portal unavailable" string (wrong for throttle/re-auth) → made status-aware (email fallback only for 502 + network catch; 401/429/500 keep the route's hygienized message), + mailto styling matched to app convention.

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default. Final merged-tree gate GREEN: tsc clean, **2161 tests** (2143 +18), determinism, `eslint .` 0 (touched), mobile `tsc --noEmit` clean (untouched). package-lock fsevents dev:true install artifact reverted.
- **No ROADMAP box ticked** — F4.1 needs the full seeded-E2E harness; F1/F2 already [x]; D2/D4/D-cancel-path are partial-surface compliance polish, not a full Track D item. **No migrations, no secrets, no new PENDING_OPS** (unique constraint already in migration 025; the Stripe portal activation + store screenshots/plist/support-email remain the SAME already-tracked human-gated items).

### Lessons learned
1. **A baseline test green in CI but red locally is a real bug, not "just my env."** The deepseek suite used `.at(-1)` of all fetch calls; #603's telemetry emit added a trailing fetch that only fires when the Margin meter is live (MARGIN_INGEST_KEY set + CI unset), so CI (CI=1 → meter off) never saw it. Select the call by URL — durable fix. Instrument the mock to PROVE the cause before changing anything.
2. **Claim-before-send is the right shape for at-least-once cron side-effects, but recording provider metadata (dry_run) at claim time is a trap** — `sendEmail` has a SECOND dry-run trigger (missing physical address) that a pre-send `isEmailDryRun()` snapshot misses. Treat the send's own `result.dryRun` as authoritative and reconcile after.
3. **Compliance/marketing copy must be honest about CURRENTLY-WORKING mechanisms, not intended ones.** Two changes (pricing "cancel anytime", account portal copy) overclaimed a self-serve cancel that 502s today; the honest fix discloses the auto-renewal fact + points to the support channel that actually works now. Ground retention/deletion claims in the source-of-truth doc precisely (item-level delete scoped to what's real).
4. **Every REQUEST_CHANGES this run named a REAL gap (4 of 6 changes needed a 2nd cycle) — the maker≠checker split earned its keep.** None were style nits; each was a factual overclaim or a correctness regression a solo pass would have shipped.

### Rotation guide for next run
- **DEEP AUDIT ran Run 95 (2026-07-17) — next due ~Run 99** (or >24h/~4 runs).
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS); design_taste (authed-axe + F7 committed screenshots); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + ANNUAL_BILLING_ENABLED=true, OR a real conversion-lift FEATURE).
- **DO-NOT-RE-FLAG (carry prior lists +):** deepseek-conversion `.at(-1)` (FIXED — URL-filtered); cron double-send (FIXED — claim-before-send + dry_run reconcile, all 3); lookupColorAsync cache eviction (COVERED); web pricing Pro renewal disclosure (SHIPPED); web privacy retention (SHIPPED); account subscription-card cancel dead-end (SHIPPED — email fallback); + all prior carried non-issues (global-error CSS-free boundary; topbar step-indicator + emerald; npm-audit --force canary; mockups IDOR fixed; diagnosis project?. graceful; lookupDurability prefix-strip; web.ts invalid-date dead; soft save-count race; mobile hardcoded LED/splash; LABELED_DIMENSION_REGEX inches dead; bundle-math coffee-table band + spatial-math undersized guard intentional; webhook fire-and-forget intentional; waitlist confirm UPDATE-before-SEND low-value).
- **Named related follow-up (NOT yet built, buildable):** the annual-billing upsell block in pricing (app/pricing/page.tsx:186-193, gated behind isAnnualBillingEnabled()) still contains a "Cancel anytime." string that will resurface the same self-serve-portal overclaim when ANNUAL_BILLING_ENABLED flips — tie its activation to the Stripe portal being live, or soften it, when annual ships.


## Run 2026-07-18 (Run 97) — 4 file-disjoint value-bar changes: store-compliance disclosures (D4/D) + mobile cross-user privacy (photo-session) + Track F2 validation branch coverage. ALL 4 both-Sonnet-APPROVED, 0 re-review cycles; 2 non-blocking reviewer suggestions folded in.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-inqmdk` at origin default tip `28b708a` (Run 96 #652 / §45 doc #653), 0/0 divergence vs `claude/ai-apartment-design-app-iHAdb`. `npm install` root + `cd mobile && npm install`. DEEP AUDIT NOT due (ran Run 95; next ~Run 99) → 8-Haiku-scout sweep.
- Baseline gate GREEN on entry: tsc clean, **2161 tests**, determinism, eslint 0.
- **MOBILE TSC GOTCHA (record for next run):** in a cold container, `cd mobile && npx tsc --noEmit` fails with ~151 errors — root web-only `@types` (google.maps/react-dom/phoenix, DOM-lib) auto-included + every RN/expo module unresolved ("Cannot find module 'react-native'") — because /mobile has NO local node_modules yet. IDENTICAL failure on a `git stash`-clean tree → 100% ENVIRONMENTAL, not a regression. FIX: `cd mobile && npm install` first, then tsc exits 0. Always install mobile deps before trusting a mobile typecheck.

### Scout sweep (8 Haiku lenses, read-only) — mostly CLEAN/dropped, converged small
- **security/RLS: CLEAN** — mockups product_ids/bundle_id IDOR already FIXED at HEAD (bound to room_id, route.ts:554-584, rejects unowned); all migrations ENABLE RLS through 029 (next 030); admin-client sites shared/internal; no secret leak.
- **web-reliability: 3× `.single()`→`.maybeSingle()` candidates DROPPED** — memory-store `.single()` returns `{data: rows[0]||null, error: null}` (line 235 — NEVER throws, error ALWAYS null); code reads only `.data` (null-safe via `?.`), so score/search-without-diagnosis is intentional graceful degradation, no crash under EITHER backend. Scout's premise (`.single()` errors/throws on 0 rows → silent failure) is false here.
- **design/a11y: 5× hardcoded emerald/amber→token DROPPED** — decorative/intentional semantic status colors (prior runs already flagged topbar emerald as intentional); "indirect" contrast = not a real WCAG fail → token churn.
- **marketing: 5× strategy-DOC candidates DROPPED** — PAYWALL_COPY/SEO/REFERRAL/SOCIAL_PROOF strategy docs don't move a funnel metric or change product behavior → below the value bar (business_case needs a real conversion FEATURE, not a doc).
- **AI-pipeline: 5× DROPPED** — 3 were BACKWARDS (proposed LOW→HIGH thinking increases in room-diagnostician/architecture-extractor/refine-summarizer judge/summarizer sub-steps — VIOLATES cheapest-by-default cost contract + harness-ratchet; a sub-step of a HIGH task legitimately runs cheap); 1 low→minimal extraction (unverifiable quality change, no eval keys); 1 computer-use agent-loop missing seed/timeout (drives a LIVE Browserbase browser — inherently non-deterministic so a seed is meaningless, already wall-clock-guarded, uses the SDK directly BY DESIGN for computer-use features, unrunnable headlessly → architectural guess, dropped).
- **store-compliance: 3 shipped-worthy, 1 dropped** — upgrade-page auto-renewal (SHIPPED), mobile paywall recurring price (SHIPPED); app.json `notificationPermissionDescription` DROPPED (verified via Expo v56 docs — iOS notifications need NO usage description; that plugin key does not exist — WebFetch check saved a bogus change); web terms-checkbox #4 dropped (speculative + same-file collision with the auto-renewal change).
- **test-coverage: 5 candidates → selected 2** (set-math price mid-band + dining-table 5-chair); dropped budget-boundary (marginal `<` vs `<=`), side-table (scout line numbers didn't match HEAD), escalation multi-tier (kept batch focused).
- **mobile-Expo: 1 real bug** — photo-session cross-user leak (SHIPPED, see below); everything else clean per the scout.

### Shipped — 4 file-disjoint value-bar changes (all both-Sonnet-APPROVED)
- **(1) COMPLIANCE/D4** `app/billing/upgrade/page.tsx` — auto-renewal disclosure at the checkout/upgrade entry (Apple 3.1.2 / Google Play); pricing page had it, the actual checkout entry didn't; one-time Apartment tier shows none; type-safe `"renewalNote" in copy` over the `as const` union.
- **(2) COMPLIANCE (mobile)** `mobile/src/components/paywall-sheet.tsx` — paywall legal text now discloses the recurring price+period (Apple 3.1.2(a)) via the already-shown `selectedOption.price`, tracking the selected plan; safe fallback pre-offering-load; wording polished (dropped a "cancel…cancel" repetition both reviewers flagged).
- **(3) PRIVACY/correctness (mobile)** `photo-session.ts` + `settings.tsx` + `use-session.ts` — module-scope pending photo/room-type outlived the auth session → shared-device cross-user leak (results.tsx reads via non-consuming `peek*` on mount). Added `clearPendingSession()`, called on both Settings sign-out/delete success paths AND (both reviewers' one substantive suggestion) at the ROOT `onAuthStateChange` SIGNED_OUT boundary — covers forced/token-expiry sign-outs the UI handlers miss.
- **(4) COVERAGE/F2** `__tests__/validation/pairwise-proportions.test.ts` + `set-math.test.ts` — 5-chair dining-table seat-length (odd count kills a `(chairs-2)`→`(chairs-3)` off-by-one the 6-chair tests can't) + duplicate price-proximity mid-band (10–20%; existing test only hit <10%). D-correctness reviewer empirically sed-mutated both → confirmed only-new-fails → reverted.

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default. Final merged-tree gate GREEN: web tsc clean, **2163 tests** (2161 +2), determinism, `eslint .` 0 (touched); mobile tsc + eslint clean (deps installed).
- **No ROADMAP box ticked** — D4/D is partial-surface compliance polish (not a full Track D item); F2 already [x]; the privacy fix is correctness hardening, not a specific box. **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **A `.single()`-vs-`.maybeSingle()` "silent failure" candidate is only real if the code reads `.error`.** Here it reads only `.data` (null-safe) and the memory store never errors → intentional graceful degradation. Check the actual store behavior (memory-store.ts:235) before trusting the scout's premise.
2. **An AI-pipeline scout proposing LOW→HIGH thinking is usually BACKWARDS** under cheapest-by-default. A judge/summarizer sub-step of a HIGH task legitimately runs cheap; increasing it violates the cost contract + harness-ratchet. Only low→lower (toward the contract) or a real determinism/timeout hole clears the bar.
3. **Verify config-key candidates against the versioned SDK docs before adding.** The proposed iOS `notificationPermissionDescription` doesn't exist in Expo v56 and iOS notifications need no usage string — a 1-lookup WebFetch killed a bogus change.
4. **Cold-container mobile tsc fails environmentally** (root web-only @types + missing RN modules) until `cd mobile && npm install`; a stashed-clean tree showing the identical failure proves it's not a regression.

### Rotation guide for next run
- **DEEP AUDIT last ran Run 95 (2026-07-17) — next due ~Run 99** (or >24h/~4 runs). Run 96/97 leaned on scouts + scorecard.
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS `cutover-to-persistent-data`); design_taste (authed-axe on seeded diagnosis/mockups + F7 committed screenshots — needs seeded-LLM E2E + push-and-watch-CI); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE).
- **DO-NOT-RE-FLAG (carry prior lists +):** upgrade-page auto-renewal (SHIPPED); mobile paywall recurring-price disclosure (SHIPPED); photo-session cross-user leak (FIXED — cleared on both UI paths + root SIGNED_OUT); set-math mid-band + dining 5-chair coverage (SHIPPED); app.json notification purpose-string (BOGUS — no such Expo key, iOS needs none); web `.single()`→`.maybeSingle()` on diagnosis reads (NON-ISSUE — reads only `.data`, memory store never errors, intentional graceful degradation); design emerald/amber status colors (intentional token, DO NOT tokenize); marketing strategy-docs (below bar — need a real FEATURE); AI-pipeline judge/summarizer LOW thinking (CORRECT per cost contract — do NOT raise to HIGH); computer-use agent-loop seed/timeout (live-browser, non-deterministic + unrunnable headlessly); + all prior carried non-issues (global-error CSS-free boundary; npm-audit --force canary; diagnosis project?. graceful; lookupDurability prefix-strip; web.ts invalid-date dead; soft save-count race; mobile hardcoded LED/splash; LABELED_DIMENSION_REGEX inches dead; bundle-math coffee-table band + spatial-math undersized guard intentional; webhook fire-and-forget intentional; waitlist confirm UPDATE-before-SEND low-value).
- **Named buildable follow-up (NOT yet built):** mobile paywall `packagesToOptions` else-branch (non-annual/non-monthly RC package types) yields a price with NO period suffix — a latent 3.1.2(a) gap + wrong for a LIFETIME package; both B reviewers flagged it. Only reachable if the RC offering ever adds a 3rd package type (today annual/monthly only) — build when/if the catalog grows.


## Run 2026-07-18 (Run 98) — 4 file-disjoint value-bar changes: 1 correctness bug (dead-branch in set-math tier scoring) + 1 store-compliance doc (D) + 2 Track-F2 validation coverage tests. ALL 4 both-Sonnet-APPROVED, 0 re-review cycles.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-qyigp3` reset to origin default tip `444af98` (Run 97 #655 + FACTORY_STANDARD doc commits #656-#660), 0/0 divergence vs `claude/ai-apartment-design-app-iHAdb`. `npm install` root (no /mobile changes this run → mobile deps not needed). Baseline gate GREEN: tsc, **2163 tests** / 11 skip, determinism, eslint 0.
- DEEP AUDIT NOT due (ran Run 95; next ~Run 99) → full 8-Haiku-scout sweep.
- **Scorecard (DATA, as_of 2026-07-13):** overall C, ship_gate false; three ship_critical below A unchanged & human/CI-gated (functional_reality C — DATA_BACKEND cutover; design_taste B; business_case_strength B). GROWTH pre_launch 0/null → no lever signal.

### Scout sweep (8 Haiku lenses, read-only) — converged small, mostly CLEAN
- **security/RLS: CLEAN** — migrations ENABLE RLS through 029 (next 030); admin-client sites shared/internal & gated; no IDOR/secret leak; mockups IDOR still fixed at HEAD.
- **monetization: CLEAN** — server-side `hasProEntitlement(Web)` before body parse; Stripe webhook HMAC-verified BEFORE DB access + `normalizeBillingTier` + idempotent upsert; fail-closed on misconfig; annual gated; prices consistent code↔pricing↔mobile.
- **design/a11y: CLEAN** — focus-visible rings, htmlFor labels, icon-button aria-labels, img alts, Lucide (no emoji-as-UI); warm-editorial tokens consistent; no vibe-code.
- **AI-pipeline: 1 flagged → DROPPED.** mockup-agent.ts:504 `options.thinkingLevel || "high"` is IMAGE generation (`responseModalities:["Text","Image"]`, gemini-3-pro-image) NOT a text task — the fallback deliberately uses HIGH to "match Pro's composition reasoning" on the flagship mockup output. The cheapest-by-default HIGH restriction governs TEXT tasks; it does not apply to the image modality. Same modality-confusion class Run 97 rejected (LOW→HIGH backwards). DO NOT lower.
- **web-reliability: DROPPED.** `createAgentRun` throws on DB error and is awaited outside the try in ~9 routes — but a route-handler throw in Next.js App Router is FRAMEWORK-caught → a 500, NOT a process crash. Raw-vs-hygienized-500 is marginal across a 9-file blast radius. Not worth the churn/risk.
- **mobile-Expo: DROPPED.** Only finding = AsyncStorage `markSaved()` write-failure after a successful server save → quota divergence on retry. Fix is genuinely client-side (/mobile has NO test harness → ships untested) on a rare edge; server contract already enforces the true limit. Deferred.
- **test-coverage: 6 boundary candidates** → selected 2 (proportion-math tolerance boundary; direction-distance whole-untested issue branch). Dropped bundle-math wood-species (mutation only affects the issue message at exactly 2 species — score unchanged, weakest), set-math `<0`→`<=0` boundary (mooted by the dead-branch bug below), palette/footprint boundaries (kept batch tight — avoid boundary-test padding).
- **store-compliance: 3 candidates** → shipped store-listing.md disclosures; the mobile paywall line-298 "unless you cancel before it ends" clarity was borderline copy-polish on a file touched Run 97 → dropped.

### Shipped — 4 file-disjoint value-bar changes (all both-Sonnet-APPROVED; 8 reviews, 0 re-review cycles)
- **(1) CORRECTNESS** `lib/validation/set-math.ts` + `__tests__/validation/set-math.test.ts` — `computeTierDifferentiation` guarded `if (separation < 0.2) {weak −0.2} else if (separation < 0) {inverted −0.3}`. Every negative separation is ALSO `< 0.2`, so the first branch always matched → the inverted-pricing branch was **unreachable dead code**: a bundle whose upper tier is priced CHEAPER than its lower tier was mislabeled "weak separation", under-penalized (−0.2 not −0.3), and the "inverted pricing" diagnostic never reached users. Reordered so `separation < 0` is checked first (weak-positive `< 0.2` unchanged). Mutation-provable test: budget median $600 / high_end $300 → separation −0.5 → emits "inverted pricing" + tier_differentiation 0.7 (old buggy order gave "weak separation" + 0.8). Reviewer A traced: reorder strictly narrows the 2nd branch's domain to `[0, 0.2)` — cannot change any reachable non-inverted case; only call site is computeSetMathScores.
- **(2) COMPLIANCE/D** `docs/store-listing.md` — added subscription auto-renewal disclosure (Apple 3.1.2 / Google Play) + in-app account-deletion path to BOTH the Apple and Google Play listing sections. Wording verified against the SHIPPED app: mobile settings.tsx already tells users to cancel via "App Store (Settings → your name → Subscriptions) / Google Play (Play Store → Payments & subscriptions)" (IAP, NOT the web Stripe portal), and has a real "Delete account" action → DELETE /api/mobile/account (route exists, cascades). No overclaim; does not reintroduce the removed self-serve web-portal claim. Both B reviewers confirmed honesty + char limits fine.
- **(3) F2** `__tests__/validation/proportion-math.test.ts` — covers a height sitting EXACTLY on the tolerance boundary (deviation == tolerance; side_table target 26 ±2 at 28"). Guard is strict `>`, so boundary is in-spec (no issue, full marks). The issue-ABSENCE assertion is what kills the `>`→`>=` mutant — the SCORE is unchanged at the boundary because the penalty `min(0.2,(dev-tol)/10)=0`. Verified by mutation.
- **(4) F2** `__tests__/validation/direction-distance.test.ts` — the "Style vocabularies barely overlap" (`styleJ < 0.10`) diagnostic branch had ZERO prior assertions (grep-confirmed; a VISION cross-room-coherence signal). Disjoint-vocab fixtures (brutalist-loft vs coastal-cottage; notes+textures+furniture feed tokenizeStyle) → Jaccard 0 → issue fires. Mutation-provable (`<0.10`→`<0` fails only this). Loose asserts (`<0.1`, regex) → not brittle.

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default (code + this bookkeeping). Merged-tree gate GREEN: tsc clean, **2166 tests** (2163 +3), determinism, `eslint .` 0. No /mobile source touched. package-lock `npm install` artifact reverted.
- **No ROADMAP box ticked** — the set-math fix is a correctness bug (not a checkbox); F2 already [x]; D3 store-assets still needs real icon/screenshots (not headlessly buildable), so the listing-copy disclosure is partial-surface D polish, not a full box. **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **An AI-pipeline scout flagging HIGH thinking on `mockup_image` is a MODALITY confusion, not a cost-contract violation.** The cheapest-by-default HIGH restriction governs TEXT tasks; mockup IMAGE generation (`responseModalities:["Text","Image"]`, gemini-3-pro-image) uses HIGH for composition reasoning on the flagship visual output BY DESIGN (the non-Pro fallback explicitly "match[es] Pro's composition reasoning"). Do NOT lower it. (Extends the Run-97 lesson that LOW→HIGH proposals are usually backwards — here even HIGH→LOW is wrong because it's not a text task.)
2. **A dead/unreachable branch can hide a real under-penalization bug, not just cosmetic dead code.** set-math's `else if (separation < 0)` looked like harmless dead code but meant inverted pricing was silently scored as merely "weak" — the fix restores both the correct penalty AND a user-facing diagnostic. Ordering of `<0` vs `<0.2` guards is load-bearing; the comment now says why.
3. **A `createAgentRun`-throws-outside-try finding is mostly a non-issue in Next.js App Router** — a handler throw is framework-caught → 500, not a process crash. Only worth hardening if it leaves inconsistent state or bypasses a timeout; a raw-vs-hygienized 500 across 9 files is churn.
4. **Keep boundary-test batches tight.** 6 boundary candidates surfaced; only 2 cleared the bar as genuine (one whole-untested branch, one plausible-input boundary with a user-facing issue effect). Dropped the ones whose mutant only changed an issue message with no score effect, or whose boundary value is unreachable in practice — avoid padding a run with marginal boundary nudges.

### Rotation guide for next run
- **DEEP AUDIT last ran Run 95 (2026-07-17) — next due ~Run 99** (>24h/~4 runs elapsed). Runs 96/97/98 leaned on scouts + scorecard; run the 8-lens holistic audit next run.
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS `cutover-to-persistent-data`); design_taste (authed-axe + F7 committed screenshots — seeded-LLM E2E + push-and-watch-CI); business_case_strength (without-annual ARR ~$99.9K < $100K floor — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE).
- **DO-NOT-RE-FLAG (carry prior lists +):** set-math inverted-pricing dead branch (FIXED — reordered); store-listing auto-renewal + account-deletion disclosures (SHIPPED both platforms); proportion-math tolerance-boundary + direction-distance barely-overlap coverage (SHIPPED); mockup-agent.ts:504 HIGH (INTENTIONAL image-composition — NOT a text-contract violation, do NOT lower); createAgentRun outside-try (framework-caught 500, churn — do NOT sweep); mobile AsyncStorage quota-divergence (untested-client edge, deferred); bundle-math wood-species 2-boundary (weak — score unchanged); + all prior carried non-issues (global-error CSS-free boundary; topbar step-indicator + emerald; npm-audit --force canary; mockups IDOR fixed; diagnosis project?. graceful; `.single()`→`.maybeSingle()` on memory-store reads NON-ISSUE; lookupDurability prefix-strip; web.ts invalid-date dead; soft save-count race; mobile hardcoded LED/splash; LABELED_DIMENSION_REGEX inches dead; bundle-math coffee-table band + spatial-math undersized guard intentional; webhook fire-and-forget intentional; waitlist confirm UPDATE-before-SEND low-value; mobile paywall packagesToOptions else-branch — only if RC catalog grows a 3rd package type).


## Run 2026-07-19 (Run 99) — DEEP AUDIT (8-lens, due) + 5 file-disjoint value-bar changes. ALL 5 both-Sonnet-APPROVED, 0 re-review cycles; 1 non-blocking reviewer suggestion folded in.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-nv7vpc` reset to origin default tip `2408144` (Run 12 growth #665), 0/0 divergence vs `claude/ai-apartment-design-app-iHAdb`. `npm install` root + `cd mobile && npm install` (paywall change). Baseline gate GREEN: web tsc, **2166 tests** / 11 skip, determinism, `eslint .` 0 errors (19 pre-existing WARNINGS live only in the vendored `.agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js` — NOT touchable, expected).
- **DEEP AUDIT was DUE** (last ran Run 95; Runs 96/97/98 leaned on scouts) → ran the 8-lens holistic sweep this run.
- Scorecard (DATA, as_of 2026-07-13 — STALE, pre-dates the mockups IDOR fix so its security_rls=A is understated): overall C, ship_gate false; three ship_critical below A unchanged & human/CI-gated (functional_reality C — DATA_BACKEND cutover; business_case_strength B — without-annual ARR ~$99.9K<$100K OR a conversion FEATURE; design_taste B — seeded-E2E authed-axe + F7 screenshots). GROWTH pre_launch → no lever signal.

### DEEP AUDIT — 8 Haiku scouts, WHOLE codebase (not just recent diff)
- **security/RLS: CLEAN** — all migrations ENABLE RLS through 029 (next 030); tenant tables USING+WITH CHECK on auth.uid(); shared/internal tables RLS+no-policy (service-role only); mockups product_ids/bundle_id IDOR still fixed at HEAD (bound to room_id); Stripe webhook HMAC verified before DB; cron/growth-metrics constant-time token; no hardcoded secret / SQLi / trust-the-client entitlement.
- **artifact-freshness: CLEAN** — pricing $29/$49-mo/$399-yr identical across README/BUSINESS_CASE/store-listing/code; 4 ARR scenarios reproducible from analysis/figures.json (within tolerance); annual billing documented gated-off in BOTH doc + code (ANNUAL_BILLING_ENABLED default false, migration 021 pending); TEXT_TIERS.mid = Gemini 3.1 Flash Lite matches models.ts; no stale claim (the old email-lifecycle "mockups coming this quarter" already fixed a prior run). Deps healthy (strict tsc, 0 `as any` in lib/ai|billing|agents, Stripe pinned 2026-05-27.dahlia).
- **monetization: CLEAN** — server-side hasProEntitlement(Web) gating, account-deletion web (/api/user/delete) + mobile (DELETE /api/mobile/account) cascade, price consistency, checkout awaits real webhook entitlement grant.
- **mobile: CLEAN** — session isolation (clearPendingSession on SIGNED_OUT + explicit sign-out), save side-effect awaits server+markSaved (no optimistic success), permission strings present, timeouts+abort on all requests. Only finding = LOW best-practice explicit accessibilityLabel on 3 results.tsx buttons → DROPPED (RN reads the ThemedText child; not a rejection criterion).
- **web-reliability/perf: 5 sequential-DB parallelizations found → ALL DROPPED.** diagnosis / search-stream setup+teardown / products-evaluate / bundles-evaluate each parallelize 2-3 trailing/independent DB writes saving ~150ms — but on paths dominated by a multi-second LLM call that's ~3% of total (NOT the whole-page-load 3-4x the dashboard-parallelization anchor cleared). Batching 5 similar micro-opts is exactly the "~40ms micro-opt BORDERLINE — standalone only, never batch padding" tier. maxDuration + external timeouts all verified present (Tavily 15s, embeddings 10s, files-cache 15s).
- **correctness: 1 REAL bug** (analyze-apartment synthesis, SHIPPED below). Everything else verified clean (timeouts, DB error checks, ownership guards, no div-by-zero, env fail-loud).
- **test-coverage: 8 untested branches** → selected the 2 strongest WHOLE-untested rules (ergonomics pendant-height + counter-gap, SHIPPED); deferred the direction-distance middle-band / harmony-math bonus-tier / outlet-reach vague-position ones (real but lower-leverage; avoid a coverage-padding batch).
- **monetization/store: paywall cancellation-method** (SHIPPED below) + ToS/privacy/fallback-price low items DROPPED (mitigated/clarity-only/server-authoritative).

### Shipped — 5 file-disjoint value-bar changes (all both-Sonnet-APPROVED)
- **(1) CORRECTNESS** `app/api/analyze-apartment/route.ts` + `__tests__/api/analyze-apartment-persistence.test.ts` — synthesis input built from the `room_type`-keyed `analysisRooms` map (last-same-type-wins) → for two bedrooms, both fed the LAST bedroom's summary into the LLM cross-room-coherence synthesis; the persistence loop was already index-aligned via `roomResults[i]` (with a comment warning against exactly the map lookup) — synthesis now matches it. Mutation-provable: reverting to `analysisRooms[r.room_type]` fails the new assertion that the synth prompt contains BOTH ROOM_A_ANALYSIS and ROOM_B_ANALYSIS. **Named follow-up (both reviewers, NOT blocking):** the STORED `analysis.rooms` overview map is still room_type-keyed and collapses duplicates — but its only downstream consumers (area-analysis:269, refine:132, validation-agent:71, build-profile:44) `JSON.stringify` it WHOLE, never index by room_type key, so it's a completeness gap (one same-type room's summary dropped from the coarse overview text), NOT a misattribution bug → acceptable minimal scope; fix later by keying the overview by room.id or making it an array.
- **(2) A11y/WCAG-1.3.1** `components/projects/floor-plan-upload-zone.tsx` — react-dropzone file input had no accessible name; added `aria-label="Upload floor plan image or PDF"` (accurate to accept: image/* + application/pdf, maxFiles:1). getInputProps() sets no aria-label (reviewer confirmed from react-dropzone source) → no conflict.
- **(3) A11y/WCAG-1.3.1** `app/dashboard/page.tsx` — room-photo dropzone on the core onboarding upload had no accessible name; added a room-specific `aria-label={`Upload photos for ${section.label}`}` (folded in reviewer A's non-blocking suggestion — the input renders once per room section, so a distinct label helps AT).
- **(4) COVERAGE/F2** `__tests__/validation/ergonomics.test.ts` — +5 tests for the two ENTIRELY-untested rules: `pendantHeightRule` (30-36" bottom-to-surface; too-low<30 + too-high>36 + a pass case) and `counterUpperRule` (15-20" counter→upper-cabinet gap; too-low<15 + too-high>20). Fixtures use plausible specs+placement text that actually match the rules' parse regexes (verified: "72 x 36 x 30 inches" → parseDimensions height=30; "28 in above the dining table" / "13 in above the counter" match). Both reviewers independently ran the mutation (thresholds→true) → 4 of 5 fail as expected.
- **(5) COMPLIANCE/D** `mobile/src/components/paywall-sheet.tsx` — paywall legal text disclosed price+period but not the cancellation METHOD; Apple 3.1.2(v) + Google Play require disclosing HOW to cancel at point of purchase → added "Manage or cancel anytime in your App Store or Google Play subscription settings." to both ternary branches, mirroring settings.tsx's store-native guidance. IAP-accurate (no self-serve/web-portal overclaim). This version is STRONGER than the borderline copy-tweak dropped Run 98 (cites the specific clause + states the "how").

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default (code + this bookkeeping). Merged-tree gate GREEN: web tsc clean, **2171 tests** (2166 +5), determinism, `eslint` 0 (touched); mobile tsc + eslint clean (deps installed). package-lock install artifact reverted.
- **No ROADMAP box ticked** — the correctness/a11y fixes aren't checkboxes; F2 already [x]; D3 store-assets still needs real committed icon/screenshots (not headlessly buildable), so the paywall + a11y items are partial-surface polish, not a full Track-D box. **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **A same-root bug can have a fixed instance AND an unfixed sibling.** The duplicate-room-type collapse was already fixed in the persistence loop (with a warning comment) but the SAME map lookup survived in the synthesis input a few lines up. When a comment says "this map collapses duplicates, don't look up by it," grep every OTHER lookup of that map in the file.
2. **Distinguish misattribution from completeness when scoping a data-collapse fix.** The synthesis (feeds wrong room's data as fact into an LLM) and persistence (writes wrong room's diagnosis) are misattribution — must fix. The stored overview map is only whole-stringified downstream → a completeness gap, acceptable to defer. Trace each consumer's ACCESS PATTERN (indexed-by-key vs stringified-whole) before deciding blast radius.
3. **A batch of similar micro-perf-opts is padding even when each is individually real.** 5 sequential-DB parallelizations each saving ~150ms on an LLM-dominated path = ~3% of total; the value bar's BORDERLINE tier says "standalone only, never batch padding." Dropped all 5. (Contrast the dashboard parallelization anchor which cut whole-page load 3-4x.)
4. **DEEP AUDIT on a mature loop mostly CONFIRMS clean** (security, artifacts, monetization, mobile all clean this run) — its value is the 1-2 real findings the per-diff scouts would miss (here: the synthesis sibling bug + two whole-untested validation rules) plus a documented negative result future audits can diff against.

### Rotation guide for next run
- **DEEP AUDIT ran Run 99 (2026-07-19) — next due ~Run 103** (>24h/~4 runs). Runs 100-102 can lean on scouts + scorecard.
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS `cutover-to-persistent-data`); business_case_strength (without-annual ARR ~$99.9K<$100K — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE); design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — needs seeded-LLM E2E + push-and-watch-CI).
- **Named buildable follow-up (NOT yet built):** analyze-apartment STORED `analysis.rooms` overview map collapse (see change 1 note) — key by room.id or make it an array so the coarse apartment-overview text doesn't drop a same-type room's summary; low-value (completeness only), do when touching that route.
- **DO-NOT-RE-FLAG (carry prior lists +):** analyze-apartment synthesis index-alignment (FIXED); floor-plan + dashboard dropzone aria-labels (SHIPPED); ergonomics pendant-height + counter-gap coverage (SHIPPED); mobile paywall cancellation-method disclosure (SHIPPED); the 5 sequential-DB parallelizations (diagnosis/search-stream/products-evaluate/bundles-evaluate — DROPPED as batch micro-opt padding, ~3% on LLM-dominated paths; only revisit a SINGLE one standalone if it's the best thing that run); mobile results.tsx button accessibilityLabel (LOW best-practice, RN reads text child — below bar); ToS auto-renewal / privacy Margin-inert wording / mobile fallback-price Apartment tier (mitigated/clarity/server-authoritative); direction-distance middle-band + harmony-math bonus-tier + outlet-reach vague-position coverage (real but deferred to avoid a coverage-padding batch — pick up 1-2 standalone next coverage run); + all prior carried non-issues (set-math inverted-pricing FIXED; mockup-agent.ts:504 HIGH intentional IMAGE modality; createAgentRun outside-try framework-caught 500; `.single()`→`.maybeSingle()` memory-store reads NON-ISSUE; store-listing auto-renewal+deletion SHIPPED; global-error CSS-free boundary; topbar emerald intentional; webhook fire-and-forget intentional; mobile paywall packagesToOptions else-branch only if RC catalog grows).


## Run 2026-07-19 (Run 100) — 5 file-disjoint value-bar changes (DEEP AUDIT not due). ALL 5 both-Sonnet-APPROVED, 10/10 reviews, 0 re-review cycles.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-16pmzd` == origin default tip `f22b8a7` (Run 99 #666), 0/0 divergence. `npm install` root + `cd mobile && npm install` (mobile change). Baseline gate GREEN: web tsc, **2171 tests** / 11 skip, determinism, `eslint` 0.
- **DEEP AUDIT NOT due** (ran Run 99; next ~Run 103) → full 8-Haiku-scout sweep.
- Scorecard (DATA, as_of 2026-07-13, STALE): overall C, ship_gate false; three ship_critical below A unchanged & human/CI-gated (functional_reality C — DATA_BACKEND cutover; design_taste B — authed-axe + F7 screenshots; business_case_strength B — without-annual ARR ~$99.9K<$100K floor). GROWTH pre_launch/awaiting_connect → no lever signal (no-op).

### 8-scout sweep — findings
- **security/RLS + G1/G4:** RLS CLEAN through 029 (next 030). G1 spot-check clean EXCEPT one real gap (shipped below). G2/G3/G5/G6/G7 done. G4 login-lockout still needs a server-side login route (deferred, not headlessly clean).
- **validation-coverage (F2):** picked the strongest genuinely-untested branch (material-math reverse-metal, shipped); deferred saturation-math new-category else + others to avoid a coverage-padding batch.
- **correctness:** analyze-apartment GET `buildSummaryFromDiagnoses` duplicate-room-type collapse (re-found; = the KNOWN logged low-value completeness gap, consumers stringify whole — deferred); `.single()`-error-not-checked on 4 hot LLM paths (defensive but speculative under the default memory backend — deferred, Reviewer-B value risk).
- **growth-E7:** paid-engagement D1/D2 re-engagement cron proposed (Rank 1) — DEFERRED: cohort selection ("inactive active subscriber") needs a defensible activity/inactivity timestamp, materially harder than winback's `stripe_customers.updated_at` filter; do as a focused airtight run, not a batched slot. Analytics-pulls (Rank 2) need owner secrets; upgrade-paywall cron (Rank 3) touches checkout — both deferred.
- **business-case-levers:** 4 conversion/retention levers (paywall-trigger-timing shift; 7-day trial; free-tier single-share; email-trigger infra) — DEFERRED as a batch: each is a revenue-critical monetization-path change, medium blast radius, some need migrations, and NONE is runtime-verifiable headlessly (BUILDS≠WORKS) → belongs in a dedicated monetization run with runtime validation, not a batched slot among coverage/a11y fixes. Scout confirmed the real ship-blocker remains the human-gated annual tier (migration 021 + ANNUAL_BILLING_ENABLED) + TIME/distribution, not more features.
- **store-compliance/D:** web-sync store-listing claim (conditionally true post-DATA_BACKEND cutover — not a clean overclaim removal, deferred); permission-string data-destination + doc-clarity items = churn (dropped).
- **mobile:** clean except the Save-button quotaLoading label (shipped). **web-a11y:** topbar user-menu + RefineChat textarea (shipped); hardcoded-color batch refactor = behavior-neutral churn (dropped).

### Shipped — 5 file-disjoint value-bar changes (all both-Sonnet-APPROVED, 10/10)
- **(1) SECURITY/G1** `app/api/waitlist/confirm/route.ts` + `lib/utils/rate-limiter.ts` + `__tests__/api/waitlist-double-opt-in.test.ts` — the public unauthenticated `GET /api/waitlist/confirm` (double-opt-in) runs a DB `UPDATE…SELECT` + fires a welcome email on each pending-token match and had NO throttle while the sibling POST does → email-quota-drain + DB-write-load abuse surface. Added a per-IP limiter (`RATE_LIMITS.waitlistConfirm` = 10/15min, mirrors the POST's 5/15min but looser since a real subscriber clicks once) checked BEFORE any DB/email; over-limit reuses the existing friendly `?status=invalid` redirect (NO token-validity oracle — indistinguishable from every other invalid outcome, both security reviewers confirmed). Test proves the 11th burst request short-circuits before `getAdminClient`/`sendEmail`; dedicated IP `203.0.113.7` so the module-level limiter bucket can't collide with the file's other confirm calls (vitest per-file module isolation).
- **(2) F2** `__tests__/validation/material-math.test.ts` — the cross-room metal-temperature check is an OR with two arms; existing tests covered ONLY warm-apartment→cool-room. Added the REVERSE arm (cool-apartment via chrome → warm-room via brass). Both reviewers empirically deleted the second arm and confirmed ONLY the new test fails (24/25 others green) — genuine gap, mutation-provable. `conflicts`/`metal_coherence` feed validation-agent → harmony-composite scoring (real user-facing).
- **(3) A11y/WCAG-4.1.2** `components/layout/topbar.tsx` — desktop user-menu icon-only DropdownMenuTrigger (an Avatar: image-alt=person-name / initials fallback) had no accessible name for the CONTROL; added `aria-label="Open account menu"`. Reviewer A verified Radix Slot's mergeProps passes aria-label through without clobbering `aria-haspopup`/`aria-expanded`, and a static (non-toggling) label is the APG-preferred pattern for a menu trigger. Mobile hamburger already labelled (mutually exclusive viewport) — no dup.
- **(4) A11y/WCAG-1.3.1** `components/refine/RefineChat.tsx` — the design-refinement chat Textarea was placeholder-only (placeholder isn't a reliable accessible name + vanishes on input); added `aria-label="Describe what to change"`. No existing label anywhere in the file or the sole call site → no conflict.
- **(5) MOBILE design-bar** `mobile/src/app/results.tsx` — the Save button (core save CTA) was disabled during the initial `quotaLoading` AsyncStorage window but still read "Save Design" (a "fake ready" state); now shows "Checking…" (matches the app's gerund+`…` microcopy house-style verified across 6 other in-flight states). New ternary arm is strictly narrower than the plain-idle branch so no state mislabeled; `quotaLoading` never toggles back to true so no race.

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default (code + this bookkeeping). Merged-tree gate GREEN: web tsc, **2173 tests** (2171 +2), determinism, `eslint` 0 (touched); mobile tsc + eslint clean (deps installed). No package-lock artifact this run.
- **No ROADMAP box ticked** — G1 kept `[ ]` (the scout was a SPOT-check, not an exhaustive proof every endpoint is throttled; closing the one known gap is progress, not completion); F2 already `[x]`; the a11y/mobile fixes are partial-surface polish, not checkbox completions. **No migrations, no secrets, no new PENDING_OPS.**

### Lessons learned
1. **Defer, don't batch, a revenue-critical monetization-path change.** The business-lever scout surfaced 4 honest conversion/retention levers, but each changes a flow (paywall trigger, trial, entitlement gating) that BUILDS≠WORKS can't validate headlessly. Batching one among coverage/a11y fixes breaks coherence and invites a Reviewer-B value/safety reject. These belong in a dedicated run with runtime validation — named them in the deferred list so a future run picks them up deliberately.
2. **A "clean mirror" cron can hide real design work in its cohort selection.** The paid-engagement cron looked like a copy of winback, but winback's cohort is a trivial `updated_at` window on a small cancelled set; "inactive active subscriber" needs an activity/inactivity signal (which timestamp? bounded scan of a large active set?) that is a real decision, not a mirror. Verify the SELECTION query is as clean as the template before treating a cron as low-risk.
3. **A per-IP limiter test must use a dedicated IP.** The rate-limiter `store` is module-level; even with vitest per-file isolation, other tests in the SAME file consume the default "unknown" bucket. Keying the burst test on a dedicated IP (matching the existing shared-token-rate-limit.test.ts pattern) keeps it isolated and deterministic.
4. **Redirect, not raw 429, is the right over-limit UX for an email-link GET.** The confirm endpoint is hit by a top-level browser navigation from an inbox, so reusing the file's own `?status=invalid` friendly redirect (which also avoids a token-validity oracle) beats a bare JSON 429 a browser tab would render.

### Rotation guide for next run
- **DEEP AUDIT ran Run 99 (2026-07-19) — next due ~Run 103** (>24h/~4 runs). Runs 100-102 lean on scouts + scorecard. (Run 100 did NOT run a deep audit.)
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND cutover — PENDING_OPS); business_case_strength (without-annual ARR ~$99.9K<$100K — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real conversion-lift FEATURE); design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — needs seeded-LLM E2E + push-and-watch-CI).
- **NAMED buildable follow-ups NOT yet built (pick up deliberately, not batched):** (a) E7 paid-engagement D1/D2 re-engagement cron — needs a defensible active-subscriber inactivity timestamp (last_sign_in_at / last project activity); a FOCUSED run. (b) The 4 conversion/retention levers (paywall-trigger-timing shift; 7-day trial window; free-tier single public-share; email-trigger infra) — a dedicated MONETIZATION run with runtime validation; the strongest for business_case_strength but each needs BUILDS≠WORKS proof. (c) G4 login lockout/backoff + password-reset/verification enumeration guards — needs a server-side login route. (d) F2 saturation-math new-category else branch + direction-distance middle-band + harmony-math bonus-tier + outlet-reach vague-position — real, pick 1-2 standalone next coverage run.
- **DO-NOT-RE-FLAG (carry prior lists +):** waitlist/confirm rate-limit (SHIPPED); material-math reverse-metal coverage (SHIPPED); topbar user-menu + RefineChat textarea aria-labels (SHIPPED); mobile results.tsx Save-button quotaLoading label (SHIPPED); analyze-apartment GET dup-room `buildSummaryFromDiagnoses` collapse (KNOWN low-value completeness, consumers stringify whole — defer to when next touching that route); `.single()`-error-not-checked on bundles/diagnosis-stream/mockups/search (speculative under memory backend, Reviewer-B value risk — do NOT batch-sweep); store-listing web-sync claim (conditionally true post-cutover, NOT a clean overclaim); permission-string data-destination + RevenueCat-gate-definition + annual-redirect doc-clarity (churn); hardcoded-color→token batch refactor (behavior-neutral churn); + ALL prior carried non-issues (analyze-apartment synthesis index-alignment FIXED; ergonomics pendant/counter coverage SHIPPED; set-math inverted-pricing FIXED; mockup-agent.ts:504 HIGH intentional IMAGE modality; createAgentRun outside-try framework-caught 500; `.single()`→`.maybeSingle()` memory-store reads NON-ISSUE; store-listing auto-renewal+deletion SHIPPED; global-error CSS-free boundary; topbar emerald intentional; webhook fire-and-forget intentional; mobile paywall packagesToOptions else-branch only if RC catalog grows; mobile results.tsx button accessibilityLabel LOW/RN-reads-text-child).


## Run 2026-07-19 (Run 101) — 2 file-disjoint value-bar changes (DEEP AUDIT not due). BOTH changes 2/2-Sonnet-APPROVED, 4/4 reviews, 0 re-review cycles.

### State on entry
- Cold container. Working branch `claude/sleepy-goldberg-vy8kt8` == origin default tip `4ddfce2` (Run 100 #667), 0/0 divergence. `npm install` root + `cd mobile && npm install`. Baseline gate GREEN: web tsc, **2173 tests** / 11 skip, determinism, eslint 0.
- **DEEP AUDIT NOT due** (ran Run 99; next ~Run 103) → full ~7-Haiku-scout sweep.
- Scorecard (DATA, as_of 2026-07-13, STALE): overall C, ship_gate false; three ship_critical below A unchanged & human/CI-gated (functional_reality C — DATA_BACKEND cutover; design_taste B; business_case_strength B — without-annual ARR ~$99.9K<$100K). GROWTH pre_launch/awaiting_connect → no lever signal (no-op).
- **Stale open PR #664** ("Run 99 … 6 disjoint") on branch `claude/sleepy-goldberg-5ajok0` — a superseded earlier Run-99 attempt; the ACTUAL merged Run 99 is #666 with a DIFFERENT 5-change set. Left untouched (not this run's job). **This mattered:** see lesson 1.

### ~7-scout sweep — findings
- **security/RLS + G1/G4:** CLEAN. 25 public tables all ENABLE RLS + appropriate policy through migration 029 (next 030); ~11 expensive/paid endpoints all throttled; G4 login-lockout still not headlessly buildable (no server login route — auth is Supabase client-side). Clean no-op.
- **mobile-Expo:** CLEAN. save/purchase/delete side-effects all await the real op before success; session isolation on sign-out; a11y fine (RN reads text children).
- **web-a11y/design/perf:** CLEAN. icon-only controls labelled, Lucide not emoji, tokens consistent, no fake-ready labels; no meaningful hot-path parallelization win (dashboard analyze is intentionally sequential; the 5 micro-opts stay dropped as ~3% padding).
- **F2 coverage:** 2 genuinely-untested load-bearing branches surfaced (saturation-math existing-category else; harmony-math lighting bonus-tier) — = 2 of the 4 named backlog items. SHIPPED.
- **correctness:** the deleted-FK null-product crash on the mockups + bundles/evaluate paid paths — SHIPPED (see lesson 1).
- **monetization/business-case levers:** 7-day trial and free-tier single public-share — DEFERRED as OWNER-LEVEL STRATEGY PIVOTS (see lesson 2).
- **store/marketing:** only a landing-page superlative "Perfect scale fit" (app/page.tsx:129) — DROPPED (single decorative-card word, below bar / cosmetic-reject risk). All store/privacy/pricing artifacts consistent.

### Shipped — 2 file-disjoint value-bar changes (both 2/2-Sonnet-APPROVED)
- **(1) CORRECTNESS / F4.1 — deleted-FK null-product crash on TWO paid paths.** `app/api/bundles/evaluate/route.ts` + `app/api/mockups/route.ts` + new `__tests__/api/bundles-evaluate-null-products.test.ts` + extended `mockups-product-binding.test.ts`. The `product_bundle_items(*, candidate_products(*))` nested join returns `null` for any item whose `candidate_products` FK row was deleted; unfiltered it derefs (`products.map((p)=>p.id)` in mockups; `[${p.category}]` via `evaluateBundle`→bundle-optimizer.ts:229) → uncaught 500 on a PAID LLM/render path, bundle stuck "pending", agent run orphaned. Fix filters nulls + rejects an all-deleted (empty-after-filter) bundle with 400 BEFORE the paid call. 4 new tests mutation-proven (both reviewers reverted the filter → `TypeError: Cannot read properties of null (reading 'id')` at the cited lines). Reviewer-B checked the 3 OTHER `evaluateBundle` call sites (orchestrator ×2, products/evaluate-set) — all pass freshly-generated products (no nullable join), so the route boundary is the correct fix layer (NOT bundle-optimizer). Reviewer-A noted the 400-on-empty also protects a never-populated bundle → strict improvement, not a regression.
- **(2) F2 — validation-math branch coverage.** `__tests__/validation/saturation-math.test.ts`: `updateSaturation` existing-category else-path (seed a profile that already has "plant" → increment 1→2 without re-deriving caps; prior tests all seeded from empty → only the new-category init branch ran). `__tests__/validation/harmony-math.test.ts`: `computeLightingAdequacy` `lightSourceCount >= minSources+1` bonus (+0.05), isolated from ambient/task/accent bonuses via a SPEC-ONLY third source (`open_shelf` + "integrated LED under-shelf light" → count-only, no flag), kitchen 2→3 sources, delta exactly 0.05. Both reviewers deleted the target source line → only the new test fails.

### Merge outcome + gate
- Single branch per this run's git constraint → ONE PR to default (code + this bookkeeping). Merged-tree gate GREEN: web tsc, **2179 tests** (2173 +6), determinism, `eslint` 0 (touched). No /mobile source touched. package-lock install artifact reverted.
- **No ROADMAP box ticked** — the crash fix is Track-A/F4.1 reliability (not a checkbox); F2 already `[x]`. No migrations, no secrets, no new PENDING_OPS.

### Lessons learned
1. **A "FIXED" note in the rotation guide can be a lie if the fix lived only in a STALE UNMERGED PR.** The DO-NOT-RE-FLAG list said "bundles/evaluate null candidate_products (FIXED #664-era)" — but #664 never merged (the real Run 99 was #666 with a different change-set), so the fix had NEVER landed on default and the crash was still live. The correctness scout re-found it and default `git show` confirmed no filter. **Takeaway: when a rotation note credits a fix to a PR number, and there's a same-numbered STALE OPEN PR, verify the fix is on the DEFAULT TIP (git show / grep HEAD), not just that a PR "did it." Trust the tree, not the ledger.** Also found the SAME bug class in a SECOND route (mockups) the #664 note never mentioned — a same-root bug can have an untracked sibling.
2. **A monetization "coherence gap" can still be an OWNER-LEVEL strategy pivot, not an autonomous fix.** The pricing page markets "Client-ready share links" as Pro, yet `PATCH /api/saved-designs/[id]` make-public has no entitlement check (free users get share links) — looks like a clean code-vs-pricing coherence bug. BUT gating it REMOVES a free-user feature AND kills a viral-growth vector, and the product deliberately positions the free Explore tier AS the trial (pricing FAQ) — so both a 7-day Pro trial and a free-share-gate change the free/paid boundary, touch marketing surfaces, and are BUILDS≠WORKS-unverifiable for conversion lift. These are owner-approved dedicated-monetization-run work, not a batched autonomous slot. (Consistent with Run 100 lesson 1.) The free-share-gate is the strongest FUTURE lever since it aligns with the marketed claim — but it needs owner intent because it removes a free feature.
3. **A mis-launched reviewer that reads the working tree directly still gives a valid verdict — and can catch a real packaging gap.** One crash-fix Reviewer A was launched with a `$(cat …)` placeholder that didn't expand in the Agent prompt; it reviewed by reading the repo directly and correctly REQUEST_CHANGES'd because the new `bundles-evaluate-null-products.test.ts` was still UNTRACKED (`??`) at review time — the evaluate route would have shipped with zero regression coverage. Resolved by `git add -A` before push. **Takeaway: embed diffs LITERALLY in reviewer prompts (shell `$()` never expands there); and commit/stage before spawning reviewers so an untracked new file can't read as "missing coverage."**

### Rotation guide for next run
- **DEEP AUDIT ran Run 99 (2026-07-19) — next due ~Run 103** (>24h/~4 runs). Run 101 did NOT run a deep audit; Run 102 can lean on scouts + scorecard, then Run 103 is due for the 8-lens sweep.
- **Ship blockers UNCHANGED & not headlessly buildable:** functional_reality (DATA_BACKEND=supabase cutover — human-gated, PENDING_OPS); business_case_strength (without-annual ARR ~$99.9K<$100K — human-gated migration 021 + `ANNUAL_BILLING_ENABLED=true`, OR a real owner-approved conversion-lift feature); design_taste (authed-axe on seeded diagnosis/mockups/compare + F7 committed screenshots — needs seeded-LLM E2E + push-and-watch-CI).
- **NAMED buildable follow-ups NOT yet built (pick up deliberately, not batched):** (a) The monetization levers (7-day trial; free-tier single public-share gate; paywall-trigger-timing) — DEDICATED owner-approved monetization run w/ runtime validation; the free-share-gate is strongest (aligns to marketed Pro-only claim) but removes a free feature → needs owner intent. (b) E7 paid-engagement D1/D2 re-engagement cron — needs a defensible active-subscriber inactivity timestamp; a FOCUSED run. (c) G4 login lockout/backoff — needs a server login route. (d) F2 coverage remaining 2 of 4 named: direction-distance middle-band + outlet-reach vague-position — real, pick standalone next coverage run (saturation-math else + harmony bonus-tier now SHIPPED). (e) analyze-apartment STORED `analysis.rooms` overview map collapse (completeness only, consumers stringify whole — do when next touching that route).
- **HOUSEKEEPING SIGNAL for a future run:** stale open PR #664 (`claude/sleepy-goldberg-5ajok0`) duplicates already-merged work and would conflict — a human/owner could close it; the loop should NOT stack on it.
- **DO-NOT-RE-FLAG (carry prior lists +):** bundles/evaluate + mockups deleted-FK null-product crash (SHIPPED this run — the real fix, on default now; the #664 "FIXED" note was stale); saturation-math existing-category else + harmony-math lighting bonus-tier coverage (SHIPPED); "Perfect scale fit" landing superlative (DROPPED, below bar); free-tier share-gate + 7-day trial (DEFERRED, owner-gated); + ALL prior carried non-issues (waitlist/confirm rate-limit SHIPPED; material-math reverse-metal SHIPPED; topbar/RefineChat/floor-plan/dashboard aria-labels SHIPPED; mobile results.tsx Save quotaLoading label SHIPPED; analyze-apartment synthesis index-alignment FIXED + stored-map collapse low-value defer; `.single()`-error speculative under memory backend — do NOT batch-sweep; set-math inverted-pricing FIXED; mockup-agent.ts:504 HIGH intentional IMAGE modality; createAgentRun framework-caught 500; store-listing web-sync claim conditional-not-overclaim; permission-string/doc-clarity churn; hardcoded-color→token batch churn; mobile paywall packagesToOptions else only if RC catalog grows).
