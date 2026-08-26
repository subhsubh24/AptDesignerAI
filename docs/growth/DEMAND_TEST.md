# The demand test — pre-committed kill criteria

**Status:** not yet run. **Written:** 2026-08-26.

This document exists because of a specific finding, and it commits to a specific
decision rule BEFORE the data arrives. That ordering is the whole point: a kill
criterion chosen after seeing the number is not a criterion, it is a
rationalisation.

## What we actually know

After ~191 Product-Factory runs and 27 GTM-Factory runs across roughly two
months, `docs/growth/GROWTH_STATUS.md` reports:

```
visitors_7d: 0        waitlist_signups_total: 0     trial_starts_total: 0
paid_conversions_total: 0    active_subscribers: 0   mrr_usd: 0
pmf.signal: none
```

**Those zeros are not market feedback.** They are the absence of an experiment.
Four independent facts, each verified on 2026-08-26:

1. **`aptdesignerai.com` was never registered** (`whois` → "No match"; Vercel
   → available, $11.25/yr). See APT-69. The canonical domain the whole
   codebase points at does not exist.
2. **Production is 45 days stale** — last deploy 2026-07-12, while the repo ran
   to Run 191. See APT-70.
3. **Vercel Web Analytics is not enabled** on the project, so even incidental
   traffic was never measured.
4. **`/` redirected every anonymous visitor to a login wall**, making
   `app/page.tsx` — a complete, SEO-annotated landing page — unreachable dead
   code. See APT-71, fixed in PR #994.

So the product has never been exposed to a single real user. We have evidence
neither for nor against this business.

## The structural risk, stated plainly

Two things are worth knowing before spending more:

- **Category base rate is poor.** Modsy raised ~$70M for approximately this
  product and shut down in 2022. Havenly pivoted toward human designers and
  retail.
- **Frequency is the hard problem.** People furnish an apartment roughly once
  every 3–5 years. A subscription priced against a once-every-few-years job is
  fighting its own shape, and it is exactly why `functional_reality`'s
  retention gap is ship-critical rather than cosmetic. This is a product-shape
  question, and no amount of code quality answers it.

The honest base case already concedes the arithmetic: **$71,207 year-1 exit
run-rate against a $100,000 floor** (`analysis/business_case_scenario_b_year1_arr.mjs`),
and that model has never met a real customer.

## The test

Six steps. Five are not code. Nothing here needs the factory loop running —
which is why both factories are paused while this runs.

| # | Step | Gate |
|---|---|---|
| 1 | Register a domain, point it at `apt-designer-ai` | owner (real money, ~$11.25) |
| 2 | Enable Vercel Web Analytics | owner (dashboard) |
| 3 | Set `DATA_BACKEND=supabase` in prod + apply migrations | owner (prod migration) |
| 4 | Deploy current `HEAD` | owner (fire hook) or wire auto-deploy |
| 5 | Land traffic on `/`, which now serves the real page | — (PR #994) |
| 6 | Drive 300–500 visitors from one honest channel | owner (channel auth) |

Step 3 matters more than it looks: `lib/supabase/server.ts` defaults
`DATA_BACKEND` to `memory`, so the deployed app **does not persist data across
processes**. Until it is flipped, the thing in production is a demo that
forgets you, and any retention reading taken from it is meaningless. This is
the same blocker that has held `functional_reality` at **C for nine consecutive
grading cycles**.

## The kill criteria — decided in advance

Run the test to 300 visitors minimum. Then:

- **Visitor → waitlist below 5%** → **stop.** For a product solving a problem
  people supposedly feel acutely, a landing page that cannot convert 1 in 20
  is not being held back by polish.
- **Waitlist → "what would you pay?" reply rate below 20%** → **stop.** Signing
  up for a free list is cheap; replying about money is the first honest signal.
- **Both clear** → the demand question is open, and the next spend is on the
  retention problem above, not on more code quality.

At 300 visitors a 5% threshold has a 95% CI of roughly ±2.5pp, so a reading of
2% or 9% is decisive while 4–6% is not. If it lands in that band, extend to
500 rather than arguing about it — and do not move the threshold.

## Why the loops are paused

Both the Product Factory (`trig_013TKiTsB7gfJRTy5uLRGF4d`, was 3×/day) and the
GTM Factory (`trig_01KGyuo3DCQkzMZP1qvWK8Cf`, was every 2 days) were set
`enabled: false` on 2026-08-26. Schedules, prompts, models and MCP bindings are
untouched — unpausing is a single `{"enabled": true}` call each.

The two weekly auditors stay **running** deliberately: they are cheap, they own
the independent grade, and they are the maker≠checker safety net if anything
changes by hand while the factories are down.

The reason for the pause is not that the loop worked badly. Its code discipline
is genuinely high, and it caught real problems — including its own fabricated
testimonial, which it fixed in Run 89 and which is *still live* only because
production never redeployed. The reason is that **the loop optimised the one
variable it could reach**, and that variable does not determine the answer. Two
months of rigorous work on code quality could not discover that the domain was
never bought, because nothing in the loop's world model included buying a
domain.

Restart the factories when the demand test returns a result — not before.
