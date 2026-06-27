# Quality Rubric (A+ → F) — how the app is graded

The standard the product is graded against. Grades are issued by an **independent adversarial
auditor** (never the agent that wrote the code — maker ≠ checker) and must be **backed by
mechanical signals**, not vibes. Anything below the bar gets a named root cause and is driven up.
This rubric is the durable method the Quality Auditor FOLLOWS (mirrors how the factory uses
ROADMAP and the Growth Agent uses ANALYSIS_PLAYBOOK).

## Grade scale (applied per dimension)
- **A+** — exemplary; an experienced expert would change nothing material. All mechanical signals
  green AND zero findings AND it clears the VISION taste/quality bar with room to spare.
- **A** — world-class; only trivial nits. Mechanical signals green, no real gaps. (Ship bar.)
- **B** — solid, but a real non-blocking gap exists (named).
- **C** — works, but notable gaps; below the ship bar.
- **D** — significant problems; not close.
- **F** — broken, unsafe, or absent (a ticked box with no real artifact is an F).

## Hard grading rules (anti-inflation — these mirror the readiness gate)
1. **Independent grader.** The grader must NOT have written the code it grades. Default skeptical:
   *"this is not A+ unless it genuinely earns it."*
2. **Backed by mechanical signals.** A grade may NOT exceed what the evidence supports (table
   below). Claiming A on security while preflight RLS checks fail, or A on tests below the
   coverage/eval threshold, is rejected.
3. **Evidence required.** Every grade cites concrete evidence (passing checks, file/line, finding
   counts). A bare letter is rejected.
4. **No self-grading by the maker.** The factory reads the scorecard as DATA and drives grades up;
   it never assigns its own grade. The standalone Quality Auditor owns the grade and re-grades.
5. **Determinism.** Criterion-referenced (use the anchors below), so the same state earns the same
   grade run to run.

## Dimensions, ship-criticality, and what backs each grade
| Dimension | Ship-critical? | Mechanical signal that backs an A/A+ |
|---|---|---|
| Functional reality | YES | `e2e/journeys.spec.ts` ran GREEN incl. authed (signup → working dashboard) |
| Correctness & reliability | YES | `tsc` clean · `npm test` green · no TODO/stub/dead path on a critical route |
| Security & RLS | YES | preflight RLS/secret checks green · 0 security findings · every public table RLS+policy |
| Design & taste | YES | clears VISION design bar (no generic-AI slop) · a11y (axe) no critical violations |
| Store-readiness | YES | Track D complete · privacy labels accurate · build+submit config real (eas.json) |
| Tests & evals | no* | coverage threshold met · live evals run green against the real pipeline |
| Performance | no* | no N+1/blocking on hot paths · perf budget met |
| Artifact integrity | YES | every ticked box backed by a real artifact · docs match current code |
| Business-case strength | YES | honest median ≥ $100K floor · high-ROI levers built (not just listed) |

\* Important but not, on its own, a launch blocker — still drive it up when value-bar-clearing.

## The bar + the bounded "drive to A+"
- **Ship gate:** readiness requires **A or A+ on every ship-critical dimension**, and **≥ B**
  elsewhere (or a named, value-bar-justified reason it's acceptable). Grades are issued by the
  independent auditor and backed by the mechanical signals above.
- **Below the bar → root-cause → drive up, BOUNDED.** For any dimension under its bar, write the
  SPECIFIC gap and turn it into value-bar-clearing work. Pursue the next grade ONLY via a specific,
  named improvement — **never open-ended polishing, never gold-plating a dimension that doesn't
  move ship-quality or revenue** (same bound as the business-case STRENGTH loop-back). A B on a
  cosmetic, non-ship-critical detail may ship; a C on a ship-critical dimension may not.
- This does NOT break convergence: chasing A+ means closing *named* gaps, not looping forever.
  When every ship-critical dimension is A/A+ and no value-bar-clearing improvement remains, STOP.

## Output
The Quality Auditor writes the result to `docs/quality/QUALITY_SCORECARD.md` (machine-readable
block: per-dimension grade + overall + evidence + the named gap for anything < A), files the top
gaps as prioritized issues, and never edits code. The factory reads the scorecard as DATA.
