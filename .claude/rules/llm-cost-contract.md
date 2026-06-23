---
description: >
  Load-bearing LLM cost rules. Read before touching any provider/model
  selection, .chat() call, thinkingConfig, escalation ladder, gemini.ts,
  deepseek.ts, or the harness-ratchet / provider-floors tests.
---

# LLM cost contract (expanded)

The short version lives in `AGENTS.md`. This is the full reasoning so the rules
are not cargo-culted. Every rule below is guarded by a test — if you change the
behavior, the test fails by design; add the config, do not relax the test.

## Cheapest by default
- Text tasks default to `TEXT_TIERS.base` = `gemini-2.5-flash-lite`.
- Provider thinking defaults: Gemini → `low`, DeepSeek → reasoning **off**.
- There is no global forced-HIGH default. If you find yourself adding one, you
  are solving the wrong problem — escalate per-call instead (see below).

## Explicit thinkingConfig on every call
- Every `.chat({...})` passes an explicit `thinkingConfig`, via
  `thinkingFor(task)` in `lib/ai/thinking.ts`.
- A new `.chat()` call without it fails `__tests__/ai/harness-ratchet.test.ts`.
  That test is the ratchet — it exists so cost can only go down silently, never
  up. Add the config to the new call; never weaken the test.

## Where HIGH is allowed
Keep HIGH thinking ONLY where there is no cheap deterministic verifier to catch
a bad answer:
- apartment / room understanding
- diagnosis
- area-analysis Pass A / Pass B
- floor-plan extraction

Everything else — validation, scoring, bundles, extraction, screening — runs
cheap and escalates only on a deterministic signal.

## Escalation is deterministic, never speculative
- Escalate inside loops only on deterministic triggers: the math layer, a Zod
  parse failure, or oscillation / velocity counters, via
  `lib/agents/escalation-ladder.ts`.
- The `verify()` passed to `escalate()` MUST NOT call an LLM. If verification
  needs a model, it is not a deterministic trigger and does not belong here.

## Floors move together
- Provider/model floor changes in `gemini.ts` and `deepseek.ts` change
  together, guarded by `__tests__/ai/provider-floors.test.ts`. Bump one, bump
  the other, update the test in the same commit.

See `lib/ai/thinking.ts`, `lib/agents/escalation-ladder.ts`, and
`ARCHITECTURE.md` (maker/checker loops) for how this fits together.
