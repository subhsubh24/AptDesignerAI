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
  as_of: 2026-07-03
  last_run: 60                   # the Run N this reflects (null until first bookkeeping update)
  last_deep_audit: 60
  this_run:
    changes_shipped: 4           # #394-397 merged (gate green, 2 Sonnet approvals each, no re-review cycles): 3× F2 test (pagination, image-mime, build-profile) + mobile results-loading a11y liveRegion
    changes_abandoned: 2         # #393 (authed-axe) + #398 (brand titles) — BOTH via the gates working, not churn
    abandoned_reasons:           # classify every dropped change so the next run doesn't re-attempt the dead-end
      - id: "#393 authed-axe dashboard"
        reason: gate_test        # both-APPROVED but the CI journeys job FAILED on REAL serious WCAG AA color-contrast violations on the signed-in dashboard welcome step (the gate working). Landing the gate needs the contrast FIXED first — unsafe to nail blind (no local auth-stack render, dark-mode parity, axe measured mid-StaggerItem animation opacity). Exact targets on issue #204; re-add WITH the fix + reducedMotion:'reduce' + drop the networkidle wait.
      - id: "#398 brand-metadata titles"
        reason: review_value     # both reviewers REQUEST_CHANGES: fixing <title> while leaving footer/body/watermark/email stale creates NEW inconsistency (metric-chasing). Needs a wholesale brand sweep behind a single BRAND_NAME constant, or not at all.
    verify_cycle_failures: 0     # LOOP-2 (local gate) clean for all changes root+mobile. #393's failure was a CI-only axe gate on a surface that cannot be rendered locally (no auth stack), not a local verify-cycle failure.
    review_rejections: 1         # LOOP-3: #398 both reviewers REQUEST_CHANGES on value (partial brand fix creates new inconsistency) → abandoned (not reworked; the right fix is a larger wholesale sweep). The value bar working as intended.
    circuit_breaker_trips: 0
  rolling_7d:
    merged_prs: 54               # all routines' merged PRs over the last 7d, from `git log --since=7d | grep -cE '\(#N\)'`
    reverts: 0                   # PRs that REVERTED a prior merge — the rework/quality-miss signal
    readiness_attempts: 0        # times the readiness gate was attempted
    readiness_rejected: 0        # times it was rejected (auditor/preflight found a real gap)
    recurring_failures: []       # no stuck pattern: the two abandonments were the gates catching real issues (an a11y bug + a metric-chasing edit), not repeated dead-ends
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
