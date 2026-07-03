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
  as_of: 2026-07-03
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: C                          # gated by functional_reality: core money-path still has no outcome-asserting runtime E2E
  ship_gate_met: false                # true only when every ship_critical dim is A or A+
  dimensions:
    functional_reality:
      grade: C
      ship_critical: true
      gap: >-
        UNCHANGED since 2026-07-01 — no delta landed this cycle. The core product journey
        (photo→understand→diagnose→source→mockup returning a REAL mockup) still has ZERO runtime
        assertion — e2e/journeys.spec.ts:149-153 ("core product flow entry") clicks "Start designing"
        then asserts only expectNoErrorBoundary (no setInputFiles/photo upload, no mockup <img>);
        paywall→checkout→entitlement-unlock still has ZERO runtime assertion — journeys.spec.ts:169-175
        asserts only that /billing/upgrade renders a heading (no Stripe checkout entry, no
        entitlement flip in the UI). A grep of e2e/ for mockup|entitlement|upload|setInputFiles|
        toHaveScreenshot hits ONLY inside ROUTE_INVENTORY.md's tracked-gap list (:34-40) — zero in any
        .spec.ts. git log --since=2026-07-01 -- e2e/ shows only a docs/honesty edit (beb4277); no test
        added an outcome assertion. The 6 authenticated money-path journeys still SKIP without
        E2E_AUTH_STACK + a seeded Supabase backend that cannot be stood up cold (cold run this cycle:
        1 pass / 6 skip / 6 fail, the 6 fails being dummy-key /waitlist-redirect env artifacts, not
        product defects). Per BUILDS≠WORKS, both critical money-path journeys have no outcome-asserting
        runtime test = not validated; this is the SOLE reason overall is below the ship bar. RAISE:
        add a real authed core-flow test (upload an image fixture → run the pipeline against
        recorded/deterministic provider responses → assert a REAL mockup <img> with non-empty src),
        plus a Stripe test-mode checkout→webhook→entitlement-unlock assertion, and make the authed
        tier CI-runnable (ephemeral Supabase-local). Until at least one actually RUNS green (not skips),
        functional_reality cannot exceed C.
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        RAISED B→A. The sole prior gap is CLOSED: app/api/computer-use/product-verify/route.ts:24 now
        carries `export const maxDuration = 300`, AND the verifier enforces an overall wall-clock cap —
        lib/agents/computer-use/product-verifier.ts:274 passes maxWallClockMs: 270_000 to
        runComputerUseAgent, stopping ~30s before the route budget so the browser session is disposed
        and a response returned instead of a mid-turn platform kill. maxDuration sweep is clean: of the
        31 routes without the export, an independent scan for getProvider/geminiProvider/deepseek/.chat/
        runComputerUse/generateContent/embedText returned zero hits — all are CRUD/auth/webhook/proxy
        routes (identified-products/search explicitly documents "we DO NOT hit Gemini here"). No
        stub/TODO/dead path on a critical route (the two `stub`/`TODO` matches are intentional
        data-shaping comments). Fake-success fixes this cycle are real not regressions (#366 surfaces a
        product-insert failure instead of a fake empty result; #370 surfaces a failed sign-out; #382
        aborts in-flight analyze on unmount; #359/#360 fixed a signup outage). Provider timeouts under
        budget: Gemini 180s (gemini.ts:42), DeepSeek 120s (deepseek.ts:27) < 300s. Signals green: tsc
        clean, eslint clean, determinism green, npm test 1544 pass / 11 skip.
    security_rls:
      grade: A+
      ship_critical: true
      gap: >-
        RAISED A→A+. The sole bounded A→A+ item is CLOSED: scripts/preflight.sh:500-577 now has
        "GATE 6 — Security invariants (RLS coverage + client-secret leak)", a REAL build-failing
        mechanical assertion (no longer resting on migration review). Its Python parse over
        supabase/migrations/*.sql collects every `create table [public.]X` and harvests RLS from both
        direct `alter table ... enable row level security` and the dynamic do-block convention —
        harvesting array[...] literals ONLY from inside a do $$...$$ block that itself contains
        `enable row level security` (fails safe, can't be masked by a stray literal); on mismatch it
        sys.exit(1) → fail() → exit 1. Replicated the parse independently: 26 public tables, ALL
        enable RLS, zero missing. Client-secret leak grep covers NEXT_PUBLIC_* and (per #371)
        EXPO_PUBLIC_*(SECRET|SERVICE_ROLE|PRIVATE). No committed secrets (git ls-files shows only
        .env.example; no hardcoded service_role/sk_live). Fan-out paid routes not regressed — both
        products/evaluate and evaluate-set gate on auth→checkRateLimit→checkDailySpend before any LLM
        call. Zero security findings. No gap.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        UNCHANGED at B — the two capping gaps persist. (1) e2e/a11y.spec.ts:6-14 still axe-covers ONLY
        the 7 public static pages (PUBLIC_PAGES = /waitlist,/pricing,/faq,/privacy,/terms,/guides,
        /support) — ZERO authed design-dense routes (dashboard, diagnosis, mockups, compare, the
        surfaces with dynamic score colors/confetti). (2) e2e/__screenshots__/ still does not exist
        (verified), so rendered pixels / dark-mode parity / empty-error states are asserted in code but
        never visually captured (F7 correctly stays UNCHECKED). Real progress DID land but doesn't lift
        the grade: diagnosis progress now announces via aria-live (page.tsx:233 wraps steps in
        aria-live="polite" with per-step sr-only status + aria-hidden on decorative icons, #330) and
        auth errors announce via role="alert" (login/signup :87/:159, #368; mobile #369). Slop hunt
        clean on consumer surfaces (zero emoji-as-icons, zero purple/violet gradients, no ad-hoc hex;
        globals.css:44-92 single-accent terracotta tokens + full .dark parity; real skeletons + error
        boundaries). Minor non-capping blemish: internal ops scorecard views mix bg-blue/bg-purple
        (ManualScorecardView.tsx:261,267; rooms/[roomId]/page.tsx:78) — competing accents confined to
        internal views, not the consumer flow. RAISE: run AxeBuilder over ≥1 authed route behind a
        logged-in fixture, and add Playwright screenshot capture to e2e/__screenshots__/ (light+dark,
        empty/error) so F7 is visually enforced rather than code-only.
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A, no regression. Every processor in app/privacy/page.tsx:70-124 maps to a live
        dependency (Gemini @google/genai, DeepSeek, Supabase, Stripe, RevenueCat react-native-purchases,
        Tavily, Google Places, Browserbase, Resend, Turnstile, Vercel Analytics) — no phantom
        Anthropic/OpenAI. In-app account deletion is real with a real cascade (app/api/user/delete +
        app/api/mobile/account both call admin.auth.admin.deleteUser; FK on delete cascade through
        profiles→projects→rooms in migration 001 + saved_designs in 025), UI-wired on web + mobile.
        Real icon (mobile/assets/images/icon.png = PNG 1024×1024 RGBA, 799 KB); real eas.json
        build+submit profiles; canonical hello@aptdesignerai.com across 13 UI refs, zero stale
        @aptdesigner.ai. Bounded A+ items (cosmetic, non-blocking, unchanged): ~10 page <title> tags
        still read "— AptDesigner" vs "AptDesignerAI"; store screenshots (D3) correctly [ ] (human/
        device-blocked).
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. Spot-checked 6 ticked boxes — all map to real artifacts: A6 computerUse→
        "gemini-3.5-flash" (lib/ai/models.ts:74), C1 Stripe checkout (app/api/billing/checkout +
        lib/billing/stripe.ts), E5 analytics (lib/analytics.ts + Vercel Analytics in layout), E8
        site-gate (lib/security/site-gate.ts, 117 lines), D1/D2/D4 all back real files. All 4 dashboard
        YAML blocks parse via yaml.safe_load (BUSINESS_CASE_SUMMARY, GROWTH_STATUS, OWNER_ACTIONS,
        QUALITY_SCORECARD). Pricing consistent — $49/mo + $399/yr identical across lib/billing/stripe.ts,
        app/pricing/page.tsx, docs/BUSINESS_CASE.md; the "Apartment $29" one-time tier is real and
        consistent everywhere (not a contradiction). F7 correctly UNCHECKED (e2e/__screenshots__/
        absent); D3 correctly [ ]. No ticked box points at a missing/placeholder artifact. Residual: a
        stale aptdesigner.ai note lingers in docs/loop-memory.md:487 (historical memo, not live code).
    business_case_strength:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. Recomputed base (Scenario B) from the body: 4,000 installs × 0.25 retention × 0.04
        conv = 40 paid/mo; tier mix → MRR $10,240 × 12 = $122,880 vs stated $122,900 (~$20 rounding,
        not padding). Floor met honestly: no single input is above-benchmark (retention 25% = 20-30%
        midpoint; conversion 4% within 2-5%; organic share anchored at 40% = TOP of the cited 35-40%
        band, and organic moves marketing cost not revenue). Pricing consistent across doc /
        lib/billing/stripe.ts / app/pricing / mobile paywall. Both revenue levers still real code
        (referral: lib/waitlist/referral.ts + migration 026 + attribution in api/waitlist/route.ts;
        upsell: components/billing/upgrade-cta-card.tsx at app/saved/page.tsx:108). No recompute since
        last grade (git log --since=2026-07-01 -- docs/BUSINESS_CASE.md empty; as_of correctly stays
        2026-06-30 as numbers are unchanged — honest, not stale). Bounded post-launch-only residual
        (cannot be built pre-launch): net margin is only ~break-even (−$940) at the 40% organic anchor;
        positive margin leans on a PROJECTED 15% referral install share with no operating data yet —
        resolvable only with real attributed-referral cohort data after launch.
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B but two of three prior gaps are genuinely CLOSED. (a) CLOSED — .github/workflows/
        live-eval.yml exists: runs `npm run eval` (RUN_EVALS=1) against real Gemini/DeepSeek on
        workflow_dispatch + weekly cron, gated on the keys with an explicit ::warning:: skip when
        unset. (c) CLOSED — refine.eval.test.ts is now a REAL live eval (imports summarizeRefineChanges,
        asserts tokens>0, rejects the fallback, requires the summary to name the warmth/sofa delta), and
        a mockup eval landed (#334: mockup.eval.test.ts asserts a real image payload + vision
        round-trip). All 6 evals/__tests__/*.eval.test.ts make real pipeline calls behind
        it.skipIf(!evalsEnabled()); gold fixtures are real Unsplash URLs. Coverage floor raised to
        40/30/42/40 (from 25/19/30/25); measured this run 52.95% stmts / 41.73% branch / 54.06% lines
        (1544 pass/11 skip) — floor now near reality. Remaining gap keeping it below A: (b) CI's verify
        job still runs bare `vitest run` (no --coverage) — vitest.config.ts's own comment admits the
        floor gates only `npm run test:coverage`, never CI — AND the live-eval job cannot be shown green
        against the real pipeline here (owner-set keys, weekly-only). RAISE: add --coverage to the CI
        verify job; land one owner-keyed green live-eval run (or a recorded-cassette tier that runs
        per-PR).
    performance:
      grade: B
      ship_critical: false
      gap: >-
        UNCHANGED at B — the headline N+1 persists. lib/store/embedding-index.ts:46 topKSimilar still
        does a full-table select('*') with an in-memory cosine loop (lines 55-70) — no supabase.rpc /
        match_ pgvector query anywhere. Still called per-crop: identified-products-pipeline.ts:117
        invokes topKSimilar inside cropperOut.crops.map(...) wrapped in Promise.all (:107-108), so one
        identify request with C crops does C full-table scans; the ivfflat cosine index (migration
        008:42-44 product_image_embeddings_vec_idx) is NEVER used (grep ivfflat lib/ = 0). No new commit
        touched lib/store/ or migrations since 2026-07-01. Secondary: 0 next/image imports vs 13 raw
        <img> (up from 6); no Lighthouse/bundle-size/perf budget in CI or preflight. Cost discipline
        remains the strong pillar (42 files with explicit thinkingConfig/thinkingFor, 33 DETERMINISTIC_
        SEED, withCostLedger/recordUsage). RAISE: add a pgvector match_ RPC (embedding <=> query
        ORDER BY + LIMIT k) via supabase.rpc so the ivfflat index is used; adopt next/image; add a
        perf budget.
  top_gaps:
    - dimension: functional_reality
      severity: critical
      gap: Core journey (photo→REAL mockup) + paywall→checkout→unlock still have no outcome-asserting runtime E2E (no delta this cycle); authed tier not CI-independently runnable. SOLE reason overall is below the ship bar — the ONLY remaining ship-critical dimension below A.
    - dimension: design_taste
      severity: high
      gap: Second (and last) ship-critical dimension below A. Authed design-dense routes still have no axe coverage; e2e/__screenshots__/ still absent so pixels/dark-parity unverified (F7). aria-live/role=alert wins (#330/#368) landed but don't lift past B.
    - dimension: tests_evals
      severity: medium
      gap: Not ship-critical. 2 of 3 prior gaps closed (CI eval job exists; refine+mockup evals real; floor raised to ~reality). Remaining — CI verify still doesn't run --coverage; live-eval can't be shown green here (owner keys, weekly-only).
    - dimension: performance
      severity: medium
      gap: Not ship-critical. Full-table-scan N+1 in embedding-index persists (ivfflat index unused, N scans/identify); 0 next/image (13 raw <img>); no perf budget.
    - dimension: business_case_strength
      severity: low
      gap: A. Bounded post-launch-only residual — positive net margin (~break-even at the honest 40% anchor) leans on a projected 15% referral share with no operating data yet.
    - dimension: correctness
      severity: resolved
      gap: RAISED B→A this cycle — product-verify maxDuration + 270s wall-clock cap landed; sweep clean; all signals green.
    - dimension: security_rls
      severity: resolved
      gap: RAISED A→A+ this cycle — preflight GATE 6 now mechanically asserts RLS-coverage (26/26 tables) + client-secret leak (incl. EXPO_PUBLIC_*); zero findings.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
