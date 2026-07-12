# Margin eval — statistical cost-per-outcome for `aptdesigner-search`

This suite exists so **Margin** gets an accurate, *statistical* cost-per-outcome
for AptDesignerAI's core workflow — not a single anecdote. It runs a
representative **input matrix** through the REAL metered search pipeline
(`runAgenticSearch`, the same orchestrator `/api/search` uses), lets the live
Gemini/DeepSeek providers emit their per-call economics via the `margin-meter`
SDK (exactly as in production), grades each run against the genuine success
signal, and emits the graded outcome. Margin then has real `calls + outcomes`
to compute productivity ÷ AI-spend and auto-tune on.

## Files

| File | Role |
| --- | --- |
| `evals/margin/cases.ts` | The **input matrix** — ~57 cases varying **room type × budget × #images × image quality × style**, easy→hard, good-fit→bad-fit. Real, fetchable Unsplash room photos (the deep-scorer downloads them for vision). |
| `evals/margin/grade.ts` | The **grader** — `passed = validation.isValid`, `qualityScore = validation.confidence/10`. Not always-pass; asserts a defined outcome where one exists (impossible budget → must fail) and flags misses. |
| `scripts/margin_eval.ts` | The **runner** — drives each case through the real metered path, grades it, emits the outcome, cost-capped and CI-guarded. |
| `__tests__/evals/margin-eval.test.ts` | Pure unit coverage (no network) proving the matrix is varied and the grader genuinely distinguishes good bundles from bad. Runs in the normal `npm test`/CI gate. |

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
# Minimal Gemini-only run (auto-selects AI_PROVIDER=gemini when no DeepSeek key):
MARGIN_INGEST_URL=https://margin-ai-rho.vercel.app \
MARGIN_INGEST_KEY=mgk_…          \
GEMINI_API_KEY=…                 \
TAVILY_API_KEY=…                 \
MARGIN_EVAL_MAX_CASES=8          \
MARGIN_EVAL_USD_CAP=5            \
npx tsx scripts/margin_eval.ts
```

### Config knobs (env)

| Env | Default | Meaning |
| --- | --- | --- |
| `MARGIN_INGEST_URL` / `MARGIN_INGEST_KEY` | — | Margin ingest endpoint + per-project key. If the key is absent the run still executes and grades **locally** but emits nothing (warned). |
| `GEMINI_API_KEY` | **required** | Vision deep-scoring (and the whole pipeline under `AI_PROVIDER=gemini`). |
| `TAVILY_API_KEY` | **required** | Product web search. Without it the pipeline finds 0 candidates. |
| `DEEPSEEK_API_KEY` | — | Enables the default DeepSeek text path; without it the runner forces `AI_PROVIDER=gemini`. |
| `AI_PROVIDER` | `gemini` (auto) | **Candidate/config override** — `gemini` or `deepseek`. Re-run under a different provider to compare cost-per-outcome of a candidate config. |
| `MARGIN_EVAL_MAX_CASES` | `8` | Hard case cap. |
| `MARGIN_EVAL_USD_CAP` | `5` | Rough $ cap (conservative local token estimate; stops before the next case once exceeded). Margin computes the *real* cost server-side. |
| `MARGIN_EVAL_FILTER` | — | Substring match on case id, or a difficulty (`easy`/`medium`/`hard`), to run a slice. |

### How eval traffic is separated from production

The runner sets `MARGIN_SESSION_ID=eval:<runid>` before loading the meter, so
**every provider call it triggers is tagged** with that batch id
(`session_id`). Production traffic is untagged. Re-running under a different
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
