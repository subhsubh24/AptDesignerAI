# AGENTS.md

Operating rules for AI agents working in this repo. Short on purpose — every
line traces to a real failure or a hard constraint (the ratchet). Add a line
only after something actually went wrong; remove one only when a guard makes it
redundant.

## Commands
- Install: `npm install`
- Test: `npm test` (vitest) · single file: `npx vitest run <path>`
- Type check: `npx tsc --noEmit` · Lint: `npx eslint .`
- Evals: `npm run eval` · Determinism: `npm run check:determinism`
- CI runs all of the above; it must be green before merge.

## LLM cost contract (load-bearing — do not regress)
<important if="touching provider/model selection, a .chat() call, thinkingConfig, escalation, gemini.ts, deepseek.ts, or the harness-ratchet/provider-floors tests">
Full reasoning + the test ratchets: `.claude/rules/llm-cost-contract.md`. These
rules are guarded by tests by design — add config, never relax the test.
</important>
- **Cheapest by default.** Text tasks default to `TEXT_TIERS.base`
  (`gemini-2.5-flash-lite`). Providers default to cheap thinking: Gemini → `low`,
  DeepSeek → reasoning off. Never restore a forced-HIGH global default.
- **Every `.chat({...})` call passes an explicit `thinkingConfig`.** Use
  `thinkingFor(task)` from `lib/ai/thinking.ts`. A new call without it fails
  `__tests__/ai/harness-ratchet.test.ts`. Don't relax that test — add the config.
- **Keep HIGH only where there is no cheap verifier:** apartment/room
  understanding, diagnosis, area-analysis Pass A/B, floor-plan extraction.
  Everything else (validation, scoring, bundles, extraction, screening) runs
  cheap and escalates on a deterministic signal.
- **Escalate in loops only on deterministic triggers** (math layer, Zod parse
  failure, oscillation/velocity counters) via `lib/agents/escalation-ladder.ts`.
  The `verify()` passed to `escalate()` must never call an LLM.
- Provider/model floor changes in `gemini.ts` and `deepseek.ts` move together,
  guarded by `__tests__/ai/provider-floors.test.ts`.

## Determinism
<important if="adding/modifying any LLM call, agent loop, sampling/sort/tiebreak, or cache">
Full checklist of what silently breaks reproducibility:
`.claude/rules/determinism.md`.
</important>
- All LLM calls pass `seed: DETERMINISTIC_SEED`. Thread seeds through new loops;
  `npm run check:determinism` must stay green.

## Conventions
- Reuse the provider via `getProvider(task)` / `geminiProvider`; never call the
  SDK directly. Read response text from `response.content` (not `.text`).
- Cost observability: wrap pipeline entries in `withCostLedger` and record
  stage cost with `recordUsage(stage, model, usage, opts)` from
  `lib/observability/cost-meter.ts`. It is a no-op outside a ledger, so it's
  always safe to add at a new call site.
- Match surrounding code style; do not introduce new frameworks or deps without
  reason.

## Architecture
See `ARCHITECTURE.md` for how the pipeline maps to maker/checker loops, the
deterministic validators (the enforcement layer), state, and observability.
