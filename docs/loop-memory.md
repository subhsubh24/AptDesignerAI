# Loop memory — AptDesignerAI autonomous engineering loop

Durable lessons across runs. Each run appends; nothing is deleted until a guard makes it redundant.

---

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
