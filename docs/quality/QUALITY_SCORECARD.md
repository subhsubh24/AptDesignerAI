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
  as_of: 2026-06-29
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # below ship bar: core journey runtime-unvalidated + evals unenforced
  ship_gate_met: false                # true only when every ship_critical dim is A or A+
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        Public/structural journeys (e2e/journeys.spec.ts) verified GREEN this run (5/5: signup/login
        forms render, protected /dashboard /account /saved bounce to /login). BUT the core product
        journey (photo→understand→diagnose→source→mockup returning a REAL mockup) and
        paywall→checkout→entitlement-unlock have NO outcome-asserting runtime E2E — both are admitted
        tracked gaps in e2e/ROUTE_INVENTORY.md. The AUTHENTICATED tier (signup→working dashboard) is
        gated on E2E_AUTH_STACK + a seeded Supabase backend and could not be run/verified cold. Per
        BUILDS≠WORKS, a critical journey with no runtime test = not validated. RAISE: deterministic
        provider fixtures + Stripe test-mode so the core flow + checkout run green in CI.
    correctness:
      grade: B
      ship_critical: true
      gap: >-
        tsc clean, npm test 1183 pass/8 skipped (skips are RUN_EVALS-gated by design), eslint clean,
        determinism green; no stubs/TODO/dead paths on critical routes; entitlements server-side;
        Stripe webhook + side-effect integrity (PR #195) honest. Real gap: NO `maxDuration` declared on
        any route or in vercel.json (grep = 0), yet area-analysis is a documented 3–5 min pipeline with a
        180s per-Gemini-call timeout. On default Vercel limits the function can be platform-killed
        mid-pipeline — a "builds green, user hits a killed run" risk on the core paid path. RAISE: add
        `export const maxDuration` (>180s) to area-analysis/refine/search/mockups/diagnosis routes.
    security_rls:
      grade: B
      ship_critical: true
      gap: >-
        RLS fully closed (every public table RLS-enabled + intentional policy; 016/019/020/024 fix chains
        verified), secrets clean (no committed keys; service-role server-only), strong headers/CORS/
        Turnstile/error-hygiene/spend-breaker. Real gap: two authenticated LLM endpoints —
        app/api/products/evaluate/route.ts and app/api/products/evaluate-set/route.ts (the latter fans
        out with Promise.all) — call the fit-scorer with NO checkRateLimit and NO checkDailySpend, so a
        single authed user can drive unbounded LLM spend (the G1 gap). Secondary: preflight has no
        mechanical RLS-coverage / NEXT_PUBLIC-secret gate. RAISE: add rate-limit + daily-spend guards to
        both routes; add a preflight RLS/secret assertion.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        Genuinely designed warm-editorial system: tokenized palette + dark parity (globals.css),
        real CVA variants, systematized framer-motion + reduced-motion kill-switch, real empty/loading/
        error states, slop hunt clean (no emoji-icons, no purple-gradient slop, accent discipline holds).
        Real gaps: ZERO aria-live/role=alert across the whole app (toast has no screen-reader
        announcement) — VISION's design bar requires accessible states; no global app/not-found.tsx (404
        falls to Next default template look); a11y.spec.ts covers only 7 public pages (authed
        design-dense routes have no axe coverage); e2e/__screenshots__/ is EMPTY so rendered pixels can't
        be verified (F7). RAISE: add toast aria-live, a design-system not-found, axe on ≥1 authed route,
        commit baseline screenshots.
    store_readiness:
      grade: B
      ship_critical: true
      gap: >-
        Every loop-controllable artifact is real and strong: privacy/terms pages, in-app account
        deletion (real DELETE API w/ cascade + rate limit), accurate App-Privacy/Data-Safety doc, real
        1024² icon, char-limit-aware ASO copy, thorough pre-submission checklist, real mobile eas.json +
        app.config.ts. Real loop-fixable gap: app/privacy/page.tsx:54-57 tells users their photos are
        processed by "Anthropic Claude, OpenAI, and Google Gemini" — neither Anthropic nor OpenAI is a
        dependency or processor in the codebase (a privacy-policy accuracy/compliance defect); plus a
        brand/domain mismatch (aptdesigner.app vs aptdesignerai.com). Human-blocked: store screenshots
        need a device. RAISE: correct the privacy processor list to match reality; reconcile domain/brand.
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        Every ticked claim spot-checked (A6 computerUse→gemini-3.5-flash, C1 Stripe checkout, C2 RC
        entitlements, E5 analytics, E8 site-gate, G5 CAPTCHA, G6 CORS, G7 spend-breaker, ARCHITECTURE
        modules) maps to a real, substantive artifact; F7's unchecked state honestly matches the empty
        screenshot dir; BUSINESS_CASE_SUMMARY parses and arr_year1.base=122900 matches the body; pricing
        consistent across pricing page / stripe.ts / business case. Only trivial nit: the privacy-page
        processor wording above is a docs-vs-reality inaccuracy (tracked under store_readiness).
    business_case_strength:
      grade: B
      ship_critical: true
      gap: >-
        Honest, research-grounded base ARR $122,900 (recomputed: 4000 installs × 0.25 D30 × 0.04 conv →
        consistent, not padded); conversion 4% is mid-band cited benchmark (not gamed); pricing CONSISTENT
        across app/pricing, lib/billing/stripe.ts, mobile paywall; ~97-99% gross margin; 30% store cut
        applied uniformly (conservative). Gaps: floor-clearance leans on a 50% organic-share assumption the
        doc itself flags as ABOVE its 35-40% benchmark, and net margin (+$19.7K) flips negative at 35%
        organic; and two named revenue levers are listed-not-built — referral is only an email-template
        type (no invite/reward mechanic), expansion/upsell has no in-app surface. RAISE: build referral +
        an expansion surface, and re-ground the organic-share input.
    tests_evals:
      grade: C
      ship_critical: false
      gap: >-
        Real live .eval.test.ts exist per stage (diagnosis/sourcing/grounding/area-analysis) calling the
        ACTUAL pipeline behind RUN_EVALS=1, with real (non-placeholder) gold fixtures. BUT: no RUN_EVALS=1
        CI job (CI sets a dummy Gemini key) so eval regressions are invisible; live evals did NOT run green
        here (no key + Unsplash fixtures 403 via proxy — non-hermetic); refine.eval.test.ts is mislabeled
        (a runner unit test, no live refine/mockup eval); coverage floor (25/19/30/25) sits far below
        actual (~42%) and CI never runs --coverage, so it's decorative; lib/agents (the LLM core) is ~21%
        covered. RAISE: wire a RUN_EVALS=1 CI job (real key or recorded fixtures), vendor gold images
        locally, enforce --coverage with floors near reality, add a real refine eval.
    performance:
      grade: B
      ship_critical: false
      gap: >-
        LLM cost discipline is strong (every .chat() explicit thinkingConfig; HIGH confined to allowed
        stages; vision context-cache amortizes image tokens; apartment per-room + harmony scoring
        parallelized with deterministic re-key). Real gaps: lib/store/embedding-index.ts topKSimilar does
        a full-table select('*') with no limit/where, called once per crop (N full-table scans per
        identify request) and never uses the existing ivfflat pgvector index; the two photo-grounding LLM
        calls (area-analysis/route.ts:961,976) run serially though independent (~2× stage latency); no
        next/image anywhere (raw <img>, CLS/payload); two ~1.6k/1.2k-line fully-client pages, no Suspense/
        next/dynamic; and NO perf budget / Lighthouse / bundle-size gate exists (CI, scripts, preflight).
        RAISE: pgvector RPC for topKSimilar; Promise.all the grounding pair; next/image; add a perf budget.
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: Core journey (photo→mockup) + paywall→checkout→unlock have no outcome-asserting runtime E2E; authed tier not CI-independently runnable.
    - dimension: tests_evals
      severity: critical
      gap: Live eval suite never runs green in CI (no RUN_EVALS=1 job, dummy key); coverage floor toothless & unenforced; lib/agents ~21%.
    - dimension: correctness
      severity: high
      gap: No maxDuration on the 3–5 min core pipeline routes → platform can kill the run mid-pipeline on default limits.
    - dimension: security_rls
      severity: high
      gap: products/evaluate{,-set} call the LLM with no rate-limit/spend guard → authed user can drain budget (G1).
    - dimension: store_readiness
      severity: high
      gap: Privacy page falsely lists Anthropic/OpenAI as photo processors (compliance accuracy defect); brand/domain drift.
    - dimension: design_taste
      severity: medium
      gap: Zero aria-live app-wide, no global not-found, authed routes have no a11y coverage, no committed visual artifacts.
    - dimension: business_case_strength
      severity: medium
      gap: Floor leans on above-benchmark 50% organic share; referral + expansion levers listed but not built.
    - dimension: performance
      severity: medium
      gap: Full-table-scan N+1 in embedding-index (pgvector index unused); serial grounding calls; no next/image; no perf budget.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
