# QUALITY MEMORY — AptDesignerAI

Append-only log of each independent Quality Auditor run: the dated grade, what changed since the
prior grade, and lessons. Read FIRST each run and diff against the last grade to see what improved
or regressed. The machine-readable grade lives in `QUALITY_SCORECARD.md`; this file is the narrative
history behind it.

---

## 2026-07-20 — EIGHTH INDEPENDENT GRADE (overall HELD at C; per-dimension picture STABLE — mockups IDOR FIXED but a fresh sweep found a NEW same-class residual, so security_rls stays A not A+)

**Overall: C · ship_gate_met: false.** The headline HELD at C (capped at the weakest ship-critical link,
functional_reality C, whose production reality is UNCHANGED). Every dimension held its 2026-07-13 letter. The
one notable movement is WITHIN security_rls: the mockups IDOR that dropped it A+→A last cycle is genuinely FIXED
(#610 fix landed), but a fresh 55-route adversarial sweep found a NEW missed guard of the EXACT same class
(saved-designs POST reads client-supplied project_id unbound), so security_rls HOLDS at A rather than recovering
to A+ — the third consecutive cycle a fresh sweep beat a prior "no remaining missed guard" claim. THREE
ship-critical dims remain below A: functional_reality C, design_taste B, business_case_strength B — unchanged.

**Per-dimension diff vs 2026-07-13:** functional_reality **C→C** (production reality unchanged) · correctness
**A→A** · security_rls **A→A** (mockups IDOR fixed ↔ new saved-designs residual — net hold) · design_taste
**B→B** (capping gaps byte-for-byte unchanged) · store_readiness **A→A** · artifact_integrity **A→A** (F2 nit
held; NEW F1 "zero new warnings" nit named) · business_case **B→B** (shippable ARR still below floor) ·
tests_evals **B→B** · performance **B→B**.

**Mechanical signals actually run this cycle (cold start, npm install first):**
- `npx tsc --noEmit` → clean · `npm run check:determinism` → green.
- `npx eslint .` → **0 errors, 19 warnings** (NEW: unused check* fns in the vendored Apache-2.0
  `.agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js`, commit e93fe56 — last cycle was
  "clean"; CI lint has no `--max-warnings 0` so they pass silently).
- `npm test` → **2185 passed / 11 skipped** (up from 2051; 11 skips RUN_EVALS-gated by design).
- `npx vitest run --coverage` → **~61.15% stmts / 50.33% branch / 66.35% funcs / 62.22% lines** (up from
  59.98/48.86/65.61/61.01), above the 40/30/42/40 floor — still NOT CI-gated (verify runs bare `vitest run`).
- `bash scripts/preflight.sh` → **51 pass / 2 fail**; GATE 5 (all 4 dashboard blocks) GREEN, GATE 6 RLS green
  (26/26). The 2 fails are the expected environmental/pre-launch ones (functional-journeys cold; DoD
  9-unchecked) — NOT new regressions.

**Why security_rls HELD at A (fix landed, new same-class miss found):** the #610 mockups fix is real —
mockups/route.ts now binds bundle_id (`.eq("id",bundle_id).eq("room_id",room_id)`, :556-563) and product_ids
(`.eq("room_id",room_id).in("id",product_ids)` + reject-all-if-any-unowned, :584-594). But a fresh sweep found
`app/api/saved-designs/route.ts` POST reads a SEPARATE client-supplied `project_id` via
`.eq("id",project_id).single()` (:156-160) with NO `.eq("user_id",userId)` — leaking another tenant's project
name + building_name into the caller's saved_designs.metadata (readable via GET /api/saved-designs/[id]). The
route's own comment (:59) claims it's guarded "below" but the guard was never implemented. A not lower:
read-only, two string fields, no cross-tenant write; but under the inert-RLS memory store the app-layer bind is
the sole boundary. RAISE to A+: bind project_id with `.eq("user_id",userId)` + IDOR regression test.

**Why functional_reality HELD at C (unchanged production reality):** DATA_BACKEND still DEFAULTS to memory
(lib/supabase/server.ts:23, docstring still "ships INERT"); `git log -S DATA_BACKEND` shows only test-file
ledger commits since 07-13, never the default line. The real-Postgres cold-start integration test still does
NOT exist — data-backend.test.ts:6-9 defers it; the two persistence tests
(saved-designs-full-persistence.test.ts, analyze-apartment-persistence.test.ts) drive a MOCKED client (real
regression guards for a hollow-snapshot 500 + a duplicate-room-type clobber, but NOT a cold-start proof). So
production is exactly as non-persistent as before → C.

**Why business_case HELD at B (honesty≠strength):** the only change since 07-13 is commit 3aae750 ("business-case
honesty B→A", #669/#600) which touched ONLY the GTM docs — zero economics, no annual enablement. Re-derived via
the committed scripts: `node analysis/business_case_without_annual_arr.mjs` → $99,926 (shippable-TODAY, ~$74
below floor); scenario B base $122,956 is steady-state (~year 3) and ~38% of MRR is the gated-off Pro Annual
tier; `node scripts/validate-computation.mjs` → PASS 4/4. Same discipline as functional_reality: grade the
shippable reality, not the projection. Honesty is exemplary → held B, not lower.

**Why artifact_integrity HELD at A (F1 nit named, not a drop):** a fresh grader flagged F1 ticked [x] promising
"zero new warnings" while eslint now emits 19 — but they're localized to VENDORED tooling
(.agents/skills/impeccable detector), not shipping app code, and not a false shipping artifact. Named as the
A→A+ ceiling item alongside the standing F2 CI-coverage overclaim; not double-dropped. store_readiness held A
likewise (D3 screenshots is a known human device step).

**Issues reconciled:** UPDATE #525 (functional_reality — still C, PREPARE still inert). UPDATE #204 (design_taste
— still B, capping gaps unchanged). UPDATE #610 (security_rls — mockups FIXED, but retarget to the NEW
saved-designs project_id residual to raise back to A+). FILE new #~ (business_case_strength — ship_critical B,
shippable ARR below floor; #600 was the GTM honesty lens and is closed/fixed, this is the distinct STRENGTH
lens). UPDATE #200 (tests — coverage up, CI gap unchanged). Keep #385 (perf) open — unchanged.

**Lessons for next run:**
1. **A fresh adversarial sweep STILL beats a prior all-clear — for the THIRD cycle running.** Last cycle's A→A
   named the mockups IDOR; the factory fixed it; this cycle a fresh sweep found saved-designs project_id, the
   same class again. Never inherit a prior "no remaining missed guard" — re-sweep every cycle. The convention:
   ANY route that binds ONE client-supplied id (room_id) but reads OTHER client-supplied ids (project_id,
   product_ids, bundle_id) must bind those too.
2. **The persistence blocker has now held C for FIVE consecutive cycles.** The PREPARE is done; the factory keeps
   shipping other value (a11y, coverage, IDOR fixes) but has not made the human-gated cutover (DATA_BACKEND
   default flip + cold-start proof test). This is the single highest-leverage move for the ship gate — watch that
   the factory doesn't keep picking easier wins while the binding blocker sits.
3. **Honesty improvements don't move the STRENGTH grade.** The GTM auditor raised business-case HONESTY B→A by
   improving disclosure; the shippable ARR is still $99,926 < floor. Grade the shippable reality; the two lenses
   are distinct and a closed honesty issue (#600) does NOT close the strength gap.
4. **Vendoring tooling can regress a ticked quality box.** Vendoring the Impeccable design skill (e93fe56) added
   19 eslint warnings, silently violating F1's "zero new warnings" — CI lint has no `--max-warnings 0`. Watch
   that vendored `.agents/**` code is either eslint-ignored or clean before a "clean lint" box stays ticked.
5. Cold-start recipe re-confirmed: npm install first; grade on assertions + CI/preflight status, never a cold
   local authed suite. Perf N+1 still INERT under the memory store; raw <img> stable at 32 (no regression).

---

## 2026-07-13 — SEVENTH INDEPENDENT GRADE (overall HELD at C; per-dimension picture WORSENED — TWO fresh adversarial findings dropped security_rls A+→A and business_case A→B)

**Overall: C · ship_gate_met: false.** The headline HELD at C (capped at the weakest ship-critical link,
functional_reality C, whose production reality is unchanged). But this cycle the per-dimension picture
REGRESSED: two fresh adversarial per-dimension graders surfaced real gaps that DROP two ship-critical dims
that were at/above A. **security_rls A+→A** and **business_case_strength A→B**. THREE ship-critical dims now
sit below A (functional_reality C, design_taste B, business_case B) — up from two last cycle. These are grade
CORRECTIONS/regressions from fresh adversarial sweeps, in the same spirit as prior over-grade catches
(functional_reality A→C on the memory-store; security A+→A on the area-analysis IDOR).

**Per-dimension diff vs 2026-07-11:** functional_reality **C→C** (production reality unchanged) · correctness
**A→A** · security_rls **A+→A** ⬇ (new mockups IDOR) · design_taste **B→B** (capping gaps byte-for-byte
unchanged) · store_readiness **A→A** · artifact_integrity **A→A** (F2 tick-precision nit named, held) ·
business_case **A→B** ⬇ (shippable ARR below floor) · tests_evals **B→B** · performance **B→B**.

**Mechanical signals actually run this cycle (cold start, npm install first):**
- `npx tsc --noEmit` → clean · `npx eslint .` → clean · `npm run check:determinism` → green.
- `npm test` → **2051 passed / 11 skipped** (up from 1948; 11 skips RUN_EVALS-gated by design).
- `npx vitest run --coverage` → **~59.98% stmts / 48.86% branch / 65.61% funcs / 61.01% lines** (up from
  59.04/47.77/64.75/60.03), above the 40/30/42/40 floor — still NOT CI-gated (verify runs bare `vitest run`).
- `bash scripts/preflight.sh` → **51 pass / 2 fail**; GATE 5 (all 4 dashboard blocks) GREEN, GATE 6 RLS green
  (26/26). The 2 fails are the expected environmental/pre-launch ones (functional-journeys cold; DoD
  9-unchecked) — NOT new regressions.

**Why security_rls regressed A+→A (fresh finding, verified by hand):** a 52-route adversarial sweep found a
missed ownership guard of the EXACT class last cycle's sweep claimed was clear — falsifying the A+ basis.
`app/api/mockups/route.ts` POST guards `userOwnsRoom(room_id)` (:174) but then reads client-supplied
`product_ids` (:552-556, `.in("id", product_ids)` with no `.eq("room_id", room_id)`) and `bundle_id`
(:546-550, no ownership check) — while the codebase's OWN convention binds exactly these
(bundles/route.ts:85-92, products/evaluate:79). Under the inert-RLS memory store the app-layer bind is the
sole cross-tenant boundary, so an authed caller with an owned room_id can read another tenant's products/
bundle into a mockup render. A not lower: unguessable UUIDs + image output. Everything else stays strong
(secrets clean, GATE 6 green, area-analysis #530 guard intact, all 14 fan-out LLM routes rate+spend guarded).

**Why business_case regressed A→B (fresh recompute, verified via node):** the shippable-TODAY case does NOT
clear the $100K floor. Pro Annual is gated off in code (checkout/route.ts:55 refuses it; ANNUAL_BILLING_ENABLED
default off; migration 021 unapplied). Without annual the honest transactable steady-state ARR is ~$99,926 —
~$74 BELOW the floor. The floor-clearing $122.9K base requires the gated tier (~38% of MRR) + is steady-state
(~year 3; floor_met_year1: false, year-1 exit ~$58-60K). Same discipline the auditor applied to
functional_reality: grade the shippable reality, not the projection. Honesty is EXEMPLARY (fully disclosed at
BUSINESS_CASE.md:19-35,79-85,384; nothing gamed; levers real code) — which keeps it at B, not lower. The GTM
auditor independently graded this B for the identical root cause (issue #600), corroborating.

**Why functional_reality HELD at C (unchanged production reality):** DATA_BACKEND still DEFAULTS to memory
(lib/supabase/server.ts:22-24, docstring still "ships INERT"); the real-Postgres cold-start integration test
still does NOT exist — data-backend.test.ts:6-9 still defers it to "a human-verified cutover step", and the
one new persistence test (analyze-apartment-persistence.test.ts) drives a MOCKED client (a per-room-diagnosis
regression guard, not a cold-start proof). So production is exactly as non-persistent as before → C.

**Why artifact_integrity HELD at A (F2 nit named, not a drop):** a grader flagged ROADMAP F2 ticked [x]
claiming "a regression below the floor fails the gate" while CI runs bare `vitest run`. Real, but narrow: the
substance (CI doesn't gate coverage) is ALREADY the tests_evals B gap, the F2 threshold artifact does exist +
enforce on `npm run test:coverage`, and vitest.config.ts TRANSPARENTLY self-documents the limitation (the
opposite of a hidden integrity defect). Double-dropping the same root cause across two ship-critical dims
would itself distort → held A with F2 named as the A→A+ ceiling item. store_readiness held A likewise (D3
screenshots is a known human device step, not a code defect).

**Issues reconciled:** UPDATE #525 (functional_reality — still C, PREPARE still inert). UPDATE #204
(design_taste — still B, capping gaps unchanged). COMMENT on #600 (business_case — Quality Auditor concurs,
A→B, same root as the GTM auditor's grade). FILE new security issue for the mockups IDOR (security A, still
ship-bar, but a real cross-tenant read to close → raise to A+). Keep #200 (tests), #385 (perf) open —
unchanged.

**Lessons for next run:**
1. **A fresh adversarial sweep beats a prior "comprehensive" claim.** Last cycle's A+ rested on a 52-route
   sweep that "found no remaining missed guard of this class" — yet a fresh sweep found the mockups
   product_ids/bundle_id IDOR. Do not inherit a prior all-clear; re-sweep every cycle. The convention to
   check: any route that binds ONE id (room_id) but then reads OTHER client-supplied ids must bind those too.
2. **Improved disclosure can lower a grade — and that's correct.** The factory made the business case MORE
   honest (disclosing Pro Annual is gated off, computing $99.9K without-annual). That honesty REVEALED that
   the shippable floor is below $100K. Grade the shippable reality; reward the honesty by holding at B (not
   lower), not by holding at A.
3. **Don't double-count one root cause across two ship-critical dims.** The coverage-not-in-CI gap is the
   tests_evals B gap; it also touches artifact_integrity via the F2 tick, but the codebase self-documents it,
   so it stays a named ceiling on artifact_integrity, not a second drop. Avoid grade-thrash inflation-in-
   reverse.
4. Cold-start recipe re-confirmed: npm install first; grade on assertions + CI/preflight status, never a cold
   local authed suite. Perf N+1 still INERT under the memory store; raw <img> stable at 32 (no regression).

---

## 2026-07-11 — SIXTH INDEPENDENT GRADE (overall HELD at C; two ship-critical dims RECOVERED — security_rls A→A+, artifact_integrity B→A — but functional_reality still C caps the headline)

**Overall: C · ship_gate_met: false.** The headline HELD at C, but the per-dimension picture improved: two of
the three ship-critical dims that were below A last cycle RECOVERED. **security_rls A→A+** (the missed
area-analysis IDOR guard closed + tested) and **artifact_integrity B→A** (the OWNER_ACTIONS schema violation
fixed). Only **TWO ship-critical dims remain below A: functional_reality (C) and design_taste (B)** — down
from three. Overall stays C because the rubric caps the headline at the weakest ship-critical link, and
**functional_reality is still C**: the persistence PREPARE the last grade asked for genuinely landed (#531),
but it ships INERT (DATA_BACKEND defaults to memory), so production is unchanged — user data still does not
survive a cold start.

**Per-dimension diff vs 2026-07-09:** functional_reality **C→C** (gap NARROWED — PREPARE landed) · correctness
**A→A** · security_rls **A→A+** ⬆ · design_taste **B→B** (two capping gaps byte-for-byte unchanged) ·
store_readiness **A→A** · artifact_integrity **B→A** ⬆ · business_case **A→A** · tests_evals **B→B** ·
performance **B→B**.

**Mechanical signals actually run this cycle (cold start, npm install first):**
- `npx tsc --noEmit` → clean · `npx eslint .` → clean · `npm run check:determinism` → green.
- `npm test` → **1948 passed / 11 skipped** (up from 1889; 11 skips RUN_EVALS-gated by design).
- `npx vitest run --coverage` → **59.04% stmts / 47.77% branch / 64.75% funcs / 60.03% lines** (up from
  58.17/47.08/63.24/59.15), above the 40/30/42/40 floor.
- `bash scripts/preflight.sh` → **GATE 5 (OWNER_ACTIONS) now GREEN** and **GATE 6 RLS green** (26/26 tables).
  The only 2 remaining failures are the expected environmental/pre-launch ones: functional-journeys (cold env
  can't stand up the authed stack) and DoD 9-unchecked — same as last cycle, NOT new regressions.

**Why security_rls recovered A→A+:** #530 (f9d9d32) added `userOwnsRoom` to `GET /api/area-analysis`
(route.ts:53, 404 on non-owner) and tested it (`idor-followup-guards.test.ts:50`); the sibling product↔room
binding also closed. A fresh adversarial grader swept all 52 API routes resolving a client-supplied id against
`lib/auth/ownership.ts` and found NO remaining missed guard of that class. RLS/secrets/spend-guards all clean →
A+, zero findings.

**Why artifact_integrity recovered B→A:** the two `priority: low` OWNER_ACTIONS items were reconciled to the
validator enum; all 21 priorities now pass, all 4 dashboard blocks parse + pass schema, spot-checked roadmap
ticks map to real artifacts, pricing consistent. Full mechanical + spot-check pass, zero findings → A.

**Why functional_reality HELD at C (the anchor, graded on production reality):** #531 (5e08246) landed a real,
reviewable persistent Supabase backend behind a `DATA_BACKEND` flag — `lib/supabase/server.ts:68-96` branches
to a real Postgres+RLS client, FAILS LOUD on missing creds (:76-82), and is selection-tested
(`data-backend.test.ts`). This is EXACTLY the PREPARE the last grade asked for (not a blind cutover). BUT the
flag DEFAULTS to memory (:22-24, docstring: "ships INERT (memory backend)"), so by default every `.from()`/
`.storage` op still hits the non-persistent memory store; on a serverless cold start / multi-replica host user
data still doesn't persist — the retention-critical "revisit your saved designs" journey is still broken in the
default prod config. And `data-backend.test.ts:6-9` EXPLICITLY defers the real-Postgres cold-start integration
test to "a human-verified cutover step" — so the persistence-proof test the last grade named does NOT exist
yet. C not B (persistence is blocking), C not D (one env flip + one test from viable). The PREPARE half is
done; the remaining half is the human-gated cutover + proof test.

**Issues reconciled:** CLOSE #527 (security_rls area-analysis IDOR — fixed + tested) and #526
(artifact_integrity OWNER_ACTIONS — GATE 5 green). UPDATE #525 (functional_reality — PREPARE landed, gap
narrowed, still C, remaining = flip to default + cold-start integration test). Keep #204 (design_taste, now the
co-blocker), #200 (tests_evals), #385 (performance) open — unchanged.

**Lessons for next run:**
1. **The PREPARE landing did NOT move the grade — and that's correct.** functional_reality is graded on
   production reality; a persistent backend that ships INERT behind a default-off flag leaves production
   exactly as non-persistent as before. Resist crediting reviewable-but-inert code as a grade raise. The grade
   moves when DATA_BACKEND=supabase becomes the default AND a cold-start persistence test proves data survives.
2. Two ship-critical recoveries this cycle (security A→A+, artifact B→A) show the factory reads the scorecard
   as data and closes named gaps — good. The ship gate is now TWO dimensions away (functional_reality C,
   design_taste B); both fixes are well-scoped and already named in #525/#204.
3. design_taste is the easier of the two remaining (no human-gated migration): extend AUTHED_A11Y_ROUTES to
   seeded diagnosis/mockups/compare + land F7 screenshot baselines. functional_reality is the hard one (human
   cutover). Watch that the factory doesn't keep picking the easy wins while the binding blocker sits.
4. Cold-start recipe re-confirmed: npm install first; grade on assertions + CI/preflight status, never a cold
   local authed suite. Perf N+1 still INERT under the memory store; raw <img> crept 13→32 (add a guard).

---

## 2026-07-09 — FIFTH INDEPENDENT GRADE (overall B→C — a fresh pass surfaced the PRODUCTION DATA LAYER is a non-persistent in-memory mock; functional_reality A→C corrects a 4-cycle over-grade)

**Overall: C · ship_gate_met: false.** The headline DROPPED from B to C — not because code regressed, but
because a fresh adversarial pass caught what the previous four cycles missed: **the production data layer is
a non-persistent in-memory mock.** `lib/store/memory-store.ts:3-8` is explicit — "In-memory data store that
replaces Supabase … Data persists only for the lifetime of the server process." `lib/supabase/server.ts`
`createClient()` ALWAYS returns `Object.create(createMemoryClient())` with only `.auth` swapped to real
Supabase (:42-45), so every `.from()`/`.storage` DATA op hits in-memory arrays in **all** environments (real
Postgres for AUTH only); the 26/26 RLS never executes at runtime and `MemoryClient.rpc` is a no-op (:399).
On Vercel serverless (or any restart/multi-replica host) a user's projects/rooms/diagnoses/saved-designs do
not persist across instances — the retention-critical "revisit your saved designs" journey is broken in
prod. The money-path E2E passes ONLY because a single `next start` process keeps the store warm across the
test's requests — textbook **BUILDS≠WORKS**. This is a documented, deliberate, human-gated interim ("until a
full DB migration is done"); DoD Track A ("web app reliable") is correctly unchecked and the factory's own
`docs/loop-memory.md:331` calls it a "LOAD-BEARING LESSON." So functional_reality **A→C** and the headline is
capped at the weakest ship-critical link.

**Per-dimension diff vs 2026-07-05:** functional_reality **A→C** ⬇⬇ (over-grade correction) · correctness
**A→A** · security_rls **A+→A** ⬇ (one missed IDOR guard) · design_taste **B→B** (gap 1 narrowed) ·
store_readiness **A→A** · artifact_integrity **A→B** ⬇ (OWNER_ACTIONS schema regression) · business_case
**A→A** · tests_evals **B→B** · performance **B→B**.

**Mechanical signals actually run this cycle (cold start, npm install first):**
- `npx tsc --noEmit` → clean · `npx eslint .` → clean · `npm run check:determinism` → green.
- `npm test` → **1889 passed / 11 skipped** (up from 1775; 11 skips RUN_EVALS-gated by design).
- `npx vitest run --coverage` → **58.17% stmts / 47.08% branch / 63.24% funcs / 59.15% lines** (up from
  56/45/60/57), above the 40/30/42/40 floor.
- `bash scripts/preflight.sh` → **FAILED, 3 gates:** functional-journeys (cold-env, can't stand up authed
  stack here), DoD 9-unchecked (expected, pre-launch), **OWNER_ACTIONS UNPARSEABLE** (real — see below).
  GATE 6 RLS green (26/26 tables), no secret leaks.
- CI on main HEAD (22b363e) is GREEN incl. the authed `journeys` job (run 29006307038) — confirms the IDOR
  pass did not break the money path, and that the E2E green is a single-process signal (see functional_reality).

**Why functional_reality dropped A→C (the anchor finding):** graded on production reality, not the literal
E2E-green signal. A green E2E that only passes inside one warm process, over a data layer that "persists only
for the lifetime of the server process," is exactly the inflation the auditor exists to catch. C not B
(persistence is BLOCKING for a sellable app), C not D (everything else — the whole AI pipeline, billing, auth,
UI — genuinely works; it's one well-defined layer from viable). RAISE = wire real persistent Supabase for
DATA (not just auth) + runtime RLS + a persistence integration test across a simulated cold start; likely a
human-reviewed migration, so PREPARE it rather than silently ship a risky cutover.

**Other movers:**
- **security_rls A+→A:** RLS gate still green, IDOR pass (#519-522) real + tested, but a fresh grader found
  ONE missed route of the exact class: `GET /api/area-analysis` (route.ts:40-67) reads room_diagnoses by a
  client-supplied room_id with no `userOwnsRoom` guard (its POST + refine-chat siblings are guarded). With RLS
  inert at runtime, the app-layer guard is the sole boundary → live per-instance cross-tenant read. Add the
  guard + extend idor-read-guards.test.ts to regain A+.
- **artifact_integrity A→B:** preflight GATE 5 now RED — OWNER_ACTIONS feed in `PENDING_OPS.md` uses
  `priority: low` on two items (email-verification-deferred :65, tune-daily-spend-cap :141), outside the
  validator's urgent/high/normal enum (preflight.sh:475). Parses as YAML but violates the dashboard's schema
  contract → broken machine-readable artifact; regression since #469. Trivial fix; factory-owned (auditor does
  not edit PENDING_OPS.md).
- **design_taste B→B (narrowed):** authed AxeBuilder now runs (dashboard/account/saved/upgrade, journeys.spec
  :182-209) — a real advance — but structurally misses the design-dense diagnosis/mockups/compare surfaces the
  prior gap named, and e2e/__screenshots__/ is still absent (F7). No longer the SOLE blocker (functional_reality
  is now the binding one).

**Issues to reconcile:** file a NEW `quality: functional_reality C -> raise to A` (persistence blocker; #199
was closed last cycle — this is a fresh, distinct root cause). Update design_taste **#204** (still B, narrowed,
no longer sole blocker). File/update artifact_integrity + the security IDOR sub-gap. Keep #385 (perf) and #200
(tests) open, unchanged.

**Lessons for next run:**
1. **VERIFY THE DATA LAYER BEFORE GRADING functional_reality.** This repo runs entirely on the in-memory store
   for DATA (real Supabase = auth only). A green money-path E2E is a SINGLE-PROCESS signal — it does not prove
   production persistence. Grade functional reality on whether user data survives a serverless cold start, not
   on E2E status alone. The prior four cycles graded the render and missed the persistence layer.
2. Don't let a literal rubric mechanical signal (E2E green → A) override the deeper "does it actually work in
   prod" question — the rubric is explicit that a grade may not exceed what the evidence supports, and BUILDS≠WORKS.
3. The perf N+1 (#385) is INERT under the memory store (in-process array ops; MemoryClient.rpc is a no-op) — a
   pgvector RPC would be dead code until the real-DB migration. Sequence perf-DB fixes WITH that migration, not before.
4. Cold-start recipe re-confirmed: npm install first; grade on assertions + CI status, never a cold local authed
   suite (env-fragile). preflight's functional-journeys + OWNER_ACTIONS failures are the honest RED flags this run.

---

## 2026-07-05 — FOURTH INDEPENDENT GRADE (functional_reality C→A; overall breaks off C→B; design_taste is the LAST ship-critical blocker)

**Overall: B · ship_gate_met: false.** The headline finally MOVED off C — held for three prior cycles.
**functional_reality C→A** closed the long-standing binding constraint (the core money-path had no
outcome-asserting runtime E2E that actually RAN). Now **design_taste (B) is the SOLE ship-critical
dimension below A** and the only thing between overall B and `ship_gate_met: true` — every other
ship-critical dim is A/A+.

**Per-dimension diff vs 2026-07-03:** functional_reality **C→A** ⬆⬆ · correctness **A→A** · security_rls
**A+→A+** · design_taste **B→B** (both capping gaps persist) · store_readiness **A→A** ·
artifact_integrity **A→A** · business_case_strength **A→A** · tests_evals **B→B** · performance **B→B**.

**Mechanical signals actually run this cycle (cold start, npm install first):**
- `npx tsc --noEmit` → clean · `npx eslint .` → clean · `npm run check:determinism` → green.
- `npm test` → **1775 passed / 11 skipped** (up from 1544; 11 skips are RUN_EVALS-gated by design).
- `npx vitest run --coverage` → **56.21% stmts / 45.08% branch / 60.21% funcs / 57.32% lines** (up from
  ~53%), well above the 40/30/42/40 floor.
- `npx vitest run __tests__/integration/render-pipeline-cassette.test.ts` → **2 passed** (the hermetic
  per-PR money-path test).
- CI: the "CI" workflow is **GREEN on main** (run 28735583211, head c5f01c14). The `journeys` job runs
  the AUTHED tier (E2E_AUTH_STACK=1 + ephemeral Supabase, full run-journeys.sh) — an unconditional,
  no-continue-on-error job — so a green CI run means the authed money-path + paywall-unlock E2E PASSED,
  not skipped. This is the key delta: the authed tier is now CI-runnable and demonstrably green (it was
  UNVERIFIABLE cold in every prior cycle).

**Why functional_reality raised C→A (verified by a fresh adversarial grader that did NOT write the code):**
- **Hermetic per-PR layer:** `__tests__/integration/render-pipeline-cassette.test.ts` runs in `npm test`,
  drives the REAL render glue (buildMockupContext→generateMockupPrompt→generateMockupImage; only the LLM
  boundary is mocked), and terminally decodes the output to a REAL PNG (signature + non-zero IHDR dims).
  A 2nd case proves the cassette THROWS on an unrecorded stage (no silent fallback).
- **Authed-browser-in-CI layer:** `journeys.spec.ts:227` POSTs `/api/mockups` through the real route and
  asserts a real decodable PNG; `:201` seeds the real stripe_customers row and asserts the ENTITLEMENT
  FLIP (`/api/billing/status` hasPaid===true + free-tier CTA gone); `:175` asserts a real checkout button.
- **Fail-closed for prod:** `gemini.ts:813-822 assertCassetteSafe()` refuses to boot if E2E_AUTH_STACK=1
  on a Vercel deploy; a regression test (`cassette-guard.test.ts`) pins it.
- **A, not A+:** the E2E seeds the recommendation_mockup payload via API and drives only the RENDER leg
  through the browser; the upstream photo-upload→understand→diagnose→source UI legs aren't yet one authed
  browser walk. That's the remaining A→A+ item — bounded, not ship-blocking.

**Why the other dimensions held:**
- **design_taste B:** both capping gaps UNCHANGED — a11y.spec.ts still axe-covers ONLY the 7 public pages
  (zero authed AxeBuilder despite journeys.spec having a full login fixture); `e2e/__screenshots__/` still
  absent (F7). The a11y PRs (#420/#437/#438) strengthen the pages but don't touch the capping axis.
- **performance B (held, NOT dropped):** a fresh grader proposed "C+" citing lack of progress, but (a) C+
  isn't a valid grade and (b) the rubric is criterion-referenced (rule 5: same state → same grade) — a
  letter is not decayed merely because a cycle passed with no change. The STATE is materially the same as
  the three prior B cycles: a single named, non-blocking N+1 (embedding-index full-table scan, ivfflat
  index unused) on a non-ship-critical path; raw `<img>` even dropped 13→6. Held B and documented the
  reasoning explicitly so it reads as discipline, not inflation.
- **tests_evals B:** CI verify still runs bare `vitest run` (no --coverage) so the floor never gates CI;
  live-eval.yml exists but can't be shown green here (owner keys, weekly-only).

**Issues reconciled:** functional_reality #199 → CLOSED (raised to A; gap closed). design_taste #204 →
updated (still B, now the SOLE ship-critical blocker; priority raised). tests_evals #200 and performance
#385 → updated (still B, gaps unchanged/narrowed).

**Lessons for next run:**
1. The ship gate is now ONE dimension away. design_taste → A takes exactly two well-scoped changes
   (already named in #204): an authed AxeBuilder pass over dashboard/diagnosis/mockups/compare behind the
   existing journeys login fixture, and `toHaveScreenshot` baselines in `e2e/__screenshots__/` (light+dark,
   empty/error). Land both and overall → A/A+ with ship_gate_met true.
2. Cold-start recipe re-confirmed: npm install first. The authed journeys tier is NO LONGER unverifiable —
   grade functional_reality on the CI `journeys` job result (green on main) plus the hermetic per-PR test,
   both of which have real PNG-decode/entitlement teeth. But still grade on ASSERTIONS present + CI status,
   never on a cold local suite run (env-fragile).
3. Resist "no-progress → lower grade" pressure on stable dimensions. Criterion-referenced grading means an
   unchanged state keeps its letter; only a changed state moves it. Document the call to keep it honest.

---

## 2026-07-03 — THIRD INDEPENDENT GRADE (two ship-critical dims raised; overall STILL gated by functional_reality)

**Overall: C · ship_gate_met: false.** Overall is UNCHANGED from the 2026-06-29/07-01 baseline, but the
per-dimension picture improved again: **correctness B→A** and **security_rls A→A+**, closing two of the
three remaining ship-critical gaps below A. After this cycle only **TWO ship-critical dimensions remain
below A: functional_reality (C) and design_taste (B)** — down from four last cycle. Overall stays C
because the rubric caps the headline at the weakest ship-critical link, and **functional_reality is still
C** with NO delta this cycle — the core money path (photo→REAL mockup) and paywall→checkout→unlock still
have no outcome-asserting runtime E2E (BUILDS≠WORKS).

**Per-dimension diff vs 2026-07-01:** functional_reality **C→C** (no delta) · correctness **B→A** ⬆ ·
security_rls **A→A+** ⬆ · design_taste **B→B** (aria-live wins landed, 2 capping gaps remain) ·
store_readiness **A→A** · artifact_integrity **A→A** · business_case_strength **A→A** · tests_evals
**B→B** (2 of 3 prior gaps closed) · performance **B→B** (headline N+1 unchanged).

**Mechanical signals actually run this cycle (cold start, npm install first):**
- `npx tsc --noEmit` → clean · `npx eslint .` → clean · `npm run check:determinism` → green.
- `npm test` → **1544 passed / 11 skipped** (up from 1350/8; the 11 skips are RUN_EVALS-gated by design).
- `npx vitest run --coverage` (via grader) → **52.95% stmts / 41.73% branch / 54.06% lines** (up from
  ~48%), comfortably above the raised 40/30/42/40 floor; lib/agents ~39%.
- Public journey suite did NOT demonstrably pass cold this cycle (`run-journeys.sh --public-only` → 1
  pass / 6 skip / 6 fail; the 6 fails are dummy-key /waitlist-redirect env artifacts, NOT product
  defects — graded on what ran, never assumed green). Authed tier + live evals remain UNVERIFIABLE cold.

**What the factory fixed since last grade (verified this run):**
- **correctness → A:** app/api/computer-use/product-verify/route.ts:24 now has `maxDuration = 300`, AND
  product-verifier.ts:274 enforces `maxWallClockMs: 270_000` (stops ~30s before the route budget). The
  full maxDuration sweep is clean — every long-external-call route is now capped. Prior sole gap CLOSED.
- **security_rls → A+:** scripts/preflight.sh:500-577 GATE 6 now MECHANICALLY asserts RLS coverage
  (Python parse: 26/26 public tables enable RLS, fails safe on the do-block convention) + a client-secret
  leak grep (NEXT_PUBLIC_* and, per #371, EXPO_PUBLIC_*). The sole A→A+ item (a mechanical gate replacing
  migration review) is CLOSED; zero findings.
- **design a11y (partial):** diagnosis progress announces via aria-live (#330); auth errors via
  role="alert" (#368, mobile #369). But e2e/a11y.spec.ts still covers ONLY 7 public pages and
  e2e/__screenshots__/ still absent (F7) → stays B.
- **tests_evals (partial):** live-eval.yml CI job exists (RUN_EVALS weekly/on-demand); refine.eval is now
  a REAL live call; mockup.eval added (#334); coverage floor raised near reality. Remaining: CI verify
  still runs bare `vitest run` (no --coverage); live-eval can't be shown green here → stays B.
- **performance:** headline N+1 (embedding-index full-table select('*') per crop; ivfflat index unused)
  UNCHANGED; no perf budget → stays B.

**Headline reasoning (why overall stays C):** functional_reality is now the SOLE ship-critical dimension
that gates the headline (design_taste at B is the only other ship-critical below A, but functional_reality
at C is the binding constraint). journeys.spec.ts:149-153 asserts only onboarding ENTRY and :169-175 only
that /billing/upgrade renders a heading — the actual mockup image and the entitlement flip are never
asserted, and ROUTE_INVENTORY.md still admits both as tracked gaps. Until a CI-runnable test asserts a
REAL mockup and a checkout→unlock, the core paid journey is runtime-unvalidated and the headline cannot
exceed C.

**Issues reconciled:** CLOSED correctness #201 (now A). Updated functional #199 (still C, now the SOLE
binding blocker), design #204 (still B; aria-live wins noted, remaining = authed axe + F7 screenshots),
tests #200 (retitled C→B; 2 of 3 gaps closed). Filed a new performance issue (N+1 embedding-index + no
perf budget — previously untracked).

**Lessons for next run:**
1. The ship gate is now one dimension from moving: fix functional_reality and design_taste both to A and
   overall jumps to A/A+ (every other ship-critical dim is already A/A+). Both fixes are well-scoped and
   already named in open issues.
2. functional_reality had ZERO delta this cycle despite broad activity elsewhere — the factory keeps
   picking lower-effort wins (a11y, maxDuration, preflight gates) over the hard, highest-leverage E2E work.
   The single most valuable next change is a recorded-provider + Stripe-test-mode core-flow assertion.
3. Cold-start recipe re-confirmed: npm install first, dummy .env.local. Note the public journey suite is
   now sensitive to the dummy-key /waitlist redirect — its cold "green" is environment-fragile, so grade
   functional_reality on the ASSERTIONS present in the specs, not on a cold suite run.

---

## 2026-07-01 — SECOND INDEPENDENT GRADE (broad ship-critical progress; overall still gated by functional_reality)

**Overall: C · ship_gate_met: false.** Overall is UNCHANGED from the 2026-06-29 baseline, but the
per-dimension picture improved substantially: **4 ship-critical dimensions are now A** (security_rls,
store_readiness, artifact_integrity, business_case_strength) vs only 1 (artifact_integrity) last cycle.
Overall stays C because the rubric caps the headline at the weakest ship-critical link, and
**functional_reality is still C** — the core money path (photo→REAL mockup) and paywall→checkout→unlock
have no outcome-asserting runtime E2E (BUILDS≠WORKS).

**Per-dimension diff vs 2026-06-29:** functional_reality **C→C** · correctness **B→B** (much closer to A)
· security_rls **B→A** ⬆ · design_taste **B→B** (2 of 4 gaps closed) · store_readiness **B→A** ⬆ ·
artifact_integrity **A→A** · business_case_strength **B→A** ⬆ · tests_evals **C→B** ⬆ · performance **B→B**.

**Mechanical signals actually run this cycle (cold start, npm install first):**
- `npx tsc --noEmit` → clean · `npx eslint .` → clean · `npm run check:determinism` → green.
- `npm test` → **1350 passed / 8 skipped** (up from 1183; 8 skips are RUN_EVALS-gated by design).
- `scripts/run-journeys.sh --public-only` → **7 passed**, 6 authenticated SKIPPED (still need
  E2E_AUTH_STACK + seeded Supabase; cannot run cold).
- `npx vitest run --coverage` (via grader) → **48.7% stmts / 37.7% branch overall, lib/agents 35%**
  (up from ~21%). vitest floor 25/19/30/25 still far below actual and CI never runs --coverage.

**What the factory fixed since last grade (verified this run):**
- **security G1 CLOSED** (PR #274/#275 chain): products/evaluate + evaluate-set now call checkRateLimit +
  checkDailySpend before any LLM call; swept — every authed LLM route now carries both guards. → A.
- **store privacy defect FIXED** (PR #280): privacy page no longer lists phantom Anthropic/OpenAI; every
  named processor cross-checked to a real dependency. Contact email canonicalized (#264). → A.
- **business levers BUILT** (migration 026 + lib/waitlist/referral.ts + upgrade-cta-card): referral invite/
  reward + upsell surface are now real code, not templates; organic share re-grounded 50%→40%. → A.
- **correctness maxDuration**: now on all 17 mainline pipeline routes (was 0). ONE route still missing —
  computer-use/product-verify (agentic browser loop). Still B until that + an overall cap land.
- **design a11y**: toast now announces via Radix foreground/background; app/not-found.tsx added. Remaining:
  no authed axe coverage, e2e/__screenshots__/ still absent (F7). Still B.
- **perf**: grounding pair now Promise.all. Headline gap unchanged — embedding-index topKSimilar still does
  N full-table select('*') scans, ivfflat index unused. Still B.
- **tests_evals**: 4 real live evals now hit the real pipeline; coverage up. Still no RUN_EVALS CI job / no
  --coverage gate / refine eval still mislabeled. C→B.

**Headline reasoning (why overall stays C):** The single blocker is functional_reality. journeys.spec.ts
asserts only the onboarding ENTRY (:149-153) and that /billing/upgrade renders a heading (:169-175) — the
actual mockup image and the entitlement flip are never asserted, and ROUTE_INVENTORY.md admits both as
tracked gaps. Until a CI-runnable test asserts a REAL mockup and a checkout→unlock, the core paid journey
is runtime-unvalidated and the headline cannot exceed C, regardless of how strong the other dimensions are.

**Issues reconciled:** closed/updated the per-dimension quality issues from the levers that reached A
(security #202, store #203, business #205); updated the still-open ones (functional #199, correctness #201,
design #204, tests #200) with the current, narrowed gap.

**Lessons for next run:**
1. Progress is real but the ship gate is binary on the weakest ship-critical link — 4→A is worth noting in
   memory, but overall correctly stayed C. Do NOT let broad B→A progress tempt an inflated headline.
2. functional_reality is now the ONLY thing between C and a B/A headline. The fix is well-scoped: recorded/
   deterministic provider fixtures + Stripe test-mode so the core flow + checkout assert real outcomes in CI.
3. Re-confirmed cold-start recipe works: npm install, then .env.local with DUMMY Supabase/Gemini/DeepSeek
   keys before the public journey suite. Authed tier + live evals remain UNVERIFIABLE cold — grade on what
   ran, never assume green.

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
