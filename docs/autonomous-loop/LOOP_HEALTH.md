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
  as_of: 2026-08-06
  last_run: 146                  # this run
  last_deep_audit: 144           # scoped/partial 8-lens pass (security/RLS, mobile, correctness/perf, design-bar/a11y); still due on the ~24h/~4-run cadence — this run's 6-scout sweep incidentally re-covered security/RLS (clean) but not a full 8-lens rotation
  this_run:
    changes_shipped: 3           # file-DISJOINT: (1) perf(refine-chat) Promise.all on 2 independent DB reads; (2) fix(mobile/a11y) accessibilityLabel across 4 mobile screens; (3) test(shopping-researcher) 6 new behavioral tests for searchProducts (previously 0% covered). All 3 committed to ONE PR (#821, squash-merged) rather than 3 separate PRs — this session's git setup provides a single designated branch, unlike the normal multi-branch-per-change flow; each change was still independently implemented, verified, and 2-reviewer-approved before being batched for that one branch/PR.
    changes_abandoned: 0         # no candidate reached implementation and then got abandoned — see the 2 false leads below, which were killed at the SCOUT-VERIFICATION step, before any code was written
    abandoned_reasons: []        # nothing reached implementation and was dropped; the 2 false leads (below) never got past verification, so they don't count as an implemented-then-abandoned change
    scout_claims_rejected_pre_implementation: 2  # NEW signal this run, worth tracking going forward: (a) "parallelize the analyze-apartment persistence loop" contradicted an explicit in-file comment stating the loop is deliberately serial (MAX_ROOMS_PER_ANALYSIS=20 sized against maxDuration=300 assuming serial latency); (b) a claimed-failing raw-<img> ratchet test did not reproduce (npx vitest run on the file: 2/2 pass). Both killed by reading the actual file/re-running the actual test before writing any code — zero wasted implementation cycles.
    verify_cycle_failures: 0
    review_rejections: 0         # 6/6 reviewer verdicts this run were APPROVE (2 reviewers x 3 changes) — a change from Runs 143-145, which each had >=1 real, substantive REQUEST_CHANGES. Read as: candidates were smaller and more thoroughly self-verified before review (the 2 false leads above were killed pre-implementation, not caught by review), not as reviewers going soft — the caveats both reviewers raised (refine-chat's modest absolute magnitude; photo.tsx's lowercase-vs-titlecase label nit) were real, just judged non-blocking.
    circuit_breaker_trips: 0
    ci_flake: "None this run. One process note: the first reviewer prompt for the mobile a11y diff was sent with the actual diff content accidentally omitted (prompt cut off after the opening code fence) — caught immediately when the agent's response didn't address any diff, corrected via a follow-up SendMessage with the full diff before any verdict was rendered. No wasted agent-cycle count impact (same agent, same task, corrected mid-flight) but worth a process note: double-check a reviewer prompt actually contains its diff before dispatching, especially when composing several similar prompts in one batch."
  rolling_7d:
    merged_prs: 72                # computed from `mcp__github__list_pull_requests` (state=closed, sort=updated desc, 100 results) filtering merged_at >= now-7d; local git is a SHALLOW clone (51 commits) so git log --since=7d undercounts and was not used. One page (100 results) may not be fully exhaustive back to exactly 7d if update-sort drifted from merge-time sort, but every entry counted has a real merged_at timestamp — no invented figure.
    reverts: 0                   # PRs that REVERTED a prior merge — the rework/quality-miss signal
    readiness_attempts: 0        # times the readiness gate was attempted
    readiness_rejected: 0        # times it was rejected (auditor/preflight found a real gap)
    recurring_failures:          # the journeys setup-cli rate-limit flake (harness-fixable only — pin the CLI version — but .github/ is not loop-editable); not triggered this run
      - "journeys/supabase-setup-cli@v1 version:latest GitHub-API rate-limit (intermittent, Runs 64-66); non-required check so it never blocks the merge gate"
    harness_proposals_open: 0    # no new proposal this run — no churning/stuck signal; 0 review rejections + 2 correctly-pre-killed false leads + 1 clean CI pass reads as a healthy, well-verified run, not a friction pattern needing escalation
  validation:                    # self-validation capability gate (validation/CAPABILITIES.yml + the REQUIRED validate-capabilities check). Dashboard reads this block.
    enforced_in_ci: true         # validate-capabilities is a required status check (fails closed on undeclared/unmet capabilities)
    capabilities_total: 15       # recounted directly this run (grep "^  - id:" validation/CAPABILITIES.yml) — up from 14 last recorded; not investigated further this run (not a value-bar item on its own), worth reconciling which capability was added next time this file is touched
    unmet: []                    # capabilities needing an owner-only secret to validate (ci_validatable:false). EACH unmet entry MUST also be an urgent OWNER_ACTION in PENDING_OPS so it surfaces to the owner. Re-verified this run: zero real `ci_validatable: false` entries in the actual data (the only regex hit is in the file's own header-comment legend, not a live entry).
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
