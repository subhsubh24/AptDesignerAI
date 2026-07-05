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
  as_of: 2026-07-05
  last_run: 66                   # the Run N this reflects (null until first bookkeeping update)
  last_deep_audit: 64            # next DEEP AUDIT due ~Run 68
  this_run:
    changes_shipped: 6           # #451-456 ALL merged (gate green, 2 Sonnet approvals each): 4× A1 silent-failure guards (mockups/bundles/setup/dashboard) + 2× F2 test (provider-factory routing+latch, deepseek request conversion)
    changes_abandoned: 0         # every scouted candidate that cleared the value bar shipped; borderline items (mobile-hook .catch swallows, 1-line stale doc) correctly NOT selected
    abandoned_reasons: []        # none abandoned this run
    verify_cycle_failures: 0     # LOOP-2 (local gate) clean for all 6 (tsc/eslint/test root); baseline green on entry (1754 tests) → 1767 after +21 F2 tests
    review_rejections: 0         # LOOP-3: 12 first-pass reviews; #456 (mockups) got ONE Reviewer-A REQUEST_CHANGES (unguarded .json() could leak a raw SyntaxError) → fixed (.json().catch + curated fallback, matching #445) + re-reviewed APPROVE. Not an abandon — the gate working.
    circuit_breaker_trips: 0
    ci_flake: "journeys/supabase-setup-cli@v1 version:latest GitHub-API rate-limit recurred on #451 (cost 1 rerun_failed_jobs). Non-required check; the 6 required checks (verify/build/mobile/lint/validate-capabilities/validate-gtm) were green. Recurring — pinning a fixed CLI version would fix it, but .github/ is not loop-editable."
  rolling_7d:
    merged_prs: 56               # all routines' merged PRs over the last 7d, from `git log --since=7d | grep -cE '\(#N\)'`
    reverts: 0                   # PRs that REVERTED a prior merge — the rework/quality-miss signal
    readiness_attempts: 0        # times the readiness gate was attempted
    readiness_rejected: 0        # times it was rejected (auditor/preflight found a real gap)
    recurring_failures:          # the journeys setup-cli rate-limit flake keeps costing ~1 rerun/run; harness-fixable only (pin the CLI version) but .github/ is not loop-editable
      - "journeys/supabase-setup-cli@v1 version:latest GitHub-API rate-limit (Runs 64/65/66); mitigated each time by rerun_failed_jobs; non-required check so it never blocks the merge gate"
    harness_proposals_open: 0    # note (not stuck): authed-surface changes (E2E/a11y) are only CI-verifiable here — no local auth stack (no supabase CLI/docker). The gates catch real issues, so this is friction not failure; fixes needing a live render (e.g. dashboard contrast) should be done in a way that can render the surface.
  validation:                    # self-validation capability gate (validation/CAPABILITIES.yml + the REQUIRED validate-capabilities check). Dashboard reads this block.
    enforced_in_ci: true         # validate-capabilities is a required status check (fails closed on undeclared/unmet capabilities)
    capabilities_total: 14       # external services declared in validation/CAPABILITIES.yml
    unmet: []                    # capabilities needing an owner-only secret to validate (ci_validatable:false). EACH unmet entry MUST also be an urgent OWNER_ACTION in PENDING_OPS so it surfaces to the owner.
  signal: improving              # bootstrapping | improving | steady | churning | stuck
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
