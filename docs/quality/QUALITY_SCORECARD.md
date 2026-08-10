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
  as_of: 2026-08-10
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C (capped by functional_reality, unmoved for an EIGHTH consecutive cycle) — but the per-dimension picture is MIXED, not uniformly better: business_case_strength genuinely RECOVERED B->A (the mobile paywall now ships the $29 Apartment tier + mirrors the web app's annual-billing kill-switch, closing issue #672 for real, verified end-to-end, no behavioral input moved) — but TWO other ship_critical dims DROPPED on fresh adversarial findings, the same pattern seen in the 07-13/07-27 cycles: security_rls A+->B (a fresh 57-route sweep found POST /api/area-analysis accepts an unbound client-supplied project_id that overrides the caller's own room's project, leaking another tenant's full project row — address, building_research, apartment_analysis — plus every sibling room's private diagnosis history into the response and the Gemini prompt; missed by 10 prior audit cycles) and artifact_integrity A->B (the standing .github/-gated stale-header nit persists, PLUS a fresh, verified overclaim: ROADMAP.md:739 claims "28 tests" cover reset-link-idempotency when the actual, sole test file has 11 — a ~2.5x inflation of a security-relevant closure claim). Net: FOUR ship_critical dims now sit below A (functional_reality C, security_rls B, design_taste B, artifact_integrity B) — UP from three last cycle, despite one genuine recovery. design_taste held B (palette-ratchet MAX_OFF_SYSTEM tightened further 48->42->36 via two more real token migrations, but F7's authed/design-dense screenshots, incl. /focus, remain uncommitted, unchanged). tests_evals and performance both held B on genuine incremental progress (validation-agent.ts coverage 13%->56.5% via a real cassette test; next/image adoption moved off zero).
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — FOUR remain below A (functional_reality C, security_rls B, design_taste B, artifact_integrity B), up from three last cycle
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C for an EIGHTH consecutive cycle — a fresh independent grader confirmed the persistence
        blocker is BYTE-IDENTICAL to 08-03: `grep -c "DATA_BACKEND" .github/workflows/ci.yml` -> 0;
        lib/supabase/server.ts:22-24 still `return process.env.DATA_BACKEND === "supabase"` (default
        memory), fail-loud logic unchanged. Of the ~50 commits since 08-03, only 4 touched a
        persistence-adjacent file, and none set DATA_BACKEND: 0870137 (Node 20->24 CI bump — touched
        ci.yml but only the node-version field in 5 jobs, env block untouched even though the file WAS
        open for editing that day, proving the gate is a deliberate choice not a technical wall);
        9391639 (memory-store .single() zero-row fix, a correctness improvement, not a cutover);
        468b0ef (security-invariants gate wiring, unrelated); f1364b2 (housekeeping only).
        `find __tests__ -iname "*cold-start*" -o -iname "*persistence*"` still returns only
        mocked-client regression guards (analyze-apartment-persistence.test.ts,
        saved-designs-*-persistence.test.ts) — no real write->restart->re-read + cross-user RLS-denial
        proof test exists anywhere in the repo. e2e/journeys.spec.ts and
        __tests__/supabase/data-backend.test.ts still self-admit the gap in unchanged language.
        PENDING_OPS.md confirms both blocking items (`ci-journeys-data-backend`,
        `cutover-to-persistent-data`) remain status:open with the same unchanged reasoning for why the
        loop cannot self-close the CI half (.github/ is permission-gated; the run-journeys.sh env-export
        workaround races the server's own startup). `npm test` 2944 pass/12 skip (up from 2788/12, all
        net-positive correctness fixes — 550cecf/76571f8/9391639 correct real 500-vs-404
        error-classification bugs across rooms/projects/search/analyze-apartment/saved-designs routes);
        `npx tsc --noEmit` clean; `npx eslint .` 0/0. No new functional-reality regressions found across
        the full commit window. C not B (persistence is blocking for a retention-driven, sellable app);
        C not D (everything else genuinely works, every money-path signal green). RAISE to A: identical
        prescription for the 8th cycle running — set DATA_BACKEND: "supabase" in the CI journeys job's
        env block (a .github/ edit the loop cannot make), add the cold-start round-trip proof test, then
        make DATA_BACKEND=supabase the production default. Migration 030 must land BEFORE the cutover.
        Tracked: #525 (update — still open, unchanged root cause, now explicitly the sole item blocking
        overall off C for 8 straight cycles).
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh adversarial grader, cold, independently re-ran every mechanical signal and
        matched the orchestrator's numbers exactly). `npx tsc --noEmit` clean; `npm test` 2944 pass / 12
        skip (up from 2788/12, 275 files); `npm run check:determinism` green (all 4 checks); `npx eslint .`
        0 errors / 0 warnings. Billing webhook re-verified line-by-line, unchanged and correct: signature
        verified before DB access, idempotent via the pre-upsert status read, DB failure 500s so Stripe
        retries. Zero TODO/FIXME/XXX and zero empty-catch findings on billing/auth/agent paths across the
        full ~50-commit window (one benign client-side catch in app/layout.tsx, unrelated). Spot-checked 6
        commits since 08-03 (550cecf, 9391639, 76571f8, 9365bd2, 2face6b, c442f4c) — all genuine behavior
        fixes with regression tests that fail against the pre-fix code, several caught by real independent
        reviewer passes documented in the same commits. Of the THREE named A->A+ ceiling items: (1)
        computer-use's hardcoded `ThinkingLevel.HIGH` deferral is unchanged, same honest comment intact;
        (2) no maxDuration sweep test still exists despite 31 files declaring maxDuration, unchanged; (3)
        harness-ratchet.test.ts's SCAN_DIRS=["lib","app"] still excludes scripts/ (root cause open), but
        the ONE instance it produced last cycle is now fixed —
        scripts/seed-product-embeddings.ts:102-121's live .chat() call now carries
        thinkingConfig/DETERMINISTIC_SEED (landed 08-04, with a comment noting the ratchet still can't see
        it). A FOURTH ceiling item is newly named, self-identified by the team rather than hidden:
        lib/auth/ownership.ts's userOwnsRoom/userOwnsProject/userOwnsCandidateProduct discard the Supabase
        query's `error` field and return Boolean(data) — a genuine DB failure during an IDOR-guarding
        ownership check is indistinguishable from "not owned" and silently 404s instead of 500ing. Fails
        closed (denies access, doesn't leak), not itself an auth bypass, and explicitly flagged as a
        distinct follow-up in 550cecf's own commit message rather than buried — so it's graded as a named
        ceiling item, not a drop. RAISE to A+: fix ownership.ts's error-swallowing; land the maxDuration
        sweep test; extend SCAN_DIRS to scripts/; resolve the computer-use HIGH-thinking deferral.
    security_rls:
      grade: B
      ship_critical: true
      gap: >-
        DROPS A+->B — a fresh, genuinely independent 57-route sweep (`find app/api -name route.ts` -> 57)
        found a real, previously-missed cross-tenant IDOR, the same "bind one id, leave a second
        client-supplied id unbound" class that has recurred across FIVE prior cycles (mockups product_ids,
        saved-designs project_id, area-analysis GET room_id — all previously fixed). This is a NEW
        instance in the same file as one of those prior fixes: app/api/area-analysis/route.ts POST handler
        accepts `project_id` directly from the request body (line 121), binds ONLY `room_id` via
        `userOwnsRoom` (lines 123-125), and then lets the client-supplied `project_id` OVERRIDE the
        caller's own room's real project — `effectiveProjectId = project_id || room.project_id` (line
        206) — with no `userOwnsProject` check anywhere. That id is then used to `select("*")` the full
        `projects` row (line 208 — building_research, apartment_analysis, address/city/neighborhood) and
        every sibling room's FULL room_diagnoses history (line 209) with no ownership check, folded into
        the Gemini "BUILDING CONTEXT" / "APARTMENT-LEVEL ANALYSIS" prompt and reflected back in the
        response's design_direction/summary fields — a real cross-tenant data leak (another tenant's
        address, building research, and private per-room diagnosis history) plus LLM-cost abuse against a
        tenant who never authorized the call, reachable by any authenticated caller who owns ANY room and
        can guess/enumerate a project UUID. The route's own sibling (refine-chat) already derives
        project_id server-side from the owned room and never accepts a client value — making this route an
        outlier among its own siblings, not a repo-wide pattern. Everything else re-verified clean this
        cycle: BOTH the c442f4c (design_profiles/saved_items WITH CHECK) and 2face6b (password-reset mint
        cooldown) security fixes are genuine and correct; the two PRIOR A+ nits (saved-designs
        boundProjectId, products search_session_id binding) remain fixed, no regression; all PATCH/PUT
        allowlists still exclude user_id/project_id/room_id; no committed secrets; preflight GATE 6 green
        (26/26 RLS). B not lower: read-only (no write/escalation path), requires an authenticated caller
        who already owns a room (not anonymous), and is a narrowly-scoped single-route defect, not a
        systemic pattern. RAISE to A: drop the `project_id` body param from
        app/api/area-analysis/route.ts entirely (mirroring refine-chat's own pattern — derive project_id
        server-side from the owned room) or gate it behind `userOwnsProject`, plus a regression test.
        Tracked: NEW issue filed this cycle (area-analysis.ts is the same file #527 fixed a DIFFERENT
        class of guard on in an earlier cycle — GET's missing room_id check; this is a distinct,
        newly-discovered vector on the POST handler's project_id).
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — real, ongoing tightening on the palette axis, byte-for-byte unchanged on the F7
        axis. `__tests__/design/off-system-palette-ratchet.test.ts` MAX_OFF_SYSTEM tightened further
        48->42->36 via two more verified real token migrations since 08-03: 2bcfc9a moved 6 raw
        emerald-500/amber-500 icon colors (setup/products/waitlist) onto the one-hue emphasis ladder
        (text-accent-warm/text-foreground/text-muted-foreground); 93f7969 moved the dashboard's "Building
        researched" badge off raw emerald onto the same pattern — both diffs read and confirmed real, not
        cosmetic. Both design tests pass (`npx vitest run
        __tests__/design/off-system-palette-ratchet.test.ts __tests__/design/warm-pill-contrast.test.ts`
        -> 35/35). AUTHED_A11Y_ROUTES / DESIGN_DENSE_A11Y_ROUTES (journeys.spec.ts:391,439) still present
        and wired. Three further a11y fixes verified genuine against their diffs: 370dc17 (real h2
        sr-only fixing the dashboard's h1->h3 skip), a211214 (aria-live scoped correctly to the phase
        list, not the ticking timer), 550cecf (mobile focus ring reuses the shared Button CVA's exact
        focus-visible classes — token-consistent, not ad hoc); 0e69e64's warm-pill-contrast fix is notable
        for surviving 3 real review-caught overclaiming rounds before landing with its own WCAG contrast
        test — a positive process signal. Fresh slop hunt across recently-touched files (topbar, image
        upload, dashboard, focus, waitlist) found zero new ad-hoc hex/emoji-iconography/purple-gradient
        instances; repo-wide grep for purple/violet/fuchsia/indigo gradients -> zero hits. The CAPPING gap,
        F7 visual baselines, is completely unchanged since 08-03: `find e2e/__screenshots__ -iname
        "*.png" | wc -l` -> 30, every one still `public-*`, zero commits to the directory since 08-03.
        /focus — the exact route the original three-hue violation was on — remains deliberately excluded
        even from the axe-scan sweep (documented reason: triggers a live, slow LLM pipeline), so it stays
        the single least-verified design-dense surface in the app. docs/loop-memory.md confirms every
        intervening run (149-157) explicitly logged this as unchanged/owner-gated, not silently dropped.
        B not A: F7's DoD requires BOTH committed artifacts AND a recorded dual-axis verdict for
        design-dense/authed routes, and neither exists for that tier. RAISE to A: commit real
        authed/design-dense screenshots (capture mechanism already exists in CI; persisting requires the
        owner-gated .github/ step) and record their dual-axis verdict, prioritizing /focus. Tracked: #204
        (update — palette axis tightened further and durably; F7 remains the sole capping gap, unchanged).
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        HOLDS A — a fresh grader independently re-verified both prior fixes are still genuinely in place,
        no regression across the ~50 commits since 08-03 (only cosmetic/perf changes touched adjacent
        code: haptics, refine-chat parallelization, ImageUploadZone rejection-state fix — none touch
        purge/privacy logic). `lib/storage/user-storage.ts`'s purgeUserStorage still sweeps upload
        buckets by `${userId}/` prefix plus mockups via the trusted mockup_jobs.result_image_url column
        only, called BEFORE deleteUser in both delete routes; `npx vitest run
        __tests__/api/account-deletion-storage.test.ts __tests__/api/user-delete.test.ts
        __tests__/api/mobile-account-delete.test.ts` -> 30/30 passed. docs/app-privacy.md and
        app/privacy/page.tsx re-read in full, still agree on location (building-address-derived
        coordinates, never device GPS, no permission requested); `npx vitest run
        __tests__/compliance/privacy-disclosure.test.ts` -> 8/8 passed. mobile/eas.json build+submit
        profiles still real; app icon re-verified via direct PNG IHDR parse: 1024x1024, 8-bit RGBA;
        bundle id `ai.aptdesigner.app` consistent; no expo-location or any location package anywhere in
        mobile/, consistent with the no-permission claim. PENDING_OPS.md's two remaining items
        (`refile-store-privacy-forms`, `audit-orphaned-storage-objects`) re-confirmed correctly scoped as
        owner/one-time-ops, not silently reframed as code gaps. Track D cross-check: D1/D2/D4 ticked, D3
        (device-captured store screenshots) remains the sole open item, correctly annotated as a HUMAN
        step. Zero findings this cycle. Tracked: #726 (stays closed — confirmed still genuinely resolved).
    artifact_integrity:
      grade: B
      ship_critical: true
      gap: >-
        DROPS A->B — the standing .github/-gated nit is unchanged (`.github/workflows/ci.yml:1` still
        carries the stale "READY-TO-APPLY workflow — copy this to .github/workflows/ci.yml" header,
        byte-identical), AND a fresh sweep found a NEW, verified overclaim: ROADMAP.md:739 (Track G4,
        "Run 141 / PR #789") states email-verification-link idempotency is "CLOSED" backed by "28 tests
        [that] cover the decision table and the actual wiring sequence." Running the actual artifact —
        `npx vitest run __tests__/auth/reset-link-idempotency.test.ts` — shows 11 passed, not 28
        (confirmed independently via `grep -c "it("` and via git history showing the file was only ever
        touched by the one commit that added exactly 11 tests). As a control, the two adjacent numeric
        claims in the SAME paragraph (signup-errors.ts "6 tests", login-errors.ts "8 tests") were also run
        and are dead-accurate (6 and 8), so this is an isolated, freshly-introduced ~2.5x inflation of a
        security-relevant closure claim, not a systemic pattern — but it's exactly the class of drift this
        dimension exists to catch, and it was NOT present at the 08-03 grade. Genuinely-verified positives
        this cycle: 89cce77's "preflight gate integrity" fix is real, not overclaimed (preflight.sh now
        does real if/then exit-status branching instead of tail-grep; scripts/check-security-invariants.mjs
        exists as a standalone 162-line gate matching the commit's claim); e2e/ROUTE_INVENTORY.md's
        "20 of 35 routes" count is still exactly correct against a fresh `find app -name page.tsx` (35);
        pricing is consistent across stripe.ts/pricing page/the new mobile paywall $29 tier/BUSINESS_CASE.md,
        with the mobile fallback module's own doc-comment correctly distinguishing "display before RC
        loads" from "what RC actually sells" (honest, not an overclaim); PENDING_OPS.md's OWNER_ACTIONS
        YAML re-parses cleanly, 33 items, spot-checked entries match code reality. B not lower: only two
        named gaps, both narrow and non-systemic (one immutable/.github-gated, one an isolated numeric
        error with the underlying fix itself genuine). RAISE to A: correct ROADMAP.md:739's test count
        from 28 to 11 (a one-line fix, fully within the loop's reach, no owner gate); the .github/ header
        remains owner-only. Tracked: reopen #727 (the prior close was correct for its own findings, but a
        fresh overclaim has appeared since — same dimension, new instance, matching this rubric's own
        "named-but-unfixed nit must eventually cost a letter" precedent).
    business_case_strength:
      grade: A
      ship_critical: true
      gap: >-
        RECOVERS B->A — the single unresolved, loop-buildable gap named last cycle is now closed and
        independently verified as GENUINE, not gamed. Commit 120d28c (#805, Aug 4) added: (1)
        mobile/src/lib/paywall-fallback.ts's FALLBACK_OPTIONS now lists the $29 one-time Apartment tier
        FIRST, then $49/mo Monthly — mirroring app/pricing/page.tsx's order and matching
        lib/billing/stripe.ts's STRIPE_PRICE_IDS.apartment price exactly; (2)
        mobile/src/lib/paywall-annual-gate.ts's shouldOfferPackage(isAnnualPackage, annualBillingEnabled)
        filters the annual package out of BOTH the static fallback AND the live RC-loaded offering unless
        the flag is on; (3) mobile/src/lib/billing-config.ts's fetchAnnualBillingEnabled() calls
        app/api/mobile/billing-config/route.ts, which reads the SAME isAnnualBillingEnabled() source of
        truth as the web checkout route (lib/billing/stripe.ts) — mobile and web cannot drift to different
        answers — and fails CLOSED to false on any error/timeout (5s AbortController), so a network hiccup
        can only ever hide the annual option, never wrongly show one the backend can't grant. `npx vitest
        run __tests__/billing/paywall-annual-gate.test.ts __tests__/billing/paywall-fallback.test.ts
        __tests__/api/mobile-billing-config.test.ts` -> 13/13 passed, assertions are substantive (exact
        FALLBACK_OPTIONS order pinned, gate behavior pinned under both flag states, per-IP rate-limit
        isolation on the route). `git log --since=2026-08-03 -- docs/BUSINESS_CASE.md` -> empty: this is
        pure app-code, zero doc/wording changes, confirming no behavioral input was touched to produce
        this result. Fresh business-case numbers re-derived and bit-identical: `node
        analysis/business_case_without_annual_arr.mjs` -> $121,339; `node scripts/validate-computation.mjs`
        -> "10 figure(s) verified... PASS." Hunted docs/BUSINESS_CASE.md for other named-but-unbuilt
        levers: the two credited with uplift (waitlist referral loop, in-product web upsell) are both real
        and built (migration 026, lib/waitlist/referral.ts, UpgradeCtaCard call sites); three further
        levers are explicitly disclosed as NOT credited with any uplift — correctly conservative, not
        overclaimed. A not A+: the web/Stripe-only reading clears the floor outright, and the mobile
        parity gap that was the sole named blocker is genuinely closed — no further named,
        value-bar-clearing gap remains at this time. Tracked: CLOSE #672 (the fix is real, complete,
        end-to-end, and independently re-verified — not cosmetic).
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B, on firmer footing than last cycle. `npx vitest run --coverage` -> 67.97% stmts / 57.36%
        branch / 73.86% funcs / 71.84% lines (up from 67.97/57.36/71.21/69.23), 2944 pass / 12 skip / 275
        files (up from 2788/12/251) — independently re-run and bit-identical to the orchestrator's numbers.
        The single biggest driver is a genuine fix to a long-named weak spot:
        `__tests__/integration/validation-agent-cassette.test.ts` (400 lines, a659293/#816) mocks only
        geminiProvider.chat() and specifically exercises the three coercion paths named across prior
        cycles (field present/absent/explicit-JSON-null all collapsing to undefined), moving
        validation-agent.ts 13.06%->56.53% stmts — a real, substantial jump, not padding. A second genuine
        0%->100% file landed (lib/db/agent-runs.ts, __tests__/db/agent-runs.test.ts, 6db689e/#842, real
        insert/update + error-path + timestamp assertions), plus a new cost-contract-enforcement test
        (__tests__/ai/thinking.test.ts, 6292196/#852, deliberately hardcodes its expected-tiers table
        rather than deriving it from the source, avoiding the tautological-test trap). Spot-checked 4
        newest test files, zero change-detector patterns found. UNCHANGED, now a THIRD straight cycle:
        orchestrator.ts's actual fan-out/scoring loop (lines 655-3445) is still 11.66% stmts, byte-identical
        to last cycle — zero incremental coverage despite being named repeatedly; the file previously cited
        as "research-assembler.ts" (~1.5%) could not be located under that name this cycle (likely
        renamed/mislabeled across audits) but its closest match, scene-assembler.ts, is still ~1.5% dark,
        essentially untouched. CI STILL never gates coverage (ci.yml:39 runs bare `npm test`, owner step,
        unchanged). docs/loop-memory.md Run 150 documents a genuine live-pipeline eval this cycle: the
        diagnosis eval against real Gemini caught a real category-slug bug ("rug" vs "area_rug"), was
        fixed, and reran green 5 times (2 by the author, 3 independently by a reviewer) — real evidence of
        live evals running against the real pipeline, beyond the weekly owner-gated live-eval.yml. RAISE to
        A: point ci.yml verify at `npm run test:coverage` (owner step); extend the cassette pattern to
        orchestrator.ts's actual fan-out loop and to scene-assembler.ts — both now named for a THIRD
        straight cycle with zero incremental coverage, which is itself becoming the more pressing gap than
        the coverage percentage. Tracked: #200 (update).
    performance:
      grade: B
      ship_critical: false
      gap: >-
        HOLDS B — genuine, verified incremental progress on two more fronts, two known items still
        untouched. next/image adoption moved off zero: components/rooms/room-image-gallery.tsx now renders
        `next/image` for hosts matching next.config.ts's remotePatterns (Supabase/Google/Places), falling
        back to raw `<img>` only for unrecognized hosts (fac45ea/#810) — a safety-reviewed conversion (a
        reviewer caught that an unmatched host would otherwise hard-crash via next/image's remotePatterns
        enforcement, and the fallback was added in response). The raw-`<img>` ratchet count did NOT drop
        (MAX_RAW_IMG still 30) because the ratchet counts source-level `<img>` occurrences, not runtime
        paths — the PR's own commit message honestly discloses this ("doesn't lower it either, honestly")
        — so this is a real behind-the-scenes win the ratchet is structurally blind to; the "0 files" prior
        characterization is now stale. c8e5787's "stop double-serializing" fix verified genuine:
        refine-chat's diffAnalysis now short-circuits primitive comparisons before any JSON.stringify call.
        9d09a4c's "parallelize independent DB fetches" verified genuine: saved-designs' POST handler now
        runs two Promise.all pairs, each pair confirmed to have no data dependency between its two queries.
        UNCHANGED, still open: lib/store/embedding-index.ts remains a full-table select("*") + in-memory
        cosine scan (still correctly sequenced with the DATA_BACKEND/pgvector cutover — would be dead code
        before that lands); no perf budget anywhere in CI. Fresh hunt across the ~50-commit window found no
        new N+1 or blocking-I/O regression. B not A: the two standing known-cost items remain untouched and
        the ratchet's blind spot toward safety-gated conversions like RoomImageGallery's means future real
        wins may keep looking like no-ops without a metric change. RAISE to A, cheapest-first: update
        no-img-growth.test.ts's stale "0 adoption" doc comment; extend the ratchet to distinguish
        unconditional vs. host-gated raw `<img>` so future safety-reviewed conversions register as
        progress; add a crude bundle-size/Lighthouse CI gate; sequence the embedding-index pgvector RPC
        with the DATA_BACKEND cutover. Tracked: #385 (update).
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE long-standing binding blocker, held C for an EIGHTH consecutive cycle, and now the SOLE
        reason overall can't move off C. Byte-identical state to 08-03: the journeys CI job never sets
        DATA_BACKEND (0 hits in .github/workflows/ci.yml, even in the one commit this cycle that opened
        that exact file for a Node-version bump), lib/supabase/server.ts still defaults to the in-memory
        store, and the real-Postgres cold-start proof test still does not exist. PENDING_OPS.md documents
        precisely why the loop cannot self-close the CI half (.github/ is permission-gated; the
        scripts/run-journeys.sh workaround doesn't work because the server starts before that script
        runs) — this remains a PURELY owner-gated item, not a loop-fixable one. FIX (owner): add
        DATA_BACKEND: "supabase" to the journeys job's env block, add the cold-start write->restart->
        re-read + second-user-RLS-denial test, then flip the production default. Migration 030 must land
        first. Tracked: #525.
    - dimension: security_rls
      severity: critical
      gap: >-
        Ship_critical, NEW this cycle — dropped A+->B on a fresh 57-route sweep. app/api/area-analysis/
        route.ts's POST handler accepts a client-supplied `project_id` (line 121), binds only `room_id`,
        and lets that unbound project_id OVERRIDE the caller's own room's real project (line 206),
        fetching another tenant's full project row (address, building_research, apartment_analysis) plus
        every sibling room's private diagnosis history (line 209) into the Gemini prompt and the response
        — a genuine cross-tenant data leak plus LLM-cost abuse, reachable by any authenticated caller who
        owns any room. Missed by 10 prior audit cycles; the route's own sibling (refine-chat) already
        derives project_id server-side and never accepts a client value, making this route an outlier
        among its own siblings rather than a repo-wide pattern. FIX: drop the project_id body param
        (mirror refine-chat's pattern) or gate it behind userOwnsProject, plus a regression test. Tracked:
        NEW issue filed this cycle.
    - dimension: artifact_integrity
      severity: high
      gap: >-
        Ship_critical, dropped A->B. The standing .github/-gated stale-header nit persists unchanged, PLUS
        a fresh, verified overclaim: ROADMAP.md:739 claims "28 tests" cover reset-link-idempotency when
        the actual, sole test file has 11 (confirmed by running it) — a ~2.5x inflation of a
        security-relevant closure claim, isolated (two adjacent numeric claims in the same paragraph are
        dead-accurate) but real and new since 08-03. FIX: correct ROADMAP.md:739's count from 28 to 11 (a
        one-line fix, fully loop-reachable, no owner gate needed). Tracked: reopen #727.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship_critical, held B. The palette-ratchet axis tightened further and durably (MAX_OFF_SYSTEM
        48->42->36 via two more verified real token migrations since 08-03). The capping gap, F7 visual
        baselines, is completely unchanged: ~30 real PNGs committed for PUBLIC routes only; the
        AUTHED/design-dense routes (incl. /focus, the exact flagship the original violation was on) are
        captured in CI but not committed, blocked on a .github/ persistence step outside the loop's reach.
        FIX: commit the authed/design-dense screenshots + record their dual-axis verdict, prioritizing
        /focus. Tracked: #204.
    - dimension: performance
      severity: low
      gap: >-
        Not ship_critical. Held B on genuine incremental progress: next/image adoption moved off zero
        (RoomImageGallery, safety-reviewed with a host-allowlist fallback) though the source-level ratchet
        can't see the runtime win; refine-chat's double-serialization and saved-designs' sequential DB
        fetches were both genuinely fixed. Remaining: embedding-index.ts's full-table N+1 scan (correctly
        sequenced with the DATA_BACKEND cutover); no perf budget anywhere in CI. FIX cheapest-first: fix
        the now-stale "0 adoption" doc comment; add a crude bundle-size/Lighthouse CI gate; sequence the
        pgvector RPC with the DATA_BACKEND cutover. Tracked: #385 (update).
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship_critical. Coverage up to 70.35/59.57/73.86/71.84 (2944 pass/12 skip/275 files). A
        long-named weak spot genuinely closed this cycle: validation-agent.ts 13.06%->56.53% via a real
        400-line cassette test exercising the exact previously-named coercion branches. Remaining, now a
        THIRD straight cycle unchanged: orchestrator.ts's actual fan-out/scoring loop (lines 655-3445) is
        still 11.66% stmts, zero incremental coverage; the near-1.5%-coverage agent file (closest match:
        scene-assembler.ts) is likewise untouched. CI still doesn't gate coverage (owner step, unchanged).
        FIX: point CI at test:coverage (owner); extend the cassette pattern to orchestrator.ts's real loop
        and scene-assembler.ts specifically — now the more pressing gap than the aggregate percentage.
        Tracked: #200 (update).
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
