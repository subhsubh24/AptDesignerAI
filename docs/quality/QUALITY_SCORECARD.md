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
  as_of: 2026-09-07
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C for a TENTH consecutive cycle, capped by functional_reality — this is a FULL CONFIRMATORY HOLD: all NINE dimensions landed at the exact same letter as the 2026-08-17 (12th) grade, the first fully flat cycle in this scorecard's visible history. 73 commits landed in the 21-day gap (2026-08-17 to 2026-09-06) but none touched either ship-critical blocker's files (.github/workflows/ci.yml, lib/supabase/server.ts, ROADMAP.md were all byte-identical per `git log --oneline 37d0142..HEAD -- <path>` returning empty for each) and none introduced a fresh adversarial finding on any dimension that was previously clean. The 73-commit window's dominant pattern was a large "discarded DB error" correctness sweep (~20 commits fixing real errors misclassified as 404/validation across ~24 API route files, all independently spot-verified as genuine fixes with regression tests, none touching authorization logic incorrectly), 8 next/image conversions (APT-39 continuation), several focus-visible a11y fixes (one new permanent ratchet test added), a lifecycle-email cron N+1 batch fix, two API select-narrowing perf wins, an orchestrator fail-open reliability fix, and a new migration (034_push_tokens.sql) for a mobile push-token receiver with RLS correctly wired and docs/app-privacy.md correctly updated to disclose it. security_rls's sweep this cycle was the most thorough on record (41 of 58 routes read line-by-line, up from ~10 in prior cycles) and found zero new instances of the project's historically recurring "bind one client id, leave another unbound" IDOR class — still held at A not A+ per the project's own six-time-reversed-claim precedent, now with materially stronger coverage backing the hold. TWO ship-critical dimensions remain below A (functional_reality C, design_taste B) — unchanged in count and identity from last cycle.
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — TWO remain below A (functional_reality C, design_taste B), unchanged from last cycle
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C for a TENTH consecutive cycle — a fresh independent grader confirmed the persistence
        blocker is BYTE-IDENTICAL to 2026-08-17: `git log --oneline 37d0142..HEAD -- .github/workflows/ci.yml
        lib/supabase/server.ts` (73 commits since last grade) returns EMPTY — zero commits touched either
        file. `lib/supabase/server.ts:23` still `return process.env.DATA_BACKEND === "supabase"` (defaults to
        memory). The `journeys` CI job's env block still never sets DATA_BACKEND, so the authed e2e tier
        exercises the in-memory store, not RLS-enforced Postgres. `find __tests__ -iname "*cold-start*" -o
        -iname "*persistence*"` still returns only 3 mocked-Supabase-client regression guards, no real write
        -> restart -> re-read + cross-user RLS-denial proof test. PENDING_OPS.md's `ci-journeys-data-backend`
        and `cutover-to-persistent-data` entries independently re-read and confirmed unchanged, still
        correctly framed as owner-gated (.github/ is permission-gated for the loop; the run-journeys.sh
        env-export workaround races the server's own startup). Spot-checked 2 of the ~18 "discarded error"
        commits (72237d5 on diagnosis/route.ts, 7acd35d on rooms/[roomId]/route.ts) — both correctly
        distinguish PGRST116 from real DB errors, genuine fixes, no new bugs. `npm test` 3201 pass/19 skip,
        299/307 files (up from 3120/15/294, all net-positive); `npx tsc --noEmit` clean; `npx eslint .` 0/0.
        No new functional-reality regression found across the full 73-commit window. C not B (persistence is
        blocking for a retention-driven, sellable app); C not D (everything else genuinely works). RAISE to
        A: identical prescription for the 10th cycle running — set DATA_BACKEND: "supabase" in the CI
        journeys job's env block (a .github/ edit the loop cannot make), add the cold-start round-trip proof
        test, then make DATA_BACKEND=supabase the production default. Migration 030 must land BEFORE the
        cutover. Tracked: #525 (update — still open, unchanged root cause, now explicitly the sole item
        blocking overall off C for 10 straight cycles).
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. `npx tsc --noEmit` clean; `npm test` 3201 pass / 19 skip, 299/307 files (up from
        3120/15/294); zero TODO/FIXME/XXX across app/ and lib/. Spot-checked 6+ diffs from the 73-commit
        window (fdb58ab, 7acd35d, cb18011, d6b6762, 396206c, e6baf66) — all genuine correctness/reliability
        fixes with real regression tests. fdb58ab and 7acd35d were independently verified to preserve
        ownership/authorization logic correctly while changing only error classification (ownership check
        still runs first; PGRST116 carve-outs explicitly reasoned about) — no auth regression in any sampled
        commit. d6b6762's middleware PUBLIC_PATHS addition (checkout-success/checkout-cancel) was checked
        against CSRF/CORS/rate-limiting/billing-data-exposure and found clean. cb18011's orchestrator
        fail-open (lib/agents/orchestrator.ts) mirrors an existing .catch() fail-open pattern ~250 lines
        above in the same file — a genuine reliability fix, not a silent behavior change. e6baf66's cron
        N+1 batch fix shows real review process: a reviewer caught the new batched functions lacked
        mixed-cohort tests (the class of bug where one user's data leaks onto another via a mis-keyed batch
        result), and a follow-up commit added them. Three named A->A+ ceiling items remain open, unchanged:
        (1) lib/agents/computer-use/agent-loop.ts:295 still hardcodes ThinkingLevel.HIGH, still
        self-documented as a deliberate cost-contract exception; (2) no maxDuration sweep test exists despite
        35 files now declaring maxDuration (up from 31) — only single-route ad hoc checks exist, no
        cross-file sweep; (3) harness-ratchet.test.ts's SCAN_DIRS=["lib","app"] still excludes scripts/. No
        new regression found in the 73-commit window. RAISE to A+: land the maxDuration sweep test; extend
        SCAN_DIRS to scripts/; resolve the computer-use HIGH-thinking deferral.
    security_rls:
      grade: A
      ship_critical: true
      gap: >-
        HOLDS A, with the most thorough sweep on record backing the hold. The tracked area-analysis
        project_id cross-tenant IDOR (issue #858, closed last cycle) is independently re-verified still
        fixed: app/api/area-analysis/route.ts never reads client-supplied project_id; effectiveProjectId
        always derives from the ownership-verified room. `__tests__/api/area-analysis-project-idor.test.ts`
        -> 4 passed. `node scripts/check-security-invariants.mjs` -> PASS (27 public tables, all RLS-enabled;
        no NEXT_PUBLIC_*/EXPO_PUBLIC_* secret leak web/mobile). The new push_tokens table (migration 034) was
        checked and is clean: RLS enabled with a real `USING/WITH CHECK (user_id = auth.uid())` policy, and
        the route resolves user id server-side from the Bearer JWT, never trusting a client-supplied id. This
        cycle's sweep for the project's historically recurring "bind one client id, leave another unbound"
        IDOR class was materially more thorough than prior cycles: 41 of 58 total API routes were read
        line-by-line (up from ~10 in the prior cycle), covering every route touched in the 73-commit window
        plus 16 additional elevated-risk routes (multi-id, token-auth, destructive), plus a repo-wide grep of
        55 `.eq("id", <var>)` call sites all triaged against their surrounding ownership checks. Confirmed
        correct binding on bundles (product_ids re-bound to room_id), mockups (bundle_id AND product_ids
        re-bound to room_id), products/evaluate (product_id checked against room_id), products POST
        (search_session_id re-bound to room_id), saved-designs (project_id separately bound, only the bound
        value persisted), and 30+ other routes across rooms/projects/diagnosis/search/billing/cron/mobile. No
        new instance of the recurring IDOR class found. Held at A rather than A+: 17 of 58 routes were not
        read line-by-line this cycle (lower-risk by shape — session-derived-only ids, external proxies,
        admin/internal-secret-gated), and this project's own documented precedent is that a "clean sweep ->
        A+" claim has been reversed by the NEXT cycle's fresh sweep six times running — a partial-but-larger
        sweep does not yet meet that bar, even though this cycle's coverage is the strongest to date. RAISE
        to A+: a genuinely exhaustive all-58-route audit (the remaining 17 named above) sustaining zero
        findings across at least one further cycle. Tracked: no open issue (#858 stays closed, re-confirmed
        genuinely resolved).
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — the F7 capping gap is unchanged, and this cycle's notably larger UI diff (24 files vs
        ~5 in the prior cycle) was independently re-swept for slop and found clean. `find e2e/__screenshots__
        -iname "*.png" | wc -l` -> 34 (up from 30), every filename still prefixed `public-*` — zero committed
        baselines for /focus, /dashboard, /mockups, /compare, /diagnosis, the design-dense authed surfaces
        where the original violation lived. All 10 of the largest changed UI files were read and judged
        against VISION.md's design bar: focus/page.tsx, compare/page.tsx, and products/page.tsx are
        neutral-mechanical (gated next/image conversions matched to actual generation aspect ratios, no
        layout/color changes); the 12 focus-visible a11y commits (dashboard, account, billing, privacy,
        support, terms, place-autocomplete, select, dialog, badge) are genuine polish using only existing
        design tokens (ring-ring, accent-warm) plus a NEW permanent ratchet test
        (focus-visible-ratchet.test.ts, ceiling 0) that didn't exist at the last grade — real quality-bar
        investment, not mechanical find-replace; motion.tsx's ScrollStagger removal is dead-code cleanup with
        zero visual change. Zero new ad-hoc hex colors, gradients, or emoji-as-icon found anywhere in the
        24-file diff. `npx vitest run __tests__/design/off-system-palette-ratchet.test.ts
        __tests__/design/warm-pill-contrast.test.ts __tests__/design/focus-visible-ratchet.test.ts` ->
        38/38 pass, MAX_OFF_SYSTEM ceiling untouched. B not A: F7's DoD requires BOTH committed authed/
        design-dense baselines AND a recorded dual-axis verdict, and neither exists for that tier — a
        legitimate AGENTS.md structural bar (the CI screenshot-persistence step is .github/-gated), correctly
        not re-derived each cycle. RAISE to A: commit real authed/design-dense screenshots (capture mechanism
        already exists in CI; persisting requires the owner-gated .github/ step) and record their dual-axis
        verdict, prioritizing /focus. Tracked: #204 (update — unchanged; F7 remains the sole capping gap; a
        larger commit window produced zero new slop, reinforcing the gap is structural, not a discipline
        lapse).
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        HOLDS A — a fresh grader independently re-verified all prior fixes are unregressed and the new
        mobile push-token surface is honestly disclosed. `git log --oneline 37d0142..HEAD --
        lib/storage/user-storage.ts app/api/user/delete/route.ts app/api/mobile/account/route.ts` is EMPTY —
        the account-deletion storage purge is byte-identical to last cycle. `npx vitest run
        __tests__/api/account-deletion-storage.test.ts __tests__/api/user-delete.test.ts
        __tests__/api/mobile-account-delete.test.ts __tests__/compliance/privacy-disclosure.test.ts` -> 4
        files, 38 tests, all pass. The new push_tokens surface (migration 034) was independently checked
        end-to-end: docs/app-privacy.md's push-token/Device ID disclosure matches exactly what
        app/api/mobile/push-tokens/route.ts collects and how (permission-gated, RLS-scoped, cascade-deleted
        on account deletion) — a source-derived test (__tests__/compliance/privacy-disclosure.test.ts:234)
        confirms this, not a hand-kept claim. mobile/eas.json, app.json, bundle id, and the 1024x1024 icon
        are all unregressed (git log on those paths is empty). No new location/contacts/microphone/tracking
        permission surface found in the window. A not A+: Track D3 (device-captured store screenshots)
        remains a human-only step; additionally, PENDING_OPS.md's `refile-store-privacy-forms` item now
        explicitly needs to cover the push-token/Device-ID category (the doc side is accurate and
        test-enforced; only the external App Store Connect / Play Console forms are stale) — both gaps are
        owner-gated, not code-level defects, same class as always. Tracked: #726 (stays closed — confirmed
        still genuinely resolved; no new issue needed, both open items already live in PENDING_OPS.md's
        owner-action mechanism).
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        HOLDS A — a fresh grader found zero new overclaims across the 73-commit window, the cleanest
        artifact-integrity sweep on record for this project. `.github/workflows/ci.yml:1`'s stale
        "READY-TO-APPLY" header is unchanged (`git log --oneline 37d0142..HEAD -- .github/workflows/ci.yml`
        empty) — the sole standing, owner-gated nit, correctly not re-derived. `e2e/ROUTE_INVENTORY.md`'s
        "22 of 35 routes" claim verified exact against `find app -name page.tsx` -> 35. docs/app-privacy.md's
        push-token disclosure (migration 034) verified consistent with the actual route code, no over- or
        under-claim. ROADMAP.md was NOT touched by any of the 73 commits (`git log` on the path is empty) —
        zero risk of a fresh unbacked tick this cycle, the cleanest possible outcome for that check. Pricing
        cross-checked across stripe.ts/pricing page/mobile paywall-fallback/BUSINESS_CASE.md — still exact.
        2 housekeeping-ledger commits (6bc7e84, 84c14a4) spot-checked in full against their claimed eval
        gold-fixture artifacts — both accurate, and 6bc7e84 candidly documents two self-corrected premise
        errors (APT-66, APT-56) rather than overclaiming. PENDING_OPS.md's as_of (2026-08-26) and two
        status:done items (reconcile-canonical-domain, enforce-ci-required-checks) spot-verified genuinely
        done in code, with the newer APT-69 domain-unregistered finding honestly disclosed as a fresh open
        item rather than buried under the older "done" entry. A not A+: the one owner-gated `.github/` header
        blemish remains the sole thing keeping this short of "nothing material to change." Tracked: no open
        issue (#727 stays closed, re-confirmed still genuinely resolved).
    business_case_strength:
      grade: A
      ship_critical: true
      gap: >-
        HOLDS A — a fresh grader independently re-verified the model is unchanged, bit-identical, and
        internally honest, with an explicit ruling on a new cross-team question. `node
        analysis/business_case_without_annual_arr.mjs` -> $121,339 (bit-identical); `node
        scripts/validate-computation.mjs` -> "12 figure(s) verified... PASS" (unchanged). `git log --oneline
        37d0142..HEAD -- docs/BUSINESS_CASE.md mobile/src/lib/paywall-fallback.ts
        mobile/src/lib/paywall-annual-gate.ts mobile/src/lib/billing-config.ts` is EMPTY across all four
        files — the mobile paywall parity fix and the business-case doc are both byte-identical to last
        cycle. `npx vitest run __tests__/billing/paywall-annual-gate.test.ts
        __tests__/billing/paywall-fallback.test.ts __tests__/api/mobile-billing-config.test.ts` -> 13/13
        passed. Re-read the full doc fresh: the steady-state-vs-year-1 caveats (added two cycles ago) are
        still present and undropped at every relevant figure. Pricing cross-check still exact. Swept the full
        73-commit window for a fresh lever (referral/paywall/pricing/retention keywords) — the only matches
        were "convert...to next/image" commits (image-loading perf, not conversion-funnel work); no new lever
        found. RULING on the sibling GTM Auditor's fresh APT-69/APT-70 findings (domain never registered;
        production 45+ days stale): docs/BUSINESS_CASE.md contains zero references to the domain, deployment,
        or production status — its claims are entirely about the economic MODEL (pricing, churn, COGS,
        take-rates, reproducible ARR scenarios), not GTM execution state. Those findings correctly stay on the
        GTM Auditor's own artifact_freshness lens (already dropped A->D there) and do not drop this dimension.
        A not A+: no fresh, buildable lever nameable; the remaining items (Apple SBP enrollment, migration
        021/annual cutover, domain registration, prod redeploy) are all owner-only actions already tracked in
        PENDING_OPS.md. Tracked: no action needed (#672 stays closed, re-confirmed still genuinely resolved).
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B. `npx vitest run --coverage` -> 73.1% stmts / 62.34% branch / 77.19% funcs / 74.5% lines,
        3201 pass / 19 skip, 299/307 files (up from 72.79/62.05/76.82/74.2, 3120/15/294) — comfortably above
        all floors (60/49/64/61). orchestrator.ts's actual fan-out/scoring loop is now FLAT for a FIFTH
        straight cycle: 13.91% stmts (vs 13.92% last cycle) — `git log --oneline 37d0142..HEAD --
        '__tests__/agents/orchestrator*'` returned nothing, zero new orchestrator-loop test files in 73
        commits. This remains the sole named gap and the largest untested surface in the repo. Spot-checked 3
        of the newest test files (refine-chat-error-classification, products-search-session-binding,
        saved-designs-narrowed-embeds) — all genuine behavioral/regression tests encoding a specific prior
        bug and asserting the corrected behavior, not change-detector snapshots. Real, credit-worthy eval-
        breadth growth this cycle even though it doesn't move the letter: 3 new live-eval gold fixtures
        (bathroom, dining_area, dark/jewel-tone bedroom — the last specifically probing whether the vision
        pipeline defaults to warm/neutral guesses on saturated dark palettes) plus a new product-discovery-
        stage live eval chaining searchProducts->quickScreenCandidates->extractFromUrlBatch against a real
        gold fixture, previously untested. CI still never gates coverage (ci.yml runs bare `npm test`, owner
        step) though preflight's own GATE 1f does. RAISE to A: point ci.yml at test:coverage (owner); extend
        the cassette pattern to orchestrator.ts's real fan-out loop specifically, still the sole coverage gap
        after scene-assembler's closure two cycles ago. Tracked: #200 (update — the issue's scene-assembler
        reference is now STALE and should be removed since that gap closed at the 2026-08-17 grade; its
        "third straight cycle" language should update to fifth).
    performance:
      grade: B
      ship_critical: false
      gap: >-
        HOLDS B — two genuine, well-tested perf fixes landed this cycle, but the two structural A-blockers
        named across the last several cycles remain untouched. e6baf66 batches three lifecycle-email crons'
        (activation/winback/habit) per-candidate N+1 lookups into `.in()` queries via new getMarketingOptOutMap
        /getProEntitlementMapWeb helpers — genuinely tested with mixed-cohort assertions specifically catching
        mis-keyed batch results (68/68 tests pass across 5 files), the exact bug class a single-user test
        can't catch. 1dfaa4e (APT-65) narrows select("*") on mockups + projects GET to consumed fields —
        independently traced against actual consumers (dashboard.tsx, mockups polling UI) and confirmed no
        field a consumer reads was dropped — but unlike the established cb18011/b403f82 precedent, it shipped
        WITHOUT a pinned regression test, so a future edit could silently revert to select("*") with nothing
        catching it; a real, if minor, gap in an otherwise-good fix. 6712b16's bounded/ordered rooms fetch and
        cb18011's projects/[projectId] narrowing both re-verified intact via their regression tests (2/2 and
        6/6 pass). The raw-<img> ratchet count moved 29->30, but this is a MEASUREMENT-BUG CORRECTION, not a
        regression: 3487975 fixed the ratchet's own stripComments() being fooled by a MIME-type string
        literal that silently undercounted by 1; the true count was always 30. The 8 subsequent next/image
        conversion commits use a conditional canOptimizeImageHost()-gated pattern that keeps a source-level
        <img> fallback for un-whitelisted CDN hosts by design, so the ratchet count correctly doesn't drop
        even though these are real runtime wins. lib/store/embedding-index.ts's full-table scan remains
        unchanged, still correctly deferred behind the DATA_BACKEND/pgvector cutover. No perf budget/
        Lighthouse CI gate exists anywhere (`find .github scripts -iname "*lighthouse*" -o -iname
        "*perf-budget*" -o -iname "*bundlesize*"` -> nothing). RAISE to A, cheapest-first: pin a regression
        test for APT-65's select narrowing (the same pattern its own precedent established); add a crude
        bundle-size/Lighthouse CI gate; sequence the embedding-index pgvector RPC with the DATA_BACKEND
        cutover. Tracked: #385 (update).
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE long-standing binding blocker, held C for a TENTH consecutive cycle, and the SOLE ship_critical
        dimension keeping overall off B/A on its own weight (design_taste is the other remaining
        ship_critical gap, at a lower severity). Byte-identical state across the 73-commit window since
        2026-08-17: the journeys CI job never sets DATA_BACKEND, lib/supabase/server.ts still defaults to the
        in-memory store, and the real-Postgres cold-start proof test still does not exist (only mocked-client
        regression guards). PENDING_OPS.md documents precisely why the loop cannot self-close the CI half
        (.github/ is permission-gated; the scripts/run-journeys.sh workaround doesn't work because the server
        starts before that script runs) — this remains a PURELY owner-gated item, not a loop-fixable one.
        FIX (owner): add DATA_BACKEND: "supabase" to the journeys job's env block, add the cold-start
        write->restart->re-read + second-user-RLS-denial test, then flip the production default. Migration
        030 must land first. Tracked: #525.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship_critical, held B, unchanged since 2026-08-17. This cycle's UI diff was notably larger (24 files
        vs ~5 last cycle) and was independently re-swept in full — found ZERO new slop, and one new permanent
        a11y ratchet (focus-visible-ratchet.test.ts) was added, reinforcing the gap is genuinely structural
        rather than a discipline lapse. The capping gap, F7 visual baselines, is completely unchanged: 34
        committed PNGs (up from 30, all still public-route-only growth), zero for the AUTHED/design-dense
        routes (incl. /focus, the exact flagship the original violation was on), blocked on a .github/
        persistence step outside the loop's reach. FIX: commit the authed/design-dense screenshots + record
        their dual-axis verdict, prioritizing /focus. Tracked: #204 (update).
    - dimension: security_rls
      severity: low
      gap: >-
        Ship_critical, HELD A with the most thorough sweep on record (41/58 routes read line-by-line, up from
        ~10 in prior cycles) — zero new findings from the historically recurring "bind one id, leave another
        unbound" class. Not yet A+ per this project's own precedent (a "clean sweep" claim has been reversed
        by the next cycle's fresh sweep six times running); this cycle's larger-but-still-partial sweep (17 of
        58 routes not read) doesn't yet clear that bar, though it materially narrows the gap. FIX (next
        cycle): complete the remaining 17 routes (session-derived-only ids, external proxies, admin/internal-
        secret-gated — auth/callback, auth/forgot-password, auth/signup, billing/portal, billing/status,
        internal/growth-metrics, internal/social-queue, mobile/account, mobile/analyze, mobile/billing-config,
        mobile/entitlements, places/photo, upload, user/email-preferences, waitlist/route, waitlist/confirm)
        for a genuinely exhaustive 58/58 pass, sustained clean, before crediting A+. No issue needed — this is
        the routine's own standing per-cycle sweep discipline.
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship_critical. Coverage up to 73.1/62.34/77.19/74.5 (3201 pass/19 skip/299 files). orchestrator.ts
        is now flat for a FIFTH straight cycle at ~14% stmts — the largest untested surface in the repo, with
        zero new orchestrator-loop test files added in the 73-commit window. Real, credit-worthy progress
        elsewhere: 3 new live-eval gold fixtures (bathroom, dining_area, dark-bedroom) plus a new product-
        discovery-stage eval, growing eval breadth even though the named coverage gap didn't move. CI still
        doesn't gate coverage in ci.yml (owner step), though preflight's own gate does. FIX: point ci.yml at
        test:coverage (owner); extend the cassette pattern to orchestrator.ts's real fan-out loop
        specifically — the sole remaining coverage gap after scene-assembler's closure. Tracked: #200
        (update — remove the now-stale scene-assembler reference).
    - dimension: performance
      severity: low
      gap: >-
        Not ship_critical. Held B on two genuine fixes: e6baf66 batched three lifecycle-email crons' N+1
        per-candidate lookups (well-tested against mis-keyed-batch bugs), and 1dfaa4e narrowed selects on
        mockups+projects GET (correct, but shipped without the pinned regression test its own precedent
        established — a minor gap worth closing). embedding-index.ts's full-table scan remains correctly
        sequenced with the DATA_BACKEND cutover; no perf budget/Lighthouse CI gate anywhere. The raw-<img>
        ratchet count moved 29->30 but this is a measurement-bug fix (the true count was always 30), not a
        regression. FIX cheapest-first: pin a regression test for the APT-65 select narrowing; add a crude
        bundle-size/Lighthouse CI gate. Tracked: #385 (update).
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
