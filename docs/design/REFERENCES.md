# Design references — the taste bar, in pixels

The living reference set for AptDesignerAI, per **FACTORY_STANDARD §6b** ("DESIGN
AGAINST REFERENCES"). §6b defines the bar by principle and a slop-blocklist; this
file grounds it in **concrete, best-in-class exemplars** so the loop aims *at*
something, not merely *away* from generic-AI slop.

## How to use this (every UI change)
1. Before touching a surface, open its section below and study the exemplar — not
   "this looks good," but **why**: layout, type scale, spacing rhythm, hierarchy,
   interaction, restraint.
2. Design the surface **against** that reference — *"adapt THIS pattern to our
   brand (`docs/brand-kit.md` tokens),"* **never copy**. Combine ideas; don't
   clone a screen.
3. Build **one surface/component at a time** against its reference, not a whole
   page from a single prompt.
4. Where a **Mobbin / inspiration-grounding MCP** is available in the run
   environment, pull live screens for the surface and ground against them too.
5. This set is **LIVING**: when the DEEP AUDIT (§10) finds a surface that clears
   the slop-blocklist yet still feels average, the fix **adds the exemplar it
   should have aimed at** here — with a one-line note on the pattern to steal.

> Honesty rule: entries are curated pointers to real, shipping products chosen for
> a specific, studyable strength. As the loop curates, attach a captured
> screenshot (`docs/design/refs/<surface>-<name>.png`) + a one-line annotation of
> the exact pattern. Do not list a reference you have not actually looked at.

---

## Onboarding — first-run, low-friction, sets the taste expectation
AptDesignerAI's onboarding must feel like meeting an elite designer, not filling a form.
- **Arc (The Browser Company)** — warmth + motion make setup feel like a product with a point of view. *Steal:* progressive disclosure, one decision per screen.
- **Headspace** — calm, illustrative, single-focus steps. *Steal:* generous spacing, one idea per screen, no dropdown walls.
- **Houzz onboarding** — the closest domain analog (style quiz → taste profile). *Steal:* image-first "pick what you love" style selection over text questions.
- Mobbin category: *Onboarding · Consumer · Style quiz*.

## The core loop — room in → understanding → direction → sourced products
The heart of the app; image-first, editorial, confidence-inspiring.
- **Pinterest / Cosmos / Savee** — masonry, image-forward, zero chrome competing with the content. *Steal:* let the room/board be the hero; UI recedes.
- **IKEA Place / Houzz "View in My Room"** — spatial, trust-building product-in-context. *Steal:* the "see it in your space" confidence moment.
- **Midjourney web** — a generation/iteration loop that feels premium, not utilitarian. *Steal:* variation grids, quiet controls, focus on the output.
- **Linear** — for the *analysis/direction* panels: dense information that still feels calm and hierarchical. *Steal:* type scale + restraint under density.
- Mobbin category: *Home / Feed · Detail · Visual-first consumer*.

## Landing / marketing — sell the outcome ("designer in your pocket"), not a feature list
Must clear the VISION bar: a design-literate Gen-Z/millennial user believes real taste is behind it.
- **Linear · Vercel · Framer showcase sites** — reference-grade restraint, typography, motion-with-purpose. *Steal:* one strong idea per section, no card soup.
- **Farrow & Ball · Benjamin Moore** — color-led, editorial, unmistakably design-authoritative (directly on-domain). *Steal:* color AS the hero; confident whitespace.
- **Article · West Elm · Burrow** — furniture e-comm with editorial polish. *Steal:* product photography treatment, quiet CTAs, category cards that aren't generic.
- Awwwards / Godly / Land-book for current best-in-class landing patterns (combine, never clone).

## Paywall — premium, honest, converts without dark patterns
- **RevenueCat Paywall gallery** — the reference corpus of shipping paywalls; study the top-converting *and* the most tasteful.
- **Calm · Blinkist · Duolingo Super** — well-studied, high-conversion, still on-brand. *Steal:* value framing before price, single clear plan emphasis, no three-column pricing anxiety.
- *Anti-pattern (do NOT copy):* countdown-timer urgency, pre-checked upsells, guilt copy.

## Navigation, cards & lists — structure without generic SaaS-dashboard slop
- **Airbnb** — filter + card grid done right; dense yet breathable. *Steal:* card composition, filter bar restraint.
- **Things (Cultured Code)** — the gold standard for restraint and spacing. *Steal:* what to leave out.
- **Anthropologie / SSENSE** — editorial e-comm cards. *Steal:* image-led cards that don't look like a shadcn default.
- *Avoid:* excessive cards everywhere, three competing accents, centered-everything (§6b blocklist).

## Color & palette UI — the app's signature surface (interior design = color)
- **Coolors** — palette interaction done cleanly. *Steal:* lock/shuffle/edit affordances.
- **Farrow & Ball / Benjamin Moore color tools** — authoritative, tactile swatches. *Steal:* swatch treatment, named-color credibility.
- Ground palette output against `lib/scoring/color-math.ts` (CIEDE2000 / harmony) — references set the *feel*, the math enforces the *rules*.

---

*Seeded by the autonomous loop under §6b. Extend it — every "still feels average"
audit finding should leave a new, annotated exemplar behind.*
