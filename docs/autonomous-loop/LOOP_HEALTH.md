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
  as_of: 2026-07-10
  last_run: 76                   # the Run N this reflects (null until first bookkeeping update)
  last_deep_audit: 76            # 8-lens sweep ran Run 76; next due ~Run 80
  this_run:
    changes_shipped: 5           # #540-544 all opened + auto-merge enabled (integrated gate green, 2 Sonnet approvals each): #540 correctness (harmony chunk-merge) + #541 security/IDOR (bundles product↔room binding) + #542 a11y (warm-variant contrast) + #543 monetization (Stripe customer portal) + #544 side-effect-integrity (checkout-success entitlement gate)
    changes_abandoned: 0         # 2 scout findings VERIFIED-DOWN as false positives before any code (proxy.ts=correct Next-16 convention; search INSERT…RETURNING preserves order); lower-value items (E7 email tail, app-tabs "Expo Starter", muted-on-amber a11y nits) correctly NOT selected, not abandoned mid-build
    abandoned_reasons: []        # none started-then-dropped this run
    verify_cycle_failures: 0     # LOOP-2 clean for all 5 (tsc/eslint/test/determinism); baseline 1908 → integrated 1920 (+12)
    review_rejections: 0         # LOOP-3: 10/10 first-pass APPROVE, ZERO REQUEST_CHANGES (unusually clean; reviewers reverted #540/#541 to prove tests fail without the fix, hand-computed #542 ratios, adversarially checked #543 for IDOR/secret-leak)
    circuit_breaker_trips: 0
    ci_flake: "awaiting required CI (verify/build/mobile) on #540-544 at bookkeeping time; none observed."
  rolling_7d:
    merged_prs: 50               # all routines' merged PRs over the last 7d, from `git log --since=7d | grep -cE '\(#N\)'`
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
