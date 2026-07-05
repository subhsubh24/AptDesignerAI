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
  as_of: 2026-07-05
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: B                          # RAISED C->B: functional_reality closed C->A; headline now capped by design_taste (B), the SOLE ship_critical dim below A
  ship_gate_met: false                # true only when every ship_critical dim is A or A+ — design_taste (B) is the last blocker
  dimensions:
    functional_reality:
      grade: A
      ship_critical: true
      gap: >-
        RAISED C->A. The sole prior gap ("core money-path has no outcome-asserting runtime E2E that
        actually RUNS, not skips") is CLOSED on TWO independent layers, both verified GREEN this cycle:
        (1) HERMETIC per-PR — __tests__/integration/render-pipeline-cassette.test.ts (matches
        vitest.config include, runs in `npm test`) drives the REAL render glue buildMockupContext->
        generateMockupPrompt->generateMockupImage (only the LLM boundary is mocked via vi.mock of
        lib/ai/gemini), asserts intermediate row-mapping (:77-83) AND terminally decodes the base64 to
        a REAL PNG — 8-byte signature + non-zero IHDR width/height (:113-118); a 2nd case proves the
        cassette THROWS on an unrecorded stage (no silent fallback). Re-ran locally: 2 passed. (2) AUTHED
        BROWSER-in-CI — e2e/journeys.spec.ts:227 "core money-path: POST /api/mockups renders a REAL,
        decodable image" signs in through the real UI, seeds project+room via the app's OWN authed API,
        POSTs /api/mockups (real route: auth->userOwnsRoom->generateMockupImage->uploadMockupImage), and
        asserts status 200 + a real PNG (magic 89504e470d0a1a0a + non-zero IHDR dims, :308-311). The
        paywall money-path is now outcome-asserted too: :201 "paywall UNLOCK" seeds the real
        stripe_customers row the webhook writes, then asserts the ENTITLEMENT FLIP end to end —
        /api/billing/status hasPaid===true (:217) AND the free-tier CTA toHaveCount(0) (:220-224); :175
        asserts a REAL "continue to checkout" button. These RUN (not skip) in CI: ci.yml `journeys` job
        sets E2E_AUTH_STACK=1, stands up ephemeral Supabase (start + db reset), builds, and runs
        `bash scripts/run-journeys.sh` in FULL mode (run-journeys.sh hard-exits 2 if the flag is unset,
        so authed cannot silently skip); it is an unconditional no-continue-on-error job and CI is GREEN
        on main (run 28735583211, head c5f01c14). The cassette is fail-closed for prod (gemini.ts:813-822
        assertCassetteSafe refuses to boot if E2E_AUTH_STACK=1 on a Vercel deploy; a regression test pins
        it). A (not A+): the E2E money-path seeds the recommendation_mockup payload via API and drives
        only the RENDER leg through the browser — the upstream photo-upload->understand->diagnose->source
        UI legs are exercised as prompt-assembly glue in the hermetic test but never as a single authed
        browser journey. A+ would drive a real photo upload -> rendered diagnosis -> sourcing -> mockup
        end to end in one browser walk. Both flagship outcomes (a real decodable mockup, a real
        entitlement flip) are fully asserted and run green.
    correctness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. Signals green this cycle (cold, npm install first): tsc --noEmit clean, eslint clean,
        determinism green, npm test 1775 pass / 11 skip (up from 1544; 11 skips are RUN_EVALS-gated by
        design). The cycle's many `fix(a1)` silent-failure guards are REAL improvements, not regressions
        (spot-checked 3): #456 mockups page sets loadError on !res.ok and surfaces distinct generate-fail
        reasons to a banner (mockups/page.tsx:57-121); #451 setup page throws BEFORE router.push so a
        failed save keeps the user on the form with saveError (setup/page.tsx:99-104 — a true data-loss
        fix); #453 bundles same guarded-load pattern. maxDuration sweep still clean — every route with a
        direct/indirect provider call carries `export const maxDuration = 300`; every `none` route was
        cross-checked to make no provider call. Provider wall-clock caps under budget: Gemini 180s
        (gemini.ts:43), DeepSeek 120s (deepseek.ts:27) < 300s. No real stub/TODO/dead path on a critical
        route (the mockups :603 hit is a fail-loud insert guard, the opposite of a stub). Cassette
        boot-guard fail-closed + tested. Minor defense-in-depth nit (not A-blocking): assertCassetteSafe
        keys the refusal on process.env.VERCEL, so a hypothetical non-Vercel prod host is covered only by
        the flag-gated activation path, not the module-load assert — the app is Vercel-deployed.
    security_rls:
      grade: A+
      ship_critical: true
      gap: >-
        Holds at A+ — the mechanical gate was RE-RUN cold, not assumed. `bash scripts/preflight.sh`
        GATE 6: "RLS coverage — 26 public tables, all ENABLE ROW LEVEL SECURITY" green; client-secret
        leak (NEXT_PUBLIC_* and EXPO_PUBLIC_* for SECRET/SERVICE_ROLE/PRIVATE) green on both web + mobile.
        29 migrations; the Python parser counts 26 created public tables, all RLS-enabled. The 3 NEW
        public tables since last grade (023_social_post_queue, 025_user_email_stages,
        027_user_email_preferences) each pair CREATE TABLE with ENABLE ROW LEVEL SECURITY — no uncovered
        table introduced. Zero secret findings (git ls-files shows only .env.example; no hardcoded
        service_role/sk_live/sk_test). The cycle's G2-hardened routes confirm auth->rate-limit->validate->
        write ordering (rooms/[roomId]/images:50-73, bundles:34-74 with size-caps, saved-designs:28-178
        with RLS as the auth boundary). Cassette bypass fail-closed + regression-tested
        (cassette-guard.test.ts: "HARD-REFUSES if the flag is set on a Vercel deploy", 9 tests pass).
        Zero security findings. No gap.
    design_taste:
      grade: B
      ship_critical: true
      gap: >-
        UNCHANGED at B — the two capping gaps persist and are now the SOLE thing between overall and the
        ship gate. (1) NO axe coverage on authed design-dense routes: grep AxeBuilder e2e/ hits ONLY
        e2e/a11y.spec.ts, whose PUBLIC_PAGES (:6-14) is exactly the 7 static public routes; journeys.spec
        HAS a full authed login fixture but zero AxeBuilder calls, so dashboard/diagnosis/mockups/compare
        (dynamic score colors/confetti) are never axe-scanned. (2) NO committed visual artifacts: `ls
        e2e/__screenshots__/` -> absent; grep toHaveScreenshot across e2e/tests/__tests__ -> zero;
        playwright.config has no snapshot config, so rendered pixels / dark-mode parity / empty+error
        states are asserted in code but never captured (F7 correctly stays UNCHECKED). The design SYSTEM
        itself is A-territory: slop hunt clean on consumer surfaces (zero emoji-in-JSX, all gradients
        resolve to warm-editorial tokens backed by --gradient-warm-start:#b4501e in globals.css:73, no
        purple/violet slop), real skeletons (components/ui/skeleton.tsx used across every list surface),
        layered error boundaries + not-found.tsx; the a11y PRs (#420 dashboard WCAG AA, #437/#438 focus
        states + labels) strengthen the pages — but none touch the capping axis, so the grade holds.
        Minor non-capping slop: ManualScorecardView.tsx:267-268 uses ad-hoc bg-purple-* off the token
        system on a consumer surface (via focus/page). RAISE: add an authed AxeBuilder pass over
        dashboard/diagnosis/mockups/compare behind the existing journeys login fixture (assert no
        critical/serious), and add toHaveScreenshot baselines to e2e/__screenshots__/ (light+dark,
        empty/error) so F7 is visually enforced rather than code-only.
    store_readiness:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A, no regression (recent commits are A1/F2/ledger housekeeping — none touch privacy,
        delete routes, icon, or eas config). Every processor in app/privacy/page.tsx:70-124 maps to a
        live, used dependency (Gemini, DeepSeek, Supabase, Stripe, RevenueCat, Tavily, Google Places,
        Browserbase, Resend, Turnstile, Vercel Analytics) — no phantom Anthropic/OpenAI (the lone
        "openai" hit is lib/ai/openai-schema.ts, a Zod->JSON-schema converter for DeepSeek's
        OpenAI-compatible strict mode, not a processor). In-app deletion real on both surfaces
        (app/api/user/delete:31 + app/api/mobile/account:56 call admin.auth.admin.deleteUser) with a
        verified FK cascade (profiles/ saved_designs -> auth.users on delete cascade). Real icon
        (mobile/assets/images/icon.png = PNG 1024x1024 RGBA 799KB); real eas.json build+submit profiles;
        canonical hello@aptdesignerai.com (14 code refs), no live stale @aptdesigner.ai. Bounded A+ items
        (cosmetic, unchanged): store screenshots (D3) correctly [ ] (device-blocked); a few page <title>
        tags.
    artifact_integrity:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. Spot-checked 7 ticked boxes — all map to real, non-placeholder artifacts (B6
        mobile/eas.json, B3 icon.png, E2 brand-kit.md + wordmark.svg, E6 press-kit.md, A5 six
        *.eval.test.ts, C1 billing/webhook route, E8 site-gate.ts). All 4 dashboard YAML blocks parse via
        yaml.safe_load (BUSINESS_CASE_SUMMARY, GROWTH_STATUS, OWNER_ACTIONS, QUALITY_SCORECARD). Pricing
        consistent across lib/billing/stripe.ts ($29 / $49-mo / $399-yr), app/pricing/page.tsx, and
        docs/BUSINESS_CASE.md. Correctly-unticked items (D3, E7, F3/F4/F7, §29) remain open with honest
        partial-status notes. No ticked box points at a missing/placeholder artifact.
    business_case_strength:
      grade: A
      ship_critical: true
      gap: >-
        Holds at A. Recomputed base (Scenario B) from the stated inputs (BUSINESS_CASE.md:218-227):
        4,000 installs x 0.25 retention x 0.04 conv = 40 paid/mo; tier mix -> MRR $10,240 -> ARR $122,880
        ~= the stated arr_year1.base 122,900 (rounding, not padding). Floor met honestly: no single input
        is above its benchmark band (retention 25% within 20-30%, conversion 4% within 2-5%, organic 40%
        = TOP of the 35-40% band, honestly re-anchored down from a prior 50%; churn 7% within 6-7.5%).
        Both levers are real code (referral: lib/waitlist/referral.ts + migration 026; upsell:
        components/billing/upgrade-cta-card.tsx + api/billing/status). Honesty maintained — the
        net-margin table admits ~break-even at the 40% organic anchor rather than papering over it.
        Bounded, disclosed residual (not a regression): the model reports STEADY-STATE subscriber pools
        (171 monthly, 167 annual) as year-1 ARR; those pools asymptote over ~1.5-2 years, so arr_year1 is
        somewhat generous as a strict year-1 figure — labeled "steady-state" throughout, a disclosed
        simplification, not hidden padding.
    tests_evals:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B — both remaining gaps persist. Coverage (npx vitest run --coverage this run): 56.21%
        stmts / 45.08% branch / 60.21% funcs / 57.32% lines (up from ~53%), comfortably above the
        vitest.config floor 40/30/42/40 — the floor is now real but generous (~16pts under actual). (b)
        CI STILL never enforces coverage: ci.yml:28 verify job runs `npm test` = bare `vitest run`
        (package.json:10, no --coverage); test:coverage exists (package.json:12) but is never wired into
        CI, so a coverage regression is invisible in CI. Live evals are genuinely real — 6
        evals/__tests__/*.eval.test.ts make real pipeline calls behind it.skipIf(!evalsEnabled()) against
        real Unsplash fixtures (e.g. grounding.eval asserts fellBack===false); live-eval.yml runs them
        weekly + on dispatch, gated on owner keys with a warn-skip — but that job CANNOT be shown green in
        this environment (owner-only keys, weekly-only). RAISE: add --coverage to the CI verify job so the
        floor actually gates; land one owner-keyed green live-eval run, or add a recorded-cassette eval
        tier that runs per-PR.
    performance:
      grade: B
      ship_critical: false
      gap: >-
        Holds at B — the headline N+1 persists, unchanged, but the current STATE is a single named,
        non-blocking gap on a non-ship-critical path (criterion-referenced: the same state that earned B
        for three cycles earns B again — a letter is not decayed merely for lack of progress).
        lib/store/embedding-index.ts:46 topKSimilar still does a full-table select('*') + in-memory
        cosine loop (:55-70), called per-crop inside identified-products-pipeline.ts:117
        cropperOut.crops.map (bounded by pLimit(20), not eliminated) -> N scans/identify; the ivfflat
        cosine index (migration 008:42-44) built to fix exactly this sits UNUSED (grep ivfflat/.rpc lib/
        = 0). Small improvement that does not lift the grade: raw <img> dropped 13->6 files, but next/image
        adoption is still 0 on an image-heavy app; no Lighthouse/bundle-size/perf budget in CI or
        preflight. Cost discipline remains the strong pillar (explicit thinkingConfig/thinkingFor,
        DETERMINISTIC_SEED, withCostLedger/recordUsage throughout). RAISE: add a pgvector match_ RPC
        (embedding <=> query ORDER BY + LIMIT k) via supabase.rpc so the ivfflat index is used; adopt
        next/image; add a perf budget.
  top_gaps:
    - dimension: design_taste
      severity: high
      gap: >-
        The SOLE ship_critical dimension below A and the ONLY blocker between overall B and the ship
        gate. Authed design-dense routes (dashboard/diagnosis/mockups/compare) still have ZERO axe
        coverage; e2e/__screenshots__/ still absent so pixels/dark-parity/empty-error unverified (F7).
        Fix both -> design_taste A -> every ship_critical dim A/A+ -> ship_gate_met true.
    - dimension: tests_evals
      severity: medium
      gap: >-
        Not ship-critical. CI verify still runs bare `vitest run` (no --coverage) so the floor never
        gates CI; live-eval.yml exists but can't be shown green here (owner keys, weekly-only). Coverage
        climbed to 56/45/60/57.
    - dimension: performance
      severity: medium
      gap: >-
        Not ship-critical. Full-table-scan N+1 in embedding-index persists (ivfflat index unused, N
        scans/identify bounded by pLimit(20)); next/image still 0 (raw <img> 13->6); no perf budget.
    - dimension: business_case_strength
      severity: low
      gap: >-
        A. Disclosed residual — steady-state subscriber pools reported as year-1 ARR (asymptote over
        ~1.5-2y); labeled steady-state, a disclosed simplification, not padding.
    - dimension: functional_reality
      severity: resolved
      gap: >-
        RAISED C->A this cycle — the long-standing binding blocker CLEARED. Hermetic per-PR
        render-pipeline cassette test + authed-in-CI money-path E2E both assert a REAL decodable PNG and
        a real entitlement flip, run GREEN (not skip). A (not A+) only because the upstream
        photo/diagnose/source UI legs aren't yet one authed browser walk.
    - dimension: security_rls
      severity: resolved
      gap: >-
        A+ holds — preflight GATE 6 re-run cold, 26/26 public tables RLS-enabled (incl. 3 new tables),
        zero secret findings, cassette bypass fail-closed + tested.
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
