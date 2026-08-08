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

## The board

Work is tracked on the **Linear team `AptDesignerAI`**. The MCP connector is
configured globally — no `.mcp.json` entry, and no API key in this repo. Verify
with a `list_issues` call before writing anything; if that fails, see LOUD
FALLBACK below.

The board does not replace the gate. `scripts/preflight.sh` and CI still decide
what is true; the board decides only *who is working on what* and *what counts
as finished*.

- **Claim before you build.** Read open issues by priority, assign the one you
  pick to yourself, move it to `In Progress` — before writing code. Assignment
  is atomic server-side, so a failed assign means another run got there first;
  take the next item rather than contesting it. Without this step two concurrent
  runs silently build the same thing and one of them wastes a whole run.
- **The acceptance check is the definition of done, not your judgement of it.**
  Every issue carries a command the *next* run can execute — `bash
  scripts/preflight.sh`, `npx vitest run <file>`, a `grep` that must return
  nothing. If you cannot write that command, the issue is not ready to be
  worked; sharpen it until you can. "I reviewed it and it looks right" is the
  failure mode this rule exists to kill.
- **On close, comment the acceptance check as run — the command AND what it
  printed.** Never the word "done". A closed issue with no output is a claim,
  not a result, and weeks later nobody can tell the difference between work that
  shipped and work that was merely believed to have shipped.
- **File what you find, in the same run.** A gap noticed mid-run and mentioned
  only in the run summary is gone once the summary scrolls away. If you surface
  a risk, a follow-up, or a shortcut you took, it becomes an issue before the
  run ends — with an acceptance check like any other.
- **Decide, don't park.** Nothing waits on the owner. If a judgement call is
  needed — scope, priority, architecture, a tradeoff between two defensible
  options — make it, write down what you chose and why in a comment, and keep
  going. `Backlog` means *not yet prioritised*, never *awaiting Subh*. An
  imperfect decision that is recorded beats a perfect one that never gets made,
  because a recorded decision is reversible and a stalled cycle is not
  recoverable. The only things that genuinely stop at the owner are outside the
  sandbox, not judgement calls: real-money spend, live secrets, prod migrations
  by hand, publishing under their identity.
- **A structural bar is not a decision — record it once and move on.** Some work
  is impossible from an unattended run rather than undecided; the clearest case
  is anything under `.github/`, which trips a sensitive-file permission prompt
  that hangs a headless run. When you hit one: leave the issue in `Todo`, say in
  a comment exactly what is barred and what remains, and take the next item.
  Do NOT re-derive the same blocker every run — read the latest comment before
  claiming, and skip what a previous run already proved it cannot finish. Three
  consecutive runs each rediscovering the same `.github/` bar is the waste this
  rule exists to stop.
- **Loud fallback.** If Linear is unreachable or the team is missing, say so
  prominently at the top of the run report, append the work to `TODO.md` in the
  same shape (title, why, acceptance check), and carry on. A down board must
  never block a run; a board that is skipped silently is worse than no board.
- **Maker ≠ checker.** Whoever audits does not fix. An auditor that fixes its
  own findings has graded its own work, which is the thing independent review
  exists to prevent. Auditors file issues; the build loop picks them up and
  fixes them. This mirrors the split already in place between the product
  factory and the Quality / GTM auditor routines.

Do not invent work to fill the board. An empty board is a truthful board.

## Model policy (SONNET-MAX — this repo only)

This project runs **Sonnet-max**: `claude-sonnet-5` is the ceiling. Never request
`claude-opus-*` for yourself or any subagent — that capacity is reserved for
another project, and spending it here is a failure even where it would do the
work better.

`FACTORY_STANDARD.md` names Opus as the maker/auditor tier. **This cap overrides
it.** The shared doc is byte-identical across all five product repos, so it is
deliberately not edited for one product; the override is stated here and in each
routine prompt instead.

The tier split, and why it is shaped this way:

| Tier | Model |
|---|---|
| Orchestrator / maker | `claude-sonnet-5` |
| Readiness auditors at the ship gate | `claude-sonnet-5`, **≥4** (not ≥3) |
| Per-change reviewers (2/change) | `claude-sonnet-4-6` — deliberately *not* upgraded |
| Scouts / deep audit | `claude-haiku-4-5-20251001` |

Two of those are load-bearing and easy to "tidy" into a regression. The auditor
count is 4 rather than 3 because under the cap the maker and its auditors share
a model family, so the model-diversity half of maker ≠ checker is gone and more
independent samples buy some of it back. And the reviewers stay one model behind
the orchestrator on purpose — that gap is the only structural model diversity
left, sitting exactly where most defects are caught. Raising the reviewers to
match the orchestrator would look like an upgrade and would quietly remove it.

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
