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
  as_of: 2026-07-20
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C — capped at the weakest ship_critical link (functional_reality C, production reality UNCHANGED: persistence still ships INERT by default). The per-dimension picture is STABLE vs 2026-07-13, with one notable WITHIN-dimension change: the mockups IDOR that dropped security_rls A+->A last cycle is now FIXED (#610 fix landed), but a FRESH 55-route sweep found a NEW missed guard of the exact same class (saved-designs POST reads client-supplied project_id unbound), so security_rls HOLDS at A rather than recovering to A+. THREE ship_critical dims remain below A: functional_reality C, design_taste B, business_case_strength B — unchanged from last cycle.
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — THREE remain below A (functional_reality C, design_taste B, business_case_strength B)
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C — production reality is UNCHANGED since 2026-07-13. The persistence PREPARE (#531)
        is still real, reviewable code behind a DATA_BACKEND flag (lib/supabase/server.ts createClient()
        branches to a real Postgres+RLS client and FAILS LOUD on missing creds :76-82; getCurrentUserId
        symmetric :108-118), selection-tested (__tests__/supabase/data-backend.test.ts). BUT the flag STILL
        DEFAULTS to memory — supabaseDataBackendEnabled() reads process.env.DATA_BACKEND==="supabase"
        (server.ts:23), and the module docstring still says it "ships INERT (memory backend)" until the
        owner flips it (:16). So by default every `.from()`/`.storage` op still hits lib/store/memory-store.ts
        ("Data persists only for the lifetime of the server process"); on Vercel serverless / any restart /
        multi-replica host a user's projects/rooms/diagnoses/saved-designs still do NOT survive a cold start —
        the retention-critical "revisit your saved designs" journey (a VISION pillar) is still broken in the
        default prod config. The real-Postgres cold-start integration test the last three grades named STILL
        does not exist: data-backend.test.ts:6-9 EXPLICITLY defers the round-trip to "a human-verified cutover
        step", and the two persistence tests that DO exist (__tests__/api/saved-designs-full-persistence.test.ts,
        analyze-apartment-persistence.test.ts) drive a MOCKED client — real regression guards (hollow-snapshot
        500, duplicate-room-type clobber) but NOT a cold-start persistence proof. `git log -S DATA_BACKEND`
        shows only test-file ledger commits since 07-13, never the default line. DoD Track A correctly
        UNCHECKED; preflight functional-journeys gate RED. The money-path E2E (e2e/journeys.spec.ts) asserts a
        REAL decodable PNG + entitlement flip, but its OWN comment states it runs against the in-memory backend
        (single-process signal, not cold-start proof). C not B (persistence is BLOCKING for a sellable,
        retention-driven app), C not D (everything else — full AI pipeline, billing, auth, UI — genuinely works;
        one env flip + one test from viable). RAISE to A: (1) make DATA_BACKEND=supabase the production DEFAULT
        (memory dev-only), (2) add the integration test that writes via the money path, simulates a cold start
        (fresh process/client), and re-reads the row from real Postgres, (3) confirm the 26 RLS policies execute
        at runtime once the memory store is gone. The PREPARE half is done — this is the human-gated cutover +
        proof test.
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh adversarial grader, cold). Signals green this cycle: `npx tsc --noEmit` clean,
        `npx eslint .` 0 errors (19 warnings — vendored-tooling only, see artifact_integrity), `npm run
        check:determinism` green, `npm test` 2185 pass / 11 skip (up from 2051; the 11 skips are RUN_EVALS-gated
        by design). maxDuration sweep clean — every provider-touching route carries `export const maxDuration`;
        the routes flagged by a naive grep (saved-designs, bundles GET, mobile/saved-designs, projects/[id],
        identified-products/search) are DB/auth-only, not provider calls. Cost contract intact: HIGH thinking
        confined to DEFAULT_THINKING (lib/ai/models.ts:22-24 — apartment_analysis/area_analysis/diagnosis), no
        hard-coded HIGH literal on a disallowed text task; harness-ratchet + provider-floors tests present.
        Billing webhook ordering sound: constructWebhookEvent runs FIRST (400 on bad sig before the admin client
        is even built), idempotent on Stripe redelivery (reads previousStatus before upsert, suppresses both
        lifecycle emails on redelivery). No stub/TODO/dead path on a critical route. Non-blocking A->A+ item
        (unchanged): maxDuration coverage is grep-verified, not test-enforced — a ratchet test asserting
        "provider route => maxDuration" would close the latent hole. No such violation exists today.
    security_rls:
      grade: A
      ship_critical: true
      gap: >-
        HELD at A. The mockups IDOR that dropped this A+->A last cycle is FIXED (#610): app/api/mockups/route.ts
        POST now binds bundle_id with .eq("id", bundle_id).eq("room_id", room_id) + 404 if unowned (:556-563),
        and product_ids with .eq("room_id", room_id).in("id", product_ids) + rejects the whole request if any id
        isn't a product of the room (:584-594) — no enumeration oracle (both 404). BUT a FRESH 55-route
        adversarial sweep found a NEW missed guard of the EXACT same class — falsifying any "no remaining missed
        guard" basis a THIRD time. app/api/saved-designs/route.ts POST guards the client-supplied room_id (:64)
        but then reads a SEPARATE client-supplied project_id with NO user bind:
        .from("projects").select("name, building_name").eq("id", project_id).single() (:156-160, no
        .eq("user_id", userId)) — and copies project.name + building_name from ANY tenant's project into the
        caller's saved_designs.metadata (:163-164, readable back via GET /api/saved-designs/[id]). The route's own
        comment (:59) claims project_id is guarded "below," but the guard was never implemented. A not lower: it
        is a cross-tenant READ of two string fields only (project name + building name), no cross-tenant write, no
        full-research exposure; but under the inert-RLS memory store the app-layer bind is the SOLE boundary, so
        it is real. Everything else stays strong: all fan-out/paid-LLM routes carry checkRateLimit +
        checkDailySpend; secrets clean (git ls-files shows only .env.example; no sk_live/service_role leak; no
        NEXT_PUBLIC_*/EXPO_PUBLIC_* secret); preflight GATE 6 green (26 public tables all ENABLE ROW LEVEL
        SECURITY). RAISE back to A+: bind the saved-designs project_id fetch with .eq("user_id", userId) (or
        verify project_id === room.project_id), returning 404 on mismatch, mirroring the mockups/bundles
        convention; add an IDOR regression test.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — the two capping gaps are BYTE-FOR-BYTE UNCHANGED this cycle (no movement toward A). Gap (1):
        AUTHED_A11Y_ROUTES (e2e/journeys.spec.ts:182) is still the LOW-density set
        ["/dashboard","/account","/saved","/billing/upgrade?tier=pro"] — NOT extended to the design-DENSE
        diagnosis/mockups/compare surfaces (which exist on disk and where WCAG contrast failures concentrate).
        The axe machinery is correct (AxeBuilder.withTags wcag2a/2aa/21a/21aa asserting zero critical/serious,
        reducedMotion:"reduce") but only iterates those 4 sparse routes. The suite already knows how to seed a
        project->room->analysis (money-path test :280-309) — the a11y loop just doesn't reuse it. Gap (2) FULLY
        REMAINS: `ls e2e/__screenshots__/` -> absent; grep toHaveScreenshot -> 0; playwright.config.ts has no
        snapshot config; ROADMAP F7 still [ ]. Rendered pixels / dark-mode parity / empty+error states asserted
        in code, never captured. The design SYSTEM itself stays A-territory: slop hunt clean on consumer surfaces
        (no emoji-in-JSX; no purple/violet/indigo/fuchsia tailwind classes; gradients resolve to warm-editorial
        tokens --accent-warm; real skeletons + layered error boundaries + not-found.tsx). This cycle's a11y
        commits (Runs 99/100/102 — keyboard nav + mobile loading states) are REAL but strengthen the system, not
        the capping proof axis. RAISE: extend AUTHED_A11Y_ROUTES to seeded diagnosis/mockups/compare (reuse the
        money-path seeding at journeys.spec.ts:280-309), and land F7 — commit e2e/__screenshots__/ baselines
        (light+dark, empty/error) with a recorded visual verdict.
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A on the store-ARTIFACT checklist. Every processor in app/privacy/page.tsx maps to a live used
        dependency (Gemini, DeepSeek, Supabase, Stripe, RevenueCat, Tavily, Google Places, Browserbase, Resend,
        Turnstile, Vercel Analytics, margin-meter telemetry) — no phantom Anthropic/OpenAI; DeepSeek is named
        honestly as the real secondary provider. In-app deletion real on both surfaces (app/api/user/delete:31 +
        app/api/mobile/account:56 call admin.auth.admin.deleteUser). Real icon (mobile/assets/images/icon.png PNG
        1024x1024 RGBA 799KB), real eas.json build+submit profiles (iOS appleId/ascAppId/appleTeamId via $EXPO_*
        env vars + Android internal/production tracks), canonical hello@aptdesignerai.com (18 occurrences, no
        other address). NOTE (cross-dependency, not double-counted): an actual store submission would fail review
        while functional_reality's default data layer stays non-persistent — the store-readiness ARTIFACTS are
        done, but launch is gated by that persistence blocker. Bounded A+ item unchanged and HUMAN-gated: Track D
        is not fully complete because D3 store screenshots (ROADMAP:461) require the owner to capture on a device
        — not a code defect.
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. `bash scripts/preflight.sh` -> 51 pass / 2 fail; the 2 failures are the expected
        environmental/pre-launch ones (functional-journeys can't stand up the authed stack cold; DoD
        9-unchecked), NOT integrity regressions. GATE 5 GREEN — all 4 machine-readable dashboard blocks parse AND
        pass schema (OWNER_ACTIONS, GROWTH_STATUS, QUALITY_SCORECARD grades in enum, BUSINESS_CASE_SUMMARY base
        122900 >= floor 100000). GATE 6 RLS green (26/26). Spot-checked roadmap ticks map to real artifacts (6
        evals/__tests__/*.eval.test.ts, mobile/eas.json, mobile/assets/images/icon.png, billing webhook + test).
        Pricing consistent — $29 one-time / $49-mo Pro / $399-yr — across lib/billing/stripe.ts:8-10, pricing
        page, BUSINESS_CASE.md, AND the pro_annual gate-off is disclosed CONSISTENTLY in all three (stripe.ts
        isAnnualBillingEnabled gates both checkout + pricing-page CTA; BUSINESS_CASE.md). Two named tick-precision
        nits keep this at A (not A+, not dropped to B): (1) ROADMAP F2 ticked [x] claiming "a regression below the
        floor fails the gate", but CI verify runs bare `npm test` = `vitest run` (no --coverage) — vitest.config.ts
        SELF-DISCLOSES this, so it is transparent, not hidden; the substance (CI doesn't gate coverage) is already
        the tests_evals B gap, so not double-counted as a second ship_critical drop. (2) NEW this cycle: F1 ticked
        [x] promising "zero new warnings", but `npx eslint .` now emits 19 warnings (0 errors) — all unused
        check* functions in the vendored Apache-2.0 file .agents/skills/impeccable/scripts/detector/
        detect-antipatterns-browser.js (introduced by commit e93fe56); the CI lint gate runs eslint without
        --max-warnings 0, so they pass silently. Localized to vendored TOOLING, not shipping app code, and not a
        false shipping artifact — low severity, held at A. RAISE to A+ / close the nits: wire --coverage into CI
        verify (also raises tests_evals) or soften F2; and either add .agents/** to eslint ignores /
        underscore-prefix the unused vendored functions, or drop F1's "zero new warnings" claim while 19 stand.
    business_case_strength:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — criterion-referenced, materially unchanged from 2026-07-13. The one relevant change since
        then (commit 3aae750, "business-case honesty B->A", #669/#600) improved DISCLOSURE on the GTM lens and
        touched only docs/growth/GTM_SCORECARD.md + GTM_AUDIT_MEMORY.md — zero code, zero economics, no annual
        enablement. Honesty != strength: the honest shippable-TODAY case still sits below the floor. Re-derived
        via the committed scripts (not eyeballed): `node analysis/business_case_without_annual_arr.mjs` ->
        $99,926 (the shippable-TODAY figure, ~$74 BELOW the $100K floor); scenario B (base) -> $122,956 but that
        is STEADY-STATE (~year 3; floor_met_year1: false, year-1 exit ~$58-60K) AND ~38% of its MRR
        ($3,888/mo of $9,753 Pro MRR) is the Pro Annual tier which is GATED OFF in code
        (app/api/billing/checkout/route.ts:55 refuses pro_annual unless isAnnualBillingEnabled();
        lib/billing/stripe.ts:47 reads ANNUAL_BILLING_ENABLED default off; PENDING_OPS apply-migration-021
        status:open). `node scripts/validate-computation.mjs` -> PASS 4/4. This is the SAME discipline the
        auditor applies to functional_reality: grade the shippable reality, not the optimistic projection. Not
        lower than B (and the honesty is EXEMPLARY — the gating + the $99.9K without-annual number are fully
        disclosed in the doc, nothing is gamed to clear the floor; the levers are real code: lib/waitlist/
        referral.ts, components/billing/upgrade-cta-card.tsx; inputs sit in honest bands). RAISE to A: either
        apply migration 021 + enable annual so the $122.9K base becomes transactable-today (and
        floor_met_year1 can honestly flip), OR lift the without-annual case above $100K via the named conversion
        lever (3% -> 5% paywall/trial optimization) so the shippable floor clears without leaning on a gated tier.
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B — coverage nudged up again, structural gaps unchanged (criterion-referenced: same state, same
        letter). `npx vitest run --coverage`: ~61.15% stmts / 50.33% branch / 66.35% funcs / 62.22% lines (up
        from 59.98/48.86/65.61/61.01), comfortably above the 40/30/42/40 floor; 2185 pass / 11 skip. But CI STILL
        never enforces coverage — .github/workflows/ci.yml verify runs bare `npm test` = `vitest run`, no
        --coverage, so the floor is healthy by accident, not gated (vitest.config.ts self-discloses this); the ~9
        recent "F2 coverage" commits (Runs 94-102) only ADD tests, none wire --coverage into CI, so a coverage
        regression is still invisible on PRs. Evals remain live-only, owner-keyed: all 6
        evals/__tests__/*.eval.test.ts sit behind it.skipIf(!evalsEnabled()) (the 11 skips), contributing nothing
        on a normal PR; a lib/ai/cassette-provider.ts exists but is NOT wired into any per-PR eval tier. RAISE:
        add --coverage with enforced thresholds to the CI verify job so the floor gates; wire a
        recorded-cassette eval tier that runs per-PR so the evals exercise real logic without live keys.
    performance:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B (criterion-referenced — same state, same letter). The headline N+1 persists in code
        (lib/store/embedding-index.ts:46 topKSimilar full-table select('*') + in-memory cosine loop, called
        per-crop in identified-products-pipeline.ts:117; the ivfflat index from migration 008 UNUSED — grep
        ivfflat/.rpc in lib/ = 0) — but it remains INERT under the default in-memory data layer (in-process array
        ops, not DB round-trips), so a pgvector match_ RPC would be dead code until the real-DB cutover (see
        functional_reality). Real regardless of the data layer: next/image adoption still 0 (raw `<img>` count 32
        across app+components, UNCHANGED — each occurrence individually silenced with eslint-disable
        no-img-element, so the rule is active-but-suppressed with NO hard guard against growth); no
        Lighthouse/bundle/perf budget in CI or preflight. Cost discipline remains the strong pillar (explicit
        thinkingConfig/thinkingFor, DETERMINISTIC_SEED, withCostLedger/recordUsage throughout). RAISE: sequence
        the pgvector match_ RPC WITH the real-DB migration; adopt next/image + flip no-img-element to error (or
        add a count ratchet) so the count can't climb; add a perf budget.
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE binding blocker (held C). Production reality unchanged: the persistence PREPARE landed (#531) but
        still ships INERT — DATA_BACKEND DEFAULTS to memory (lib/supabase/server.ts:23), so production still
        routes .from()/.storage to the non-persistent memory store and user projects/rooms/diagnoses/
        saved-designs do NOT survive a serverless cold start / multi-replica host. The real-Postgres cold-start
        integration test still does not exist (data-backend.test.ts:6-9 defers it; the two persistence tests use
        a mocked client). Remaining (human-gated cutover): (1) make DATA_BACKEND=supabase the production default,
        (2) add the write-via-money-path -> cold-start -> re-read-from-real-Postgres integration test, (3) confirm
        the 26 RLS policies execute at runtime once the memory store is gone. Tracked: #525.
    - dimension: business_case_strength
      severity: high
      gap: >-
        Ship_critical, below A (held B). The shippable-TODAY ARR is $99,926 (re-derived via
        analysis/business_case_without_annual_arr.mjs), ~$74 BELOW the $100K floor, because Pro Annual is gated
        off in code (checkout/route.ts:55; ANNUAL_BILLING_ENABLED default off; migration 021 unapplied). The
        floor-clearing $122.9K base leans on that gated tier (~38% of MRR) + ~year-3 steady state
        (floor_met_year1: false). Honesty is exemplary (fully disclosed, nothing gamed); the grade tracks the
        shippable reality. The GTM honesty issue (#600) is closed/fixed but is a DIFFERENT lens. RAISE: apply
        migration 021 + enable annual so $122.9K is transactable, OR lift the without-annual case above $100K via
        conversion 3%->5%.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship-critical, below A (held B). Two capping gaps BYTE-FOR-BYTE UNCHANGED this cycle: AUTHED_A11Y_ROUTES
        (journeys.spec.ts:182) still the low-density set [dashboard/account/saved/upgrade], NOT extended to the
        design-dense diagnosis/mockups/compare surfaces; e2e/__screenshots__/ still absent so
        pixels/dark-parity/empty-error unverified (F7 unchecked, toHaveScreenshot=0). Extend AUTHED_A11Y_ROUTES
        to seeded diagnosis/mockups/compare (reuse seeding at :280-309) and add toHaveScreenshot baselines
        (light+dark, empty/error). Tracked: #204.
    - dimension: security_rls
      severity: medium
      gap: >-
        HELD A (still at the A ship-bar, so not a ship-gate blocker — but a real cross-tenant read to close). The
        mockups IDOR (#610) is FIXED, but a fresh 55-route sweep found a NEW same-class miss:
        saved-designs/route.ts POST reads client-supplied project_id via .eq("id", project_id).single()
        (:156-160) with NO .eq("user_id", userId), leaking another tenant's project name + building_name into the
        caller's saved_designs.metadata (readable via GET /api/saved-designs/[id]). Mitigated: read-only, two
        string fields, no cross-tenant write. FIX: bind project_id with .eq("user_id", userId) (or verify
        project_id === room.project_id) + IDOR regression test. Tracked: update #610.
    - dimension: artifact_integrity
      severity: low
      gap: >-
        Held A (two named tick-precision nits, neither a false shipping artifact). NEW this cycle: F1 ticked [x]
        "zero new warnings" but `npx eslint .` emits 19 warnings (unused check* fns in the vendored
        .agents/skills/impeccable detector, commit e93fe56) — CI lint has no --max-warnings 0 so they pass
        silently. Plus the standing F2 tick overclaims CI coverage enforcement. Close: add .agents/** to eslint
        ignores or drop F1's claim; wire --coverage into CI or soften F2.
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship-critical. Coverage up to ~61/50/66/62 but CI verify still runs bare `vitest run` (no
        --coverage), so the floor never gates PRs; evals live-only/weekly and skip-green when keys unset; no
        recorded-cassette per-PR eval tier (cassette-provider.ts exists but unwired). Tracked: #200.
    - dimension: performance
      severity: low
      gap: >-
        Not ship-critical, and the headline N+1 is currently INERT under the default in-memory data layer (the
        pgvector RPC would be dead code until the real-DB cutover). Real items: next/image still 0 (raw <img> 32,
        each eslint-disabled, no growth guard); no perf budget. Tracked: #385.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
