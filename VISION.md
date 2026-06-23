# VISION — AptDesignerAI

North-star anchor for autonomous loops and contributors. Read this first each run
so work builds toward the product, not just toward "tests pass." Operating rules
live in `AGENTS.md` (aka `CLAUDE.md`); this file is the *why* and the *what good
looks like*.

## What we're building
An AI interior-design copilot. A user photographs a room (often many angles),
optionally adds a floor plan and free-text notes, and the app holistically
understands the space, diagnoses what's working/missing, sets a design direction,
sources real products in budget, and renders mockups — end to end.

## Who it's for
Primarily **Gen Z and millennials**: design-literate, mobile-first, taste-driven,
impatient with clutter. The bar is a warm-editorial feel — calm, tactile, modern —
not a spreadsheet with photos.

## What "good" looks like (optimize for these)
- **Trustworthy output.** Recommendations are grounded in the actual photos and
  the user's constraints — no hallucinated specificity. The maker/checker
  validators are what make the pipeline trustworthy; keep them honest.
- **Holistic understanding.** Treat all photos of a room as one space (see the
  scene graph), not isolated images.
- **Fast and cheap by default.** Latency and cost are features. Cheapest model
  tier that does the job; escalate only on a deterministic signal.
- **Reproducible.** Same input → same output. Determinism is a product
  requirement because the checkers must be trustworthy.
- **Mobile-first, low-friction UX.** Touch targets, skeleton/loading states,
  micro-interactions; nothing that makes a phone user pinch-zoom or wait blind.
- **Does NOT look vibe-coded.** The UI must read as an intentionally designed
  product, not generated scaffolding. See "The design bar" below — this is a
  hard quality bar, not a nice-to-have.

## The design bar (do NOT look vibe-coded)
A Gen-Z/millennial audience spots generic AI-generated UI instantly and bounces.
Every UI change must clear this bar:
- **Use the design system, never ad-hoc styles.** Reuse the existing tokens,
  components, and spacing scale (the warm-editorial system, CVA variants,
  framer-motion primitives). No one-off hex colors, no random `gap`/`p-` values,
  no inline magic numbers where a token exists.
- **No default/template look.** Avoid stock unstyled shadcn defaults left as-is,
  centered-everything hero blandness, purple-gradient-on-white slop, emoji used
  as iconography, or three competing accent colors. Consistent type scale,
  deliberate hierarchy, generous and *consistent* whitespace.
- **Polish is the point.** Real empty/loading/error states, hover/press
  feedback, considered transitions, dark-mode parity, and accessible contrast +
  focus states. Pixel alignment and optical balance matter.
- **Taste test.** Before shipping a UI change, ask: would this look at home in a
  well-designed editorial app, or does it look like a generated demo? If the
  latter, it does not ship. When unsure whether a visual change clears the bar,
  treat it as human-only and open a PR rather than auto-merging.

## Hard constraints (never trade away — see AGENTS.md + .claude/rules)
- **LLM cost contract.** Cheapest tier by default; explicit `thinkingConfig` on
  every `.chat()`; seed every call; HIGH thinking only where there's no cheap
  verifier. The ratchet tests guard this — add config, never relax the test.
- **Determinism.** Seed every call; stable sort tiebreakers; no
  `Date.now()`/`Math.random()` in scoring paths; caches bypassed under
  `DETERMINISTIC`.

## Out of scope / non-goals
- No new frameworks or heavy dependencies without a strong, stated reason.
- No marketing pages, pricing experiments, or auth/payment rewrites from the
  autonomous loop (those are human-only changes).
- Not a general CRM/PM tool — stay focused on the design→source→mockup journey.

## How to judge a change
Would this make a Gen-Z/millennial user trust the result more, get to a beautiful
room faster, or make the codebase cheaper/safer/clearer to run — without
weakening a validator or the cost/determinism contract? If yes, it's on-vision.
