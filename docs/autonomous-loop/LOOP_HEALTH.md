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
  as_of: 2026-07-26
  last_run: 117                  # the Run N this reflects
  last_deep_audit: 115           # 8-lens sweep ran Run 115 (2026-07-26); next due ~Run 119
  this_run:
    changes_shipped: 6           # one PR (single-branch git constraint): (1) password reset built from nothing, rebased off the stalled PR #697; (2) the middleware routing fix — public pages unreachable for signed-in users, recovery + /shared/<token> + /gallery unreachable for signed-out ones; (3) sitemap.xml + robots.txt, neither of which existed anywhere in the repo; (4) no fallback identity outside local dev; (5) paywall stops promising a trial the store may not give; (6) 21 surfaces of opacity-dimmed muted text below the WCAG AA floor. All 6 file-DISJOINT (no file touched by two commits).
    changes_abandoned: 0         # scout findings DROPPED before any code: web share-link Pro gating (issue #692 owner pricing decision, and gating it would regress the Run 106 all-tiers viral loop); tier-differentiated daily limits (= the abandoned #704, do not re-derive); two stream-route parallelizations (the standing "micro-opt, standalone only, never batch" tier); OG images for marketing pages (real but a separate standalone change). Also dropped from PR #697: its mobile-auth-enumeration commit (landed independently in Run 116) and its stale dep-lockfile commit.
    abandoned_reasons: []        # none started-then-dropped this run; all drops were pre-code selection calls (blocked_owner/dead_end/review_value class)
    verify_cycle_failures: 0     # LOOP-2 clean: tsc, 2383 tests (+107), determinism, prod build, mobile tsc, eslint 0 on touched files, and the runtime journey suite GREEN (the 3 reset journeys that were red on #697 now pass)
    review_rejections: 3         # LOOP-3: 15 verdicts. 3 REQUEST_CHANGES, every one a REAL defect the maker missed — (a) the dev-mode half of the routing fix had NO test (reverting it left all 33 green); (b) the proxy matcher's new alternatives were unanchored/unescaped, so /sitemap.xml-preview would have skipped auth+CORS+the site gate, AND /gallery was being rationalised as non-public when it was a live dead link in the marketing footer; (c) the a11y ratchet's "inactive step label" carve-out exactly matched its own regex blind spot, hiding three real status labels, and the published dark-theme contrast numbers were measured against the wrong surface. All fixed and re-reviewed.
    circuit_breaker_trips: 0
    ci_flake: "none observed at author time; PR pushed and set to auto-merge on the required verify/build/mobile/lint/journeys checks."
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
