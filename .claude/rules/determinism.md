---
description: >
  Determinism rules. Read before adding or modifying any LLM call, agent loop,
  sampling/sort/tiebreak, cache, or anything that affects reproducibility.
  Required when `npm run check:determinism` is involved.
---

# Determinism (expanded)

Reproducible runs are a product requirement, not a nicety — the pipeline is a
maker/checker system and non-determinism makes the checkers untrustworthy.

## Seed every call
- All LLM calls pass `seed: DETERMINISTIC_SEED`.
- New loops must thread the seed through every call they introduce. A loop that
  spawns calls without the seed is a regression even if output looks stable.
- `npm run check:determinism` (`scripts/check-determinism.ts`) must stay green.

## Things that silently break determinism (audit when touched)
- **Temperature / sampling** — route through `resolveTemperature()` /
  `resolveSeed()`; do not hardcode.
- **Map ordering** — when fanning out with `Promise.all`, key results back to a
  stable order; never depend on completion order.
- **Sorts** — every sort needs a deterministic final tiebreaker (id/slug), not
  just the primary score.
- **Caches** — semantic/embedding caches are bypassed under the `DETERMINISTIC`
  flag. A cache that returns under deterministic mode is a bug.
- **Jitter / randomness / `Date.now()`** — disabled or injected under
  deterministic mode. No `Math.random()` in scoring paths.

If you add any of the above, add or extend a determinism assertion so the next
change can't silently regress it.
