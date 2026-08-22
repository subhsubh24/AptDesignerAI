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
  as_of: 2026-08-17
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C (still capped by functional_reality, unmoved for a NINTH consecutive cycle) — but the per-dimension picture improved SHARPLY, the best cycle since 08-03: TWO ship_critical dims that were below A RECOVERED FULLY to A. security_rls B->A: the tracked area-analysis project_id cross-tenant IDOR (issue #858) is genuinely fixed — POST /api/area-analysis no longer reads project_id from the client body at all (app/api/area-analysis/route.ts:120-131, with a SECURITY comment explaining the prior vuln), runAnalysis always derives it server-side from the ownership-verified room, and a real regression test (__tests__/api/area-analysis-project-idor.test.ts) pins it. A fresh spot-sweep of ~10 other multi-id routes (mockups, bundles, saved-designs, products, floor-plan, mobile share) found every one correctly binding client-supplied ids to the authenticated user. Held at A rather than A+ (the grading subagent argued A+): the sweep was NOT an exhaustive 57/57-route audit, and this exact "clean sweep -> A+" claim has been reversed by the NEXT cycle's fresh sweep six times running in this project's history — raise to A+ only after a full route-by-route audit sustains zero findings across at least one more cycle. artifact_integrity B->A: ROADMAP.md's reset-link-idempotency test-count overclaim is fixed (now correctly says "11 tests", verified by independently running __tests__/auth/reset-link-idempotency.test.ts -> 11 passed, exact match) — issue #727's finding is closed. Held at A not A+: the standing .github/workflows/ci.yml:1 stale "READY-TO-APPLY" header remains, an owner-gated file the loop cannot edit. Net: TWO ship_critical dims now sit below A (functional_reality C, design_taste B) — DOWN from four last cycle, the fewest since this scorecard's visible history began. functional_reality holds C for a 9th straight cycle (DATA_BACKEND persistence blocker byte-identical, still purely owner-gated, #525). design_taste holds B (F7 authed/design-dense screenshots, incl. /focus, still uncommitted — completely unchanged). correctness held A (3 of 4 A->A+ ceiling items still open; ownership.ts's fail-open error-swallowing was fixed via requireRoomOwnership/etc., PR #859). store_readiness and business_case_strength both held A on re-verified evidence. tests_evals held B (scene-assembler.ts coverage closed 1.5%->96.9% via a real cassette test; orchestrator.ts's actual fan-out loop remains the named gap, still ~86% dark for a 4th straight cycle). performance held B (APT-41 genuinely bound 3 previously-unbounded rooms queries feeding LLM prompts; no perf budget/Lighthouse CI gate yet).
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — TWO remain below A (functional_reality C, design_taste B), down from four last cycle
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C for a NINTH consecutive cycle — a fresh independent grader confirmed the persistence
        blocker is BYTE-IDENTICAL to 08-10: `grep -n "DATA_BACKEND" .github/workflows/ci.yml` -> 0 hits;
        the journeys job's env block still lacks it even though `supabase start` + `supabase db reset`
        stand up a fully-migrated Postgres right beside it, unused. lib/supabase/server.ts:22-24 still
        `return process.env.DATA_BACKEND === "supabase"` (defaults to memory), docstring confirms this is
        deliberately human-gated. `find __tests__ -iname "*cold-start*" -o -iname "*persistence*"` still
        returns only 3 mocked-client regression guards (saved-designs-full/existing-persistence.test.ts,
        analyze-apartment-persistence.test.ts, all `vi.mock("@/lib/supabase/server", ...)`) — no real
        write->restart->re-read + cross-user RLS-denial proof test exists anywhere in the repo. Of the 50
        commits since 08-10, `git log --since=2026-08-10 -- lib/supabase/server.ts
        .github/workflows/ci.yml` shows no real edits to either file. PENDING_OPS.md confirms both
        blocking items (`ci-journeys-data-backend`, `cutover-to-persistent-data`) remain status:open with
        unchanged reasoning (.github/ is permission-gated; the run-journeys.sh env-export workaround races
        the server's own startup, confirmed by re-reading the script). `npm test` 3120 pass/15 skip, 294
        files (up from 2944/12/275, all net-positive correctness/reliability fixes — c0c4a58 bounded
        queries, d7136a3/e986ac6 fail-loud on the free-save-limit count, dd51bdc mobile error boundary);
        `npx tsc --noEmit` clean; `npx eslint .` 0/0. No new functional-reality regression found across the
        full commit window. C not B (persistence is blocking for a retention-driven, sellable app); C not D
        (everything else genuinely works, every money-path signal green). RAISE to A: identical
        prescription for the 9th cycle running — set DATA_BACKEND: "supabase" in the CI journeys job's env
        block (a .github/ edit the loop cannot make), add the cold-start round-trip proof test, then make
        DATA_BACKEND=supabase the production default. Migration 030 must land BEFORE the cutover. Tracked:
        #525 (update — still open, unchanged root cause, now explicitly the sole item blocking overall off
        C for 9 straight cycles).
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh adversarial grader, cold, independently reproduced every mechanical signal).
        `npx tsc --noEmit` clean; `npm test` 3120 pass / 15 skip, 294 files (up from 2944/12/275); scoped
        reruns (ownership/IDOR/harness-ratchet/provider-floors, free-limit + cache-scope regressions) all
        green. `grep -rn "TODO\|FIXME\|XXX"` on billing/mobile/auth/agents paths -> zero hits, no bare
        empty-catch on non-test paths. Of the FOUR named A->A+ ceiling items, ONE is now closed:
        lib/auth/ownership.ts no longer has the boolean-collapsing userOwnsRoom/userOwnsProject/
        userOwnsCandidateProduct — it now exports requireRoomOwnership/requireProjectOwnership/
        requireCandidateProductOwnership (lines 48-83) which classify the Supabase error field explicitly:
        a real DB error 500s via apiError(), only PGRST116 (zero rows) or absent data 404s. Landed PR #859
        (2026-08-11); zero production callers of the old names remain. THREE ceiling items remain open,
        unchanged: (1) lib/agents/computer-use/agent-loop.ts:272 still hardcodes ThinkingLevel.HIGH, still
        self-documented as a deliberate cost-contract exception; (2) no maxDuration sweep test exists
        despite 31 files declaring maxDuration; (3) harness-ratchet.test.ts's SCAN_DIRS=["lib","app"] still
        excludes scripts/. Spot-checked 6 commits since 08-10 (c0c4a58, d3ea54f, e986ac6, d7136a3, 304dda9,
        9bed74e) — all genuine fixes with regression tests, not cosmetic: d3ea54f fixed cacheScope images
        being silently dropped whenever `tools` was also present, meaning every room-diagnosis call was
        running blind on the uploaded photo. No new regression found in the 50-commit window. RAISE to A+:
        land the maxDuration sweep test; extend SCAN_DIRS to scripts/; resolve the computer-use
        HIGH-thinking deferral.
    security_rls:
      grade: A
      ship_critical: true
      gap: >-
        RECOVERS B->A — the tracked area-analysis project_id cross-tenant IDOR (issue #858) is genuinely
        fixed, independently re-verified. app/api/area-analysis/route.ts:120-131 no longer reads
        `project_id` from the client body at all (only `room_id`), with a SECURITY comment explaining the
        prior vuln in detail; the POST handler calls `runAnalysis(supabase, room_id, undefined)` (line
        148), so `effectiveProjectId = project_id || room.project_id` (line 212) always resolves to the
        ownership-verified room's own project. Sibling route refine-chat already followed this pattern. A
        real regression test exists: `__tests__/api/area-analysis-project-idor.test.ts` asserts the
        `projects` table is queried only with the caller's own project_id even when a victim project_id is
        sent in the body — this is a genuine, tested fix, not a comment-only claim. A fresh spot-sweep of
        ~10 other multi-client-id routes (mockups bundle_id/product_ids, bundles, bundles/evaluate,
        saved-designs project_id, products search_session_id, products/evaluate-set, projects/floor-plan,
        mobile saved-designs share, shared/[token]) found every one correctly binding client-supplied ids
        to the authenticated user, each with either an explicit binding query or a comment documenting the
        fix. `node scripts/check-security-invariants.mjs` -> PASS (26/26 RLS tables, no client-secret leak
        web/mobile); no committed secrets (`.env.example` is the only tracked env file). HELD at A rather
        than A+ (the grading pass argued A+ on "zero findings"): the sweep spot-checked ~10 of 57 total
        API routes, not an exhaustive route-by-route audit, and this exact "clean sweep -> A+" claim has
        been reversed by the NEXT cycle's fresh sweep SIX times running in this project's history (07-09
        through 08-10). RAISE to A+: a full, independently-verified 57/57-route audit sustaining zero
        findings across at least one further cycle, without inheriting this cycle's partial sweep as
        proof. Tracked: CLOSE #858 (the fix is real, tested, and independently re-verified).
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — byte-for-byte unchanged on the F7 capping axis, no regression on the palette axis.
        `find e2e/__screenshots__ -iname "*.png" | wc -l` -> still exactly 30, every filename still
        prefixed `public-*` (independently re-verified). Zero committed baselines for /focus, /dashboard,
        /mockups, /compare, /diagnosis — the design-dense authed surfaces where the original three-hue
        violation actually lived. `__tests__/design/off-system-palette-ratchet.test.ts` MAX_OFF_SYSTEM
        still 36 (no further tightening this cycle, but no regression). `npx vitest run
        __tests__/design/off-system-palette-ratchet.test.ts __tests__/design/warm-pill-contrast.test.ts`
        -> 35/35 pass. Of the 50 commits since 08-10, only 5 touched UI files (dashboard, picks, focus,
        saved, room-image-gallery) and all are mechanical (<img>->next/image conversions, fetch-timeout
        hardening) — grepped each for ad-hoc hex/purple-gradient/emoji-iconography, found none;
        focus/page.tsx even carries a deliberate design-system comment explaining an intentional opaque-
        background choice over a stacked alpha tint (issue #711), evidence of taste being actively
        maintained. AUTHED_A11Y_ROUTES / DESIGN_DENSE_A11Y_ROUTES (journeys.spec.ts:391,439) still wired;
        /focus remains excluded from the axe sweep with the exclusion reason documented inline (kicks off
        a live, slow LLM pipeline), not silently dropped. B not A: F7's DoD requires BOTH committed
        artifacts AND a recorded dual-axis verdict for design-dense/authed routes, and neither exists for
        that tier — this is a legitimate AGENTS.md structural bar (the CI persistence step is
        .github/-gated, outside the loop's reach), correctly not re-derived each run. RAISE to A: commit
        real authed/design-dense screenshots (capture mechanism already exists in CI; persisting requires
        the owner-gated .github/ step) and record their dual-axis verdict, prioritizing /focus. Tracked:
        #204 (update — unchanged; F7 remains the sole capping gap).
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        HOLDS A — a fresh grader independently re-verified all prior fixes are still genuinely in place.
        `lib/storage/user-storage.ts`'s purgeUserStorage still sweeps `USER_UPLOAD_BUCKETS` by `${userId}/`
        prefix plus mockups via the trusted `mockup_jobs.result_image_url` column only (deliberately
        excluding client-settable thumbnail/cover-image columns to prevent cross-tenant delete), called
        BEFORE deleteUser in both app/api/user/delete/route.ts and app/api/mobile/account/route.ts. `npx
        vitest run __tests__/api/account-deletion-storage.test.ts __tests__/api/user-delete.test.ts
        __tests__/api/mobile-account-delete.test.ts __tests__/compliance/privacy-disclosure.test.ts` -> 4
        files, 38 tests, all passed. docs/app-privacy.md and app/privacy/page.tsx re-read, still agree on
        location disclosure (building-address-derived coordinates, no device GPS/permission). mobile/
        eas.json build+submit profiles real; app icon re-verified 1024x1024, 8-bit RGBA PNG; bundle id
        `ai.aptdesigner.app` consistent. Of the 50 commits since 08-10, filtering out the branch's shallow-
        clone root commit, ZERO touched lib/storage, app/privacy, the delete routes, or mobile/eas.json/
        app.json (confirmed via diff) — and a keyword sweep for new location/contacts/microphone/tracking/
        permission surfaces across app/api, mobile/, app/privacy found nothing new. PENDING_OPS.md's two
        remaining items (refile-store-privacy-forms, audit-orphaned-storage-objects) re-confirmed correctly
        scoped as owner/one-time-ops. Track D3 (device-captured store screenshots) remains the sole open
        item, a HUMAN step — keeps this at A, not A+. Tracked: #726 (stays closed — confirmed still
        genuinely resolved).
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        RECOVERS B->A — the tracked overclaim is genuinely fixed and independently re-verified.
        ROADMAP.md's reset-link-idempotency claim now reads "11 tests cover the decision table and the
        actual wiring sequence" (was "28 tests"); ran `npx vitest run
        __tests__/auth/reset-link-idempotency.test.ts` -> 11 passed, exact match. Fresh spot-checks this
        cycle, all consistent: e2e/ROUTE_INVENTORY.md's "20 of 35 routes" claim still matches `find app
        -name page.tsx` -> 35; pricing consistent across lib/billing/stripe.ts, app/pricing/page.tsx,
        mobile/src/lib/paywall-disclosure.ts, and docs/BUSINESS_CASE.md ($29/$49/$399 throughout);
        PENDING_OPS.md's OWNER_ACTIONS YAML parses cleanly; ROADMAP.md ticks for F1 (lint gate), F2
        (coverage floor), G1 (rate limiting, 118 call-site hits), and C4 (entitlements) all verified
        against real, matching code — none bare-ticked without an artifact. The Run 172 ratchet-fix claim
        (MAX_RAW_IMG dropped to 29) verified accurate against `__tests__/perf/no-img-growth.test.ts`. No
        new overclaim found in the doc-touching commits since 08-10 — these are terse housekeeping ledgers
        with concrete acceptance-check output pasted inline, not narrative claims. The ONE remaining item
        is unchanged and structural, not a fresh finding: `.github/workflows/ci.yml:1` still carries the
        stale "READY-TO-APPLY workflow — copy this to .github/workflows/ci.yml" header — a real, if inert,
        doc/artifact mismatch the autonomous loop cannot fix (.github/ is permission-gated per AGENTS.md's
        structural-bar rule), correctly not re-derived as a fresh drop. A not A+: that one owner-gated
        blemish is the sole thing keeping this short of "nothing material to change." Tracked: CLOSE #727
        (the reset-link test-count overclaim that reopened it is fixed and verified; the remaining
        .github/ nit is the same permanently-recorded structural bar as #525's persistence blocker, not a
        new issue).
    business_case_strength:
      grade: A
      ship_critical: true
      gap: >-
        HOLDS A — a fresh grader independently re-verified the mobile-parity fix is unchanged and the
        numbers are bit-identical, with firmer validation coverage than last cycle. `node
        analysis/business_case_without_annual_arr.mjs` -> $121,339 (bit-identical); `node
        scripts/validate-computation.mjs` -> "12 figure(s) verified... PASS" (up from 10 — two new year-1
        sensitivity scripts registered). docs/BUSINESS_CASE.md's BUSINESS_CASE_SUMMARY YAML
        (arr_year1.base, floor_met_year1) is internally consistent with the body; the steady-state vs
        year-1 distinction (arr_year1.base is explicitly annotated as steady-state, with the true year-1
        exit run-rate $71,207 disclosed in prose, not hidden) survives a fresh reading. Mobile paywall
        parity re-verified intact: mobile/src/lib/paywall-fallback.ts still lists Apartment ($29) first,
        Monthly ($49) second; paywall-annual-gate.ts and billing-config.ts still fail closed to false on
        any error. `npx vitest run __tests__/billing/paywall-annual-gate.test.ts
        __tests__/billing/paywall-fallback.test.ts __tests__/api/mobile-billing-config.test.ts` -> 13/13
        passed. `git log --since=2026-08-10 -- docs/BUSINESS_CASE.md` -> one commit (32ea347), a genuine
        GTM-auditor-driven disclosure fix (added steady-state caveats + two newly-registered/verified
        sensitivity figures) with zero ARR-figure or behavioral change per its own diff — confirmed, not
        gamed. Pricing cross-check (stripe.ts/pricing page/doc) still exact. Lever spot-check: referral
        codes, PAST_DUE_GRACE_DAYS=14 grace period, and the save-limit-paywall funnel event all wired in
        real code, not just narrated. A not A+: no fresh, specific, buildable, value-bar-clearing lever is
        currently nameable — the remaining items (Apple Small Business Program enrollment, annual-billing
        migration 021 cutover) are owner-only actions already tracked in PENDING_OPS.md, not unbuilt code
        the loop controls. Tracked: no action — #672 stays closed, confirmed still genuinely resolved.
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B, with one of the two long-named weak spots genuinely closed this cycle. `npx vitest run
        --coverage` -> 72.79% stmts / 62.05% branch / 76.82% funcs / 74.2% lines, 3120 pass / 15 skip, 294
        files (up from 70.35/59.57/73.86/71.84, 2944/12/275) — independently re-run and matching. scene-
        assembler.ts (previously ~1.5% dark for 3+ cycles) is now 96.92% stmts / 76.47% branch / 100% funcs
        via a real 236-line cassette test (__tests__/agents/scene-assembler-cassette.test.ts, commit
        1e7a851) — closes one of the two chronically-named gaps. orchestrator.ts's actual fan-out/scoring
        loop (~lines 741-3492) remains the other: now 13.92% stmts / 16.03% branch / 13.06% funcs (up only
        marginally from 11.66% stmts) — the 4 new orchestrator test files
        (orchestrator-dispatch-primitives/filters/primitives/score-tiebreak.test.ts) exercise extracted
        pure helpers, not the loop itself, so the real gap is essentially unmoved for a 4th straight cycle.
        CI STILL never gates coverage (ci.yml:39 runs bare `npm test`) — though scripts/preflight.sh GATE
        1f now runs `npm run test:coverage` against real floors (60/49/64/61), so the readiness gate the
        loop actually uses does check coverage even though CI itself doesn't (a genuine partial mitigation,
        still owner-gated for the CI half). Spot-checked 5 newest test files (area-analysis-refine-room-
        limit, gemini-cache-scope-tools, picks-route, apartment-research-route, relation-graph) — all real
        behavior/regression tests with explicit bug narratives, zero change-detector-pattern smell.
        docs/loop-memory.md Run 170 (2026-08-16) documents a fresh live-eval-driven find: diagnosis-eval
        flakiness traced to gemini.ts silently dropping cacheScope images when `tools` was present (a real
        production bug), root-caused and fixed with a mutation-proven regression test. RAISE to A: point
        ci.yml verify at `npm run test:coverage` (owner step); extend the cassette pattern to
        orchestrator.ts's actual fan-out loop specifically — now the sole named coverage gap after
        scene-assembler.ts's closure, and the largest untested surface in the repo. Tracked: #200 (update).
    performance:
      grade: B
      ship_critical: false
      gap: >-
        HOLDS B — genuine, verified progress closing a real unbounded-query defect, one known item still
        untouched. APT-41 (c0c4a58) fixed three previously-unbounded rooms queries feeding LLM prompts:
        app/api/picks/route.ts, app/api/area-analysis/route.ts, and area-analysis/refine/route.ts
        previously fetched all owned/sibling rooms with no `.limit()`; now bounded (`.limit(100)` /
        `.limit(30)`) AND correctly paired with `.order("created_at", {ascending:false})` — a reviewer
        caught that `.limit()` without `.order()` is non-deterministic on Postgres/PostgREST, which also
        threatens the determinism contract since the result feeds a prompt; three new regression tests
        assert both. Raw-`<img>` ratchet independently re-run: `npx vitest run
        __tests__/perf/no-img-growth.test.ts` -> 2/2 passed, MAX_RAW_IMG=29 confirmed tight (two more
        conversions since 08-10, both using the established host-gated safe-fallback pattern rather than a
        blind swap). lib/store/embedding-index.ts unchanged — still a full-table select("*") + in-memory
        cosine scan, still correctly sequenced with the DATA_BACKEND/pgvector cutover (no commits touched
        it this window). Fresh hunt across the 50-commit window (bundles/evaluate, products/evaluate-set,
        mockups, diagnosis, search, saved-designs, analyze-apartment, apartment-research, rooms/[roomId]/
        images) found no new N+1 or blocking-I/O regression; one notable non-regression is
        analyze-apartment/route.ts's intentional serialization of a formerly-concurrent Promise.all for
        room-diagnosis writes, a defensible correctness-over-parallelism tradeoff explained in its own
        comment, not a perf bug. No perf budget/Lighthouse CI gate exists anywhere. B not A: the mechanical
        signal the rubric requires for A ("no N+1/blocking on hot paths · perf budget met") still lacks the
        budget-gate half. RAISE to A, cheapest-first: add a crude bundle-size/Lighthouse CI gate; sequence
        the embedding-index pgvector RPC with the DATA_BACKEND cutover. Tracked: #385 (update).
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE long-standing binding blocker, held C for a NINTH consecutive cycle, and now the SOLE
        ship_critical dimension keeping overall off B/A on its own weight (design_taste is the other
        remaining ship_critical gap, but at a lower severity). Byte-identical state to 08-10: the journeys
        CI job never sets DATA_BACKEND (0 hits in .github/workflows/ci.yml), lib/supabase/server.ts still
        defaults to the in-memory store, and the real-Postgres cold-start proof test still does not exist
        (only mocked-client regression guards). PENDING_OPS.md documents precisely why the loop cannot
        self-close the CI half (.github/ is permission-gated; the scripts/run-journeys.sh workaround
        doesn't work because the server starts before that script runs) — this remains a PURELY owner-gated
        item, not a loop-fixable one. FIX (owner): add DATA_BACKEND: "supabase" to the journeys job's env
        block, add the cold-start write->restart->re-read + second-user-RLS-denial test, then flip the
        production default. Migration 030 must land first. Tracked: #525.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship_critical, held B, unchanged since 08-10. The palette-ratchet axis is stable at MAX_OFF_SYSTEM
        36 (no regression). The capping gap, F7 visual baselines, is completely unchanged: exactly 30
        committed PNGs, every one for a PUBLIC route only; the AUTHED/design-dense routes (incl. /focus,
        the exact flagship the original violation was on) are captured in CI but not committed, blocked on
        a .github/ persistence step outside the loop's reach. FIX: commit the authed/design-dense
        screenshots + record their dual-axis verdict, prioritizing /focus. Tracked: #204 (update).
    - dimension: security_rls
      severity: medium
      gap: >-
        Ship_critical, RECOVERED B->A this cycle — the tracked area-analysis project_id IDOR (#858) is
        genuinely fixed with a real regression test, and a spot-sweep of ~10 other multi-id routes found no
        new instance. Not yet A+: the sweep was not an exhaustive 57/57-route audit, and this exact "clean
        sweep" claim has been reversed by the next cycle's fresh sweep six times running in this project's
        history. FIX (next cycle): a full, independently-verified route-by-route audit across all 57 API
        routes for the "bind one id, leave another unbound" class, sustained clean across at least one more
        cycle before crediting A+. No new issue needed — this is the standing per-cycle discipline the
        routine already applies; CLOSE #858 as its specific finding is resolved.
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship_critical. Coverage up to 72.79/62.05/76.82/74.2 (3120 pass/15 skip/294 files). A
        long-named weak spot genuinely closed this cycle: scene-assembler.ts 1.5%->96.92% via a real
        236-line cassette test. Remaining, now a FOURTH straight cycle essentially unchanged:
        orchestrator.ts's actual fan-out/scoring loop is still only 13.92% stmts (up marginally from
        11.66%) — the largest untested surface in the repo, and now the sole named coverage gap after
        scene-assembler.ts's closure. CI still doesn't gate coverage in ci.yml (owner step), though
        preflight's own gate now does. FIX: point ci.yml at test:coverage (owner); extend the cassette
        pattern to orchestrator.ts's real fan-out loop specifically. Tracked: #200 (update).
    - dimension: performance
      severity: low
      gap: >-
        Not ship_critical. Held B on genuine progress: APT-41 bound three previously-unbounded rooms
        queries (picks, area-analysis x2) that fed an LLM prompt, paired correctly with .order() to
        preserve determinism. Remaining: embedding-index.ts's full-table N+1 scan (correctly sequenced with
        the DATA_BACKEND cutover); no perf budget/Lighthouse CI gate anywhere. FIX cheapest-first: add a
        crude bundle-size/Lighthouse CI gate; sequence the pgvector RPC with the DATA_BACKEND cutover.
        Tracked: #385 (update).
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
