# Architecture

How AptDesignerAI's pipeline maps onto **agent harness engineering** and **loop
engineering** (Osmani, 2026). The model is one input; the harness — the
validators, loops, state, routing, and observability around it — is where the
reliability and cost behavior live. This doc names each component's job so we
add scaffolding only where the model can't be trusted on its own, and remove it
when a guard makes it redundant.

## Runtime pipeline (request → response)

```
POST /area-analysis ──► runAnalysis (wrapped in withCostLedger)
  Pass A  room understanding ........ self-consistency (N samples + judge), HIGH
  Pass B  furnishing list ........... single generation + enrichment, HIGH
  Validation gauntlet (6 gates) ..... photo-grounding, reconciliation, self-review,
                                      hallucination filter, keep-item injection
  Harmony loop ...................... maker/checker, iterates to convergence (cheap+escalate)
  Final assessment .................. math-blended per-item scoring
  Design coordinator ................ agentic planner (optional, post-convergence)

POST /search/stream ──► runAgenticSearch (orchestrator)
  plan categories → search brief → parallel search + dedup → quick-screen →
  rerank → extract (+ computer-use fallback) → quick-score → deep-score →
  validate + bundle ──► post-search coordinator
```

## Loop engineering — the six building blocks

| Block | In this codebase | Notes |
|---|---|---|
| **Automations** | In-pipeline loops triggered per request (harmony loop, coordinators) | No *scheduled* dev-automations — this is a request/response product, not a background agent farm. Intentionally N/A. |
| **Worktrees (parallel isolation)** | `pLimit` fan-out over search queries and self-consistency samples | Parallelism is per-request data fan-out, not multi-agent repo edits. |
| **Skills (codified knowledge)** | System prompts (`lib/prompts/`), dynamic design profiles (`lib/design-context/`), `AGENTS.md` | This is the intent-debt cure: project knowledge written down so agents don't re-guess each run. |
| **Connectors (MCP analog)** | Tavily (search/extract), Gemini tools (`googleSearch`, `codeExecution`, `googleMaps`, `urlContext`), computer-use, Supabase | The loop acts on real systems, not just the filesystem. |
| **Sub-agents (maker/checker)** | See table below | The single most load-bearing structural pattern here. |
| **State / memory** | Supabase (`room_diagnoses`, `search_sessions`, `projects`), `agent-runs`, per-round best-version tracking | Survives between turns; the model forgets, the store doesn't. |

## Maker / checker splits (the verifier is a *different* thing)

| Maker | Checker (deterministic unless noted) |
|---|---|
| `validateRoomHarmony` (harmony scores) | `harmony-math` + `harmony-composite` + oscillation/velocity/stale counters |
| Self-consistency generator (Pass A) | Judge LLM with a *different* prompt framing |
| Area-analysis output | `lib/validation/` (~20 modules: spatial graph, ergonomics, outlet reach, code compliance, budget, saturation…) |
| Self-correction subject | `self-correction.ts` reviewer + hard guards |
| Complexity router (sets the cheap floor) | Escalation ladder (raises tier only on deterministic reject) |

The deterministic validators in `lib/validation/` are the **enforcement layer** —
the "mechanical architecture enforcement" that replaces trusting the model. A
cheap model is safe precisely because these catch a shallow answer and force a
re-run rather than shipping it.

## Harness primitives

- **The ratchet.** Every observed failure becomes a permanent guard, not a
  retry. The forced-HIGH-thinking default (top-tier cost on ~60 structured-output
  call sites) is now locked cheap by `__tests__/ai/harness-ratchet.test.ts` and
  `__tests__/ai/provider-floors.test.ts`, plus the rules in `AGENTS.md`.
- **Durable state.** Supabase + `agent-runs` stand in for filesystem/git as the
  out-of-context memory; harmony tracks the best version per item across rounds.
- **Context-rot mitigation.** Vision `cacheScope` amortizes room/floor-plan
  tokenization across samples and harmony rounds; validators chunk large item
  sets; context is grounded once and reused, not rebuilt per call.
- **Long-horizon execution.** The harmony loop is a bounded Ralph-loop analog:
  it re-runs against a convergence goal, restores the best version on
  stall/oscillation, and exits on velocity/target/safety limits. The
  design-coordinator is the planner/generator/evaluator split applied to "are we
  done?".
- **Cost routing.** Layer 1 (`lib/ai/complexity-router.ts`) classifies once per
  run and sets the floor; Layer 2 (`lib/agents/escalation-ladder.ts`) raises the
  tier per-item only when a deterministic `verify()` rejects the cheap output.
- **Observability.** Logs (`lib/logging/`), traces with optional OTel
  (`lib/observability/tracing.ts`), funnel counts (`pipeline-trace.ts`), and
  per-stage token/cost metering (`lib/observability/cost-meter.ts`).

## Where to extend
- New LLM call → `getProvider(task).chat({ … thinkingFor(task) })`, then
  `recordUsage(stage, model, response.usage, …)`.
- New loop → bound it with a deterministic stop condition + best-version restore;
  escalate via `escalate()` with an LLM-free `verify()`.
- New invariant the model keeps violating → add a `lib/validation/` check and a
  line to `AGENTS.md`. Ratchet; don't brainstorm.
