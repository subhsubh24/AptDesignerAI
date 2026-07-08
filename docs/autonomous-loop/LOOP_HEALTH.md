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
  as_of: 2026-07-08
  last_run: 71                   # the Run N this reflects (null until first bookkeeping update)
  last_deep_audit: 69            # next DEEP AUDIT due ~Run 72
  this_run:
    changes_shipped: 7           # #503-509 ALL merged (gate green, 2 Sonnet approvals each): 1 SSRF + 2× G2 PATCH validation (rooms/products) + 1 A1 dashboard guard + 1 mobile blank-screen guard + 1 F2 test (groundConfidence) + 1 ship-critical business-case honesty fix (closes #486)
    changes_abandoned: 0         # every scouted candidate that cleared the value bar shipped; borderline items (dead toast/badge info-blue variants, topbar emerald semantic, email-lifecycle Pro-Annual entangled w/ owner #487) correctly NOT selected
    abandoned_reasons: []        # none abandoned this run
    verify_cycle_failures: 0     # LOOP-2 (local gate) clean for all 7 (tsc/eslint/test/determinism root + mobile tsc); baseline green on entry (1840 tests) → 1846 after +6 F2 tests
    review_rejections: 1         # LOOP-3: 16 first-pass reviews; #509 (rooms PATCH) got ONE Reviewer-A REQUEST_CHANGES (3 real gaps: enum-membership not checked, budget_dollars not integer-checked, present-but-null on NOT NULL cols → all would 500 at the DB instead of a clean 400) → all 3 fixed + both cycle-2 reviewers APPROVE. Not an abandon — the gate working as designed.
    circuit_breaker_trips: 0
    ci_flake: "none observed this run — all 7 required-check runs (verify/build/mobile/lint) went green first try; #505 took longer to auto-merge due to runner-queue congestion behind the post-merge CI, not a flake."
  rolling_7d:
    merged_prs: 57               # all routines' merged PRs over the last 7d, from `git log --since=7d | grep -cE '\(#N\)'`
    reverts: 0                   # PRs that REVERTED a prior merge — the rework/quality-miss signal
    readiness_attempts: 0        # times the readiness gate was attempted
    readiness_rejected: 0        # times it was rejected (auditor/preflight found a real gap)
    recurring_failures:          # the journeys setup-cli rate-limit flake (harness-fixable only — pin the CLI version — but .github/ is not loop-editable); not triggered this run
      - "journeys/supabase-setup-cli@v1 version:latest GitHub-API rate-limit (intermittent, Runs 64-66); non-required check so it never blocks the merge gate"
    harness_proposals_open: 0    # note (not stuck): authed-surface changes (E2E/a11y, design_taste closure) are only CI-verifiable here — no local auth stack (supabase-local unrunnable: registry 503 + rlimit-denied container init). The gates catch real issues, so this is friction not failure.
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
