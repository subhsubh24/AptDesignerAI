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

## Commercial north star (this is a real product, meant to be sold)
The end goal is a **shippable, sellable app that generates reliable, consistent
revenue** — ideally distributed via the App Store and grown into dependable side
income. Every improvement should ultimately serve that: a product people will
**pay for and keep paying for**.

Concretely, weight work toward:
- **Worth paying for.** Output quality and polish high enough that a paywall feels
  fair. The free→paid moment must land on real value (a beautiful, trustworthy
  result), not a nag.
- **Conversion & retention.** Smooth onboarding, fast time-to-first-"wow",
  reasons to come back (save designs, revisit rooms, share). Reduce drop-off.
- **Reliability = revenue.** Paying users churn on breakage. Crashes, dead ends,
  wrong results, and slow loads are revenue leaks, not just bugs.
- **Healthy margins.** Per-user runtime LLM/infra cost is **cost of goods** — it
  directly sets the margin. Cheaper-by-default and the cost contract aren't just
  hygiene here, they're unit economics. A feature that 3×'s inference cost per
  session can make the business unviable even if users love it.
- **Store-readiness.** Move toward what a paid launch needs: trust, privacy
  clarity, billing/subscription readiness, performance, and a credible polished
  surface. (Billing/auth/payments changes are still human-reviewed, not
  auto-shipped.)

Not every change is a feature — paying down reliability, latency, and cost debt
is directly commercial because it protects the margin and the churn rate.

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

### THE DESIGNER QUESTION (run this on EVERY UI change — Reviewer B enforces it)
Before implementing or approving any layout, component, color, spacing, motion, or
visual decision, pause and ask the one question that kills lazy visual defaults:
**"Would an experienced product designer intentionally make this decision?"** If the
answer is no, improve the design before proceeding — do NOT ship it. The interface
should feel built, edited, and judged by taste, NOT assembled from the average of the
internet. Reviewer B REQUEST_CHANGES any UI diff that can't answer this with a clear yes.

### AVOID BY DEFAULT (generic-AI-frontend slop — these never ship)
Cookie-cutter SaaS dashboards · excessive cards everywhere · default/unstyled Tailwind or
shadcn aesthetics · weak typography · random/inconsistent spacing · visual noise &
decorative gradients/blur for their own sake · over-engineered interfaces · design-by-
template thinking · uninspired landing pages · generic startup-website patterns · emoji
as iconography · three competing accent colors · centered-everything hero blandness.
A layout that could belong to *any* startup is a FAIL — make it unmistakably this product.

### GENERATE BETTER (what we optimize FOR)
Strong visual hierarchy · exceptional typography · deliberate spacing & rhythm · clear
information architecture · premium product aesthetics · thoughtful interaction & meaningful
motion · cohesive visual system · high-quality component composition · intentional color ·
human-designed, opinionated decisions · product-level polish · memorable experiences.

### RECURRING TASTE AUDIT (part of the loop, not a one-off)
The periodic DEEP AUDIT's design lens must actively HUNT for slop across the live UI —
layout, type scale, spacing, hierarchy, component quality, color, navigation, motion,
landing/dashboard quality, responsiveness, a11y, information density — flag anything
that reads "generated," and turn the highest-design-impact fixes into prioritized,
value-bar-clearing work (ranked by how much they improve hierarchy, comprehension, trust,
and polish). Final standard: **simplicity without blandness; functionality without visual
clutter.**

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
Would this move the product closer to something people **pay for and keep paying
for** — by making a Gen-Z/millennial user trust the result more, reach a
beautiful room faster, come back again, or by protecting the margin
(cheaper/faster/more reliable to run) — all without weakening a validator or the
cost/determinism contract? If yes, it's on-vision. If it only adds surface area
without serving quality, retention, reliability, or margin, it's probably not.
