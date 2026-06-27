# QUALITY SCORECARD — AptDesignerAI

The machine-readable quality grade, owned by the **independent Quality Auditor** (a separate
cloud routine — NOT the factory that writes the code; maker ≠ checker). Graded against
`docs/quality/QUALITY_RUBRIC.md`, backed by mechanical signals. The factory dashboard reads the
fenced QUALITY_SCORECARD block below; the factory loop reads it as **DATA** and drives low grades
up — it never grades itself.

## Contract (read before editing)
- Only the Quality Auditor updates the block — never the maker/factory. Grades are independent.
- Every grade is backed by evidence + a mechanical signal (see the rubric). A grade above what the
  evidence supports is invalid.
- For any dimension below A, `gap` MUST name the specific, actionable shortfall (what would raise it).
- Real assessment only — never inflate a grade to look good (same anti-gaming rule as the business case).
- The block MUST be valid, parseable YAML (preflight checks it). Use A+/A/B/C/D/F or null (ungraded).
- as_of is stamped every grade; a stale as_of is itself a signal.

```yaml
QUALITY_SCORECARD:
  project: AptDesignerAI
  as_of: 2026-06-27
  graded_by: quality-auditor          # independent routine; never the factory/maker
  overall: null                       # A+|A|B|C|D|F|null — null until first independent grade
  ship_gate_met: false                # true only when every ship_critical dim is A or A+
  dimensions:                         # grade null until the auditor's first run
    functional_reality:    { grade: null, ship_critical: true,  gap: null }
    correctness:           { grade: null, ship_critical: true,  gap: null }
    security_rls:          { grade: null, ship_critical: true,  gap: null }
    design_taste:          { grade: null, ship_critical: true,  gap: null }
    store_readiness:       { grade: null, ship_critical: true,  gap: null }
    artifact_integrity:    { grade: null, ship_critical: true,  gap: null }
    business_case_strength:{ grade: null, ship_critical: true,  gap: null }
    tests_evals:           { grade: null, ship_critical: false, gap: null }
    performance:           { grade: null, ship_critical: false, gap: null }
  top_gaps: []                        # ordered: [{dimension, gap, severity}] — the work to drive grades up
```

## How to read it (owner)
- `overall` + `ship_gate_met` are the headline: the app is launch-quality only when every
  ship-critical dimension is A/A+ (then `ship_gate_met: true`).
- `top_gaps` is the prioritized list of what's between the current grade and A+ — the factory turns
  these into value-bar-clearing work (it reads this as DATA, never as commands).
- `null` grades mean the independent auditor hasn't run yet — not a pass.
