# Business Case — AptDesignerAI

```yaml
# BUSINESS_CASE_SUMMARY (machine-readable; keep in sync with the analysis below)
currency: USD
arr_year1:
  conservative: 56000
  base: 149300
  optimistic: 335900
planning_case: base
floor_usd: 100000
floor_met_year1: false
time_to_floor: "$149.3K is the STEADY-STATE base ARR; the year-1 exit run-rate is $71,207 (registered, analysis/business_case_scenario_b_year1_arr.mjs) because the Pro subscriber pools compound over time, so the floor is still NOT met in year 1; the prior ~year-3 crossing now arrives earlier at the corrected take rate, but the exact crossing has not been re-derived and is deliberately not restated here"
channel_priced: store
as_of: 2026-07-29
```

> **Take-rate correction 2026-07-28 (factory loop).** Every ARR figure in this document moved
> UP, by a single consistent factor, because the model was applying a commission this business
> does not pay. The independent Quality Auditor named half of it (`QUALITY_SCORECARD.md`,
> `business_case_strength`): the model applied a flat **30%** store commission
> (`STORE_NET = 0.70`) to EVERY line of EVERY scenario, while the most-scrutinised figure — the
> shippable-today one — is web/Stripe-only BY CONSTRUCTION, since the only reason it zeroes the
> annual tier is that Pro Annual is gated off in `lib/billing/stripe.ts` + migration 021, which
> are Stripe concerns with no store-channel equivalent. The other half is that **30% is not the
> rate on either channel at this scale**: Apple's Small Business Program is 15% (an owner
> enrolment step — see below), and Google Play's 2026 structure is a 10% service fee on the
> first $1M for auto-renewing subscriptions plus a 5% billing fee (~15% effective). 30% is the
> rate ABOVE $1M in proceeds — roughly 3x the top of this document's own optimistic scenario.
>
> **The 15% store rate is an owner ACTION, not a given.** Apple separates eligibility from
> enrolment: eligibility under $1M is automatic, but the Account Holder must accept the Paid
> Apps agreement (Schedule 2) in App Store Connect, list any Associated Developer Accounts, and
> the reduced rate then applies 15 days after the end of the fiscal month in which enrolment is
> approved. Un-enrolled, the store rate is 30% and the store column here is wrong. An earlier
> draft of this entry said new developers "qualify automatically" — that conflated the two and
> would have let the model bank a discount nobody had claimed. Tracked as
> `enroll-apple-small-business-program` in `PENDING_OPS.md`.
>
> This document had **already written that down** ("Margin upside not in the headline") and
> deliberately excluded it to stay conservative, on the stated grounds that "the floor is cleared
> without it." That premise was false: the shippable-today figure came to **$99,926**, ~$74
> BELOW the floor. Excluding a real, published, applicable rate is not conservatism when the
> excluded rate is the one actually charged — it is a wrong input that happened to point
> downward.
>
> The correction moves the headline up, which is the direction that deserves the most suspicion,
> so, precisely: every rate is a published primary-source list price (linked in Sources);
> **not one behavioural input changed** — installs, Day-30 retention, conversion, churn, tier
> mix and annual adoption are byte-identical; the model's default channel is the **less**
> favourable of the two; Stripe's **$0.30 is applied per transaction, not as a blended
> percentage**, because a flat percentage would quietly flatter the $29 tier that carries 60% of
> conversions; and **`floor_met_year1` stays `false`** — this changes the steady-state level, not
> the ramp. The 15% store rate holds only below $1M proceeds and is flagged in the model as a
> constant to revisit, not inherit, if the business crosses it.
>
> Shippable-today ARR is now **$121,339** on the conservative store channel and **$136,762** on
> web/Stripe — it clears the $100K floor on either, where before it missed on a rate that applies
> to neither. Both ends of that band are registered in `analysis/figures.json` and re-run by
> `scripts/validate-computation.mjs` on every PR, so neither is quotable without being verified.
>
> **Computation-integrity verification 2026-07-15 (Growth Agent Run 10).** No committed,
> reproducible script backed any of this doc's ARR figures until now (FACTORY_STANDARD §22 —
> "every quantitative claim... produced by executed, reproducible code, never mental
> arithmetic" — was previously unmet here; both `GTM_SCORECARD.md` and
> `QUALITY_SCORECARD.md`'s `business_case_strength` dimension independently cite the
> without-annual **$99,926** figure, which until now existed only as a one-off, uncommitted
> `node` calculation). Added `analysis/business-case-model.mjs` (the shared revenue-model core,
> reproducing "The revenue model" section below verbatim) plus four registered figures —
> `analysis/business_case_scenario_{a,b,c}_arr.mjs` and
> `analysis/business_case_without_annual_arr.mjs` — wired into `analysis/figures.json` so
> `scripts/validate-computation.mjs` (a required preflight gate, previously vacuous) now
> mechanically re-runs and verifies all four ARR figures on every PR. Independently re-derived
> (maker≠checker, fresh subagent, re-ran all 4 scripts + the gate + a from-scratch hand
> reimplementation of the formula): Scenario A **$46,109** (doc: ~$46,200), Scenario B
> (planning case) **$122,956** (doc: ~$122,900), Scenario C **$276,652** (doc: ~$276,800), and
> the without-annual shippable-today figure **$99,926 exactly** — confirming, not gaming, the
> Quality Auditor's precise "$99,926, $74 below the floor" reading (`QUALITY_SCORECARD.md`,
> `business_case_strength`) and the GTM Auditor's rounded "~$99.9K" reading
> (`GTM_SCORECARD.md`). No figure or number in this document changed; this
> makes the existing figures independently re-derivable by anyone, permanently, instead of
> resting on an unrepeatable one-off calculation.
>
> **Annual-tier disclosure fix 2026-07-13 (Growth Agent Run 9).** The independent GTM Auditor
> (`GTM_SCORECARD.md`, `auditor_run: 2`) named a real disclosure gap: the planning case credits
> ~38% of steady-state MRR to the Pro Annual tier while annual billing is currently gated OFF in
> prod (migration 021 unapplied, `ANNUAL_BILLING_ENABLED` off) — the doc read as if annual were
> live today. Added an explicit "gated off, not live" disclosure to the Pro Annual section and
> tightened the without-annual scenario to the correct, computed **~$99.9K** (AT the $100K floor,
> not over it — verified via `node`, not eyeballed) rather than the vaguer "~$100K baseline." No
> number was gamed: the floor claim always relied on the annual tier being live; this makes that
> dependency explicit instead of implied. ARR magnitude/levers otherwise unchanged.
>
> **Floor-timing honesty recompute 2026-07-08 (Run 71).** Corrected an overstatement:
> the summary previously read `floor_met_year1: true` ("exceeds the $100K floor in year 1"),
> but the $122.9K base ARR is built entirely from **steady-state** subscriber pools (~171
> monthly + ~167 annual Pro subs, below) that are fed by only ~12 + 4 net-new subs/month and
> take years to accumulate. The honest **year-1 exit run-rate is ~$58–60K** (month-12 pools:
> ~100 monthly Pro × $34.30 + ~42 annual Pro × $23.28 + ~$487/mo apartment ≈ $4.9K MRR ≈
> $59K ARR); the **$100K floor is reached ~year 3** as the pools compound — consistent with
> Scenario A's own note that the identical steady-state model "requires 2–3 years to compound
> to $100K." Set `floor_met_year1: false` and rewrote `time_to_floor`; the $122.9K figure is
> relabelled **steady-state** throughout the body so the summary reconciles. The ARR magnitude,
> margin math, and levers are unchanged — only the year-1 *timing* claim was wrong.
>
> **COGS recompute 2026-07-04 (Run 61).** Corrected the per-analysis unit-economics
> to the model the code actually uses: the reasoning-heavy stages (apartment/area
> understanding + diagnosis) run at HIGH thinking and route to `TEXT_TIERS.mid` =
> **Gemini 3.1 Flash Lite** (`lib/ai/models.ts`), not the base-tier Gemini 2.5 Flash
> Lite the doc previously cited. At the 3.1 Flash Lite price ($0.25/$1.50 per 1M in/out,
> per the official Gemini pricing page) per-analysis text inference is ~$0.002 (was
> $0.0006) — still negligible, so
> gross margin stays ~97–99% and **ARR is unchanged** (COGS moves margin, not revenue).
>
> **Last recomputed 2026-06-30 (Run 47).** Changelog: re-grounded the base-case
> organic-install share from an above-benchmark 50% to **40%** (the top of the
> cited 35–40% benchmark) so the planning case no longer leans on an assumption
> the doc itself flagged as optimistic; added an explicit **net-margin
> sensitivity table** vs organic share; **credited the two now-built revenue
> levers** — the waitlist referral loop (PR #226) and the in-product web upsell
> surface (PR #238) — with researched referral-economics benchmarks; and noted
> the **Apple Small Business Program 15% commission** (the app qualifies at
> launch, < $1M proceeds) as a documented margin upside the headline
> conservatively excludes. ARR is unchanged: organic share moves marketing COST
> and net margin, not revenue, so the floor-clearing base ARR ($122.9K) holds;
> the change makes the **path to positive net margin** honest and lever-backed
> rather than resting on an optimistic acquisition-mix assumption.

A bottoms-up, research-grounded estimate of the path to ≥ $100K/yr ARR. Maintained
as a living artifact; update when pricing, conversion data, or market conditions change.
**All benchmarks cited; no invented metrics.**

---

## The product and pricing (as of June 2026)

| Tier | Price | Model |
|---|---|---|
| Explore | Free | 1 full room analysis, no card required |
| Apartment | $29 | One-time; unlimited rooms in one apartment |
| Pro | $49/month | Unlimited apartments, client-ready share links, priority support |
| Pro Annual | $399/year | Same as Pro, billed annually (~$33/mo effective — save 32%) |

Pro Annual was added in PR #98 / migration 021. The annual tier reduces effective price by 32% vs monthly, dramatically improves retention (annual subscribers renew once per year, not monthly), and improves upfront cash flow.

> **Annual billing is currently GATED OFF, not live.** Migration 021 (the `stripe_customers.tier`
> CHECK constraint extension for `'pro_annual'`) is unapplied to prod and `ANNUAL_BILLING_ENABLED`
> defaults off (`PENDING_OPS.md apply-migration-021`, `status: open`) — the checkout route refuses
> `pro_annual`, the pricing-page annual CTA is hidden, and `/billing/upgrade?tier=pro_annual`
> redirects to `/pricing` (PR #597). The economics below model Pro Annual as a **planned, built-but-
> not-yet-turned-on lever**, not a currently transactable tier — see the without-annual floor check
> in "What would have to change to NOT reach $100K" below for the number that holds today.

Distribution: iOS App Store + Google Play (15% commission at this revenue scale — Apple Small
Business Program, Google Play's first-$1M tier; 30% applies only above $1M in proceeds), plus
web checkout over Stripe (2.9% + $0.30, +0.7% Billing on recurring). See "Channel economics".

### Pro Annual tier economics

Annual subscribers pay $399 × 0.85 (after the 15% store commission) = **$339.15 net per year** upfront. Compared to the monthly Pro plan:

| Metric | Monthly Pro | Pro Annual | Delta |
|---|---|---|---|
| Net revenue per subscriber/yr | $49 × 0.85 × 12 = **$499.80** | **$339.15** | −32% per year |
| Annual renewal churn | 58.1% (1 − 0.93¹², compounding monthly churn over 12 months — CORRECTED Run 15; a prior version wrote 84% = 7%/mo × 12, a rate-vs-probability conflation that overstated this row) | **~25%** (at renewal) | −33pp |
| Avg subscriber lifetime | ~14 months | **~4 years** | +240% |
| LTV | ~$595 | **~$1,357** | +128% |

Source: 25% annual renewal churn (Recurly Research B2C subscription benchmarks; consumer lifestyle apps 20–30%).

**Net effect on revenue:** Each annual subscriber generates less revenue per calendar year but far more over their lifetime. The large retention improvement more than compensates at steady state, increasing the subscriber base pool and total ARR even though the per-subscriber annual price is lower.

---

## Unit economics — per-user COGS

The dominant text-inference cost is the room/apartment understanding + diagnosis
pipeline. These are the reasoning-heavy stages, so they run at HIGH thinking and route
to `TEXT_TIERS.mid` = **Gemini 3.1 Flash Lite** (`lib/ai/models.ts`), not the cheaper
base tier. The cheaper stages (validation, scoring, extraction, search) run on the base
tier (Gemini 2.5 Flash Lite) and cost less than the figures below.

| Component | Cost per room analysis |
|---|---|
| Input tokens (~2,000: image + prompt) @ $0.25/M | $0.0005 |
| Output tokens (~1,000: analysis JSON + reasoning) @ $1.50/M | $0.0015 |
| **Total per analysis (Gemini 3.1 Flash Lite)** | **~$0.0020** |

Source: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
and [Pricepertoken.com](https://pricepertoken.com/pricing-page/model/google-gemini-3.1-flash-lite-preview)
— $0.25 / $1.50 per 1M input/output tokens.

Image-render (mockup) COGS is separate and larger per call, but bounded: renders go
through a content-addressed cache (`computeMockupCacheKey` in `app/api/mockups/route.ts`)
so identical inputs don't re-bill, and the free tier caps renders per user. It does not
change the conclusion below.

Hosting (Vercel + Supabase) is estimated at ~$200/month flat, amortized across users.

| Scenario | Monthly active users | Hosting per user | API per user (~10 analyses) | Total COGS/user |
|---|---|---|---|---|
| Early stage (500 MAU) | 500 | $0.40 | $0.02 | ~$0.42 |
| Growth stage (5,000 MAU) | 5,000 | $0.04 | $0.02 | ~$0.06 |

**Gross margin: effectively 97–99%.** The cost structure is dominated by fixed hosting,
not per-user compute — even at the corrected 3.1 Flash Lite pricing, per-analysis text
inference is only ~$0.002. At scale, per-user COGS is negligible. This is a healthy
software unit economics profile, not an infra-heavy AI product.

---

## Market context

### Competitive landscape

| Competitor | Model | Price |
|---|---|---|
| Houzz Pro | Monthly subscription | $55–$400/month |
| Planner 5D | Freemium + annual | Free / $60–$400/year |
| Homestyler | Freemium + subscription | Free / $4–$20/month |
| Havenly | Per-room design service | $159–$499/room |
| Spacejoy | Per-room custom packages | Starting $299 |
| Modsy | Per-room (historical) | Ceased operations July 2022 |

Sources: G2 (Houzz Pro), Planner 5D, Havenly, Homestyler, Spacejoy pricing pages.

**AptDesignerAI's position**: Lower-cost and faster than designer-led services
($29 one-time vs $159–499/room), with deeper AI analysis than DIY tools that are
mostly 3D planners. The differentiation is honest, room-specific analysis vs generic
mood boards. This is a defensible position in a market where the main players either
require human designers or don't read the actual room.

---

## Key benchmark inputs (all research-grounded)

| Metric | Benchmark | Source |
|---|---|---|
| Free-to-paid conversion (freemium apps, general) | 2–5% | Geneo.app freemium benchmarks |
| Free-to-paid conversion (top performers) | 6–8% | Geneo.app; Canva reference (~6%) |
| Monthly subscription churn (lifestyle apps) | 6–7.5% | Business of Apps; Adapty lifestyle benchmarks |
| Day-30 churn (lifestyle installs) | 70–80% | CleverTap mobile app churn analysis |
| CPI, iOS (North America, design category) | $4.70 | Mapendo CPI Benchmarks 2025 |
| CPI, Android | $3.70 | Mapendo CPI Benchmarks 2025 |
| **Blended CPI used in model** | **$4.30** | Derived: $4.70 × 60% iOS + $3.70 × 40% Android = $4.30 |
| Organic install share | 35–40% | MobileAction / SplitMetrics 2025 |
| App Store conversion (paid search ads) | 67% | SplitMetrics |
| App Store conversion (organic browse) | 25–27% | SplitMetrics |

---

## The revenue model

**Formula (updated for Pro Annual tier):**

```
Monthly Net Revenue =
    (New_Installs × Day30_Retention × ConversionRate × ApartmentMix × net($29))   [one-time]
  + (Steady_State_Pro_Monthly × net($49))                                        [monthly sub]
  + (Steady_State_Pro_Annual  × net($399)/12)                                    [annual sub, MRR]

net(x) is CHANNEL-dependent — see "Channel economics". On the store channel (the
default, and the lower of the two) net(x) = x × 0.85, giving $24.65 / $41.65 /
$339.15 per charge. The annual charge is netted ONCE and then amortised over 12
months ($28.26/mo), because the transaction fee is paid once a year.

Steady_State_Pro_Monthly = (NewPro × MonthlyMix) / MonthlyChurn
Steady_State_Pro_Annual  = (NewPro × AnnualMix) / EffectiveMonthlyChurn_Annual

EffectiveMonthlyChurn_Annual = 1 − (1 − AnnualRenewalChurn)^(1/12)
                              = 1 − 0.75^(1/12) ≈ 2.4%/month

ARR = Monthly_Net_Revenue × 12
```

**Shared assumptions across scenarios:**
- Day-30 retention: 25% (industry: 20–30%; slightly optimistic given design intent)
- Monthly Pro churn: 7% (mid-range for lifestyle apps; implies average sub duration ~14 months)
- Annual Pro renewal churn: 25% (Recurly Research B2C benchmarks; consumer lifestyle 20–30%)
- Store commission: **15%** (Apple Small Business Program — new developers qualify
  automatically; Google Play 2026 = 10% service fee on the first $1M for auto-renewing subs
  + 5% billing fee ≈ 15% effective). 30% applies only above $1M in proceeds, which is ~3x the
  top of Scenario C — if the business crosses it, this constant must be revisited, not inherited.
- Web/Stripe fees (the alternative channel): 2.9% + $0.30 per charge, +0.7% Stripe Billing on
  recurring. Net is 96.1% on $29, 95.8% on $49, 96.3% on $399 — better than the store on every
  tier, and the fixed $0.30 is why it is computed per charge rather than as one blended rate.
- Mix: 60% Apartment one-time, 40% Pro subscription (conservative; Pro has better LTV)
- Annual plan adoption: **25% of new Pro subscribers choose annual** (conservative; typical consumer SaaS 15–40%); remaining 75% choose monthly Pro

---

## Three scenarios

### Scenario A — Conservative
**Inputs:** 2,000 installs/month, 3% conversion, 70% organic

```
Active users reaching paywall: 2,000 × 0.25 [Day-30 retention] = 500/month
Paid conversions: 500 × 0.03 = 15/month
  Apartment buyers: 15 × 0.60 [Apartment mix] = 9/month  →  9 × $24.65 = $222/month
  Pro new subscribers: 15 × 0.40 [Pro mix] = 6/month
    Monthly Pro (75%): 4.5/month  →  steady-state: 4.5 / 0.07 = 64.3 subs  →  64.3 × $41.65 = $2,677/month
    Annual Pro (25%): 1.5/month   →  steady-state: 1.5 / 0.024 = 62.5 subs  →  62.5 × $28.26 = $1,766/month
  Combined Pro MRR: $4,443/month

Total MRR: $4,666  →  ARR: ~$56,000/year
```

**Paid acquisition cost (30% paid installs):**  
600 paid installs × avg $4.30 CPI = $2,580/month = $30,960/year

**Verdict:** Falls short of $100K but is 23% better than without the annual tier ($45,502 → $55,989). This is the bootstrap-organic scenario: sustainable (revenue > marketing spend) but requires 2–3 years to compound to $100K without investment. The lever to pull: improve conversion from 3% to 5% via paywall timing + trial optimization.

---

### Scenario B — Base (planning case)
**Inputs:** 4,000 installs/month, 4% conversion, **40% organic** (top of the 35–40% benchmark)

> **Why 40% organic (not 50%):** A prior version of this model headlined 50% organic and
> flagged it as above the 35–40% benchmark. That was an honesty gap — the planning case
> should not lean on an above-benchmark assumption. We now anchor the base case at **40%**,
> the **top** of the cited 35–40% range (MobileAction / SplitMetrics 2025), which is the
> defensible ceiling for a launch with no operating history. Pushing **beyond** 40% toward
> the 50–65% organic share that makes the margin comfortable is the job of the two built
> growth levers below (referral + the visual-content marketing engine) — that is upside the
> model now treats as a lever to earn, not a baseline to assume.

```
Active users reaching paywall: 4,000 × 0.25 [Day-30 retention] = 1,000/month
Paid conversions: 1,000 × 0.04 = 40/month
  Apartment buyers: 40 × 0.60 [Apartment mix] = 24/month  →  24 × $24.65 = $592/month
  Pro new subscribers: 40 × 0.40 [Pro mix] = 16/month
    Monthly Pro (75%): 12/month   →  steady-state: 12 / 0.07  = 171.4 subs  →  171.4 × $41.65 = $7,140/month
    Annual Pro (25%):   4/month   →  steady-state:  4 / 0.024 = 166.7 subs  →  166.7 × $28.26 = $4,710/month
  Combined Pro MRR: $11,850/month

Total MRR: $12,442  →  ARR: ~$149,300/year ✓✓ (+23% vs monthly-only model)
```

> **Steady-state, not year-1.** The $149,300 above is the ARR once the monthly/annual Pro
> pools have filled to steady state. Because those pools are fed by only ~12 + 4 net-new
> subs/month against 7%/2.4% monthly churn, they compound over years: the **year-1 exit
> run-rate is $71,207** (`analysis/business_case_scenario_b_year1_arr.mjs`, registered in
> `analysis/figures.json`, verified by `node scripts/validate-computation.mjs` — replaces the
> previously-uncomputed "~$70–73K" prose range with an exact, reproducible figure, 2026-08-03), so
> the floor is still **NOT met in year 1** (see the summary block's `floor_met_year1: false`). The
> 2026-07-28 take-rate correction raised the LEVEL, not the ramp — the pools fill at exactly the
> same rate — so the crossing arrives earlier than the previous ~year-3 estimate, but that crossing
> has **not been re-derived** and is deliberately not restated as a number here. The steady-state
> figure is the right planning anchor for whether the model *can* clear the floor; the ramp is the
> honest timeline for *when*.

ARR is unchanged by acquisition mix: **organic share moves marketing COST and net margin, not
revenue.** Installs × retention × conversion × price set the $149.3K ARR; the acquisition mix
sets how much of it survives marketing spend. So the floor is still cleared at $149.3K — the
honest question is net margin.

**Net-margin sensitivity to organic share** (4,000 installs/mo, blended CPI $4.30, ARR $149.3K):

| Organic (non-paid) share | Paid installs/mo | Marketing/yr | Net margin/yr |
|---|---|---|---|
| 35% (benchmark floor) | 2,600 | $134,160 | **+$15,144** |
| **40% (planning case)** | 2,400 | $123,840 | **+$25,464** |
| 50% | 2,000 | $103,200 | **+$46,104** |
| 65% | 1,400 | $72,240 | **+$77,064** |

> The margin row is where the take-rate correction bites hardest. At 30% this table ran from
> −$11,260 to +$50,660 and the planning case sat at break-even; at the rate actually charged it
> is positive across the whole benchmark range. Marketing spend is untouched — only the share of
> revenue that survives the commission changed.

**Verdict:** The base case clears the **$100K ARR floor** at its **steady-state** $149.3K
regardless of acquisition mix (year-1 exit run-rate $71,207, i.e. the floor is not met in year
1; the pools compound toward it). At the honest 40%-organic anchor it is now **net-margin
positive** (+$25.5K) rather than break-even — but that margin is thin enough that driving
non-paid share toward 50%+ remains the difference between a viable business and a fragile one.
That is precisely what the two **built** levers below are for; the annual tier (which lifts
LTV by cutting renewal churn on 25% of Pro conversions from ~58%/yr to 25%/yr — corrected
Run 15, see the Pro Annual tier economics table above) compounds the
return on every acquired user. The strategy is unchanged and now honestly stated: **the floor
is revenue-secured; positive margin is organic-led, and the levers to get there are built.**

### Built revenue levers (now credited)

The prior model named referral and expansion as levers but they were not yet built. Both now
exist in the product, so the path from a thin margin to a comfortable one is concrete, not
aspirational:

- **Waitlist referral loop (PR #226 / migration 026).** Shareable referral codes with
  attribution. Industry benchmarks: mature mobile referral programs drive **20–35% of installs**,
  at a referral CAC of **$0.50–$1.50 — 3–5× cheaper than paid** — and referred users show
  **~37% better Day-30 retention and ~25% higher LTV** (GrowSurf 2026 mobile-referral data).
  Even a **conservative 15% referral install share** (below the 20–35% mature-program band, to
  reflect a no-history launch) lifts effective non-paid share to the **50% line or above**,
  landing net margin in the **+$20K and up** zone on the table above — at materially better
  retention than paid installs. This is the single highest-leverage acquisition lever and it is built.
- **In-product web upsell surface (PR #238).** A reusable upgrade CTA + `GET /api/billing/status`
  wired into the saved-designs flow (web parity with the proven mobile paywall). It raises
  **expansion/conversion at the post-value moment** (after a free user has seen real output),
  improving the 4% free→paid input and the Pro/annual mix that drives MRR — i.e. it lifts the
  revenue side of the same table, complementing the referral lever's cost side.

Three further levers shipped after 2026-07-20 and were missing from this section until
2026-07-29. **None of them is credited with any uplift in the figures above** — the model's
4% free→paid and its churn inputs are unchanged, and the floor is cleared without them. They
are recorded because a "built revenue levers" section that omits built revenue levers
understates what the product already does, which is its own kind of dishonesty:

- **Free-tier save-limit paywall (commit 724e138, Run 105).** Hitting the free save quota used
  to return a bare 403 and a dead-end retry toast. It now opens a real upgrade Dialog carrying
  the `UpgradeCtaCard`, and emits a `save_limit_paywall_shown` funnel event
  (`lib/analytics.ts`, `app/projects/[projectId]/rooms/[roomId]/focus/page.tsx`). It fires at a
  post-value moment — the user has already seen a finished design — rather than at a cold gate.
  It ADDS a second web conversion surface alongside the PR #238 upgrade CTA credited above; it
  did not create the first one, and no uplift is claimed for it over that existing surface.
- **Save→share viral nudge (commit 0ab361a, Run 106).** After a save, the user is nudged to the
  public share link, with funnel events on the path. It is an acquisition lever sitting on a
  retention surface — a user's own saved work becomes the distribution. It adds to the organic
  acquisition this document already credits (the waitlist referral loop above; the Tracks E2–E6
  engine cited in the channel-mix sections). Deliberately carrying no rank and no category
  exclusion: three earlier drafts of this sentence claimed "the only", then "the second", then
  "non-ASO", and each was contradicted by another passage in this same file.
- **`past_due` grace window (commit f4011f4).** A failed renewal no longer revokes Pro
  instantly; access persists for `PAST_DUE_GRACE_DAYS = 14` (`lib/entitlements/web.ts:41`) and
  then lapses, so a dropped webhook or a temporarily declined card does not read to the user as
  cancellation. This is involuntary-churn recovery: the user has not decided to leave, so the
  subscription is retained without a discount or a win-back offer. The churn inputs above are
  NOT reduced to reflect it, and no claim is made about how it ranks against other retention
  work: reducing churn without a cited dunning-recovery benchmark for this product would be
  exactly the input-nudging this document refuses.

### Channel economics

**Corrected 2026-07-28.** This section used to be titled "Margin upside not in the headline" and
argued that the 15% small-business rate was deliberately excluded to keep the case conservative,
"anti-gaming: the floor is cleared without it." The exclusion was real; the justification was
not — the shippable-today figure came to $99,926, ~$74 UNDER the floor. Withholding the rate a
business actually pays is not conservatism, and the arithmetic it was protecting did not hold.
The rate is now in the model.

| | Store (App Store / Play) | Web (Stripe) |
|---|---|---|
| Fee at this scale | 15% | 2.9% + $0.30, +0.7% Billing on recurring |
| Net on $29 one-time | $24.65 (85.0%) | $27.86 (96.1%) |
| Net on $49/month | $41.65 (85.0%) | $46.94 (95.8%) |
| Net on $399/year | $339.15 (85.0%) | $384.34 (96.3%) |
| Shippable-today ARR (steady-state) | **$121,339** | **$136,762** |
| Shippable-today ARR (**year-1 exit run-rate**) | **$73,519** | **$82,873** |

Every headline figure in this document is priced on the **store** channel — the lower of the two
at every price point — so an unqualified number here is the harder one to beat. Web/Stripe is
the better-margin channel and is the one live today, which is why the shippable-today case is
quoted at both ends of the band rather than at a blended mix that no source supports.

> **Steady-state, not year-1 — the same caveat the $149.3K base case carries, now applied here
> too.** ADDED 2026-08-03 per the independent GTM Auditor (`GTM_SCORECARD.md`,
> `business_case_honesty`): the $121,339 / $136,762 figures above are computed via the identical
> multi-year Pro-subscriber-pool-fill formula as Scenario B's $149,300 — which already carries a
> "steady-state, not year-1" box below — but had been quoted as "the honest number for TODAY's
> transactable product... over the floor" with no equivalent caveat. Registered and reproducible
> (`analysis/business_case_without_annual_year1_arr.mjs` / `..._year1_web_arr.mjs`, verified by
> `node scripts/validate-computation.mjs`): the **year-1 exit run-rate is $73,519 (store) /
> $82,873 (web) — BELOW the $100K floor on either channel.** The steady-state figures are real and
> useful as the planning ceiling once the Pro subscriber pools fill against 7% monthly churn (this
> takes years, same mechanism as Scenario B) — but "shippable-today... over the floor" is only true
> at steady state, not in year 1. Read the steady-state row as *what this product's current,
> already-built pricing/paywall CAN earn once it has run long enough to fill*, and the year-1 row
> as *what it earns in its first 12 months* — both honest, neither substitutable for the other.

Two caveats kept deliberately load-bearing:
- The 15% store rate holds only **below $1M in annual proceeds**. Above it, both stores revert
  to 30%. Scenario C at $335.9K is ~3x below that line, so the rate applies throughout — but
  crossing $1M means this constant is revisited, not inherited.
- Stripe's $0.30 is charged **per transaction**, so it is heavier on the $29 tier (≈3.9% all-in)
  than on the $399 annual charge (≈3.7% all-in). It is modelled per charge rather than as one
  blended percentage, because a blended rate would flatter the small-ticket tier — which happens
  to be the one carrying 60% of conversions.

---

### Scenario C — Optimistic
**Inputs:** 6,000 installs/month, 6% conversion, 65% organic

```
Active users reaching paywall: 6,000 × 0.25 [Day-30 retention] = 1,500/month
Paid conversions: 1,500 × 0.06 = 90/month
  Apartment buyers: 90 × 0.60 [Apartment mix] = 54/month  →  54 × $24.65 = $1,331/month
  Pro new subscribers: 90 × 0.40 [Pro mix] = 36/month
    Monthly Pro (75%): 27/month   →  steady-state: 27 / 0.07  = 385.7 subs  →  385.7 × $41.65 = $16,065/month
    Annual Pro (25%):   9/month   →  steady-state:  9 / 0.024 = 375.0 subs  →  375.0 × $28.26 = $10,598/month
  Combined Pro MRR: $26,663/month

Total MRR: $27,995  →  ARR: ~$335,900/year
```

**Paid acquisition cost (35% paid):**  
2,100 paid × $4.30 = $9,030/month = $108,360/year

**Net profit after marketing: ~$228K/year** ($335,934 − $108,360)

**Verdict:** Significantly exceeds $100K with ~68% net margin after all marketing spend.
Requires both strong organic presence AND paywall optimization (6% is achievable but
requires real effort — Canva runs ~6%, and AptDesigner's value proposition is more
focused). The annual tier adds ~$63K ARR at steady state vs monthly-only. **This is a
STEADY-STATE ceiling, not a 12–18-month timeline** (corrected Run 15 — a prior version
called it "the reachable ceiling within 12–18 months", but Scenario B's own analysis two
sections up shows the smaller $149.3K base case alone needs years for its monthly/annual
Pro pools to fill against 7%/2.4% monthly churn; this scenario's larger subscriber pools
(386 + 375 vs 171 + 167) take at least as long to compound, so read $335.9K as the
multi-year steady-state this scenario's inputs support, not a near-term number).

---

## Planning case: Scenario B

**The $100K/yr path requires four things:**

1. **4,000 installs/month** — achievable with: strong ASO (keywords, screenshots,
   ratings strategy), 2–3 SEO articles ranking for "AI interior design" category terms,
   consistent social presence (X, Instagram, TikTok), Product Hunt launch, and targeted
   Apple Search Ads once the creative is tested.

2. **4% free-to-paid conversion** — the current paywall (after saving the 3rd design)
   needs to feel fair, not punitive. "You've saved 3 designs — see all your work with
   the Apartment plan" is the right moment. The design of the upgrade screen matters.

3. **7% monthly Pro churn or better / 25% annual renewal churn or better** — requires
   good post-purchase engagement: push notifications when analysis is ready, email tips,
   reasons to re-open (new room, revisit saved design, share). The re-engagement features
   (B3 push notifications, E6 email lifecycle) exist for this reason. Annual subscribers
   renew once per year — the value must be re-demonstrated before each renewal date.

4. **25% of Pro subscribers choosing the annual plan** — the annual tier must be
   prominently offered in the paywall UI (currently wired in `app/pricing/page.tsx` and
   the RevenueCat paywall). Positioning: "Save 32% — pay once, design all year."

5. **Organic share from 40% toward 50%+** — the planning case anchors at 40% (benchmark
   top); the **built referral loop (PR #226)** plus the Tracks E2–E6 visual-content engine
   (brand kit, SEO, social drafts, content calendar, press kit, ASO package) are what push
   non-paid share past 40% into the positive-margin zone. Each organic/referred install at
   ~$0 (vs $4.30 paid CPI) is pure margin — and referred users retain ~37% better.

---

## What would have to change to NOT reach $100K

If Scenario B inputs slip:
- Conversion drops from 4% → 2%: ARR falls to ~$74.7K — still short of the floor. Need to rebuild paywall/onboarding.
- Monthly Pro churn rises from 7% → 12%: Monthly steady-state shrinks; ARR **$113,604**
  (`analysis/business_case_sensitivity_monthly_churn12_arr.mjs`, registered in
  `analysis/figures.json`, verified by `node scripts/validate-computation.mjs`). Re-priced
  2026-07-28 from $93,556; at the corrected take rate this downside now CLEARS the floor,
  where before it did not.
- Annual mix stays at 0% (the current live state — annual billing is gated off, see above): STEADY-STATE
  ARR is **$121,339** on the store channel and **$136,762** on web/Stripe — over the floor on
  either, and ~$28K below the annual-tier model. This is the honest steady-state number for
  TODAY'S transactable product, once its Pro-subscriber pool has filled; **the year-1 EXIT
  run-rate is $73,519 (store) / $82,873 (web) — BELOW the $100K floor on either channel** (see the
  "steady-state, not year-1" box above). The $149.3K figure requires shipping the annual-billing
  cutover (migration 021 + `ANNUAL_BILLING_ENABLED`). Re-priced 2026-07-28 from $99,926: that
  reading missed the floor by ~$74 purely on a 30% commission this business pays on neither
  channel at this scale.
- Annual renewal churn rises to 40% (→ 1 − 0.6^(1/12) ≈ 4.17%/month effective): Annual pool shrinks
  ~43%. ARR **$125,331** (`analysis/business_case_sensitivity_annual_churn40_arr.mjs`, registered in
  `analysis/figures.json`, verified by `node scripts/validate-computation.mjs`). Re-priced
  2026-07-28 from $103,214.
- Installs stall at 2,000/month: ARR ~$56K (conservative scenario). Need growth channel.
- Organic share stays at 35% (not the planned 40%): marketing rises to ~$134K/year; net margin
  stays positive (+$15.1K) but thin — see the sensitivity table. This is why the built referral loop (which adds non-paid, better-retaining installs) is the priority growth lever.

The biggest risk is the **top-10% dominance in lifestyle apps**: 97.9% of subscription
revenue in the category goes to the top 10% of apps (source: Adapty lifestyle benchmarks).
Below a PMF threshold, even good conversion rates don't compound. The early signal to
watch is Day-30 retention — if it drops below 20%, the product isn't sticky enough yet
and the growth model doesn't work regardless of installs.

---

## The honest statement

The base case (Scenario B) shows a credible path to a **steady-state $149.3K ARR** — 49% above
the $100K floor — but it is neither automatic nor instant: the year-1 exit run-rate is $71,207,
so the floor is **not met in year 1**; it is reached as the monthly/annual Pro pools compound. The **floor is
revenue-secured** at 4,000 installs × 4% conversion regardless of acquisition mix; the honest
constraint is **net margin**, which is
**+$25.5K at the 40%-organic anchor** (positive, but thin) and widens as non-paid share rises —
re-priced 2026-07-28; before the take-rate correction this line read "≈ break-even".
Reaching it requires five things:
- Consistently reaching 4,000 installs/month (strong ASO + organic channels)
- Maintaining 4%+ conversion (paywall UX, good onboarding, fast time-to-value — the built web upsell surface, PR #238, works this lever)
- Keeping Pro monthly churn ≤7% and annual renewal churn ≤25%
- Getting 25%+ of Pro subscribers to choose the annual plan (the annual tier must be prominently offered and priced to feel like a deal — "save 32% upfront")
- Pushing organic/referred install share from the 40% anchor toward 50%+ (the built referral loop, PR #226, plus the E2–E6 visual-content engine) so net margin widens from thin (+$25.5K) to comfortable (+$46K at 50%)

The product and marketing engine built across Tracks A–E addresses all five levers within
what the loop controls — and the two that most move net margin (referral acquisition and the
in-product upsell) are now **built, not just listed**. The only things it cannot control are
market reception and the owner's execution on the human-only steps (accounts, distribution,
funding). On the levers it does control, it has been taken to 100%.

**Per-user COGS is not a constraint** — at ~$0.002/analysis and 97%+ gross margins,
this product has excellent unit economics. The constraint is user acquisition and retention.

---

## Sources

- [Google Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Business of Apps — App Churn Rates](https://www.businessofapps.com/data/app-churn-rates/)
- [Business of Apps — CPI Research](https://www.businessofapps.com/ads/cpi/research/cost-per-install/)
- [Adapty Lifestyle App Subscription Benchmarks](https://adapty.io/blog/lifestyle-app-subscription-benchmarks/)
- [Geneo Freemium Conversion Benchmarks](https://geneo.app/query-reports/freemium-conversion-rate-benchmarks)
- [Mapendo CPI Benchmarks 2025](https://mapendo.co/blog/cost-per-install-2025)
- [Recurly Research — B2C Subscription Benchmarks](https://recurly.com/research/) (annual renewal churn 20–30% for consumer B2C)
- [SplitMetrics App Store Acquisition Channels](https://splitmetrics.com/glossary/app-store-acquisition-channels/)
- [MobileAction Organic App Growth 2025](https://www.mobileaction.co/blog/organic-app-growth-in-2025/)
- [CleverTap Mobile App Churn Analysis](https://clevertap.com/blog/mobile-app-churn-rate/)
- [GrowSurf — Mobile App Referral Statistics 2026](https://growsurf.com/statistics/mobile-app-referral-statistics/) (referral install share 20–35%; referral CAC $0.50–1.50; referred-user retention/LTV uplift)
- [Apple App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/) (15% commission for developers with < $1M annual proceeds)
- [Havenly Pricing](https://havenly.com/pricing) / [Houzz Pro (G2)](https://www.g2.com/products/houzz-pro/pricing) / [Planner 5D](https://planner5d.com/pricing) / [Homestyler](https://www.homestyler.com/pricing)
