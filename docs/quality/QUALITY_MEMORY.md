# QUALITY MEMORY — AptDesignerAI

Append-only log of each independent Quality Auditor run: the dated grade, what changed since the
prior grade, and lessons. Read FIRST each run and diff against the last grade to see what improved
or regressed. The machine-readable grade lives in `QUALITY_SCORECARD.md`; this file is the narrative
history behind it.

---

## 2026-06-29 — FIRST INDEPENDENT GRADE (baseline)

**Overall: C · ship_gate_met: false.** First run of the independent auditor; prior scorecard was all
`null` (never graded). This establishes the baseline.

**Per-dimension:** functional_reality **C** · correctness **B** · security_rls **B** · design_taste
**B** · store_readiness **B** · artifact_integrity **A** · business_case_strength **B** ·
tests_evals **C** · performance **B**.

**Mechanical signals actually run this cycle (cold start, `npm install` first):**
- `npx tsc --noEmit` → clean (exit 0).
- `npm test` (vitest) → 1183 passed / 8 skipped / 102 files. The 8 skips are `RUN_EVALS`-gated live
  evals (`it.skipIf(!evalsEnabled())`) — by design, not hidden failures.
- `npx eslint .` → clean (exit 0).
- `npm run check:determinism` → all checks passed.
- Functional journeys: `e2e/journeys.spec.ts` public/structural tier FAILED on first run purely due
  to missing Supabase env (no `.env`, only `.env.example`); after writing a gitignored `.env.local`
  with DUMMY keys, all 5 public/structural tests PASS (signup/login forms render; protected
  /dashboard /account /saved bounce to /login). The AUTHENTICATED tier needs `E2E_AUTH_STACK=1` +
  a seeded Supabase backend that can't be stood up cold, so it was not verified this run.
- `npx vitest run --coverage` (via grader) → ~41.8% stmts overall; lib/validation 84%, lib/billing
  76%, **lib/agents ~21%**. vitest.config floor is 25/19/30/25 — below actual, and CI never runs
  `--coverage`, so the floor is decorative.
- Live evals attempted (`RUN_EVALS=1`) → did NOT run green here: no Gemini key + Unsplash gold-image
  fixtures 403 through the proxy (non-hermetic).

**Method:** graded via 8 fresh adversarial per-dimension subagents (none wrote the code) +
own assessment of functional reality. Each grade backed by a signal the grader actually ran +
file/line evidence.

**Headline reasoning (why overall C despite 6/9 at B/A):** the two dimensions that answer "does the
product actually work end-to-end" and "do we KNOW the output is good" — functional_reality and
tests_evals — are both C. The core money path (photo→understand→diagnose→source→mockup) and
paywall→checkout→unlock have NO outcome-asserting runtime test (admitted in ROUTE_INVENTORY), and the
live eval suite never runs green in CI. Several dimensions are individually strong (artifact_integrity
A; security RLS core, design system, and cost discipline are genuinely good), but the headline can't
exceed the weakest ship-critical link while the core journey is runtime-unvalidated.

**Notable concrete findings (filed as issues):**
- `app/privacy/page.tsx:54-57` names "Anthropic Claude, OpenAI" as photo processors — neither is a
  dependency/processor in the codebase. Privacy-policy accuracy/compliance defect (loop-fixable).
- No `maxDuration` anywhere (grep=0) on a documented 3–5 min core pipeline with 180s per-call
  Gemini timeouts → platform can kill the run mid-pipeline on default Vercel limits.
- `app/api/products/evaluate{,-set}/route.ts` call the LLM fit-scorer with no rate-limit/spend guard
  (the open G1 gap) → an authed user can drain budget; evaluate-set even fans out with Promise.all.
- `lib/store/embedding-index.ts` topKSimilar full-table `select('*')` once per crop (N scans) and
  never uses the existing ivfflat pgvector index.
- Zero `aria-live`/`role=alert` across the app; no global `not-found.tsx`; authed routes have no axe
  coverage; `e2e/__screenshots__/` empty (F7 has no artifacts to judge).

**Lessons for next run:**
1. Cold start has NO deps and NO env. ALWAYS `npm install` first, then write a gitignored
   `.env.local` with DUMMY Supabase keys before running the public journey suite — otherwise the
   "failures" are environmental, not real defects (this tripped the first journey run this cycle).
2. The authed journey tier + live evals cannot run in this cold environment (need a seeded Supabase
   backend + a real Gemini key + hermetic fixtures). Treat their "green" as UNVERIFIABLE here, not as
   pass — grade functional_reality and tests_evals on what can actually be exercised.
3. Don't trust a background `npm test` "exit 0" — it can be the trailing `echo`'s exit while
   `vitest: not found`. Confirm deps are installed first.
