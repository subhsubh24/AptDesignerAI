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
  as_of: 2026-07-16
  last_run: 93                   # the Run N this reflects (null until first bookkeeping update)
  last_deep_audit: 91            # 8-lens sweep ran Run 91 (2026-07-16); next due ~Run 95
  this_run:
    changes_shipped: 3           # #647 (one PR, squash 59afc19, required checks green): (1) F4.1 saved-designs fail-loud on full-stage read errors + test; (2) F4 products-page surface add-product failures; (3) entitlements/server fail-open (never throw) on a malformed RC response + test. All 3 both-Sonnet-APPROVED first-pass.
    changes_abandoned: 0         # ~6 scout findings VERIFIED-DOWN before any code (bundle-math + spatial-math "bugs" = intentional tolerance/defensive design; LABELED_DIMENSION_REGEX inches? = dead path; site-gate + cors "coverage gaps" = already-caught/no-op-cast; mobile use-free-quota unmount = React-18 no-op). E7 deferred (no clean disjoint headless-safe change). None started-then-dropped mid-build.
    abandoned_reasons: []        # none started-then-dropped this run (all drops were pre-code verification, not abandoned builds)
    verify_cycle_failures: 0     # LOOP-2 clean for all 3 (tsc/eslint/test/determinism); baseline 2119 → integrated 2126 (+7)
    review_rejections: 0         # LOOP-3: 6/6 first-pass APPROVE, ZERO REQUEST_CHANGES (reviewers reverted change-A to reproduce the 500→200 mutation; change-C security reviewer confirmed rcAppUserId is server-derived — no client-triggerable entitlement bypass)
    circuit_breaker_trips: 0
    ci_flake: "none observed; #647 registered no legacy commit-statuses (Actions check-runs only) but merged cleanly ~19min after push once the verify/build/mobile queue cleared."
  rolling_7d:
    merged_prs: 49               # all routines' merged PRs over the last 7d (git log --since=7d origin/default | grep -cE '\(#N\)'), incl. #647
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
