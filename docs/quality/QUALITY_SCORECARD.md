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
  as_of: 2026-07-09
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # DROPPED B->C: a fresh adversarial pass surfaced that the PRODUCTION DATA LAYER is a non-persistent in-memory mock (real Supabase = auth only). functional_reality A->C corrects a 4-cycle over-grade; headline is capped at the weakest ship_critical link.
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — now THREE are below A (functional_reality C, design_taste B, artifact_integrity B)
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        DROPPED A->C. This is NOT a regression in code — it CORRECTS a 4-cycle over-grade. The prior A
        graded the money-path RENDER (real decodable PNG + entitlement flip) but never surfaced that the
        PRODUCTION DATA LAYER IS A NON-PERSISTENT IN-MEMORY MOCK. lib/store/memory-store.ts is explicit at
        :3-8 — "In-memory data store that replaces Supabase ... Data persists only for the lifetime of the
        server process." lib/supabase/server.ts createClient() (:12-46) ALWAYS builds createMemoryClient()
        and, when Supabase creds are present, returns Object.create(memoryClient) with ONLY `.auth` swapped
        to real Supabase (:42-45) — so every `.from()`/`.storage` DATA op hits the in-memory arrays in ALL
        environments, real Postgres for AUTH only. The 26/26 RLS coverage never executes at runtime, and
        MemoryClient.rpc is a no-op (:399). The factory's own docs/loop-memory.md:331 flags this as a
        "LOAD-BEARING LESSON: the app's DATA layer is the IN-MEMORY store, NOT Supabase Postgres". CONSEQUENCE:
        on Vercel serverless (assertCassetteSafe keys on process.env.VERCEL, so it IS Vercel) each function
        instance has its own store that resets per process — a user's projects/rooms/diagnoses/saved-designs
        do NOT survive across instances or cold starts. The retention-critical "revisit your saved designs"
        journey (a VISION pillar) is broken in production; even a single always-on host loses all data on
        every deploy/restart and cannot scale past one replica. The money-path E2E passes ONLY because a
        single `next start` process keeps the store warm across the test's requests (CI seeds via the app's
        OWN API for exactly this reason — loop-memory.md:329) — textbook BUILDS≠WORKS. This is a documented,
        deliberate, human-gated interim ("until a full DB migration is done"); DoD Track A ("web app
        reliable") is correctly UNCHECKED (ROADMAP.md:742) and preflight's functional-journeys gate is RED.
        C (works within a session, and the ENTIRE AI pipeline + billing + auth + UI genuinely function — one
        well-defined layer from viable), not B (persistence is BLOCKING for a sellable app, not a
        non-blocking gap) and not D (it is close; everything but persistence works). RAISE: wire a real
        persistent data layer — route `.from()`/`.storage` through real Supabase (not just auth), execute the
        RLS policies at runtime, and add an integration test that runs the money path against real Postgres
        across a simulated cold start. This is likely a human-reviewed migration (like billing/auth), so the
        loop should PREPARE it (real data client + runtime RLS wiring + the persistence test), not silently
        ship a risky cutover.
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A (fresh grader, cold). Signals green this cycle: `npx tsc --noEmit` clean, `npx eslint .`
        clean, `npm run check:determinism` green, `npm test` 1889 pass / 11 skip (up from 1775; the 11 skips
        are RUN_EVALS-gated by design). This cycle's determinism fix #522 (81ddd67) is REAL: refine-summarizer
        .chat() now passes seed: DETERMINISTIC_SEED (lib/agents/refine-summarizer.ts:73) and keeps its explicit
        thinkingConfig (:71) — no cost-contract regression. maxDuration sweep still clean — all 19 routes with a
        direct/indirect provider call carry `export const maxDuration`; the 30 without were cross-checked to be
        DB-only. Provider wall-clock caps under budget (Gemini 180s gemini.ts:43, DeepSeek 120s deepseek.ts:27
        < 300s). The IDOR/g2 guards this cycle are fail-loud (return 4xx BEFORE the read/write/LLM call), not
        silent no-ops. No real stub/TODO/dead path on a critical route. Minor non-blocking nit: refine-summarizer
        uses an inline `thinkingConfig:{thinkingLevel:"low"}` instead of thinkingFor(task) — pre-existing drift
        the ratchet doesn't catch, no cost/correctness risk.
    security_rls:
      grade: A
      ship_critical: true
      gap: >-
        DROPPED A+->A. The RLS mechanical gate is still GREEN — `bash scripts/preflight.sh` GATE 6: "RLS
        coverage — 26 public tables, all ENABLE ROW LEVEL SECURITY"; no NEXT_PUBLIC_*/EXPO_PUBLIC_* secret
        leak; git ls-files shows only .env.example; no hardcoded sk_live/service_role. 29 migrations, no new
        public table introduced. This cycle's IDOR hardening pass (#519-522) is REAL and tested: lib/auth/
        ownership.ts helpers (userOwnsRoom/userOwnsProject/userOwnsCandidateProduct) scope by user_id and are
        called BEFORE the read/write/LLM call, returning 404 on non-owner; regression suites idor-read-guards
        + idor-compute-guards assert non-owner->404. BUT a fresh adversarial grader found ONE route the pass
        MISSED, of exactly the class it was built to close: GET /api/area-analysis (app/api/area-analysis/
        route.ts:40-67) reads room_diagnoses by a client-supplied room_id with `.eq("room_id", roomId)` and
        NO userOwnsRoom guard — while its POST sibling (:101) and refine-chat (:71) both got the guard. Because
        the runtime data layer is the in-memory store (RLS never executes — see functional_reality), the
        userOwns* guard is the SOLE cross-tenant boundary at runtime, so this is a live (if per-instance,
        in-process-bounded) authenticated cross-tenant read of another user's private diagnosis JSON. Medium
        severity, single missed guard in an otherwise comprehensive tested pass -> A not A+, and a named
        finding rather than "no gap". RAISE (regain A+): add userOwnsRoom(supabase, roomId, user.id) before the
        room_diagnoses read at route.ts:48 (404 on non-owner) and extend idor-read-guards.test.ts to cover it.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Holds at B — NARROWED, not closed. Gap (1) improved: an authed AxeBuilder gate now RUNS behind the
        real login fixture (e2e/journeys.spec.ts:182-209) over AUTHED_A11Y_ROUTES = /dashboard, /account,
        /saved, /billing/upgrade with withTags(wcag2a/2aa/21a/21aa) asserting zero critical/serious — a genuine
        advance from the last grade's "zero authed AxeBuilder" (landed #469/aa323a0). BUT it covers only the
        LOW-density routes and structurally EXCLUDES the exact design-DENSE surfaces the prior gap named —
        diagnosis, mockups, compare (dynamic score-color badges + confetti, where WCAG contrast failures
        concentrate) — the loop comment (:178-181) admits it scans only routes reachable "WITHOUT deep seeding".
        Gap (2) FULLY REMAINS: `ls e2e/__screenshots__/` -> absent; grep toHaveScreenshot across e2e/__tests__
        -> zero; playwright.config has no snapshot config; ROADMAP F7 still [ ]. So rendered pixels / dark-mode
        parity / empty+error states are asserted in code but never captured. The design SYSTEM itself remains
        A-territory: slop hunt clean on consumer surfaces (zero emoji-in-JSX; all gradients resolve to
        warm-editorial tokens off --gradient-warm-start #b4501e in globals.css; no purple/violet slop; real
        skeletons + layered error boundaries + not-found.tsx). Minor non-capping: ManualScorecardView.tsx
        bg-blue-* on a score-tier band (via focus/page) is semantic, not slop. RAISE: extend AUTHED_A11Y_ROUTES
        to seeded diagnosis/mockups/compare (reuse the money-path seeding already at journeys.spec.ts:280-309),
        and land F7 — commit e2e/__screenshots__/ baselines (light+dark, empty/error) with snapshot config.
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
        @aptdesigner.ai. NOTE (cross-dependency, not double-counted here): an actual store submission would fail
        review while functional_reality's non-persistent data layer stands — the store-readiness ARTIFACTS are
        done, but launch is gated by that persistence blocker. Bounded A+ items unchanged: store screenshots
        (D3) device-blocked; a few page <title> tags.
    artifact_integrity:
      grade: B
      ship_critical: true
      gap: >-
        DROPPED A->B. `bash scripts/preflight.sh` GATE 5 is now RED: "bad priority email-verification-deferred"
        -> "OWNER_ACTIONS: missing or UNPARSEABLE". Root cause: the OWNER_ACTIONS dashboard feed in
        PENDING_OPS.md uses two out-of-schema priorities — `email-verification-deferred` (:65) and
        `tune-daily-spend-cap` (:141) both set `priority: low`, but the validator (scripts/preflight.sh:475)
        accepts only urgent/high/normal, so it fails on the first offender. The block parses as YAML but violates
        the schema CONTRACT the dashboard consumes — a real broken machine-readable artifact and a regression
        since the last grade (introduced by aa323a0/#469). The other 3 dashboard blocks (BUSINESS_CASE_SUMMARY,
        GROWTH_STATUS, QUALITY_SCORECARD) still parse AND pass their schema checks. Spot-checked roadmap ticks all
        map to real artifacts (eas.json, icon.png, brand-kit, press-kit, 6 *.eval.test.ts, billing/webhook);
        pricing consistent ($29/$49-mo/$399-yr) across stripe.ts, pricing page, BUSINESS_CASE.md. Low severity,
        trivially fixable -> B (named non-blocking gap), not C. RAISE: reconcile the OWNER_ACTIONS priority values
        to the validator enum (or add `low` to both the validator and the dashboard renderer) so GATE 5 goes green.
        NOTE: this is a factory-owned artifact (PENDING_OPS.md) — the auditor does NOT edit it; filed for the factory.
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
        Holds at B — coverage nudged up, structural gaps unchanged. `npx vitest run --coverage`: 58.17% stmts /
        47.08% branch / 63.24% funcs / 59.15% lines (up from 56/45/60/57), comfortably above the 40/30/42/40
        floor. But (b) CI STILL never enforces coverage — ci.yml verify runs bare `npm test` = `vitest run`
        (package.json:10), no --coverage; test:coverage exists (package.json:12) but is wired into no CI job, so a
        coverage regression is invisible in CI. Evals remain live-only, owner-keyed, weekly: all 6
        evals/__tests__/*.eval.test.ts sit behind it.skipIf(!evalsEnabled()); no recorded-cassette per-PR tier;
        live-eval.yml is weekly cron + dispatch and SKIPS-GREEN (exits 0 with a ::warning::) when keys are unset
        (issue #348, still live). RAISE: add --coverage to the CI verify job so the floor gates; add a
        recorded-cassette eval tier that runs per-PR; make live-eval fail/neutral (not green) when keys are unset.
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
        data layer: next/image adoption still 0 (13 raw <img> across 6 files); no Lighthouse/bundle/perf budget in
        CI or preflight. Cost discipline remains the strong pillar (explicit thinkingConfig/thinkingFor,
        DETERMINISTIC_SEED, withCostLedger/recordUsage throughout). RAISE: sequence the pgvector match_ RPC WITH
        the real-DB migration; adopt next/image; add a perf budget.
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: >-
        NEW binding blocker (A->C). The production data layer is a non-persistent in-memory mock —
        lib/supabase/server.ts routes ALL .from()/.storage data ops to lib/store/memory-store.ts ("persists only
        for the lifetime of the server process"); real Supabase is auth-only; the 26/26 RLS never runs at runtime.
        On Vercel serverless (or any restart/multi-replica host) user projects/rooms/diagnoses/saved-designs do not
        persist across instances — the retention-critical "revisit your saved designs" journey is broken in prod.
        The money-path E2E passes only inside a single warm `next start` process (BUILDS≠WORKS). Documented,
        human-gated interim (DoD Track A unchecked). Fix: wire real persistent Supabase for DATA (not just auth) +
        runtime RLS + a persistence integration test across a simulated cold start. Likely human-reviewed — PREPARE it.
    - dimension: design_taste
      severity: high
      gap: >-
        Ship-critical, below A. Authed AxeBuilder now runs (dashboard/account/saved/upgrade) but still MISSES the
        design-dense diagnosis/mockups/compare surfaces the prior gap named; e2e/__screenshots__/ still absent so
        pixels/dark-parity/empty-error unverified (F7 unchecked). Extend AUTHED_A11Y_ROUTES to seeded
        diagnosis/mockups/compare and add toHaveScreenshot baselines.
    - dimension: artifact_integrity
      severity: medium
      gap: >-
        Ship-critical, dropped A->B. OWNER_ACTIONS dashboard feed (PENDING_OPS.md) fails its own preflight GATE 5
        schema check — two items use `priority: low`, outside the validator's urgent/high/normal enum
        (preflight.sh:475). Reconcile the values (or extend the enum in validator + renderer). Trivial, but a
        broken machine-readable artifact until fixed.
    - dimension: security_rls
      severity: medium
      gap: >-
        A (down from A+). GET /api/area-analysis (route.ts:40-67) reads room_diagnoses by a client-supplied room_id
        with no userOwnsRoom guard — a missed route of the exact IDOR class #519-522 closed (its POST + refine-chat
        siblings are guarded). With RLS inert at runtime (memory store), the app-layer guard is the sole boundary.
        Add userOwnsRoom before the read; extend idor-read-guards.test.ts.
    - dimension: tests_evals
      severity: low
      gap: >-
        Not ship-critical. Coverage up to 58/47/63/59 but CI verify still runs bare `vitest run` (no --coverage);
        evals live-only/weekly and skip-green when keys unset (#348).
    - dimension: performance
      severity: low
      gap: >-
        Not ship-critical, and the headline N+1 is currently INERT under the in-memory data layer (in-process
        array ops, not DB round-trips; pgvector RPC would be dead code until the real-DB migration). Real items:
        next/image still 0 (13 raw <img>); no perf budget.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
