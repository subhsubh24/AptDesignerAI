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
  as_of: 2026-07-27
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C, but the per-dimension picture WORSENED — three dims dropped, all on fresh adversarial findings, none a code regression by the factory. store_readiness A->C (account deletion never purges the PUBLIC storage buckets, so a deleted user's room photos + mockups stay publicly fetchable forever, contradicting the app's own privacy promise; AND docs/app-privacy.md declares location "Not collected" while projects stores city/neighborhood/building_name/latitude/longitude). artifact_integrity A->B (the F1/F2 ticks assert enforcement that exists nowhere in the repo, unchanged across 33 commits after being named, plus 3 newly-stale docs). performance B->C (a correction: the prior B assumed the perf debt was inert under the memory backend; a deeper sweep found live serial image I/O outside the concurrency gate plus an uncapped request-body fan-out). FIVE ship_critical dims now sit below A, up from three. Genuine progress this cycle too: the authed journey tier runs green in CI, the saved-designs IDOR is fixed and a fresh 56-route sweep found no successor, the design-dense a11y gate landed and caught a real critical violation, and the raw-<img> ratchet is real and enforcing.
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — FIVE remain below A (functional_reality C, store_readiness C, design_taste B, artifact_integrity B, business_case_strength B)
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C for the SIXTH consecutive cycle — the blocking defect is untouched, even though the
        surrounding evidence genuinely improved. NEW and worth crediting: the authed journey tier now
        RUNS GREEN in CI (run 30254523085 @ a38160d, `journeys` job conclusion success, with
        E2E_AUTH_STACK=1 and service-role env exported at .github/workflows/ci.yml:153,174-182), so the
        rubric's LITERAL A signal is met; the money path asserts a real decodable PNG with non-zero IHDR
        dimensions (e2e/journeys.spec.ts:486-489); and paywall->unlock is a REAL Postgres proof
        (e2e/helpers/seed.ts:88-100 inserts a live stripe_customers row via service-role, read back
        through getAdminClient() in lib/entitlements/web.ts:91-105, bypassing the memory store). It is
        still NOT A because that green suite proves the MEMORY backend, not the production config: the
        journeys job never sets DATA_BACKEND (ci.yml:148-160) and the spec concedes it outright at
        journeys.spec.ts:416-421 ("createClient() proxies all data ops to the in-memory store ... an
        admin/Postgres seed is invisible to the route"). lib/supabase/server.ts:23 still reads
        `process.env.DATA_BACKEND === "supabase"` (default memory); only two commits since 07-20 touched
        that file (7284446, 43e122f), neither changed the default; vercel.json has no env block;
        PENDING_OPS.md:57-61 still lists `cutover-to-persistent-data` status:open, conceding "a user's
        projects/rooms/diagnoses/saved-designs do NOT survive across instances" and "the 26/26 RLS
        policies never execute at runtime". The real-Postgres cold-start test still does not exist
        (__tests__/supabase/data-backend.test.ts:29-31 mocks @supabase/ssr; :6-9 defers the round-trip to
        a human step). preflight GATE 1b RED. C not B (persistence is blocking for a retention-driven,
        sellable app), C not D (everything else genuinely works). RAISE to A: (1) set
        DATA_BACKEND: "supabase" in the CI journeys job so the authed suite exercises the PRODUCTION
        config against supabase-local (this also makes the 26 RLS policies actually execute), (2) add the
        cold-start proof — write a saved design through the app's API, restart the process, re-read it,
        assert it survives, plus a second-user RLS denial, (3) make DATA_BACKEND=supabase the production
        default. NOTE: migration 030 (share-token) must land BEFORE the cutover — PENDING_OPS.md:164 says
        that hole is "dormant TODAY only because DATA_BACKEND still defaults to the in-memory store".
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh adversarial grader, cold). Signals green this cycle: `npx tsc --noEmit` clean,
        `npm test` 2438 pass / 11 skip (up from 2185; the 11 skips are RUN_EVALS-gated by design),
        `npm run check:determinism` green, `npx eslint .` 0 errors / 19 warnings (vendored tooling only —
        see artifact_integrity), preflight GATE 1 all green incl. production build + mobile tsc.
        harness-ratchet + provider-floors pass (7 tests). The prior A->A+ ceiling item turns out to have
        NO underlying defect: a transitive import-closure sweep of all 27 routes lacking `maxDuration`
        found ZERO real misses — the suspicious-sounding routes read pipeline OUTPUT
        (rooms/[roomId]/diagnosis/route.ts:21-27 selects a stored row; identified-products/search:75
        selects embedding metadata, not the vector; bundles is CRUD behind bundles/evaluate). Billing
        webhook correct: signature verified at app/api/billing/webhook/route.ts:80 BEFORE getAdminClient()
        at :96, idempotent on redelivery via the pre-upsert status read (:111-119), DB failure 500s so
        Stripe retries. Zero empty catch blocks; zero catch-returns-success in app/api or mobile.
        Determinism holds structurally (jitter guarded lib/ai/retry.ts:86; caches bypassed
        search-cache.ts:32, product-extractor.ts:25; escalation-ladder imports only a logger). Three
        A->A+ items, all the SAME class — enforcement by convention where the harness cannot reach:
        (1) still no maxDuration sweep test (the only assertion is __tests__/api/auth-signup.test.ts:48-50,
        one route); (2) harness-ratchet.test.ts:22 sets SCAN_DIRS=["lib","app"], so
        scripts/seed-product-embeddings.ts:100 has a live geminiProvider.chat({...}) with NO thinkingConfig
        and NO seed, invisible by construction; (3) lib/agents/computer-use/agent-loop.ts:261 hardcodes
        `thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }` on task `computer_use` — NOT in the
        allowed-HIGH list — and passes no seed; it deliberately bypasses .chat() (documented :11-18) so
        neither ratchet nor check:determinism covers it. RAISE to A+: one test walking app/api/**/route.ts
        transitive import closures asserting maxDuration whenever the closure touches lib/ai/*, and extend
        SCAN_DIRS to scripts/ + add `generateContent(` to the ratchet markers so (2) and (3) become CI
        failures rather than audit findings.
    security_rls:
      grade: A
      ship_critical: true
      gap: >-
        HELD at A, and for the FIRST cycle in four a fresh sweep did NOT beat the prior finding. The
        saved-designs project_id IDOR is GENUINELY FIXED (commit 1a4b1dc): app/api/saved-designs/route.ts:168-174
        now binds `.eq("id", project_id).eq("user_id", userId).maybeSingle()` — maybeSingle means an
        unowned project yields null metadata with no error, so there is no enumeration oracle — pinned by
        __tests__/api/saved-designs-project-idor.test.ts. The share-token fix (7284446) is real: exactly two
        readers of share_token funnel through lib/supabase/public-share.ts readSharedDesignByToken(), which
        binds share_token AND is_public via service-role, enforces MIN_SHARE_TOKEN_LENGTH=16, returns a
        narrowed column set excluding user_id/share_token, and migration 030 DROPs the permissive anon
        policy so the anon key has no PostgREST read path to saved_designs. A FRESH sweep of all 56
        app/api/**/route.ts found NO cross-tenant read, NO cross-tenant write, NO auth bypass: every route
        binding one client id then reading another DOES bind the second (mockups :556-597 bundle_id+product_ids
        with reject-all-on-any-miss; bundles POST :81-95; products/evaluate :79; bundles/evaluate :59;
        rooms/[roomId]/images DELETE :141), and PATCH allowlists on rooms/projects exclude user_id/project_id
        so ownership cannot be reassigned. Guards: 15/15 provider-touching routes carry checkRateLimit AND
        checkDailySpend before the call; SSRF guards on every server-side fetch; open redirect closed at
        app/api/auth/callback/route.ts:4. Middleware is deny-by-default with each public API prefix carrying
        its own in-route auth. Secrets clean: `git ls-files | grep -i env` -> only .env.example + config/test
        files; every NEXT_PUBLIC_*/EXPO_PUBLIC_* name is publishable. preflight GATE 6 green (26 public
        tables, all ENABLE ROW LEVel SECURITY; 20 owner-scoped policies + 6 deliberate policy-less deny-all
        service-role-only tables, each with an in-migration rationale — stricter than the rubric, not weaker).
        Two NON-EXPLOITABLE integrity nits keep this off A+ (the rubric's A+ needs 0 findings), and both are
        the same bind-every-client-id convention this dimension ratchets on: (1)
        app/api/saved-designs/route.ts:242 persists `project_id: project_id ?? null` even when the
        ownership-bound fetch above returned nothing, storing a foreign id on the caller's own row (no
        cross-tenant read — /api/projects/[projectId] 404s on it); (2) app/api/products/route.ts:101
        length-validates search_session_id but never binds it to a caller-owned session (no code joins
        candidate_products -> search_sessions, so no read path exists today). RAISE to A+: persist project_id
        only when the bound fetch returned a row (`project ? project_id : null`); bind or drop
        search_session_id; pin both in __tests__/api/idor-followup-guards.test.ts.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B, but for the first time in three cycles ONE of the two capping gaps genuinely CLOSED.
        Gap (1) CLOSED: commit a38160d added a second axe gate, DESIGN_DENSE_A11Y_ROUTES
        (e2e/journeys.spec.ts:281-351), covering setup/diagnosis/products/bundles/mockups/compare with
        wcag2a/2aa/21a/21aa failing on critical||serious (:339-343), seeding project+room through the app's
        own API (:299-319), and — the part that makes it non-vacuous — asserting each route's OWN h1
        (:333-337) precisely because app/not-found.tsx renders an h1 and a 404 would otherwise scan clean.
        It caught and fixed a REAL critical button-name violation (Radix SelectTrigger is role="combobox",
        which takes no name from content, leaving Budget Mode unnamed). The original AUTHED_A11Y_ROUTES
        array is byte-for-byte identical, only moved to :233 — the gap closed by ADDING a gate, not
        extending that one. Gap (2) FULLY REMAINS, third cycle: `ls e2e/__screenshots__/` -> No such file;
        `grep -rn toHaveScreenshot e2e/ playwright.config.ts` -> 0; `grep -rn "page.screenshot\|screenshot:"`
        -> 0; ROADMAP.md:647 F7 still [ ], and ROADMAP.md:665-674 requires committed non-zero PNGs PLUS a
        recorded per-screenshot visual verdict — neither exists. NEW finding this cycle:
        components/manual-sourcing/ManualScorecardView.tsx:140-142 encodes ORDINAL score data with THREE
        categorical hues (emerald >= 8 / blue >= 6 / amber below) — the exact three-competing-accent
        anti-pattern VISION forbids, off the warm-editorial token system, and it renders on /focus
        (focus/page.tsx:1424), the core-journey flagship, which is also the ONE route deliberately excluded
        from the new a11y sweep (journeys.spec.ts:271-273). Run 119 fixed the identical pattern one file
        over (lib/utils/tier-colors.ts) and honestly scoped its guard as "NOT a repo-wide colour ratchet".
        Repo-wide: 267 raw-palette utilities vs 959 semantic-token ones. The design SYSTEM stays
        A-territory: ZERO purple/violet/indigo/fuchsia; ZERO emoji-as-iconography (lucide throughout); hex
        confined to token definitions in app/globals.css:39-60; landing is not centered-everything
        (asymmetric 2-col hero app/page.tsx:48, custom type scale, single warm accent, an honest trust strip
        that explicitly refuses fake metrics :77-78); real error.tsx/global-error.tsx/not-found.tsx +
        route-level error/loading states; focus-visible:ring-2 + active:scale-[0.97]
        (components/ui/button.tsx:7); full reduced-motion kill-switch (globals.css:524-532); .dark parity
        (globals.css:85). RAISE to A: land F7 (screenshot capture in playwright.config.ts + page.screenshot()
        at each journey step, commit non-zero PNGs to e2e/__screenshots__/, record the per-image verdict F7
        demands), and convert ManualScorecardView.tsx:140-142 to the single-hue emphasis ladder already
        proven in tier-colors.ts, extending __tests__/design/tier-colors-system.test.ts into the repo-wide
        colour ratchet that commit explicitly declined to claim.
    store_readiness:
      grade: C
      ship_critical: true
      gap: >-
        DROPPED A->C on two fresh, independently VERIFIED findings — both code/content defects fully within
        the loop's control, NEITHER human-gated. (F1) ACCOUNT DELETION DOES NOT DELETE THE USER'S PHOTOS.
        Both delete routes call only `admin.auth.admin.deleteUser()` (app/api/user/delete/route.ts:31,
        app/api/mobile/account/route.ts:57); `grep -rn "\.remove(" app lib` -> ZERO hits repo-wide, there is
        no auth.users delete trigger and no storage DELETE policy in
        supabase/migrations/001_initial_schema.sql:412-435. Uploads land at ${user.id}/${hash}.ext in
        `room-images` (app/api/upload/route.ts:71-83), and BOTH buckets are created `public` (
        001_initial_schema.sql:408,410 — `insert into storage.buckets (id, name, public) values
        ('room-images','room-images', true)` and the same for 'mockups') with an "Anyone can view room
        images" policy (:417-419). So after account deletion a user's room photos and generated mockups
        REMAIN PUBLICLY FETCHABLE FOREVER at a guessable-prefix URL. This directly contradicts the app's own
        promises — app/privacy/page.tsx:208 ("Delete your account — this immediately and permanently removes
        all your content"), :186 ("retained until you delete your account"), docs/app-privacy.md:98, and the
        in-app alert mobile/src/app/settings.tsx:156 — and it fails Apple 5.1.1(v) (delete the account AND
        its associated data) and Play's deletion policy. (F2) PRIVACY LABELS ARE INACCURATE IN BOTH
        DIRECTIONS. Undisclosed collection: the dashboard collects city, neighborhood, apartment building and
        home lat/lng (app/dashboard/page.tsx:601,761 via components/ui/place-autocomplete.tsx), persisted to
        `projects` (002_onboarding_fields.sql:4-7 city/neighborhood/building_name, 005_place_ids.sql:4-5
        latitude/longitude) and sent to Google with place_id + latLng (app/api/apartment-research/route.ts:
        875-918) — yet docs/app-privacy.md:19 declares "Not collected: name, phone number, physical address,
        precise or coarse location", a FALSE Apple App Privacy declaration, and app/privacy/page.tsx:34-49
        omits location entirely. Wrong purpose: privacy/page.tsx:129-132 and docs/app-privacy.md:67,106
        describe Google Maps/Places as "product image search terms, with no personal data", when it is
        actually address/building autocomplete over user-typed location plus place photos by place_id
        (app/api/places/photo/route.ts:56); app/layout.tsx:53-55 loads maps.googleapis.com on EVERY page
        (Google sees every visitor's IP/referer), undisclosed. C not B: a false store privacy declaration and
        incomplete data deletion are review-blocking and are user-facing privacy harm, not cosmetic. C not D:
        every other artifact is real and verified — mobile/assets/images/icon.png is a genuine PNG 1024x1024
        RGBA (splash 228x213, adaptive 512x512, mono 432x432); mobile/eas.json has real build (dev/preview/
        production, app-bundle, autoIncrement) AND submit profiles (appleId/ascAppId/appleTeamId via env,
        Android internal|production); mobile/app.json:23,44 bundle id ai.aptdesigner.app both platforms with
        NSPrivacyTracking:false and accurate expo-image-picker permission strings (:78-79); paywall
        disclosure is complete and TESTED (price/period paywall-sheet.tsx:93, auto-renew + how-to-cancel
        :371-376, Restore Purchases :344-352, Terms/Privacy :383-395 — __tests__/billing/
        purchase-disclosure.test.ts 6 pass); deletion is discoverable (mobile/src/app/settings.tsx:275) and
        DB-cascade-complete; the other 11 processors all map to real deps with no phantoms. RAISE to A:
        (1) in BOTH delete routes, list and `admin.storage.from('room-images'|'mockups').remove(...)` the
        user's prefix before deleteUser (plus a regression test), (2) declare location collection in
        docs/app-privacy.md and app/privacy/page.tsx and correct the Google Maps/Places purpose entry in
        both. D3 store screenshots (ROADMAP.md:461) remains the only genuinely HUMAN-gated Track D item.
    artifact_integrity:
      grade: B
      ship_critical: true
      gap: >-
        DROPPED A->B. Not for a new false tick — 12 sampled ticks ALL verified to real artifacts (G1 rate
        limiting, the only new tick since 07-20, checked by sweeping every provider-importing route for a
        limiter: zero misses; G2/G3/G5/G6/G7, A6, B6, C1-C4, E6, E8, F6) and pricing is FULLY consistent
        ($29/$49/$399 across lib/billing/stripe.ts:8-10, app/pricing/page.tsx:50,69,190,
        app/billing/upgrade/page.tsx, docs/BUSINESS_CASE.md:95-97, mobile paywall-sheet.tsx:48,56,
        PENDING_OPS.md:602-611, lifecycle emails), ARCHITECTURE.md accurate, GATE 5 GREEN (all 4 dashboard
        blocks parse AND pass schema; GROWTH_STATUS engine_pct=100 independently recomputed against its 5
        anchor files), GATE 6 green (26/26). It drops because the two nits named LAST cycle are BOTH
        UNCHANGED after 33 commits, and the rubric's A bar is "no real gaps": ROADMAP.md:591-594 is still
        [x] asserting "a regression below the floor fails the gate" while `--coverage` appears ONLY in
        package.json:12 — not in .github/workflows/ci.yml (verify runs bare `npm test`), not in
        scripts/preflight.sh — and vitest.config.ts:18-21 LITERALLY contradicts the tick ("the CI verify job
        runs bare vitest run (no --coverage), so a coverage regression is NOT yet caught in CI"). A ticked
        box asserting an enforcement mechanism that exists nowhere in the repo is exactly what this
        dimension grades. ROADMAP.md:587-590 is still [x] titled "Lint clean + ENFORCED" while `npx eslint .`
        emits 19 warnings (0 errors) and ci.yml:94 runs eslint with no --max-warnings 0, so they pass
        silently. THREE newly-stale docs: e2e/ROUTE_INVENTORY.md:60-61 says the CI journeys job still needs
        adding ("the loop cannot edit .github/") when ci.yml ALREADY HAS a full journeys: job;
        ci.yml:1-5 still reads "READY-TO-APPLY workflow — copy this to .github/workflows/ci.yml" when it IS
        that file; ROUTE_INVENTORY.md:3 claims it proves "every route/flow" while 28 of 35 app/**/page.tsx
        routes appear in neither its table nor its honest "Tracked gaps" list. TWO further tick-precision
        findings surfaced by sibling graders: ROADMAP.md:389 A4 is [x] "Accounts, data model, and RLS are
        correct and secure" while PENDING_OPS.md:60 concedes "the 26/26 RLS policies never execute at
        runtime"; and ROADMAP.md:457 D2 is [x] for prepared App Privacy labels whose artifact
        (docs/app-privacy.md) now contains a FALSE declaration (see store_readiness F2) — the substance is
        scored under store_readiness, not double-counted here. B not C: no ticked box is hollow (every
        artifact physically exists and does real work), the overclaims are about ENFORCEMENT and ACCURACY,
        and vitest.config.ts self-discloses one of them. RAISE to A: change ci.yml verify to
        `npm run test:coverage` (or reword F2 to "gated in npm run test:coverage, not CI"); add .agents/**
        to eslint ignores then set `--max-warnings 0` (or drop F1's "ENFORCED"); delete the stale
        ROUTE_INVENTORY.md:60-61 note and the ci.yml:1-5 "copy this" header; untick A4 until RLS executes at
        runtime.
    business_case_strength:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — the shippable-TODAY number is BIT-IDENTICAL to last cycle. Re-derived via the committed
        scripts, not eyeballed: `node analysis/business_case_without_annual_arr.mjs` -> $99,926, still ~$74
        BELOW the $100K floor; scenario A $46,109 / B (base) $122,956 / C $276,652; sensitivity
        monthly-churn-12 $93,556 and annual-churn-40 $103,214; `node scripts/validate-computation.mjs` ->
        PASS (6 figures verified). Hand re-derivation reproduces $99,926.3 exactly — nothing is gamed. The
        blocker is unchanged: Pro Annual is still gated OFF in code
        (app/api/billing/checkout/route.ts:55 refuses pro_annual unless isAnnualBillingEnabled();
        lib/billing/stripe.ts:47 reads ANNUAL_BILLING_ENABLED==="true", ships disabled;
        app/pricing/page.tsx:186 hides the annual CTA; app/billing/upgrade/page.tsx:84 redirects;
        PENDING_OPS.md:63-69 apply-migration-021 status:open), and the floor-clearing $122,956 base is
        STEADY-STATE ~year 3 with docs/BUSINESS_CASE.md:4-14 honestly recording floor_met_year1: false.
        Honesty remains EXEMPLARY and is not the gap: the only edit since 07-20 (commit fe1d4bc) moved two
        sensitivity figures in the LESS flattering direction (~$85K->$93,556; ~$106K->$103,214, explicitly
        noting the old one "erred in the FLATTERING direction") and fixed an 84%-vs-58.1% rate-vs-probability
        conflation; inputs cite real sources (Mapendo, Adapty, SplitMetrics, Recurly, GrowSurf, Gemini
        pricing). Levers are genuinely BUILT, not listed: lib/waitlist/referral.ts,
        components/billing/upgrade-cta-card.tsx, plus post-07-20 commits 724e138 (free-tier save-limit 403
        -> real paywall Dialog + save_limit_paywall_shown event), 0ab361a (save->share viral nudge + funnel
        events), f4011f4 (past_due grace). NEW findings this cycle: (a) CHANNEL INCONSISTENCY — the model
        applies a flat 30% store commission (analysis/business-case-model.mjs:11 STORE_NET = 0.70, i.e.
        mobile economics) while the "shippable-today" $99,926 is derived from a WEB/Stripe-only gate
        (migration 021 constrains stripe_customers.tier); on the modeled channel the haircut is wrong
        (Stripe ~2.9%, not 30%) AND annual is not gated at all there —
        mobile/src/components/paywall-sheet.tsx:44-59 offers "Annual / $399 / year" with no
        isAnnualBillingEnabled equivalent anywhere in mobile/ (all 9 call sites are web); (b) the $29
        Apartment tier, credited with 60% of conversions ($487/mo) in the model, is ABSENT from the mobile
        paywall; (c) docs/BUSINESS_CASE.md as_of: 2026-07-13 is 14 days stale and credits none of the three
        post-07-20 conversion levers. RAISE to A: apply migration 021 + set ANNUAL_BILLING_ENABLED=true in
        the same deploy (owner ops step, PENDING_OPS.md:68) so $122,956 becomes transactable; within the
        loop's control, resolve (a) by modeling ONE channel consistently — a web/Stripe shippable-today
        figure at real Stripe fees clears $100K on its own math — and credit the built levers only against a
        cited benchmark. Do NOT close the $74 by nudging the 4% conversion input; that is gaming and will be
        graded DOWN.
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B — coverage up again, both capping gaps unchanged. `npx vitest run --coverage` ->
        62.6% stmts / 51.88% branch / 67.53% funcs / 63.6% lines (up from 61.15/50.33/66.35/62.22),
        2438 pass / 11 skip / 226 files. vitest.config.ts:22-25 thresholds are 40/30/42/40 — ~22 points
        BELOW reality, so the floor is healthy by accident. CI STILL never gates it:
        .github/workflows/ci.yml:39 runs `npm test` = `vitest run`, no --coverage; `--coverage` appears only
        in package.json:12. Evals still contribute NOTHING per-PR: all 6 evals/__tests__/*.eval.test.ts are
        it.skipIf(!evalsEnabled()) (evals/runner.ts:158-160 = RUN_EVALS==="1"), and live-eval.yml is
        workflow_dispatch + weekly cron where every step is `if: env.GEMINI_API_KEY != ''` — it prints a
        ::warning:: and passes GREEN when keys are unset, so "live evals run green against the real
        pipeline" is not demonstrated. REAL progress worth crediting: lib/ai/cassette-provider.ts is now
        wired into two per-PR tests — __tests__/integration/render-pipeline-cassette.test.ts:24-28 mocks only
        the Gemini boundary, drives the real buildMockupContext -> generateMockupPrompt ->
        generateMockupImage chain, and asserts a decodable PNG signature with non-zero dimensions; that is a
        genuine hermetic money-path integration test and the best thing added since 07-20. Adversarial test-
        QUALITY sample: strong work exists (validation-agent-math-cap.test.ts runs the real
        computeSetMathScores and asserts the cap may only LOWER; saved-designs-project-idor.test.ts:52-56
        emulates the RLS user_id filter so an id-only query FAILS the test; quick-score-gate.test.ts:25-35
        covers boundaries + negatives), but 7 of 41 changed test files are pure prompt-string formatter
        change-detectors — e.g. lifestyle-fit-format.test.ts:35-48 has two separate tests asserting the same
        toFixed(2), and outlet-reach-format.test.ts:23-63 makes six toContain assertions on exact emoji/label
        strings; a refactor breaks them, a logic bug does not. The real gap is WHERE the coverage is not:
        lib/agents (the maker/checker core) sits at 41.33% stmts / 34.13% branch — orchestrator.ts 2.97%,
        room-diagnostician.ts 0.94%, research-assembler.ts 1.58%, fit-scorer.ts 2.42%, validation-agent.ts
        13.06% — and coverage.include is lib/**/*.ts only, so ZERO app/ rows are measured. RAISE to A:
        point ci.yml:39 at `npm run test:coverage` with thresholds raised to ~58/48/63/59 so the floor is
        live; add app/**/*.{ts,tsx} to coverage.include; extend the render-pipeline-cassette pattern into a
        per-PR cassette eval tier for the 6 skipIf'd evals (leaving live-eval.yml as the weekly real-API
        confirmation) and confirm one live run actually green; cover orchestrator.ts /
        room-diagnostician.ts through the cassette rather than adding more formatter string tests.
    performance:
      grade: C
      ship_critical: false
      gap: >-
        DROPPED B->C — NOT a regression in the code, a correction of the prior grade. The B rested on the
        belief that the headline N+1 was INERT under the memory backend and therefore harmless today; a
        deeper sweep falsified that premise by finding LIVE serial network I/O on the time-to-wow path plus
        an uncapped user-controlled fan-out, both independent of the data layer. Each finding below was
        re-verified first-hand by the auditor. (1) lib/ai/gemini.ts:254 awaits fetchImageAsBase64(imgUrl)
        SERIALLY per image inside the part-builder loop — a 10s-timeout HTTP fetch plus sync base64 per
        photo, before every model call — and it runs OUTSIDE the concurrency gate (geminiConcurrencyLimit is
        declared :60 but applied ONLY at :605, around the model call). This is on every vision call in the
        app and compounds with app/api/analyze-apartment/route.ts:285, a Promise.all over user-controlled
        rooms with no pLimit. (2) lib/ai/resolve-image.ts:59 exports resolveImageBlocks() — the batched
        Promise.all helper — with ZERO call sites (`grep -rn resolveImageBlocks lib/ app/` returns only the
        definition), while all 13 real uses resolve serially in loops, including the mockup money path
        (mockup-agent.ts:291,418,448; mockup-verifier.ts:66; room-diagnostician.ts:120), each a
        getOrUploadFile -> fetchAsBlob + Files API upload, cold on first render. The fix is already written
        and simply unused. (3) app/api/mockups/route.ts:105 calls fs.readdirSync on the request path (from
        POST :614) — O(every mockup ever generated), growing forever. (4)
        app/api/products/evaluate-set/route.ts:151 does Promise.all over items.flatMap(item.urls) straight
        from the request body with NO cap, each an LLM extraction (the scoring phase below it IS batched at
        5, :257 — so the omission is inconsistent, not intentional). Unchanged from last cycle:
        embedding-index.ts:46 full-table select("*") + in-memory cosine per crop, ivfflat unused (`grep -rn
        ivfflat lib/` -> 0; the single .rpc hit is memory-store.ts:400's no-op stub); next/image adoption
        still exactly 0; still no perf budget anywhere (`grep -riE "lighthouse|bundlesize|size-limit|budget"
        .github/workflows/ scripts/ package.json` -> one non-blocking ::warning:: string in
        margin-eval.yml:94). GENUINE progress worth crediting: the raw-<img> growth ratchet from 38236d4 is
        REAL and enforcing — __tests__/perf/no-img-growth.test.ts passes (2 tests), is bidirectional (:91
        fails if the count drops without lowering MAX_RAW_IMG=30), runs in CI via npm test, and was
        replicated against a synthetic 31-img fixture that correctly FAILED; the count itself fell 32->30.
        The 33 new commits introduced ZERO new perf regressions (saved-designs actually gained .range()).
        Cost discipline stays green (63 .chat / 70 thinkingConfig / 91 DETERMINISTIC_SEED; harness-ratchet +
        provider-floors 7 pass), though recordUsage has only 5 call sites so the orchestrator money path
        carries no cost ledger. C not B: "no N+1/blocking on hot paths" now fails on live, non-inert
        evidence. C not D: nothing is broken, throughput is merely left on the table, and the ratchet shows
        the dimension is moving. RAISE to A, cheapest-first: batch the gemini.ts:254 image fetches with
        Promise.all inside the concurrency gate; swap the 13 serial resolveImageBlock loops to the
        already-written resolveImageBlocks; cap the evaluate-set fan-out with pLimit; replace readdirSync
        with an fs.promises.access probe; sequence the pgvector match_ RPC WITH the data cutover (not
        before — it would be dead code); adopt next/image on the whitelisted hosts next.config.ts:56-64
        already allows and ratchet MAX_RAW_IMG down as each lands; add any real budget to CI.
  top_gaps:
    - dimension: store_readiness
      severity: critical
      gap: >-
        NEW ship_critical regression A->C, and listed FIRST because unlike the persistence blocker it is
        100% within the loop's control — no owner step, no env flip. (1) Account deletion never purges
        storage: both delete routes call only admin.auth.admin.deleteUser (app/api/user/delete/route.ts:31,
        app/api/mobile/account/route.ts:57), `grep -rn "\.remove(" app lib` -> ZERO hits, and BOTH buckets
        are public:true (supabase/migrations/001_initial_schema.sql:408,410) — so a deleted user's room
        photos and mockups stay PUBLICLY FETCHABLE FOREVER, contradicting app/privacy/page.tsx:208
        ("immediately and permanently removes all your content") and failing Apple 5.1.1(v). (2) Privacy
        labels are false in both directions: docs/app-privacy.md:19 declares location "Not collected" while
        projects stores city/neighborhood/building_name (002_onboarding_fields.sql:4-7) and latitude/
        longitude (005_place_ids.sql:4-5) and sends place_id+latLng to Google
        (app/api/apartment-research/route.ts:875-918); and the Maps/Places purpose entry
        (privacy/page.tsx:129-132, app-privacy.md:67,106) describes product image search when it is actually
        address autocomplete, with maps.googleapis.com loaded on every page (app/layout.tsx:53-55). FIX:
        storage.remove() the user's prefix in both delete routes + regression test; declare location and
        correct the Maps/Places entry in both privacy artifacts. Tracked: NEW issue.
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE long-standing binding blocker, held C for a SIXTH cycle. Credit where due: the authed journey
        tier now runs GREEN in CI (run 30254523085 @ a38160d) and paywall->unlock is a real Postgres proof
        (e2e/helpers/seed.ts:88-100 -> lib/entitlements/web.ts:91-105). But the green suite proves the MEMORY
        backend — the journeys job never sets DATA_BACKEND (ci.yml:148-160) and journeys.spec.ts:416-421
        concedes an admin/Postgres seed is invisible to the route. lib/supabase/server.ts:23 still defaults
        to memory; PENDING_OPS.md:57-61 still status:open, conceding saved designs "do NOT survive across
        instances" and "the 26/26 RLS policies never execute at runtime"; the cold-start test still does not
        exist (data-backend.test.ts:29-31 mocks @supabase/ssr). NEXT STEP the loop CAN take without the
        owner: set DATA_BACKEND: "supabase" in the CI journeys job so the authed suite exercises the
        production config against supabase-local, and add the write -> restart -> re-read + second-user-RLS-
        denial test. Land migration 030 BEFORE any prod cutover (PENDING_OPS.md:164). Tracked: #525.
    - dimension: artifact_integrity
      severity: high
      gap: >-
        Ship_critical, DROPPED A->B. Both nits named last cycle survived 33 commits untouched:
        ROADMAP.md:591-594 [x] asserts "a regression below the floor fails the gate" while --coverage exists
        only in package.json:12 — not ci.yml, not preflight — and vitest.config.ts:18-21 literally
        contradicts the tick; ROADMAP.md:587-590 [x] "Lint clean + ENFORCED" while eslint emits 19 warnings
        and ci.yml:94 has no --max-warnings 0. Plus 3 newly-stale docs (ROUTE_INVENTORY.md:60-61 says the CI
        journeys job still needs adding when ci.yml already has one; ci.yml:1-5 still says "copy this to
        .github/workflows/"; ROUTE_INVENTORY.md:3 overclaims route coverage) and ROADMAP.md:389 A4 [x]
        claiming RLS "correct and secure" against PENDING_OPS.md:60. FIX: ci.yml verify ->
        npm run test:coverage; eslint-ignore .agents/** then --max-warnings 0; delete the two stale headers;
        untick A4. Tracked: NEW issue.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship_critical, held B — but one capping gap genuinely CLOSED this cycle: DESIGN_DENSE_A11Y_ROUTES
        (journeys.spec.ts:281-351) now axe-scans setup/diagnosis/products/bundles/mockups/compare with an
        h1 assertion that defeats the not-found false-pass, and it caught a real critical button-name
        violation. Remaining: F7 visual baselines, third cycle at zero (e2e/__screenshots__/ absent,
        toHaveScreenshot 0, ROADMAP.md:647 unticked); plus a NEW three-competing-accent violation at
        components/manual-sourcing/ManualScorecardView.tsx:140-142 (emerald/blue/amber encoding ORDINAL
        data) on /focus, the one route excluded from the new sweep. FIX: land F7 with committed PNGs + a
        recorded verdict; convert the accent ladder to the single-hue pattern from tier-colors.ts and
        extend that test into a repo-wide colour ratchet. Tracked: #204.
    - dimension: business_case_strength
      severity: high
      gap: >-
        Ship_critical, held B. Shippable-TODAY ARR re-derived at $99,926 — bit-identical to last cycle, ~$74
        below the floor — because Pro Annual is still gated off (checkout/route.ts:55, stripe.ts:47,
        migration 021 unapplied). Honesty stays exemplary (fe1d4bc moved two figures the LESS flattering
        way). NEW: the model applies a 30% store haircut (business-case-model.mjs:11) i.e. mobile economics,
        while the shippable figure is web/Stripe-only — and on mobile annual is NOT gated at all
        (paywall-sheet.tsx:44-59) while the $29 tier credited with 60% of conversions is absent from that
        paywall; BUSINESS_CASE.md as_of is 14 days stale. FIX: apply migration 021 + ANNUAL_BILLING_ENABLED
        (owner), and in-loop model ONE channel consistently at real fees. Do NOT nudge the conversion input
        to close $74 — that is gaming. Tracked: #672.
    - dimension: security_rls
      severity: low
      gap: >-
        HELD A (at the ship bar, not a gate blocker). First cycle in four where a fresh 56-route sweep did
        NOT beat the prior all-clear: the saved-designs project_id IDOR is genuinely fixed
        (route.ts:168-174, .eq user_id + maybeSingle, pinned by a test) and share-token enforcement is real
        (public-share.ts + migration 030 dropping the anon policy). Two non-exploitable A+ items remain, both
        the same bind-every-client-id convention: saved-designs/route.ts:242 persists project_id even when
        the bound fetch returned nothing; products/route.ts:101 never binds search_session_id. Tracked:
        fold into the existing security issue rather than opening a new one.
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship_critical. Coverage up to 62.6/51.88/67.53/63.6 and a genuine hermetic cassette money-path
        test landed (render-pipeline-cassette.test.ts). Unchanged: ci.yml:39 runs bare `vitest run` so the
        floor gates nothing; the 6 live evals stay skipIf'd and live-eval.yml passes GREEN with keys unset;
        lib/agents is 41% stmts (orchestrator 2.97%, room-diagnostician 0.94%) and app/ is not measured at
        all. Tracked: #200.
    - dimension: performance
      severity: medium
      gap: >-
        Not ship_critical, but DROPPED B->C — a correction, not a code regression. The prior B assumed the
        perf debt was inert under the memory backend; a deeper sweep found LIVE, data-layer-independent
        problems on the time-to-wow path: lib/ai/gemini.ts:254 fetches images SERIALLY per photo before
        every vision call and does so OUTSIDE the concurrency gate (declared :60, applied only at :605);
        lib/ai/resolve-image.ts:59 exports the batched resolveImageBlocks() with ZERO call sites while all
        13 real uses loop serially, including the mockup money path; app/api/mockups/route.ts:105 runs
        fs.readdirSync on the request path, O(all mockups ever); app/api/products/evaluate-set/route.ts:151
        fans out Promise.all over request-body URLs with no cap, each an LLM extraction, while the scoring
        phase right below it IS batched at 5. Unchanged: embedding-index.ts:46 N+1 with ivfflat unused,
        next/image adoption 0, no perf budget anywhere. Credit: the raw-<img> ratchet is real, bidirectional
        and CI-enforced (count fell 32->30), and the 33 new commits added zero perf regressions. FIX
        cheapest-first: batch the gemini.ts image fetches inside the gate; use the resolveImageBlocks that
        already exists; pLimit the evaluate-set fan-out; drop readdirSync. Tracked: #385.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
