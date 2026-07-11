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
  as_of: 2026-07-11
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # HELD at C. Two ship_critical dims RAISED this cycle (security_rls A->A+, artifact_integrity B->A), but the headline is capped at the weakest ship_critical link and functional_reality is still C: the persistence PREPARE (#531) landed as real reviewable code but ships INERT (DATA_BACKEND defaults to memory), so production STILL loses data across a cold start. Two ship_critical dims remain below A (functional_reality C, design_taste B).
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — TWO remain below A (functional_reality C, design_taste B); down from three last cycle (artifact_integrity recovered B->A)
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        HELD at C — but the gap NARROWED: the factory did exactly what the last grade asked (PREPARE, don't
        blind-cutover). #531 (5e08246) landed a real, reviewable persistent Supabase data backend behind a
        DATA_BACKEND flag. lib/supabase/server.ts createClient() (:68-96) now branches: with
        DATA_BACKEND=supabase it returns buildRealClient() (real Postgres + runtime RLS for BOTH auth AND
        data) and FAILS LOUD on missing creds (:76-82); getCurrentUserId() is symmetric (:108-112). It is
        selection-tested: __tests__/supabase/data-backend.test.ts asserts routing + fail-loud (no silent
        memory fallback). GENUINE progress. BUT the grade tracks PRODUCTION REALITY, and reality is unchanged:
        the flag DEFAULTS to memory (supabaseDataBackendEnabled() reads process.env.DATA_BACKEND==="supabase",
        :22-24) and the module's own docstring says it "ships INERT (memory backend)" until the owner flips
        it (:10-16). So by default every `.from()`/`.storage` op still hits lib/store/memory-store.ts ("Data
        persists only for the lifetime of the server process," :3-8); on Vercel serverless / any restart /
        multi-replica host a user's projects/rooms/diagnoses/saved-designs still do NOT survive a cold start —
        the retention-critical "revisit your saved designs" journey (a VISION pillar) is still broken in the
        default prod config. The money-path E2E (journeys.spec.ts) asserts a real decodable PNG (:344-347) +
        entitlement flip (:245-260) but reads the in-memory store in ONE warm `next start` process — a
        single-process signal, not proof of persistence (BUILDS≠WORKS). And data-backend.test.ts:6-9
        EXPLICITLY defers the real Postgres round-trip to "a human-verified cutover step" — the "money path
        against real Postgres across a simulated cold start" integration test the last grade named does NOT
        exist yet. DoD Track A ("web app reliable") correctly UNCHECKED; preflight functional-journeys gate
        RED. C not B (persistence is BLOCKING for a sellable, retention-driven app), C not D (everything else
        — full AI pipeline, billing, auth, UI — genuinely works; one env flip + one test from viable). RAISE
        to A: (1) make the persistent backend the production DEFAULT (DATA_BACKEND=supabase live, memory
        dev-only), (2) add the integration test that writes via the money path, simulates a cold start (fresh
        process/client), and re-reads the row from real Postgres, (3) confirm the 26 RLS policies execute at
        runtime once the memory store is gone. The PREPARE half is done — this is the human-gated cutover +
        proof test.
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh adversarial grader, cold). Signals green this cycle: `npx tsc --noEmit` clean,
        `npx eslint .` clean, `npm run check:determinism` green, `npm test` 1948 pass / 11 skip (up from 1889;
        the 11 skips are RUN_EVALS-gated by design). maxDuration sweep clean — all 21 routes touching a
        provider carry `export const maxDuration`; the 31 without were cross-checked to be DB/Supabase-only
        (e.g. rooms/[roomId]/diagnosis just reads room_diagnoses). Cost contract intact: 78 `.chat(` sites, all
        with explicit thinkingConfig (harness-ratchet green), HIGH only where allowed (computer-use agent-loop).
        Determinism seeds threaded at every spot-checked site; this cycle added several stable-tiebreak/seed
        fixes (#547/#558/#559/#562/#563/#566). Billing side-effect integrity is REAL: webhook verifies the
        Stripe signature first and only marks tier active AFTER the DB write succeeds (#544); evaluate/status
        surface real failures instead of faking success (#528). No stub/TODO/dead path on a critical route.
        Minor non-blocking nit (unchanged): inline `thinkingConfig:{thinkingLevel:"low"}` drift in lib/agents
        (~45 inline vs 7 thinkingFor(task)); scene-assembler's header comment even claims thinkingFor() while
        :186 uses inline — doc/impl mismatch, no cost/correctness risk, the ratchet doesn't catch it.
    security_rls:
      grade: A+
      ship_critical: true
      gap: >-
        RAISED A->A+. The single missed IDOR guard that capped the last grade is CLOSED and TESTED. #530
        (f9d9d32) added the guard to GET /api/area-analysis: route.ts:53 now calls
        userOwnsRoom(supabase, roomId, user.id) BEFORE the room_diagnoses read and returns 404 on non-owner;
        __tests__/api/idor-followup-guards.test.ts:50 asserts non-owner->404 + owner-passes. The sibling
        product↔room binding gap #530 also closed (products/evaluate/route.ts:79 binds product.room_id to the
        owned room). A fresh adversarial grader swept ALL 52 API routes resolving a client-supplied id
        (room_id/project_id/product_id) against lib/auth/ownership.ts and found NO remaining missed guard of
        this class — every read/write/LLM call is ownership-gated (or uses an inline projects!inner join /
        .eq("user_id") / is a public catalog typeahead with no tenant data). Mechanical gates green:
        preflight GATE 6 "RLS coverage — 26 public tables, all ENABLE ROW LEVEL SECURITY" (the 2 tables
        without a direct ALTER are covered by migration 016's dynamic loop, which GATE 6's parser recognizes);
        no NEXT_PUBLIC_*/EXPO_PUBLIC_* secret leak; git ls-files shows only .env.example; no sk_live/
        service_role hardcoded; fan-out LLM routes carry checkRateLimit + checkDailySpend. Zero findings ->
        A+. NOTE: with RLS inert at runtime under the default memory store (see functional_reality), the
        app-layer userOwns* guard is the SOLE cross-tenant boundary today — its now-complete coverage is what
        earns the A+; the runtime-RLS defense-in-depth arrives with the persistence cutover.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — the two capping gaps are BYTE-FOR-BYTE UNCHANGED this cycle (no movement toward A). Gap
        (1): AUTHED_A11Y_ROUTES (e2e/journeys.spec.ts:182) is still the identical LOW-density set
        [/dashboard, /account, /saved, /billing/upgrade] — NOT extended to the design-DENSE diagnosis/mockups/
        compare surfaces (dynamic score-color badges + confetti, where WCAG contrast failures concentrate).
        The axe machinery is correct (AxeBuilder.withTags wcag2a/2aa/21a/21aa asserting zero critical/serious)
        but only iterates those 4 sparse routes, and reducedMotion (:180) sidesteps confetti rather than
        testing it. Gap (2) FULLY REMAINS: `ls e2e/__screenshots__/` -> absent; grep toHaveScreenshot -> zero;
        playwright.config has no snapshot config; ROADMAP F7 still [ ]. Rendered pixels / dark-mode parity /
        empty+error states asserted in code, never captured. The design SYSTEM itself stays A-territory: slop
        hunt clean on consumer surfaces (zero emoji-in-JSX; purple/violet/indigo grep on app+components -> zero;
        gradients resolve to warm-editorial tokens off --gradient-warm-start #b4501e in globals.css; real
        skeletons + layered error boundaries + not-found.tsx). This cycle's WCAG-AA contrast commits are REAL
        and verified (#538/#542/#549 route tinted-bg text through --accent-warm-strong #a3441a/#d4733e) — but
        they strengthen the system, not the capping proof axis. RAISE: extend AUTHED_A11Y_ROUTES to seeded
        diagnosis/mockups/compare (reuse the money-path seeding at journeys.spec.ts:280-309), and land F7 —
        commit e2e/__screenshots__/ baselines (light+dark, empty/error) with snapshot config.
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A on the store-ARTIFACT checklist (privacy accuracy, deletion, build/submit config, icon,
        contact). Every processor in app/privacy/page.tsx maps to a live used dependency (Gemini, Supabase,
        Stripe, RevenueCat, Tavily, Google Places, Browserbase) — no phantom Anthropic/OpenAI (the lone openai
        hit is lib/ai/openai-schema.ts, a Zod->JSON-schema converter for DeepSeek). In-app deletion real on both
        surfaces (app/api/user/delete:31 + app/api/mobile/account:56 call admin.auth.admin.deleteUser) with FK
        cascade to auth.users (migrations 001/011/012/018/025/027). Real icon (icon.png PNG 1024x1024 RGBA
        799KB), real eas.json build+submit profiles, canonical hello@aptdesignerai.com, zero stale
        @aptdesigner.ai. This cycle re-verified the two self-serve subscription-management levers exist:
        app/api/billing/portal/route.ts (self-serve Stripe customer portal, RLS-scoped + rate-limited, #543)
        and mobile settings "Manage subscription" via RevenueCat managementURL with a store-settings fallback
        (Apple 3.1.2, #548). NOTE (cross-dependency, not double-counted here): an actual store submission would
        fail review while functional_reality's default data layer stays non-persistent — the store-readiness
        ARTIFACTS are done, but launch is gated by that persistence blocker. Bounded A+ items unchanged: store
        screenshots (D3) device-blocked; a few page <title> tags.
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        RAISED B->A. The OWNER_ACTIONS schema violation that dropped it last cycle is FIXED. `bash
        scripts/preflight.sh` GATE 5 is now GREEN — "OWNER_ACTIONS: valid, parseable YAML block". The two
        offending `priority: low` items in PENDING_OPS.md are reconciled: all 21 OWNER_ACTIONS priorities now
        sit in the validator's urgent/high/normal enum (preflight.sh:475). All 4 machine-readable dashboard
        blocks parse AND pass their schema checks: OWNER_ACTIONS (21 items), GROWTH_STATUS (pre_launch,
        engine 100%, all 5 anchor files exist), QUALITY_SCORECARD (grades in enum), BUSINESS_CASE_SUMMARY
        (base 122900 >= floor 100000). Spot-checked roadmap ticks all map to real artifacts:
        evals/__tests__/*.eval.test.ts (6 files), mobile/eas.json, mobile/assets/images/icon.png,
        docs/brand-kit.md + press-kit.md, billing/webhook route + test. Pricing consistent — $29 one-time
        apartment / $49-mo Pro / $399-yr — across lib/billing/stripe.ts:8-10, pricing page, BUSINESS_CASE.md.
        No ticked box with a missing artifact; no doc-vs-code contradiction. Full mechanical + spot-check pass,
        zero findings -> A. (A+ would want a broader automated docs-vs-code consistency check beyond spot
        checks — bounded, not currently value-bar-clearing.)
    business_case_strength:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. Recomputed base (Scenario B, BUSINESS_CASE.md:218-240): 4,000 installs x 0.25 retention x
        0.04 conv = 40 paid/mo; tier mix -> $10,240 MRR -> ARR $122,900 >= $100K floor; math sound. No single
        input above its benchmark band (retention 25% in 20-30%, conversion 4% in 2-5%, organic 40% = TOP of the
        35-40% band honestly re-grounded down from 50%, churn 7% in 6-7.5%). Honesty framing INTACT and
        strengthened this cycle (219ef4c/#508): floor_met_year1:false, "$122.9K is STEADY-STATE", year-1 exit
        run-rate ~$58-60K, floor ~year 3 — disclosed, not padded as strict year-1. Both levers are real code
        (referral: lib/waitlist/referral.ts + migration 026; upsell: components/billing/upgrade-cta-card.tsx).
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B — coverage nudged up again, structural gaps unchanged (criterion-referenced: same state,
        same letter). `npx vitest run --coverage`: 59.04% stmts / 47.77% branch / 64.75% funcs / 60.03% lines
        (up from 58.17/47.08/63.24/59.15), comfortably above the 40/30/42/40 floor; 1948 pass / 11 skip. But
        CI STILL never enforces coverage — .github/workflows/ci.yml:28 verify runs bare `npm test` = `vitest
        run`, no --coverage, so the floor is healthy by accident, not gated; a coverage regression is invisible
        on PRs. Evals remain live-only, owner-keyed: all 6 evals/__tests__/*.eval.test.ts sit behind
        it.skipIf(!evalsEnabled()) (the 11 skips), contributing nothing on a normal PR; no recorded-cassette /
        replay per-PR tier exists. The one bright spot unchanged: live-eval.yml skips-GREEN with a ::warning::
        when keys are unset (#348 pattern). RAISE: add --coverage with enforced thresholds to the CI verify
        job so the floor gates; add a recorded-cassette eval tier that runs per-PR so the 6 evals exercise real
        logic without live keys.
    performance:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B (criterion-referenced — same state, same letter). The headline N+1 persists in code
        (lib/store/embedding-index.ts:46 topKSimilar full-table select('*') + in-memory cosine loop, called
        per-crop in identified-products-pipeline.ts:117 under pLimit(20); the ivfflat index from migration 008
        UNUSED — grep ivfflat/.rpc lib/ = 0) — but note it is currently INERT: under the in-memory data layer
        these are in-process array ops, not DB round-trips, and MemoryClient.rpc is a no-op, so a pgvector match_
        RPC would be dead code until the real-DB migration lands (see functional_reality). Real regardless of the
        data layer: next/image adoption still 0 (raw `<img>` count now 32 across app+components, up from 13 — no
        image optimization, no regression guard); no Lighthouse/bundle/perf budget in CI or preflight. Cost
        discipline remains the strong pillar (explicit thinkingConfig/thinkingFor, DETERMINISTIC_SEED,
        withCostLedger/recordUsage throughout). RAISE: sequence the pgvector match_ RPC WITH the real-DB
        migration; adopt next/image (add a raw-<img> guard so the count stops climbing); add a perf budget.
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        THE binding blocker (held C). The persistence PREPARE landed (#531): a real Supabase data backend
        behind a DATA_BACKEND flag, fail-loud on missing creds, selection-tested. BUT it ships INERT — the flag
        DEFAULTS to memory (lib/supabase/server.ts:22-24), so production STILL routes .from()/.storage to the
        non-persistent memory store ("persists only for the lifetime of the server process") and user
        projects/rooms/diagnoses/saved-designs do NOT survive a serverless cold start / multi-replica host. The
        retention-critical "revisit your saved designs" journey is still broken in the default prod config; the
        money-path E2E passes only in one warm `next start` process (BUILDS≠WORKS). The prep half is done —
        remaining (human-gated cutover): (1) make DATA_BACKEND=supabase the production default, (2) add the
        integration test that writes via the money path, simulates a cold start, and re-reads from real
        Postgres, (3) confirm the 26 RLS policies execute at runtime once the memory store is gone.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship-critical, below A — the co-blocker now that artifact_integrity + security_rls recovered. Two
        capping gaps BYTE-FOR-BYTE UNCHANGED this cycle: AUTHED_A11Y_ROUTES still the low-density set
        [dashboard/account/saved/upgrade], NOT extended to the design-dense diagnosis/mockups/compare surfaces
        the prior gap named; e2e/__screenshots__/ still absent so pixels/dark-parity/empty-error unverified (F7
        unchecked). Extend AUTHED_A11Y_ROUTES to seeded diagnosis/mockups/compare and add toHaveScreenshot
        baselines (light+dark, empty/error).
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship-critical. Coverage up to 59/48/65/60 but CI verify still runs bare `vitest run` (no
        --coverage), so the floor never gates PRs; evals live-only/weekly and skip-green when keys unset (#348);
        no recorded-cassette per-PR eval tier.
    - dimension: performance
      severity: low
      gap: >-
        Not ship-critical, and the headline N+1 is currently INERT under the default in-memory data layer
        (in-process array ops, not DB round-trips; the pgvector RPC would be dead code until the real-DB
        cutover). Real items: next/image still 0 (raw <img> now 32, up from 13); no perf budget.
    - dimension: artifact_integrity
      severity: resolved
      gap: >-
        RECOVERED B->A this cycle. OWNER_ACTIONS preflight GATE 5 is GREEN again (all 21 priorities in the
        urgent/high/normal enum); all 4 dashboard blocks parse + pass schema. No open gap.
    - dimension: security_rls
      severity: resolved
      gap: >-
        RECOVERED A->A+ this cycle. The missed GET /api/area-analysis IDOR guard is closed (#530,
        route.ts:53) and tested (idor-followup-guards.test.ts:50); a 52-route sweep found no remaining gap of
        the class. No open gap.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
