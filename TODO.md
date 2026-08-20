# TODO — Linear fallback log

**LOUD FALLBACK, per `CLAUDE.md` → "## The board" and the run prompt's STEP 0c.**
This file is appended to (never overwritten) every run where the Linear MCP
connector is unreachable, in the same shape a Linear issue would carry:
title, why, acceptance check. Newest entries first.

---

## 2026-08-20 — Linear unreachable this run (Product Factory)

**Why:** the Linear MCP connector requires OAuth re-authorization
(`ListAgents`/tool listing surfaced it under "MCP servers that require
authentication before their tools can be used"). This session is
non-interactive (scheduled/autonomous run) and cannot complete an OAuth
flow. No `list_issues` call could be attempted safely — the connector's
tools are not loaded.

**Action needed (human, one-time):** re-authorize the Linear connector for
this account/workspace (via `claude mcp` or `/mcp` in an interactive
session, or the claude.ai connector settings). Until then every scheduled
Product Factory / Growth Agent / GTM Auditor / Quality Auditor run that
depends on the board will keep hitting this same wall — worth fixing once
rather than re-discovering it every ~6h.

**Acceptance check for THIS finding:** `Linear list_issues` (or any Linear
MCP tool call) succeeds without an auth error, from a fresh scheduled
session.

---

### Filed this run (worked below Linear-issue granularity because the board was unreachable — promote to real Linear issues once the connector is back)

## APT-52 (carried over, re-confirmed, NOT re-derived) — CI `journeys` job hangs on "Install deps + browser" and gets cancelled after ~6h

**Status: confirmed still active and now the dominant failure mode**, not
just a past flake. Checked `ci.yml` workflow-run history on the default
branch (`claude/ai-apartment-design-app-iHAdb`, `push` events): the last
clean/green run was **2026-08-19T00:37:30Z**; every push-triggered run
since **2026-08-19T16:26Z** (7+ consecutive runs) came back `cancelled`.
Job-level breakdown on run `32276367573` (PR #949) confirms the failure is
isolated to exactly one step: `journeys` job → `Install deps + browser`
(`npx playwright install --with-deps chromium`) started `16:56:03Z`,
never completed, cancelled at `22:54:20Z` (~6h). Every other job in the
same run — `lint`, `mobile`, `build`, `verify` (tsc + tests + determinism),
`security-invariants`, `validate-gtm`, `validate-capabilities` — passed
cleanly in under a minute each. This is a CI-runner/infra problem (apt or
npm registry reachability during the Playwright browser+deps install),
not a defect in any PR's diff.

**Why not fixed this run:** the fix (adding `timeout-minutes` to that
step, caching the browser binary via `actions/cache`, or switching to a
pre-built Playwright Docker image) requires editing
`.github/workflows/ci.yml`, which is a hard structural bar for this
sandbox (`.github/` edits trip a permission prompt that hangs a headless
run — see `CLAUDE.md` → the `.github/` bar). Recorded once here per the
"structural bar, not a decision" rule; do not re-derive this diagnosis on
a future run — just check whether the workflow-run history above still
shows the same signature before reinvestigating.

**Correction (found later this same run): `journeys` does NOT actually
gate merge.** The paragraph above, and PR #942's body, assumed it was a
required check. It is not: this run's own PR (#951) opened with the
same 3-commit diff and merged in ~4 minutes — far too fast for the
journeys job to have completed, and its `run_attempt` history confirms
it never did. The actually-required checks are `verify`, `build`, and
`mobile` (all fast, all green), matching what `ROADMAP.md`'s own "Merge
decision" section says. So the hang is real and still worth fixing (a
required-in-spirit quality gate silently not running is its own gap —
worth a Linear issue once the board is back: "make `journeys` block
merge, or stop treating a >6h hang as blocking"), but it is NOT currently
blocking any PR from merging. **PRs #941/#942 are stuck for a different
reason** — most likely their base commit is now several commits stale
(`3e59415`, well behind the current tip) rather than the CI infra issue;
worth a fresh look, not a re-run, next time someone owns them (not this
run — they belong to a different session's work, out of scope here).

**Acceptance check for the underlying hang (still open):** a
`push`-triggered `ci.yml` run on the default branch completes the
`journeys` job with `conclusion: success` (or any non-`cancelled`
terminal state reached in well under the ~6h timeout).
