# QUALITY SCORECARD — AptDesignerAI

The machine-readable quality grade, owned by the **independent Quality Auditor** (a separate
cloud routine — NOT the factory that writes the code; maker ≠ checker). Graded against
`docs/quality/QUALITY_RUBRIC.md`, backed by mechanical signals. The factory dashboard reads the
fenced QUALITY_SCORECARD block below; the factory loop reads it as **DATA** and drives low grades
up — it never grades itself.

## Contract (read before editing)
- Only the Quality Auditor updates the block — never the maker/factory. Grades are independent.
- Every grade is backed by evidence + a mechanical signal (see the rubric). A grade above what the
  evidence supports is invalid.
- For any dimension below A, `gap` MUST name the specific, actionable shortfall (what would raise it).
- Real assessment only — never inflate a grade to look good (same anti-gaming rule as the business case).
- The block MUST be valid, parseable YAML (preflight checks it). Use A+/A/B/C/D/F or null (ungraded).
- as_of is stamped every grade; a stale as_of is itself a signal.

```yaml
QUALITY_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-08-03
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C (capped by functional_reality, unmoved for 7 cycles) but the per-dimension picture IMPROVED SHARPLY — TWO ship_critical dims recovered fully to A (store_readiness C->A, artifact_integrity B->A) and a THIRD reached the A+ ceiling (security_rls A->A+, zero findings for the first time in 5 cycles), while performance recovered B (from C). Both store_readiness fixes were verified genuine, not closed-by-assertion: account deletion now purges storage BEFORE deleting the auth user (lib/storage/user-storage.ts purgeUserStorage, pinned by regression tests including a cross-tenant-delete guard), and docs/app-privacy.md + app/privacy/page.tsx now consistently disclose location collection and the real Maps/Places purpose. artifact_integrity's four named root causes (F1/F2 overclaim, 3 stale docs, A4 mistick) are all fixed with honest, re-verified language; one trivial nit remains (a stale .github/workflows/ci.yml header). design_taste closed its three-hue-anti-pattern gap SYSTEMICALLY (a new repo-wide off-system-palette ratchet, not a spot fix) but held B because F7's authed/design-dense screenshots (incl. /focus, the flagship route the violation was ON) remain uncommitted. business_case_strength's take-rate correction (30%->15%, real Apple SBP/Google Play programs) was independently verified as HONEST, not gaming — no behavioral input moved — but held B on a newly-precise, loop-buildable gap: the mobile paywall doesn't mirror the business case's own annual-gating/tier-mix assumptions. THREE ship_critical dims now sit below A, down from five: functional_reality (C, unchanged — a purely owner-gated CI/cutover step), design_taste (B), business_case_strength (B).
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — THREE remain below A (functional_reality C, design_taste B, business_case_strength B), down from five last cycle
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C for a SEVENTH consecutive cycle — a fresh independent grader confirmed the persistence
        blocker is BYTE-IDENTICAL to 07-27: `grep -c "DATA_BACKEND" .github/workflows/ci.yml` -> 0;
        lib/supabase/server.ts:23 still `return process.env.DATA_BACKEND === "supabase"` (default
        memory). Zero commits since 07-27 touched e2e/journeys.spec.ts, lib/supabase/server.ts,
        .github/workflows/ci.yml, or lib/store/memory-store.ts. journeys.spec.ts still self-admits the
        gap (creates via the in-memory store; real Supabase is auth-only).
        __tests__/supabase/data-backend.test.ts still concedes the real Postgres round-trip is "a
        human-verified cutover step" — no cold-start proof test exists anywhere in the repo.
        PENDING_OPS.md confirms both blocking items (`ci-journeys-data-backend`,
        `cutover-to-persistent-data`) remain status:open, and documents WHY the loop cannot self-close
        the CI half: .github/ is a sensitive/permission-gated path, and the scripts/run-journeys.sh
        workaround doesn't work because `npm run start &` launches the server BEFORE that script runs,
        so an exported env var never reaches the already-running process. CI is otherwise green (latest
        run 30799362489 on b3fbcd6, conclusion=success); `npm test` 2788 pass/12 skip (up from 2438/11);
        `npx tsc --noEmit` clean. No new functional-reality regressions found across the 60+ PRs merged
        since 07-27 (design/a11y/coverage/billing-cap work only — none touched the money path, auth, or
        dashboard population). C not B (persistence is blocking for a retention-driven, sellable app); C
        not D (everything else genuinely works, and every money-path signal stays green). RAISE to A:
        this is now PURELY an owner-gated step, unchanged from last cycle's prescription — set
        DATA_BACKEND: "supabase" in the CI journeys job's env block (a .github/ edit the loop cannot
        make), add the cold-start round-trip proof test (write a saved design, restart, re-read, assert
        survival + a second-user RLS denial), then make DATA_BACKEND=supabase the production default.
        Migration 030 (share-token) must land BEFORE the cutover per PENDING_OPS. Tracked: #525 (update).
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh adversarial grader, cold). `npx tsc --noEmit` clean; `npm test` 2788 pass / 12
        skip (up from 2438/11, 251 files); `npm run check:determinism` green; `npx eslint .` now 0 ERRORS
        AND 0 WARNINGS (was 19 — .agents/** is now eslint-ignored, eslint.config.mjs:49, and `npm run
        lint` = `eslint . --max-warnings 0` passes clean — see artifact_integrity). Billing webhook still
        correct: signature verified before DB access (app/api/billing/webhook/route.ts:76-88), idempotent
        via the pre-upsert status read (:103-117), DB failure 500s so Stripe retries. Zero empty catches
        or stub/TODO markers found on billing/entitlements paths. Spot-checked 6 new test files
        (direction-distance-format, lifestyle-fit-format, pairwise-proportions-format, set-math,
        spatial-graph, waitlist/referral) — all genuine behavior assertions (boundary rounding, branch
        presence/absence, uniqueness over 2000 draws, adjacency/dead-zone thresholds), not
        formatter-string change-detectors; the 2438->2788 jump looks legitimate on this sample. Of the
        three named A->A+ ceiling items, ONE is now partially fixed: lib/agents/computer-use/agent-loop.ts:279
        now threads `seed: resolveSeed(undefined)` (was missing entirely) — the seed-omission half of
        finding (3) is closed. The thinkingConfig half is UNCHANGED: `thinkingLevel: ThinkingLevel.HIGH`
        is still hardcoded on task `computer_use` (not on the AGENTS.md allowed-HIGH list), now with an
        honest comment arguing the task has a cheap deterministic verifier
        (product-verifier.ts parseFinal()/hasData) and naming an escalation-ladder rewrite as the real
        fix — a reviewed, deliberate deferral, not silent drift, but the cost-contract violation itself
        persists. The other two ceiling items are untouched: no maxDuration sweep test exists
        (`find __tests__ -iname "*maxduration*"` empty; only __tests__/api/auth-signup.test.ts:48-50
        asserts one route) despite 12+ routes declaring maxDuration=300; harness-ratchet.test.ts:22 still
        sets SCAN_DIRS=["lib","app"], so scripts/seed-product-embeddings.ts:102's live
        geminiProvider.chat({...}) still has no thinkingConfig/seed and stays invisible by construction.
        RAISE to A+: a transitive import-closure sweep test asserting maxDuration wherever the closure
        touches lib/ai/*; extend SCAN_DIRS to scripts/ + add `generateContent(` as a ratchet marker; and
        either land the computer-use escalation-ladder rewrite or add an explicit, seeded, ratchet-visible
        allowed-HIGH exception for computer_use.
    security_rls:
      grade: A+
      ship_critical: true
      gap: >-
        RECOVERS to A+ — a fresh 56-route sweep (`find app/api -name route.ts` -> 56) found NO new IDOR,
        and BOTH prior A+-ceiling nits are now genuinely fixed. app/api/saved-designs/route.ts:178-192,254
        now persists a `boundProjectId` derived from the SAME ownership-bound fetch (not the raw,
        possibly-empty client `project_id`) — closing the dangling-FK nit. app/api/products/route.ts:96-109
        now binds `search_session_id` to `search_sessions.id + room_id` via the already-cleared room and
        400s on a mismatch, rather than silently accepting an unbound id. Every route that binds one
        client-supplied id then reads another was re-checked and holds the convention: bundles/route.ts
        binds product_ids to room_id; bundles/evaluate resolves room_id from the bundle row itself (no
        client-supplied room_id to spoof); mockups/route.ts binds both bundle_id and product_ids to
        room_id; products/evaluate explicitly checks product.room_id !== room_id before scoring;
        area-analysis/refine-chat derive project_id from room.project_id server-side, never trusting a
        client value; picks/route.ts scopes rooms by projects.user_id. PATCH/PUT allowlists on
        projects/rooms/products all use explicit ALLOWED_KEYS arrays excluding user_id/project_id/room_id
        — no ownership-reassignment vector via PATCH body. Every route added or changed since 07-27 (9
        commits touching analyze-apartment, mockups, diagnosis, floor-plan, search) retains
        checkRateLimit/enforceWriteRateLimit + checkDailySpend where paid — no new provider-touching route
        shipped without the standard guard stack. Secrets clean: `git ls-files | grep -iE
        "\.env$|secret|credential"` empty; no NEXT_PUBLIC_*/EXPO_PUBLIC_* secret leakage. Mechanical
        signals: `npx tsc --noEmit` clean; `npm test` 2788 pass/12 skip; preflight GATE 6 rerun green (26
        public tables, all ENABLE ROW LEVEL SECURITY). Zero findings this cycle — the rubric's A+ bar (0
        findings) is genuinely met for the first time in 5 cycles.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B, but ONE of the two capping gaps genuinely and SYSTEMICALLY closed this cycle — not a
        spot fix. The three-hue-ordinal anti-pattern named last cycle
        (ManualScorecardView.tsx:140-142, emerald/blue/amber encoding a 0-10 score on the /focus flagship)
        is fixed AND backed by a repo-wide ratchet: every score surface now routes through
        lib/scoring/verdicts.ts's documented ONE-HUE EMPHASIS LADDER (getScoreColor/getScoreSurface/
        VERDICT_COLORS — worst=muted, middle=warm accent, best=full-ink, zero emerald/blue/amber), and a
        NEW test (__tests__/design/off-system-palette-ratchet.test.ts) caps off-system Tailwind colour
        usage repo-wide at MAX_OFF_SYSTEM=52 (ratcheted DOWN from 82 across real conversions incl. this
        one, same-day #788) — it can only shrink, and the remaining hits (toast/badge status variants,
        illustrative photo-swatch content on the gallery page) are named, counted, pinned exemptions with
        real reasoning, not loopholes. AUTHED_A11Y_ROUTES and DESIGN_DENSE_A11Y_ROUTES
        (journeys.spec.ts:391,439) both still present, unmodified, and green (6 files / 63 tests). The
        SECOND capping gap, F7 visual baselines, is materially narrowed but NOT closed: e2e/__screenshots__/
        now holds ~30 real, non-placeholder PNGs (a manifest test decodes PNG headers to reject
        0-byte/placeholder/orphaned files) — but EVERY captured file is `public-*`; the AUTHED and
        DESIGN-DENSE routes (dashboard, /focus, setup/diagnosis/products/bundles/mockups/compare) are
        wired to capture in CI but NOT committed, because persisting them requires the seeded
        Supabase-local backend plus a .github/ step outside the loop's reach. docs/loop-memory.md records
        real dual-axis (FUNCTIONAL+DESIGN) verdicts for the committed public set, and it genuinely caught
        a real bug (a disabled-looking waitlist CTA) — proving the mechanism works where it runs.
        Critically, /focus — the EXACT route that carried this cycle's closed violation — still has no
        committed visual baseline, so the fix cannot yet be vision-verified in situ, only in source.
        ROADMAP.md F7 correctly stays unticked. B not A: F7's DoD explicitly requires BOTH artifacts AND a
        recorded dual-axis verdict for design-dense/authed routes, and that half is still absent — a real,
        named, ship-critical gap, not a trivial nit. RAISE to A: commit real authed/design-dense
        screenshots (the CI-side capture mechanism already exists; persisting requires the owner-gated
        .github/ step) and record their dual-axis verdict, prioritizing /focus. Tracked: #204 (update —
        one gap closed with a durable ratchet, one remains and is now more precisely scoped).
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        RECOVERS A — both C-dropping findings from 07-27 are genuinely fixed, independently re-verified,
        not merely closed-by-assertion. (F1) lib/storage/user-storage.ts now exports `purgeUserStorage`,
        sweeping upload buckets by `${userId}/` prefix listing plus generated mockups via the trusted
        `mockup_jobs.result_image_url` column ONLY — deliberately NOT trusting client-settable
        `saved_designs.thumbnail_url`/`projects.cover_image_url`, closing a cross-tenant-delete vector
        pinned by __tests__/api/account-deletion-storage.test.ts:228-236. Called from BOTH
        app/api/user/delete/route.ts:42 and app/api/mobile/account/route.ts:66 BEFORE `deleteUser`, and on
        purge failure the route 500s WITHOUT calling deleteUser
        (__tests__/api/user-delete.test.ts:103-114 pins both the ordering and the
        no-deleteUser-on-purge-failure behavior; __tests__/api/mobile-account-delete.test.ts:96-104
        mirrors it). (F2) docs/app-privacy.md:19-38,158 and app/privacy/page.tsx:50-54,142-146,212 now
        AGREE: location is declared as building-coordinates (not device location, no permission
        requested), the Google Maps/Places purpose is correctly described as address autocomplete + building
        photos (not "product image search"), and the maps.googleapis.com-loads-on-every-page fact is now
        explicitly disclosed to the user. Fresh sweep: mobile/eas.json build+submit profiles still real
        (dev/preview/production, app-bundle, autoIncrement, appleId/ascAppId/appleTeamId via env); app icon
        still a genuine 1024x1024 RGBA PNG; D3 store screenshots remain the sole HUMAN-gated Track D item
        (expected, unchanged). Two PENDING_OPS items remain but are correctly scoped as owner/one-time-ops,
        NOT code gaps: `refile-store-privacy-forms` (re-file the actual App Store Connect/Play Console
        privacy FORMS to match the now-corrected docs) and `audit-orphaned-storage-objects` (a one-time
        sweep for accounts deleted before this fix shipped, whose storage objects predate the purge). Zero
        findings this cycle. Tracked: #726 (already closed 2026-08-01 — confirmed genuinely resolved, not
        prematurely closed).
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        RECOVERS A. All four root causes named 07-27 are now fixed with honest, evidence-matched language,
        not merely re-ticked. ROADMAP.md F1/F2 now carry accurate caveats — F1: "REMAINING: the CI lint
        step runs bare npx eslint .; adding --max-warnings 0 there is an owner step, see PENDING_OPS"; F2:
        the equivalent for coverage — both re-verified TRUE (ci.yml:39 still bare `npm test`, ci.yml:94
        still bare `npx eslint .`; but scripts/preflight.sh GATE 1f DOES run `npm run test:coverage`, so
        the floor is enforced in the readiness gate even though not yet in per-PR CI). e2e/ROUTE_INVENTORY.md:3
        no longer overclaims "every route/flow" — it now states "20 of the 35 app/**/page.tsx routes appear
        in the table; the other 15 are listed under Tracked gaps," an honest, self-checking count; the
        stale "still needs adding" language at the old lines 60-61 is gone. ROADMAP.md:389 A4 is now
        correctly UN-TICKED ([ ]) with an explanatory note matching PENDING_OPS.md's
        `cutover-to-persistent-data: status open` — no longer a misleading claim. Spot-checked G1/G5/G6/G7/
        C2/C4 ticks plus pricing consistency (lib/billing/stripe.ts $29/$49/$399 vs app/pricing/page.tsx vs
        the rewritten docs/BUSINESS_CASE.md, including the new 15% store-rate figure) — all hold up, all
        honestly caveat inert-until-owner-key states. preflight GATE 5 (business case/GROWTH_STATUS/
        OWNER_ACTIONS YAML) and GATE 6 (RLS 26/26) both green; the QUALITY_SCORECARD ship-bar preflight
        failure is a fair, by-design non-finding (the auditor's own gate correctly blocking on
        ship_gate_met:false, not a bug). ONE nit remains and keeps this at A, not A+: .github/workflows/ci.yml:1-5
        still carries the stale, self-contradictory "READY-TO-APPLY workflow — copy this to
        .github/workflows/ci.yml" header on the file that already IS that workflow — a one-line, real
        doc/reality mismatch, but .github/ is off-limits to the loop. RAISE to A+: an owner or a
        .github/-authorized pass deletes the stale header. Tracked: #727 (close — genuinely resolved; the
        one remaining nit is trivial and .github/-gated, not a code-level integrity defect).
    business_case_strength:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — genuine, honest progress, explicitly verified this cycle to be a REAL correction, NOT
        gaming. The 30%->15% store take-rate correction (docs/BUSINESS_CASE.md, "Take-rate correction
        2026-07-28") is real and well-sourced: Apple's Small Business Program and Google Play's first-$1M
        fee tier are cited, genuine programs, and the doc correctly separates automatic ELIGIBILITY from
        the owner-only ENROLLMENT action (PENDING_OPS.md `enroll-apple-small-business-program`,
        status:open, blocks: business-case-store-channel). No behavioral input moved to hit the floor —
        installs, day-30 retention (25%), conversion (4%), churn, and tier mix are UNCHANGED from last
        cycle's B grade; only the commission rate was corrected, on both channels, to their real values.
        `node analysis/business_case_without_annual_arr.mjs` -> $121,339 (up from $99,926); `node
        scripts/validate-computation.mjs` -> "10 figure(s) verified... PASS." Crucially, the floor-clearing
        claim does NOT rest solely on the un-enrolled SBP rate: the web/Stripe-only reading ($136,762
        steady-state, Stripe's live 2.9% fee) needs no pending owner action at all. The doc was ALSO caught,
        same-day, by the sibling GTM auditor overclaiming "$121,339/$136,762 over the floor" without the
        steady-state-not-year-1 caveat the base case already carried, and fixed within the day (commit
        2d079e6) — year-1 exit run-rate is now honestly disclosed at $73,519 (store) / $82,873 (web), BOTH
        still below the floor, and floor_met_year1 stays false. UNRESOLVED gap, unchanged from last cycle:
        mobile/src/components/paywall-sheet.tsx's FALLBACK_OPTIONS/packagesToOptions() still produce only
        Annual/Monthly Pro — no $29 Apartment one-time tier (credited with 60% of modeled conversions in the
        business case) and no isAnnualBillingEnabled-equivalent gate anywhere in mobile/ (all 9 real gate
        call sites remain web-only) — so the model's own core assumptions are not mirrored in the app's
        primary mobile purchase surface. This is a real, specific, LOOP-BUILDABLE lever (unlike SBP
        enrollment, which is owner-only). RAISE to A: add the $29 Apartment tier to the mobile paywall and
        mirror the web annual kill-switch there, so mobile monetization actually matches what the business
        case models. Do NOT close any remaining gap by nudging a behavioral input (conversion/retention/
        churn) — that is gaming and will be graded DOWN. Tracked: #672 (update — the honest floor-clearing
        correction landed; the mobile-parity lever is the new, more precise RAISE-to-A target).
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B, on firmer footing than last cycle. `npx vitest run --coverage` -> 67.97% stmts / 57.36%
        branch / 71.21% funcs / 69.23% lines (up from 62.6/51.88/67.53/63.6), 2788 pass / 12 skip / 251
        files (up from 2438/11/226). The named maker/checker files show a MIXED picture, not uniform
        improvement: room-diagnostician.ts 0.94%->72.07% and fit-scorer.ts 2.42%->65.27% are real,
        substantial jumps; but validation-agent.ts sits at 13.06% — IDENTICAL to last cycle, zero new
        coverage — and research-assembler.ts is unchanged at ~1.5%; orchestrator.ts moved only
        2.97%->11.66%, and that entirely from two pure helper functions (TokenBudget/cartesian) — the
        actual fan-out/scoring loop (lines 655-3445) is still ~88% dark. CI STILL never gates coverage:
        .github/workflows/ci.yml:39 runs bare `npm test` (= `vitest run`, no --coverage) — an owner step
        per PENDING_OPS, unchanged. The cassette pattern was genuinely EXTENDED per last cycle's explicit
        instruction: __tests__/integration/diagnosis-pipeline-cassette.test.ts (new, 326 lines) drives the
        real two-pass diagnosis agent (Pass A, self-consistency, room-type gate, few-shot retrieval, Pass
        B), mocking only the Gemini boundary — a real second hermetic money-path test, not a rename.
        Sampled 7 newly-added test files (fit-scorer-batch, orchestrator-primitives, category-normalization,
        sanitize-prompt-pii, diagnosis-validator, off-system-palette-ratchet, bundle-scorer): zero
        change-detector patterns found (an improvement over last cycle's 7-of-41 formatter-string problem);
        several explicitly reason about what NOT to assert to avoid brittleness (e.g.
        orchestrator-primitives.test.ts cites a grep proving one code path has no caller and deliberately
        skips asserting on it). IMPROVEMENT_LOG.md documents one genuine manual live RUN_EVALS run this
        cycle — the new bedroom gold fixture (b3fbcd6) failed legitimately twice on real sampling variance,
        was revised, then passed 3/3 live, with both reviewers independently re-fetching the source photo
        to verify the fixture's premise — real evidence, but for 1 of 6 eval files and manual/local rather
        than an automated repeatable CI signal; live-eval.yml is otherwise unchanged (still passes GREEN
        with keys unset). RAISE to A: point ci.yml verify at `npm run test:coverage` (owner step); extend
        the cassette pattern specifically to validation-agent.ts and research-assembler.ts (both untouched
        this cycle despite being named twice now); grow orchestrator.ts coverage past its two pure helpers
        into the actual fan-out/scoring loop. Tracked: #200 (update).
    performance:
      grade: B
      ship_critical: false
      gap: >-
        RECOVERS to B — four of the five findings named last cycle are genuinely fixed, each independently
        re-verified live (not just by commit title). (1) app/api/mockups/route.ts's findCachedMockup now
        uses fs.promises.readdir, not the blocking sync call — the event-loop-blocking defect is gone (the
        O(all-mockups-ever) directory-scan cost itself remains architecturally, a lesser, separate concern).
        (2) app/api/analyze-apartment/route.ts:29 adds MAX_ROOMS_PER_ANALYSIS=20, slices over-cap projects
        and surfaces a warning (:113-120) — real and complete, matching the commit title exactly. (3)
        app/api/products/evaluate-set/route.ts:26,172 now gates extraction through
        pLimit(EXTRACT_CONCURRENCY=5), symmetric with the scoring phase below it (previously uncapped). (4)
        The serial per-image fetch in lib/ai/gemini.ts and the unused resolveImageBlocks() helper are BOTH
        fixed, non-superficially: a new shared lib/ai/image-fetch-gate.ts (imageFetchLimit, pLimit-based)
        replaces what its own comment says were two INDEPENDENTLY-instantiated limiters that could double
        real concurrency — a subtler bug than the one originally flagged, caught and fixed in the same
        pass; resolveImageBlocks now has 6 real call sites (scene-assembler.ts, mockup-verifier.ts,
        mockup-agent.ts x2, room-diagnostician.ts, greedy-decorator.ts) versus zero last cycle. All four
        landed in the commit range around #732 (2026-07-29). UNCHANGED, still open: lib/store/embedding-index.ts:46
        remains a full-table select("*") + in-memory cosine scan per crop, ivfflat index still unused;
        next/image adoption still exactly 0 files repo-wide; no perf budget anywhere in CI
        (.github/workflows/margin-eval.yml has only an unrelated cost ::warning::, not a real budget gate).
        The raw-<img> growth ratchet (__tests__/perf/no-img-growth.test.ts) is still green and enforcing,
        MAX_RAW_IMG steady at 30 (no regression, no further reduction this cycle). B not A: two real,
        known-cost items (the embedding N+1, zero perf budget) remain fully untouched. B not C: this cycle
        shows genuine, non-trivial architectural fixes — a shared concurrency gate, a bounded fan-out, an
        async directory read — not just config bumps, and zero new regressions were introduced. RAISE to A,
        cheapest-first: add even a crude bundle-size/Lighthouse budget gate to CI; sequence the
        embedding-index pgvector RPC WITH the DATA_BACKEND cutover (it would be dead code before it lands);
        adopt next/image on the whitelisted hosts next.config.ts already allows, ratcheting MAX_RAW_IMG down
        as each page converts. Tracked: #385 (update).
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE long-standing binding blocker, held C for a SEVENTH consecutive cycle, now the SOLE reason
        overall can't move off C (store_readiness and artifact_integrity both recovered to A this cycle;
        security_rls reached A+). Byte-identical state to 07-27: the journeys CI job never sets
        DATA_BACKEND (grep confirms 0 hits in .github/workflows/ci.yml), lib/supabase/server.ts:23 still
        defaults to the in-memory store, and the real-Postgres cold-start proof test still does not exist.
        PENDING_OPS.md documents precisely why the loop cannot self-close the CI half (.github/ is
        permission-gated; the scripts/run-journeys.sh workaround doesn't work because the server starts
        before that script runs) — this is now a PURELY owner-gated item, not a loop-fixable one. FIX
        (owner): add DATA_BACKEND: "supabase" to the journeys job's env block, add the cold-start
        write->restart->re-read + second-user-RLS-denial test, then flip the production default. Migration
        030 must land first. Tracked: #525.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship_critical, held B, but ONE of two capping gaps genuinely and systemically closed: the
        three-hue-ordinal anti-pattern on ManualScorecardView.tsx is fixed via a shared one-hue emphasis
        ladder (lib/scoring/verdicts.ts) backed by a NEW repo-wide ratchet
        (__tests__/design/off-system-palette-ratchet.test.ts, MAX_OFF_SYSTEM=52, can only shrink).
        Remaining: F7 visual baselines are narrowed but not closed — ~30 real PNGs now committed for PUBLIC
        routes only; the AUTHED/design-dense routes (incl. /focus, the exact flagship the closed violation
        was on) are captured in CI but not committed, blocked on a .github/ persistence step outside the
        loop's reach. FIX: commit the authed/design-dense screenshots + record their dual-axis verdict,
        prioritizing /focus. Tracked: #204.
    - dimension: business_case_strength
      severity: high
      gap: >-
        Ship_critical, held B, on genuinely stronger and independently-verified-honest footing. The
        30%->15% store take-rate correction is real (Apple SBP/Google Play programs, correctly separating
        eligibility from unenrolled status) and moved the shippable-today figure from $99,926 to $121,339 —
        confirmed NOT gaming (no behavioral input changed). The web/Stripe-only reading ($136,762) clears
        the floor without depending on the un-enrolled SBP rate at all. Remaining, unchanged: the mobile
        paywall (mobile/src/components/paywall-sheet.tsx) still lacks the $29 Apartment tier (60% of
        modeled conversions) and any annual-billing gate (all 9 real isAnnualBillingEnabled call sites are
        web-only) — a real, loop-buildable lever, distinct from the owner-only SBP enrollment. FIX: add the
        $29 tier + mirror the annual kill-switch in the mobile paywall so mobile monetization matches the
        model's own assumptions. Tracked: #672.
    - dimension: performance
      severity: medium
      gap: >-
        Not ship_critical. RECOVERED B (from C) — four of five findings from last cycle genuinely fixed:
        mockups readdirSync now async, analyze-apartment fan-out capped at 20 rooms, evaluate-set extraction
        now pLimit'd, and the gemini.ts serial-image-fetch + unused-resolveImageBlocks pair both fixed via a
        new shared concurrency gate (lib/ai/image-fetch-gate.ts) that also caught a subtler double-limiter
        bug in the same pass. Remaining: embedding-index.ts is still a full-table N+1 scan (ivfflat unused);
        next/image adoption still 0; no perf budget anywhere in CI. FIX cheapest-first: add a bundle-size/
        Lighthouse CI gate; sequence the pgvector RPC with the DATA_BACKEND cutover; adopt next/image on the
        already-whitelisted hosts. Tracked: #385.
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship_critical. Coverage up to 67.97/57.36/71.21/69.23 and a SECOND genuine hermetic cassette
        money-path test landed (diagnosis-pipeline-cassette.test.ts), extending last cycle's
        render-pipeline-cassette pattern as instructed. Unchanged: ci.yml:39 still runs bare `vitest run`
        (coverage floor not CI-gated, owner step); validation-agent.ts and research-assembler.ts sit at the
        SAME near-zero coverage as last cycle despite being named twice now; orchestrator.ts's actual
        fan-out loop is still ~88% dark. FIX: point CI at test:coverage (owner); extend the cassette pattern
        to validation-agent.ts/research-assembler.ts specifically. Tracked: #200.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
