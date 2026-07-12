# Margin eval — statistical cost-per-outcome per AI workflow

These suites exist so **Margin** gets an accurate, *statistical* cost-per-outcome
for AptDesignerAI's AI workflows — not a single anecdote. Each suite runs a
representative **input matrix** through a REAL metered pipeline (the same entry
the app route uses), lets the live Gemini/DeepSeek providers emit their per-call
economics via the `margin-meter` SDK (exactly as in production), grades each run
against that workflow's genuine success signal, and emits the graded outcome.
Margin then has real `calls + outcomes` per workflow to compute productivity ÷
AI-spend and auto-tune on.

See **`COVERAGE.md`** for the full workflow census and the ranked frontier of
what to eval next.

## Suites (`--workflow`)

| Suite | Workflow id | Metered entry | Genuine outcome signal |
| --- | --- | --- | --- |
| `search` | `aptdesigner-search` | `runAgenticSearch` | `validation.isValid` + `validation.confidence/10` |
| `fit-scoring` | `aptdesigner-fit-scoring` | `scoreProduct` | `final_item_score/10` (pass ≥ 6) + `confidence_score` |
| `diagnosis` | `aptdesigner-diagnosis` | `runRoomDiagnosis` | `success` (room-type gate) + diagnosis completeness |

Each suite is a curated matrix + a seeded fuzz/boundary tail + a genuine grader
that is never always-pass (good inputs must score well, bad/adversarial inputs
must score poorly — asserted where a defined outcome exists).

## Files

| File | Role |
| --- | --- |
| `evals/margin/suites.ts` | Suite **registry** — `search`, `fit-scoring`, `diagnosis` (+ `selectSuites`). |
| `evals/margin/suite.ts` | The `Suite` interface the runner drives generically. |
| `evals/margin/cases.ts` | Search **input matrix** (~67 cases) — room type × budget × #images × image quality × style, + a seeded fuzz tail. |
| `evals/margin/search-suite.ts` / `fit-scoring.ts` / `diagnosis.ts` | The three suites: matrix + grader + real-metered-path `runCase`. |
| `evals/margin/grade.ts` | Shared `Grade` + `summarize` + the search grader. |
| `evals/margin/prng.ts` | Seeded mulberry32 PRNG for reproducible fuzz cases. |
| `scripts/margin_eval.ts` | The **runner** — `--workflow <name>` or run-all; cost-capped, CI-guarded. |
| `__tests__/evals/margin-eval.test.ts` | Pure unit coverage (no network) proving every suite's matrix is varied and its grader distinguishes good from bad. Runs in the normal `npm test`/CI gate. |

## What the grader measures (the real signal)

`runAgenticSearch` returns `validation: { isValid, confidence, issues }`, computed
by the pipeline itself (deterministic bundle-math blended with the LLM
requirement audit — see `lib/agents/orchestrator.ts` ~3284–3341):

- **passed** = `validation.isValid` — the genuine pass/fail. The orchestrator
  forces `isValid = false` when the bundle total exceeds `budgetDollars`, which
  is why the **impossible-budget** cases can be asserted to fail.
- **qualityScore** = `validation.confidence / 10` (0–1) — the graded quality.

A case that errors or finds zero candidates grades as a **failed** outcome with
quality 0 — never silently passed.

## Running (on-demand only)

Requires real keys and makes real, paid LLM + web-search calls. **Never runs in
CI** (the runner refuses when `CI` is set or keys are missing — zero calls).

```bash
# Run ALL suites (default). Gemini-only auto-selects when no DeepSeek key.
MARGIN_INGEST_URL=https://margin-ai-rho.vercel.app \
MARGIN_INGEST_KEY=mgk_…          \
GEMINI_API_KEY=…                 \
TAVILY_API_KEY=…                 \
MARGIN_EVAL_MAX_CASES=4          \
MARGIN_EVAL_USD_CAP=5            \
npx tsx scripts/margin_eval.ts --workflow all

# Or just one workflow:
… npx tsx scripts/margin_eval.ts --workflow fit-scoring
… npx tsx scripts/margin_eval.ts --workflow diagnosis
```

`fit-scoring` and `diagnosis` do **not** need `TAVILY_API_KEY` (no product
search) — but the runner still requires it up front because the default run-all
includes `search`. Pass `--workflow fit-scoring` and set a dummy `TAVILY_API_KEY`
if you only want the non-search suites.

### Config knobs (env)

| Env | Default | Meaning |
| --- | --- | --- |
| `--workflow <name>` (CLI arg) | `all` | `search` \| `fit-scoring` \| `diagnosis` \| `all`. |
| `MARGIN_INGEST_URL` / `MARGIN_INGEST_KEY` | — | Margin ingest endpoint + per-project key. If the key is absent the run still executes and grades **locally** but emits nothing (warned). |
| `GEMINI_API_KEY` | **required** | Vision + pipeline (whole pipeline under `AI_PROVIDER=gemini`). |
| `TAVILY_API_KEY` | **required** | Product web search (search suite). |
| `DEEPSEEK_API_KEY` | — | Enables the default DeepSeek text path; without it the runner forces `AI_PROVIDER=gemini`. |
| `AI_PROVIDER` | `gemini` (auto) | **Candidate/config override** — `gemini` or `deepseek`. Re-run under a different provider to compare cost-per-outcome of a candidate config. |
| `MARGIN_EVAL_MAX_CASES` | `6` | **Per-suite** case cap. |
| `MARGIN_EVAL_USD_CAP` | `5` | Rough GLOBAL $ cap (conservative local token estimate; stops before the next case once exceeded). Margin computes the *real* cost server-side. |
| `MARGIN_EVAL_FILTER` | — | Substring match on case id, or a difficulty (`easy`/`medium`/`hard`), to run a slice. |

### How eval traffic is separated + attributed per workflow

The runner sets `MARGIN_SESSION_ID=eval:<runid>` before loading the meter, so
**every provider call it triggers is tagged** with that batch id (`session_id`);
production traffic is untagged. For run-all, it also sets `MARGIN_WORKFLOW_ID` per
suite so each suite's calls (which the providers otherwise all emit as
`aptdesigner-search`) are re-attributed to that suite's workflow id, and the
outcome is emitted under the same id. Both env vars are eval-only and inert in
prod/CI (declared in `validation/CAPABILITIES.yml`). Re-running under a different
`AI_PROVIDER` produces a new `eval:<runid>` batch you can compare in Margin.

## CI guard

- The runner **refuses to run** (no calls, exit 0) under `CI` or without keys.
- No CI workflow invokes it — it is on-demand / scheduled only.
- The only thing that runs in CI is the **pure** unit test above (no network).
- New env read by app code (`MARGIN_SESSION_ID`) is declared in
  `validation/CAPABILITIES.yml`, so the `validate-capabilities` gate stays green.

## Honesty — the faithful slice and the gap

**Faithful:** `runAgenticSearch` is pure compute/LLM/web — it touches **no
Supabase/DB** (all DB I/O lives in the route, before/after the call). So the
runner drives the *entire real search workflow* — brief → Tavily search →
extract → quick+deep vision scoring → bundle → validation — with real inputs and
the real providers. The economics and the outcome are genuine, not simulated.

**Documented gaps (not faked):**

1. **Requires `TAVILY_API_KEY` + `GEMINI_API_KEY` + network + real spend**, hence
   on-demand only. With Tavily absent the pipeline finds no products; the runner
   fail-safe-skips rather than emit meaningless data.
2. **Upstream area-analysis/diagnosis is out of scope.** In production the room
   is diagnosed first (a separate route/workflow); here `style` is supplied via
   the brief text and `budgetMode`/`budgetDollars` directly. This isolates the
   *search* workflow's cost-per-outcome (workflow_id `aptdesigner-search`),
   which is what we're measuring.
3. **Outcomes can't carry `session_id`** (the SDK's `recordOutcome` has no such
   field), so only the *calls* are batch-tagged; Margin joins calls↔outcomes by
   workflow + time. Per-call tagging is what matters for cost attribution.
4. **Images are representative interiors**, not the user's own room; the
   image-quality/#images dimensions are encoded via width/quality params and
   repetition. Swap in more diverse real photos by editing the `IMG` pool in
   `cases.ts`.
