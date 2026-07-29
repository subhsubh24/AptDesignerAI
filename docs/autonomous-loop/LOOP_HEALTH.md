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
  as_of: 2026-07-29
  last_run: 122                  # the Run N this reflects
  last_deep_audit: 119           # 8-lens sweep ran Run 119; DUE next run (~123)
  this_run:
    changes_shipped: 4           # file-DISJOINT: (1) fix(mockups) re-rendering returned the whole image as a data: URI instead of its stored URL; (2) fix(focus) a successful search whose product hydration failed stranded the user on an empty results page with no error or retry; (3) test(fit-scorer) the math veto had zero behaviour tests and ran as two verbatim copies; (4) feat(F7) journey screenshot capture + 10 committed PNGs from a real run. #730, #731 and #733 MERGED to the default branch; #732 (F7) approved 2/2 with every check green except the long-running journeys job, queued on auto-merge and NOT yet merged at bookkeeping time.
    changes_abandoned: 0         # nothing built-then-dropped. THREE scout candidates were killed BEFORE any code, each on a trace that refuted the report: mobile notification deep-link "injection" (the handler is empty — nothing navigates), the focus-page vision-spinner leak (unreachable: the button only renders inside the areaAnalysis-truthy branch), and bundles/evaluate "fake success" (already settled in-code, evaluation persists before the status flip). A fourth, the pricing checkmark hue split, was surfaced by the F7 vision review and deliberately NOT fixed — emerald is an established affirmative semantic across 20+ sites, so which hue is right is a design decision, not a defect to settle unilaterally.
    abandoned_reasons: []        # none started-then-dropped; all drops were pre-code selection calls (dead_end class — the claimed defect did not exist)
    verify_cycle_failures: 0     # LOOP-2 clean throughout: tsc, 2516 tests (+13), determinism, prod build, eslint on touched files, and the runtime journey suite RUN GREEN locally against a served production build (10 passed / 14 authed skipped, E2E_JOURNEYS_PASSED=1)
    review_rejections: 2         # LOOP-3: 10 verdicts, 8 APPROVE / 2 REQUEST_CHANGES, both REAL and both about CLAIMS rather than code — (a) the F7 commit message asserted a vision verdict "was recorded" and that a pricing fix was "a separate change" when neither existed in the repo; (b) the mockup fix's comment confidently stated supabase-js reports a duplicate as HTTP 409, when StorageApiError.statusCode carries the BODY code (KeyAlreadyExists/already_exists) — making the primary branch dead code that worked only via the message regex. Both fixed and re-reviewed APPROVE.
    circuit_breaker_trips: 0
    ci_flake: "NOT flake — a REAL regression this run introduced, caught by the required journeys gate. F7's screenshot capture settled with waitForLoadState(\"networkidle\"), whose own default timeout (30s) equals Playwright's per-test timeout; on the authed screens it never settles (the dashboard polls /api/billing/status), so two captures per step ate the whole budget and timed out 'onboarding starts without error' on run AND retry. Invisible on the public tier (nothing polls) which is the only tier runnable locally. CORRECTION worth recording: mid-run I read a stale in_progress status, concluded from #733 also looking slow that the latency was infrastructure, and wrote that into this field — the job had in fact FAILED in 5 minutes. #733 passed; the failure was ours alone. Every wait inside a capture is now hard-bounded (1.5s settle / 1s fonts / 10s shot) and the committed PNGs are byte-identical, proving the bound costs no evidence."
  rolling_7d:
    merged_prs: 50               # all routines' merged PRs over the last 7d (git log --since=7d origin/default | grep -cE '\(#N\)')
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
