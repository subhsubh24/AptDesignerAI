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
- Keep the block valid, parseable YAML.

```yaml
LOOP_HEALTH:
  project: AptDesignerAI
  as_of: 2026-06-29
  last_run: 43                   # the Run N this reflects (null until first bookkeeping update)
  last_deep_audit: 40
  this_run:
    changes_shipped: 4           # #213 #214 #215 merged; #216 auto-merge queued (gate green, 2 approvals)
    changes_abandoned: 0         # all 4 implemented changes passed gate+review; 3 candidates were deselected at SELECTION (not built), per below
    abandoned_reasons: []        # deselected-pre-build (not counted as abandoned): embedding-index-pgvector-RPC = dead_end-for-now (cannot runtime-verify a pgvector RPC cold; latent value pre-seed; ship_critical:false → defer to a live-DB-verifiable run); toast-aria-live = review_value (Radix Toast already announces via its Provider region — false flag); rooms/[roomId]/diagnosis-maxDuration = review_value (plain DB GET, no LLM/long work)
    verify_cycle_failures: 0     # LOOP-2 gate failures
    review_rejections: 1         # LOOP-3 REQUEST_CHANGES (product-extractor test: vacuous `geminiProvider.chat not called` assertion on a path that uses getProvider/tavilyExtract) — fixed to assert vs tavilyExtract, re-reviewed APPROVE in-cap
    circuit_breaker_trips: 0
  rolling_7d:
    merged_prs: 24               # Runs 40-43 product PRs (#183-187, #191-196, #206-211, #213-215) + housekeeping (#188 #197 #212)
    reverts: 0                   # PRs that REVERTED a prior merge — the rework/quality-miss signal
    readiness_attempts: 0        # times the readiness gate was attempted
    readiness_rejected: 0        # times it was rejected (auditor/preflight found a real gap)
    recurring_failures: []       # failures seen across >=2 runs (the "stuck" signal) — name them
    harness_proposals_open: 0    # issue #181 ("gates not enforced in CI") RESOLVED: lint + the public journey tier (BUILDS!=WORKS) are now REQUIRED checks alongside verify/build/mobile; the loop merges via --auto so a red check BLOCKS auto-merge. Authed journey tier = tracked follow-up.
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
