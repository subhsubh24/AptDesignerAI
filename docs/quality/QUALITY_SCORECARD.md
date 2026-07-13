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
  as_of: 2026-07-13
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C — capped at the weakest ship_critical link (functional_reality C). The per-dimension picture WORSENED this cycle: two fresh adversarial findings dropped two ship_critical dims that were at/above A — security_rls A+->A (a missed IDOR guard on the mockups route, of the exact class last cycle's sweep claimed was clear) and business_case_strength A->B (the shippable-TODAY ARR is ~$99.9K, BELOW the $100K floor, once Pro Annual is gated off in code; the floor-clearing $122.9K leans on that gated tier + ~year-3 steady state). THREE ship_critical dims now sit below A: functional_reality C, design_taste B, business_case_strength B (up from two). functional_reality is unchanged in production reality (persistence still ships INERT), so the headline stays C.
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — THREE remain below A (functional_reality C, design_taste B, business_case_strength B); business_case regressed A->B this cycle, security_rls regressed A+->A (still at the A ship-bar)
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C — production reality is UNCHANGED. The persistence PREPARE (#531) is still real,
        reviewable code behind a DATA_BACKEND flag (lib/supabase/server.ts createClient() :68-96
        branches to a real Postgres+RLS client and FAILS LOUD on missing creds :76-82; getCurrentUserId
        symmetric :101-118), selection-tested (__tests__/supabase/data-backend.test.ts). BUT the flag
        STILL DEFAULTS to memory (supabaseDataBackendEnabled() reads process.env.DATA_BACKEND==="supabase",
        :22-24) and the module docstring still says it "ships INERT (memory backend)" until the owner flips
        it (:8-20). So by default every `.from()`/`.storage` op still hits lib/store/memory-store.ts
        ("Data persists only for the lifetime of the server process," :3-8); on Vercel serverless / any
        restart / multi-replica host a user's projects/rooms/diagnoses/saved-designs still do NOT survive a
        cold start — the retention-critical "revisit your saved designs" journey (a VISION pillar) is still
        broken in the default prod config. The real-Postgres cold-start integration test the last two grades
        named STILL does not exist: data-backend.test.ts:6-9 EXPLICITLY defers the round-trip to "a
        human-verified cutover step", and the one new persistence test this cycle
        (__tests__/api/analyze-apartment-persistence.test.ts) drives the route against a MOCKED client — a
        per-room-diagnosis regression guard, not a cold-start persistence proof. DoD Track A correctly
        UNCHECKED; preflight functional-journeys gate RED. C not B (persistence is BLOCKING for a sellable,
        retention-driven app), C not D (everything else — full AI pipeline, billing, auth, UI — genuinely
        works; one env flip + one test from viable). RAISE to A: (1) make DATA_BACKEND=supabase the
        production DEFAULT (memory dev-only), (2) add the integration test that writes via the money path,
        simulates a cold start (fresh process/client), and re-reads the row from real Postgres, (3) confirm
        the 26 RLS policies execute at runtime once the memory store is gone. The PREPARE half is done —
        this is the human-gated cutover + proof test.
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh adversarial grader, cold). Signals green this cycle: `npx tsc --noEmit` clean,
        `npx eslint .` clean, `npm run check:determinism` green, `npm test` 2051 pass / 11 skip (up from
        1948; the 11 skips are RUN_EVALS-gated by design). maxDuration sweep clean — every provider-touching
        route carries `export const maxDuration`; the ~26 without were cross-checked to be DB/auth-only
        (picks, identified-products/search substring match, rooms/[roomId]/diagnosis GET). Cost contract
        intact: ~50 `.chat(` sites, all with explicit thinkingConfig (harness-ratchet green); HIGH confined
        to DEFAULT_THINKING (lib/ai/models.ts:21 — only apartment_analysis/area_analysis/diagnosis), no
        hard-coded HIGH literal on a disallowed text task. Billing webhook ordering sound: signature verified
        BEFORE any DB access (route.ts:87 → 400 on bad sig), tier "active" is the stripe_customers upsert
        (500 on error :138 before any active state/email), lifecycle emails fire-and-forget after the write,
        idempotent on Stripe redelivery. No stub/TODO/dead path on a critical route. Non-blocking A->A+ item
        (unchanged): the ratchet guards PRESENCE of thinkingConfig, not its LEVEL — per-call inline overrides
        (mockup-agent.ts:504 `options.thinkingLevel || "high"`) are unguarded; a test asserting the thinking
        LEVEL stays within DEFAULT_THINKING for text tasks would close the latent hole. No such violation
        exists today.
    security_rls:
      grade: A
      ship_critical: true
      gap: >-
        REGRESSED A+->A. A fresh 52-route adversarial sweep found a missed ownership guard of the EXACT
        class last cycle's sweep claimed was clear — falsifying the "no remaining missed guard" A+ basis.
        app/api/mockups/route.ts POST guards userOwnsRoom(room_id) (:174) but then reads two SEPARATE
        client-supplied ids with NO room/user binding: product_ids -> candidate_products.select("*").in("id",
        product_ids) (:552-556, no .eq("room_id", room_id)) and bundle_id ->
        product_bundle_items.select("candidate_products(*)").eq("bundle_id", bundle_id) (:546-550, no
        ownership check on the bundle). The codebase's OWN convention binds exactly these: bundles/route.ts:85-92
        fetches .eq("room_id", room_id).in("id", product_ids) and rejects unowned, and products/evaluate/route.ts:79
        rejects when product.room_id !== room_id. Because RLS is inert under the default memory store, this
        app-layer bind is the SOLE cross-tenant boundary — an authed caller with a legit owned room_id can
        pass another tenant's product_ids/bundle_id and have that data read + composited into a mockup render
        (cross-tenant read + expensive LLM work on foreign data). A not lower: the leaked ids are unguessable
        UUIDs and the output is an image, not raw rows. Everything else stays strong: all 14 fan-out LLM
        routes carry checkRateLimit + checkDailySpend; secrets clean (git ls-files shows only .env.example,
        NEXT_PUBLIC_* hits are publishable keys, no sk_live/service_role); preflight GATE 6 green (26 public
        tables all ENABLE ROW LEVEL SECURITY); the area-analysis IDOR guard from last cycle (#530) intact.
        RAISE back to A+: in mockups POST, bind product_ids with .eq("room_id", room_id) (reject any id not
        returned) and verify bundle_id's bundle belongs to room_id, mirroring bundles/route.ts:85-92.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — the two capping gaps are BYTE-FOR-BYTE UNCHANGED this cycle (no movement toward A). Gap
        (1): AUTHED_A11Y_ROUTES (e2e/journeys.spec.ts:182) is still the LOW-density set [/dashboard,
        /account, /saved, /billing/upgrade?tier=pro] — NOT extended to the design-DENSE diagnosis/mockups/
        compare surfaces (dynamic score-color badges + confetti, where WCAG contrast failures concentrate).
        The axe machinery is correct (AxeBuilder.withTags wcag2a/2aa/21a/21aa asserting zero critical/serious)
        but only iterates those 4 sparse routes, and reducedMotion (:185) sidesteps confetti rather than
        testing it. Gap (2) FULLY REMAINS: `ls e2e/__screenshots__/` -> absent; grep toHaveScreenshot -> zero;
        playwright.config has no snapshot config; ROADMAP F7 still [ ]. Rendered pixels / dark-mode parity /
        empty+error states asserted in code, never captured. The design SYSTEM itself stays A-territory: slop
        hunt clean on consumer surfaces (no emoji-in-JSX — the grep hits are em-dashes; purple/violet/indigo
        grep on app+components -> zero; gradients resolve to warm-editorial tokens; real skeletons + layered
        error boundaries + not-found.tsx). This cycle's a11y commits (#606/#607: main landmark + picks
        room-filter SR announcement) are REAL but strengthen the system, not the capping proof axis. RAISE:
        extend AUTHED_A11Y_ROUTES to seeded diagnosis/mockups/compare (reuse the money-path seeding at
        journeys.spec.ts), and land F7 — commit e2e/__screenshots__/ baselines (light+dark, empty/error).
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A on the store-ARTIFACT checklist (privacy accuracy, deletion, build/submit config, icon,
        contact). Every processor in app/privacy/page.tsx maps to a live used dependency (Gemini, Supabase,
        Stripe, RevenueCat, Tavily, Google Places, Browserbase, Resend, Turnstile) — no phantom Anthropic/
        OpenAI. Margin (#593, npm margin-meter@0.1.0, wired in lib/ai/gemini.ts:790-798) is disclosed
        accurately as a telemetry-only processor (privacy/page.tsx:126-130). In-app deletion real on both
        surfaces (app/api/user/delete:31 + app/api/mobile/account:56 call admin.auth.admin.deleteUser). Real
        icon (mobile/assets/images/icon.png PNG 1024x1024 RGBA 799KB), real eas.json build+submit profiles
        (iOS appleId/ascAppId/teamId + Android tracks), canonical hello@aptdesignerai.com. NOTE
        (cross-dependency, not double-counted): an actual store submission would fail review while
        functional_reality's default data layer stays non-persistent — the store-readiness ARTIFACTS are
        done, but launch is gated by that persistence blocker. Bounded A+ items unchanged and HUMAN-gated:
        store screenshots (D3, ROADMAP:461) require the owner to capture on a device — not a code defect.
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. `bash scripts/preflight.sh` -> 51 pass / 2 fail; the 2 failures are the expected
        environmental/pre-launch ones (functional-journeys can't stand up the authed stack cold; DoD
        9-unchecked), NOT integrity regressions. GATE 5 GREEN — all 4 machine-readable dashboard blocks parse
        AND pass schema: OWNER_ACTIONS (valid), GROWTH_STATUS (valid), QUALITY_SCORECARD (grades in enum),
        BUSINESS_CASE_SUMMARY (base 122900 >= floor 100000). GATE 6 RLS green (26/26). Spot-checked roadmap
        ticks map to real artifacts (evals/__tests__/*.eval.test.ts, mobile/eas.json, mobile/assets/images/
        icon.png, billing webhook + test). Pricing consistent — $29 one-time / $49-mo Pro / $399-yr — across
        lib/billing/stripe.ts:8-10, pricing page, BUSINESS_CASE.md, AND the pro_annual gate-off is disclosed
        CONSISTENTLY in all three (stripe.ts comment, pricing-page isAnnualBillingEnabled() guard,
        BUSINESS_CASE.md:79-84) — no doc-vs-code contradiction there. One named ceiling item (kept at A, not
        A+, and not dropped to B): ROADMAP F2 is ticked [x] claiming "a regression below the floor fails the
        gate", but vitest.config.ts's OWN comment transparently states coverage gates only `npm run
        test:coverage`, not the CI verify job. This is a narrow tick-precision overclaim whose SUBSTANCE (CI
        doesn't gate coverage) is already the tests_evals B gap; the codebase self-documents the limitation
        (the opposite of a hidden integrity defect), so it is not double-counted here as a second
        ship_critical drop. RAISE to A+ / close the nit: either untick F2 to [ ] with an inline note, or wire
        --coverage into the CI verify job (which also raises tests_evals).
    business_case_strength:
      grade: B
      ship_critical: true
      gap: >-
        REGRESSED A->B. A fresh recompute (verified via node, not eyeballed) surfaces that the
        shippable-TODAY business case does NOT clear the $100K floor. Pro Annual is GATED OFF in code
        (app/api/billing/checkout/route.ts:55 refuses pro_annual unless isAnnualBillingEnabled();
        lib/billing/stripe.ts:26-27 reads ANNUAL_BILLING_ENABLED, default off; migration 021 unapplied). With
        annual off, the honest transactable steady-state ARR is ~$99,926 — ~$74 BELOW the floor
        (BUSINESS_CASE.md, "without annual" scenario). The floor-clearing headline base of $122,900 (a)
        requires the not-yet-live Pro Annual tier (~38% of steady-state MRR) and (b) is STEADY-STATE reached
        ~year 3 (floor_met_year1: false; year-1 exit run-rate ~$58-60K). This is the SAME discipline the
        auditor applied to functional_reality: grade the shippable reality, not the optimistic projection.
        Not lower than B (and the honesty is EXEMPLARY — the gating + the $99.9K without-annual number are
        spelled out at BUSINESS_CASE.md:19-35,79-85,384, nothing is gamed to clear the floor; the levers are
        real code: lib/waitlist/referral.ts, components/billing/upgrade-cta-card.tsx; inputs sit in honest
        bands — retention 25%, conversion 4%, churn 7%, organic 40%). The GTM auditor independently graded
        this B for the same root cause (issue #600), corroborating. RAISE to A: either apply migration 021 +
        enable annual billing so the $122.9K base becomes transactable-today, OR lift the without-annual case
        above $100K via the named conversion lever (3% -> 5% paywall/trial optimization) so the shippable
        floor clears without leaning on a gated tier.
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B — coverage nudged up again, structural gaps unchanged (criterion-referenced: same state,
        same letter). `npx vitest run --coverage`: ~59.98% stmts / 48.86% branch / 65.61% funcs / 61.01%
        lines (up from 59.04/47.77/64.75/60.03), comfortably above the 40/30/42/40 floor; 2051 pass / 11 skip.
        But CI STILL never enforces coverage — .github/workflows/ci.yml verify runs bare `npm test` = `vitest
        run`, no --coverage, so the floor is healthy by accident, not gated; a coverage regression is
        invisible on PRs (the floor now sits ~20pts below actual -> decorative). Evals remain live-only,
        owner-keyed: all evals/__tests__/*.eval.test.ts sit behind it.skipIf(!evalsEnabled()) (the 11 skips),
        contributing nothing on a normal PR; no recorded-cassette / replay per-PR tier exists. RAISE: add
        --coverage with enforced thresholds to the CI verify job so the floor gates; add a recorded-cassette
        eval tier that runs per-PR so the evals exercise real logic without live keys.
    performance:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B (criterion-referenced — same state, same letter; reject "no-progress -> lower" pressure).
        The headline N+1 persists in code (lib/store/embedding-index.ts:46 topKSimilar full-table select('*')
        + in-memory cosine loop, called per-crop in identified-products-pipeline.ts:117; the ivfflat index
        from migration 008 UNUSED — grep ivfflat/.rpc lib/ = 0) — but it remains INERT under the default
        in-memory data layer (in-process array ops, not DB round-trips; MemoryClient.rpc is a no-op), so a
        pgvector match_ RPC would be dead code until the real-DB cutover (see functional_reality). Real
        regardless of the data layer: next/image adoption still 0 (raw `<img>` count 32 across app+components,
        UNCHANGED from last cycle — no regression, no guard); no Lighthouse/bundle/perf budget in CI or
        preflight. Cost discipline remains the strong pillar (explicit thinkingConfig/thinkingFor,
        DETERMINISTIC_SEED, withCostLedger/recordUsage throughout). RAISE: sequence the pgvector match_ RPC
        WITH the real-DB migration; adopt next/image (add a raw-<img> guard so the count can't climb); add a
        perf budget.
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE binding blocker (held C). Production reality unchanged: the persistence PREPARE landed (#531) but
        still ships INERT — DATA_BACKEND DEFAULTS to memory (lib/supabase/server.ts:22-24), so production
        still routes .from()/.storage to the non-persistent memory store and user projects/rooms/diagnoses/
        saved-designs do NOT survive a serverless cold start / multi-replica host. The real-Postgres
        cold-start integration test still does not exist (data-backend.test.ts:6-9 defers it; the new
        analyze-apartment-persistence.test.ts uses a mocked client). Remaining (human-gated cutover): (1)
        make DATA_BACKEND=supabase the production default, (2) add the write-via-money-path -> cold-start ->
        re-read-from-real-Postgres integration test, (3) confirm the 26 RLS policies execute at runtime once
        the memory store is gone.
    - dimension: business_case_strength
      severity: high
      gap: >-
        REGRESSED A->B — a new ship_critical dim below A. The shippable-TODAY ARR is ~$99.9K, ~$74 BELOW the
        $100K floor, because Pro Annual is gated off in code (checkout/route.ts:55; ANNUAL_BILLING_ENABLED
        default off; migration 021 unapplied). The floor-clearing $122.9K leans on that gated tier (~38% of
        MRR) + ~year-3 steady state (floor_met_year1: false). Honesty is exemplary (fully disclosed, nothing
        gamed); the grade tracks the shippable reality. GTM auditor concurs (#600). RAISE: apply migration
        021 + enable annual so $122.9K is transactable, OR lift the without-annual case above $100K via
        conversion 3%->5%.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship-critical, below A. Two capping gaps BYTE-FOR-BYTE UNCHANGED this cycle: AUTHED_A11Y_ROUTES still
        the low-density set [dashboard/account/saved/upgrade], NOT extended to the design-dense diagnosis/
        mockups/compare surfaces; e2e/__screenshots__/ still absent so pixels/dark-parity/empty-error
        unverified (F7 unchecked). Extend AUTHED_A11Y_ROUTES to seeded diagnosis/mockups/compare and add
        toHaveScreenshot baselines (light+dark, empty/error).
    - dimension: security_rls
      severity: medium
      gap: >-
        REGRESSED A+->A (still at the A ship-bar, so not a ship-gate blocker — but a real cross-tenant read
        to close). mockups/route.ts POST reads client-supplied product_ids (:552-556) and bundle_id
        (:546-550) with NO room/user binding, unlike the codebase's own convention (bundles/route.ts:85-92,
        products/evaluate:79). Under the inert-RLS memory store the app-layer bind is the sole boundary, so
        an authed caller with an owned room_id can read another tenant's products/bundle into a render.
        Mitigated by unguessable UUIDs + image output. FIX: bind product_ids with .eq("room_id", room_id) and
        verify bundle_id belongs to room_id.
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship-critical. Coverage up to ~60/49/66/61 but CI verify still runs bare `vitest run` (no
        --coverage), so the floor never gates PRs; evals live-only/weekly and skip-green when keys unset; no
        recorded-cassette per-PR eval tier.
    - dimension: performance
      severity: low
      gap: >-
        Not ship-critical, and the headline N+1 is currently INERT under the default in-memory data layer
        (in-process array ops, not DB round-trips; the pgvector RPC would be dead code until the real-DB
        cutover). Real items: next/image still 0 (raw <img> 32, unchanged); no perf budget.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
