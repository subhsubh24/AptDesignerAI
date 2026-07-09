# Onboarding & Conversion Playbook

Shared, product-agnostic playbook for consumer subscription products. Product/conversion-specific,
so per FACTORY_STANDARD §19 it lives here (the product repo), NOT in FACTORY_STANDARD. The PRODUCT
factory BUILDS this flow (activation track, clearing the VISION design bar + the guardrails below);
the GTM factory A/B TESTS it on REAL conversion data (§C). North star: show each user REAL
personalized value BEFORE asking them to pay — the free→paid moment lands on real value (VISION).
Persuasion via real value, YES; deception, NEVER (honesty enforced).

## A. The personalized onboarding blueprint (the high-converting sequence)
The proven pattern for consumer subscription apps — a personalized, value-first onboarding that
EARNS the paywall (each step must clear the design bar; no generic-AI slop):
1. **Warm, branded open** — a playful/animated intro (a mascot or tasteful motion) that sets tone.
2. **Promise the payoff up front** — immediately tell them they'll get a personalized plan/result;
   set the expectation for the effort you're about to ask for.
3. **Understand the user** — a short goal/quiz flow (a few HIGH-SIGNAL questions) to segment +
   personalize. Every question is friction — each must earn its place.
4. **Reflect it back** — visualize their situation/goals + projected outcome with clean charts / a
   results screen. Show them you understood.
5. **Build their plan** — a genuine "building your personalized plan" moment. It MUST reflect REAL
   computation/personalization (see §B) — never a fake timer.
6. **Earn commitment** — before revealing the full plan, ask for a small commitment (a goal date,
   an "I'm ready", a pledge). Commitment/consistency lifts follow-through AND conversion.
7. **Reveal the personalized plan** — the aha: their tailored plan/result, clearly THEIRS, not
   one-size-fits-all.
8. **Paywall at peak value** — present the paywall AFTER the personalized experience, at the moment
   perceived value is highest, framed around THEIR plan/outcome (not a generic feature list).
9. **Reduce trial anxiety** — offer a free trial and CLEARLY tell them they'll get a reminder
   before it ends. This is pro-consumer, it lifts trial starts, and Apple supports it.
10. **Personalize the whole thing** — no two users get the same experience; copy, plan, and visuals
    reflect their answers so each feels the app was built for them.

## B. Honesty guardrails (persuasion, NEVER deception — non-negotiable)
Our doctrine forbids dark patterns + fabrication. Ship ONLY the honest version of the above:
- **REAL personalization** — the plan/result/visuals genuinely derive from the user's answers. A
  "building your plan…" / "analyzing…" screen is allowed ONLY when real work is happening; a FAKE
  delay to manufacture perceived value is a DARK PATTERN and is forbidden.
- **No manufactured urgency/scarcity** — no fake countdowns, fake "X spots left", or invented
  social proof/testimonials.
- **Honest pricing + easy cancel** — price shown clearly before purchase; trial terms + auto-renew
  disclosed; cancellation easy. The trial-end reminder is required-quality, not optional.
- **True claims** — any projected outcome/result is a realistic, defensible estimate, labeled as an
  estimate; never a fabricated number.
- **Compliant + accessible** — Apple/Play subscription guidelines; a11y onboarding (contrast,
  focus, labels, reduced-motion for the animation).
- **Friction discipline** — every added step must earn its conversion lift in an experiment (§C) or
  it gets cut. Personalization is not a long slog.

## C. A/B test it (the GTM factory owns the experiments)
Build the blueprint, then let the GTM factory optimize it on REAL conversion data (falsifiable
hypothesis + minimum sample size + a significance check; keep winners, kill losers; "insufficient
data" over noise). High-value tests:
- **Paywall placement** (after the reveal vs. earlier) + **framing** (their-plan-centric vs. generic).
- **Commitment step** on/off + type.
- **Quiz length/order** (drop-off vs. personalization value) — cut questions that don't earn lift.
- **Results-visualization** style + the plan-reveal moment.
- **Trial** vs. no-trial, trial length, hard vs. soft paywall.
- **First-screen hook** / mascot vs. none.
Optimize for the REAL outcome — conversion, retention, LTV (ROAS-style), never vanity installs/opens.
Feed winning learnings into docs/BUSINESS_CASE.md and (high-confidence only) a roadmap steer.

## D. Where it fits
- **Product factory:** builds the onboarding→reveal→paywall flow (activation track), clearing the
  design bar + §B guardrails, wired to the real paywall/entitlement code (RevenueCat/Superwall/
  StoreKit/Stripe already in scope).
- **GTM factory:** runs §C experiments on connected analytics/billing; feeds conversion/retention
  learnings into the business case; steers the roadmap on high-confidence evidence.
- Ties directly to the VISION "free→paid moment lands on real value" and the store CPP work
  (STORE_GROWTH_PLAYBOOK §A) — a competitor-search visitor can land on a matching onboarding.

## Boundaries (reaffirmed)
Persuasion via real value, never deception. No fake personalization theater, no dark patterns,
honest pricing + easy cancel, true claims only, Apple/Play-compliant, accessible. Real metrics only
in every experiment — never fabricate a conversion/retention number.
