# LOOP HEALTH — is the factory actually getting BETTER, not just busier?

The machine-readable signal for the loop's OWN performance over time (distinct from product
quality, which the independent QUALITY_SCORECARD owns). "More PRs" is not improvement; this
measures whether the loop is converging and learning vs. churning or stuck. The factory updates
the fenced block below EVERY run in the ONE bookkeeping PR, with REAL counts computed from
git/gh — never invented or flattered (same anti-gaming rule as the business case). The factory
dashboard reads this block.

## Contract (read before editing)
- Update every run in the bookkeeping PR; stamp `as_of` + `last_run`.
- Counts are REAL (merged/reverted PRs from `gh`/`git`, this-run tallies you actually observed).
- `abandoned_reasons` CLASSIFIES every change you started and dropped this run, so the next run
  does NOT re-attempt the same dead-end (reason ∈ gate_tsc | gate_test | gate_determinism |
  gate_build | review_value | review_correctness | circuit_breaker | conflict | dead_end |
  blocked_owner). This is the loop's "don't repeat the failed path" memory.
- `signal` is your honest read; **churning or stuck is the trigger to open ONE
  `loop: harness improvement proposal` issue** (the META rule — the only channel by which the
  loop's own operating rules improve, since the loop cannot edit its routine/.claude itself).
- Keep the `validation` block current from `validation/CAPABILITIES.yml`: `capabilities_total`
  = number of declared capabilities; `unmet` = the ids with `ci_validatable: false` (run
  `node scripts/validate-capabilities.mjs --readiness`). Every `unmet` id MUST also be an urgent
  OWNER_ACTION in PENDING_OPS so it surfaces to the owner + the dashboard.
- Keep the block valid, parseable YAML.

```yaml
LOOP_HEALTH:
  project: AptDesignerAI
  as_of: 2026-08-05
  last_run: 145                  # the Run N this reflects. NOTE: this field + this_run were stale since Run 122 (23 runs, contract requires every-run updates) — this run recomputed it from directly-observed data only; runs 123-144's individual health metrics were NOT backfilled (no reliable source to reconstruct them honestly).
  last_deep_audit: 144           # scoped/partial 8-lens pass (security/RLS, mobile, correctness/perf, design-bar/a11y); accessibility-beyond-heading-order, dependency/config-health, artifact-freshness NOT covered there but incidentally covered clean by this run's scout sweep
  this_run:
    changes_shipped: 7           # file-DISJOINT: (1) perf(saved-designs) DB fetch parallelization; (2) perf(refine-chat) diffAnalysis double-stringify fix; (3) fix(mobile) saved.tsx back button; (4) fix(mobile) results.tsx haptics; (5) test(validation-agent) cassette test for revision-coercion branches; (6) fix(security) migration 033 WITH CHECK pin; (7) fix(design-bar) dashboard badge onto tokens. #812/#813/#815/#816/#817/#818 MERGED; #814 queued on auto-merge, all required checks green except the long-running journeys job, NOT yet merged at bookkeeping time.
    changes_abandoned: 1         # #819 (a11y ManualScorecardView toggle): the scout-reported keyboard-accessibility violation was a FALSE POSITIVE — the div already wrapped a fully keyboard-accessible nested button doing the identical action. First fix attempt made it worse (duplicate focus stop, caught by review); second attempt reverted to a comment-only no-op; two independent cycle-2 reviewers both recommended closing rather than merging a no-op under an "a11y fix" title. Closed without merging.
    abandoned_reasons: ["dead_end"]  # the claimed a11y defect did not exist; the process caught it before shipping a no-op
    verify_cycle_failures: 1     # #814's required `verify` CI check failed post-approval on a REAL, predictable consequence (__tests__/mobile/tap-targets.test.ts, a web-side test scanning mobile/src, needed its hardcoded Pressable count bumped 33->34) that neither the implementer's nor either reviewer's mobile-only local verification (cd mobile && tsc/lint) ever exercised — fixed and re-verified within the cycle cap.
    review_rejections: 3         # LOOP-3: 18 verdicts across cycle 1 + cycle 2. 3 REQUEST_CHANGES, all real: (a) #817 cycle 1 — the migration's entire stated security rationale was factually wrong (Postgres implicitly reuses USING as WITH CHECK for ALL/UPDATE policies; no live gap existed); (b) #819 cycle 1 — the fix created a duplicate, identically-labeled keyboard focus stop instead of a real fix; (c) #819 cycle 2 — the corrected fix netted to a behaviorally-empty diff, not worth merging. Every blocking finding this run was real, extending the pattern from Runs 143/144.
    circuit_breaker_trips: 0
    ci_flake: "NOT flake — see verify_cycle_failures above (#814). A second, non-CI process issue also occurred this run and is recorded in loop-memory rather than here since it never reached a commit: the first attempt at the 8-way parallel implementation batch ran in a SHARED working directory (isolation: worktree was omitted from the initial Agent calls), causing 3 agents' uncommitted edits to collide in one tree. Caught via the stop hook before any commit, cleaned up, redone correctly with isolation: worktree — zero data loss, one wasted round-trip."
  rolling_7d:
    merged_prs: 56                # all routines' merged PRs over the last 7d (git log --since=7d origin/default | grep -cE '\(#N\)') — recomputed this run
    reverts: 0                   # PRs that REVERTED a prior merge — the rework/quality-miss signal
    readiness_attempts: 0        # times the readiness gate was attempted
    readiness_rejected: 0        # times it was rejected (auditor/preflight found a real gap)
    recurring_failures:          # the journeys setup-cli rate-limit flake (harness-fixable only — pin the CLI version — but .github/ is not loop-editable); not triggered this run
      - "journeys/supabase-setup-cli@v1 version:latest GitHub-API rate-limit (intermittent, Runs 64-66); non-required check so it never blocks the merge gate"
    harness_proposals_open: 0    # note (not stuck): authed-surface changes (E2E/a11y, design_taste closure) are only CI-verifiable here — no local auth stack. The gates catch real issues, so this is friction not failure.
  validation:                    # self-validation capability gate (validation/CAPABILITIES.yml + the REQUIRED validate-capabilities check). Dashboard reads this block.
    enforced_in_ci: true         # validate-capabilities is a required status check (fails closed on undeclared/unmet capabilities)
    capabilities_total: 14       # external services declared in validation/CAPABILITIES.yml
    unmet: []                    # capabilities needing an owner-only secret to validate (ci_validatable:false). EACH unmet entry MUST also be an urgent OWNER_ACTION in PENDING_OPS so it surfaces to the owner.
  signal: steady                 # bootstrapping | improving | steady | churning | stuck
```

## How to read it (owner + loop)
- **improving** — shipping value-bar-clearing work, low abandon/revert, DoD/quality advancing.
- **steady** — normal healthy run.
- **churning** — high abandoned/revert relative to shipped: busy, not better. Investigate the
  abandoned_reasons; cut whatever pattern is wasting cycles.
- **stuck** — recurring_failures present or no convergence progress across runs → OPEN a
  `loop: harness improvement proposal` issue (loop-of-the-loop fix; human applies it).
- A rising `reverts` or `readiness_rejected` trend means quality is slipping upstream — tighten
  review/gates, don't just ship more.
