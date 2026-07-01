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
  as_of: 2026-07-01
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # gated by functional_reality: core money-path still has no outcome-asserting runtime E2E
  ship_gate_met: false                # true only when every ship_critical dim is A or A+
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        Public/structural journeys ran GREEN this run (scripts/run-journeys.sh --public-only: 7 passed —
        signup/login forms render, protected /dashboard /account /saved bounce to /login, root + pricing
        resolve to real screens). tsc/eslint/determinism clean, npm test 1350 pass/8 skip. BUT the core
        product journey (photo→understand→diagnose→source→mockup returning a REAL mockup) has ZERO runtime
        assertion — journeys.spec.ts:149-153 asserts only onboarding ENTRY (no upload, no mockup image);
        paywall→checkout→entitlement-unlock has ZERO runtime assertion — journeys.spec.ts:169-175 asserts
        only that /billing/upgrade renders a heading. Both are admitted tracked gaps in
        e2e/ROUTE_INVENTORY.md. The 6 AUTHENTICATED journeys are outcome-asserting but SKIP without
        E2E_AUTH_STACK + a seeded Supabase backend that cannot be stood up cold. Per BUILDS≠WORKS, a
        critical journey with no runtime test = not validated. RAISE: deterministic/recorded provider
        fixtures + Stripe test-mode so the core flow + checkout run green in CI, and make the authed tier
        CI-runnable (ephemeral Supabase-local).
    correctness:
      grade: B
      ship_critical: true
      gap: >-
        Strongly improved. tsc clean, eslint clean, determinism green, npm test 1350 pass/8 skip (skips
        RUN_EVALS-gated by design); no TODO/stub/dead path on any app/api route; provider timeouts all
        shorter than the 300s budget (Gemini 180s, DeepSeek 120s); side-effect integrity honest (signup/
        checkout/webhook surface real provider errors, no fake-success). The prior maxDuration=0 gap is
        now largely closed: maxDuration=300 is present on all 17 mainline LLM pipeline routes
        (area-analysis, refine, refine-chat, search, search/stream, mockups, analyze-apartment,
        bundles/evaluate, floor-plan, identified-products/correct, …). One real gap remains:
        app/api/computer-use/product-verify/route.ts runs an agentic Browserbase browser loop (per-step
        15-30s nav timeouts, no overall cap) with NO maxDuration and no global vercel.json default → it
        hits Vercel's short default cap and is killed mid-verification when Browserbase creds are set.
        RAISE: add `export const maxDuration = 300` to product-verify (and an overall wall-clock cap
        inside runProductVerifier).
    security_rls:
      grade: A
      ship_critical: true
      gap: >-
        G1 CLOSED. Both fan-out paid routes now gate on rate-limit + spend-breaker BEFORE any LLM call
        (evaluate/route.ts:26,33-34; evaluate-set/route.ts:43,50-51), auth-gated first. Swept every authed
        route calling scoreProduct/evaluateBundle/extractFromUrl/.chat/runComputerUse — all carry
        checkRateLimit + checkDailySpend (mockups, computer-use/product-verify, analyze, diagnosis,
        area-analysis, search, bundles). RLS complete + intentional on every public table (001 tenant
        tables + fix chains 015→019→020, 016, 023, 025); no committed secrets (only .env.example tracked);
        service-role server-only; Turnstile CAPTCHA, HMAC-timing-safe internal tokens, full security
        headers (HSTS/CSP/X-Frame DENY). Bounded remaining item (not a live defect): scripts/preflight.sh
        still lacks a MECHANICAL gate asserting RLS-coverage per public table + a NEXT_PUBLIC-secret grep,
        so correctness rests on migration review. RAISE toward A+: add those two preflight assertions.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Real warm-editorial system, consistently applied: terracotta single-accent tokens + full dark
        parity (globals.css:38-113), coherent CVA button family with focus-visible rings across
        button/card/input/textarea/toast, framer-motion + reduced-motion kill-switch, real empty/loading/
        error states, slop hunt clean (no emoji-icons, no purple-gradient slop, no competing accents).
        Two prior gaps CLOSED: components/ui/toast.tsx now uses Radix ToastPrimitive with
        type=foreground(assertive)/background(polite) so screen readers ARE announced; app/not-found.tsx
        now exists and uses the design system fully. Two gaps remain and cap below A: (1) e2e/a11y.spec.ts
        still axe-covers ONLY the 7 public static pages — ZERO authed design-dense routes (dashboard,
        diagnosis, mockups, compare, the surfaces with dynamic score colors/confetti); (2)
        e2e/__screenshots__/ does not exist, so rendered pixels / dark-mode parity / empty-error states
        are asserted in code but never visually captured (F7). RAISE: extend axe to ≥1 authed route,
        audit dynamic status (diagnosis running/done/error) announces via aria-live, commit baseline
        journey screenshots.
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        Prior privacy-accuracy defect FIXED (PR #280) and independently verified: every processor named in
        app/privacy/page.tsx (Gemini, DeepSeek, Supabase, Stripe, RevenueCat, Tavily, Google Places,
        Browserbase, Resend, Turnstile, Vercel Analytics) is a real dependency in code — no phantom
        Anthropic/OpenAI. In-app account deletion is real with cascade (app/api/user/delete/route.ts:31,
        app/api/mobile/account/route.ts:56, wired to mobile settings UI). Real 1024² RGBA icon
        (mobile/assets/images/icon.png); real eas.json build+submit config; canonical contact email
        (hello@aptdesignerai.com) across all UI surfaces. Bounded A+ items (cosmetic, non-blocking):
        residual page-title brand naming ("AptDesigner" vs "AptDesignerAI") and stale .ai domain
        references in loop-memory/PENDING_OPS notes; store screenshots remain human-blocked (need a
        device) and are correctly tracked as the D3 owner step.
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        Spot-checked 8 ticked boxes — all map to real substantive artifacts: A6 computerUse→gemini-3.5-flash
        (lib/ai/models.ts:74), C1 Stripe checkout, C2 RevenueCat entitlements (lib/entitlements/server.ts),
        E5 analytics, E8 site-gate (lib/security/site-gate.ts, wired into middleware), G5 CAPTCHA, G6 CORS,
        G7 spend-breaker. All four dashboard YAML blocks (BUSINESS_CASE_SUMMARY, GROWTH_STATUS,
        OWNER_ACTIONS, QUALITY_SCORECARD) parse; arr_year1.base=122900 matches the body; pricing
        $49/mo+$399/yr consistent across body / stripe.ts / env-based price IDs. F7 correctly UNCHECKED —
        e2e/__screenshots__/ does not exist and the DoD honestly gates it. No contradicting doc claims
        found. No gap.
    business_case_strength:
      grade: A
      ship_critical: true
      gap: >-
        Both prior listed-not-built levers are now BUILT and verified: (1) referral — migration
        026_waitlist_referral.sql + lib/waitlist/referral.ts (code gen/sanitize) + real attribution in
        app/api/waitlist/route.ts:121-153 + a share/"jump the line" reward card in waitlist-form.tsx;
        (2) upsell — components/billing/upgrade-cta-card.tsx + app/api/billing/status/route.ts, rendered
        at app/saved/page.tsx:108. Organic-install share re-grounded from an above-benchmark 50% to 40%
        (top of the cited 35-40% band); the ARR floor is now explicitly organic-independent, so
        floor_met_year1=true is honest. Recomputed base ARR $122,880 ≈ stated $122,900 (not padded);
        pricing consistent across stripe.ts / app/pricing / mobile paywall. Bounded, post-launch-only
        residual (cannot be built pre-launch): net margin is only ~break-even at the 40% anchor and
        negative at the 35% benchmark, so positive margin leans on a PROJECTED 15% referral share with no
        operating history — resolvable only with real attributed-referral cohort data after launch.
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Improved from C. 4 of 5 eval files are REAL live evals calling the actual pipeline behind
        RUN_EVALS=1 (diagnosis.eval.test.ts:26,64 runRoomDiagnosis; grounding:23,39; area-analysis:23,94
        geminiProvider.chat; sourcing:20,106 scoreProduct), each it.skipIf(!evalsEnabled()); gold fixtures
        are real Unsplash URLs, not placeholders. Measured coverage (npx vitest run --coverage this run):
        48.7% stmts / 37.7% branch overall, lib/agents 35% (up from ~21%). Gaps keep it below A: no
        RUN_EVALS=1 CI job (ci.yml runs only tsc/test/determinism, dummy key) so eval regressions are
        invisible and cannot run green here; CI never runs --coverage and the vitest floor (25/19/30/25)
        sits far below the real ~48%, so it's decorative; refine.eval.test.ts is STILL a mislabeled runner
        unit test (no live call, no gate) and there is no refine/mockup gold case. RAISE: wire a
        RUN_EVALS=1 CI job (real key or recorded cassettes), add a real refine eval + gold case, enforce
        --coverage with floors near reality.
    performance:
      grade: B
      ship_critical: false
      gap: >-
        Strong LLM cost discipline (41 files with explicit thinkingConfig, cacheScope amortizes vision
        tokens, withCostLedger/recordUsage, DETERMINISTIC_SEED, rate+spend guards, in-flight coalescing).
        Prior serial-grounding gap FIXED — the grounding pair is now Promise.all (area-analysis/route.ts:976).
        Headline hot-path gap persists unchanged: lib/store/embedding-index.ts:46 topKSimilar still does a
        full-table select('*') with an in-memory cosine loop (lines 54-70), called once per crop inside
        Promise.all (identified-products-pipeline.ts:107,117) = N full-table scans per identify request,
        and the ivfflat cosine index (migration 008:42) is NEVER used. Secondary: 0 next/image imports
        (raw <img> in 6 files); no Lighthouse/bundle-size/perf budget in CI/preflight. RAISE: add a
        pgvector match_ RPC (embedding <=> query ORDER BY + LIMIT k) called via supabase.rpc; adopt
        next/image; add a perf budget.
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: Core journey (photo→REAL mockup) + paywall→checkout→unlock have no outcome-asserting runtime E2E; authed tier not CI-independently runnable. Sole reason overall is below the ship bar.
    - dimension: tests_evals
      severity: high
      gap: Live eval suite never runs in CI (no RUN_EVALS=1 job, dummy key); --coverage unenforced & floor decorative vs real ~48%; refine eval still mislabeled.
    - dimension: correctness
      severity: high
      gap: computer-use/product-verify agentic browser route has no maxDuration/overall cap → platform-killed mid-verification when Browserbase is enabled (17/18 pipeline routes now fixed).
    - dimension: design_taste
      severity: medium
      gap: Authed design-dense routes have no axe coverage; e2e/__screenshots__/ still absent so pixels/dark-parity unverified (F7). Toast a11y + not-found now fixed.
    - dimension: performance
      severity: medium
      gap: Full-table-scan N+1 in embedding-index (ivfflat index unused); no next/image; no perf budget. Grounding pair now parallelized.
    - dimension: security_rls
      severity: low
      gap: G1 wallet-drain CLOSED (now A). Only bounded A+ item left — preflight lacks a mechanical RLS-coverage + NEXT_PUBLIC-secret assertion.
    - dimension: business_case_strength
      severity: low
      gap: Referral + upsell levers now BUILT, organic re-grounded to 40% (now A). Residual is post-launch-only — positive margin leans on a projected referral share with no operating data yet.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
