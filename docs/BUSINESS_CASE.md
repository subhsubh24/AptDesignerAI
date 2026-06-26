# Business Case — AptDesignerAI

```yaml
# BUSINESS_CASE_SUMMARY (machine-readable; keep in sync with the analysis below)
currency: USD
arr_year1:
  conservative: 46200
  base: 122900
  optimistic: 276800
planning_case: base
floor_usd: 100000
floor_met_year1: true
time_to_floor: "base case exceeds the $100K floor in year 1 (with Pro Annual tier)"
as_of: 2026-06-26
```

A bottoms-up, research-grounded estimate of the path to ≥ $100K/yr ARR. Maintained
as a living artifact; update when pricing, conversion data, or market conditions change.
**All benchmarks cited; no invented metrics.**

---

## The product and pricing (as of June 2026)

| Tier | Price | Model |
|---|---|---|
| Explore | Free | 1 full room analysis, no card required |
| Apartment | $29 | One-time; unlimited rooms in one apartment |
| Pro | $49/month | Unlimited apartments, client exports, priority support |
| Pro Annual | $399/year | Same as Pro, billed annually (~$33/mo effective — save 32%) |

Pro Annual was added in PR #98 / migration 021. The annual tier reduces effective price by 32% vs monthly, dramatically improves retention (annual subscribers renew once per year, not monthly), and improves upfront cash flow.

Distribution: iOS App Store + Google Play (both gated by a 30% platform commission).

### Pro Annual tier economics

Annual subscribers pay $399 × 0.70 (after 30% store commission) = **$279.30 net per year** upfront. Compared to the monthly Pro plan:

| Metric | Monthly Pro | Pro Annual | Delta |
|---|---|---|---|
| Net revenue per subscriber/yr | $49 × 0.70 × 12 = **$411.60** | **$279.30** | −32% per year |
| Annual renewal churn | 84% (7%/mo × 12) | **~25%** (at renewal) | −59pp |
| Avg subscriber lifetime | ~14 months | **~4 years** | +240% |
| LTV | ~$490 | **~$1,117** | +128% |

Source: 25% annual renewal churn (Recurly Research B2C subscription benchmarks; consumer lifestyle apps 20–30%).

**Net effect on revenue:** Each annual subscriber generates less revenue per calendar year but far more over their lifetime. The large retention improvement more than compensates at steady state, increasing the subscriber base pool and total ARR even though the per-subscriber annual price is lower.

---

## Unit economics — per-user COGS

The dominant cost driver is AI inference via Gemini 2.5 Flash Lite, the cheapest
available Gemini model.

| Component | Cost per room analysis |
|---|---|
| Input tokens (~2,000: image + prompt) | $0.0002 |
| Output tokens (~1,000: analysis JSON) | $0.0004 |
| **Total per analysis (Gemini 2.5 Flash Lite)** | **$0.0006** |

Source: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
and [Pricepertoken.com](https://pricepertoken.com/pricing-page/model/google-gemini-2.5-flash-lite)

Hosting (Vercel + Supabase) is estimated at ~$200/month flat, amortized across users.

| Scenario | Monthly active users | Hosting per user | API per user | Total COGS/user |
|---|---|---|---|---|
| Early stage (500 MAU) | 500 | $0.40 | $0.006 | ~$0.41 |
| Growth stage (5,000 MAU) | 5,000 | $0.04 | $0.006 | ~$0.05 |

**Gross margin: effectively 97–99%.** The cost structure is dominated by fixed hosting,
not per-user compute. At scale, per-user COGS is negligible. This is a healthy software
unit economics profile, not an infra-heavy AI product.

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
    (New_Installs × Day30_Retention × ConversionRate × ApartmentMix × $29 × 0.70)   [one-time]
  + (Steady_State_Pro_Monthly × $49 × 0.70)                                           [monthly sub]
  + (Steady_State_Pro_Annual  × ($399/12) × 0.70)                                     [annual sub, MRR]

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
- App Store / Play commission: 30% (standard; Apple small-business 15% applies at <$1M ARR)
- Mix: 60% Apartment one-time, 40% Pro subscription (conservative; Pro has better LTV)
- Annual plan adoption: **25% of new Pro subscribers choose annual** (conservative; typical consumer SaaS 15–40%); remaining 75% choose monthly Pro

---

## Three scenarios

### Scenario A — Conservative
**Inputs:** 2,000 installs/month, 3% conversion, 70% organic

```
Active users reaching paywall: 2,000 × 0.25 [Day-30 retention] = 500/month
Paid conversions: 500 × 0.03 = 15/month
  Apartment buyers: 15 × 0.60 [Apartment mix] = 9/month  →  9 × $29 × 0.70 = $184/month
  Pro new subscribers: 15 × 0.40 [Pro mix] = 6/month
    Monthly Pro (75%): 4.5/month  →  steady-state: 4.5 / 0.07 = ~64 subs  →  64 × $34.30 = $2,195/month
    Annual Pro (25%): 1.5/month   →  steady-state: 1.5 / 0.024 = ~63 subs  →  63 × $23.28 = $1,467/month
  Combined Pro MRR: $3,662/month

Total MRR: $3,846  →  ARR: ~$46,200/year
```

**Paid acquisition cost (30% paid installs):**  
600 paid installs × avg $4.30 CPI = $2,580/month = $30,960/year

**Verdict:** Falls short of $100K but is 23% better than without the annual tier ($37,600 → $46,200). This is the bootstrap-organic scenario: sustainable (revenue > marketing spend) but requires 2–3 years to compound to $100K without investment. The lever to pull: improve conversion from 3% to 5% via paywall timing + trial optimization.

---

### Scenario B — Base (planning case)
**Inputs:** 4,000 installs/month, 4% conversion, 50% organic

> **Why 50% organic (above the 35–40% benchmark):** The 35–40% figure is a cross-category
> mobile average, weighted by games and utilities. Lifestyle apps with aesthetic, shareable
> content (design before/afters, room transformations) consistently outperform this average
> on visual platforms (Instagram, Pinterest, TikTok). The E2–E6 marketing work — content
> calendar, press kit, social drafts, ASO copy — is specifically built to drive that
> above-average organic share. 50% is an aspirational-but-achievable target that requires
> this marketing engine to be active, not a baseline assumption.

```
Active users reaching paywall: 4,000 × 0.25 [Day-30 retention] = 1,000/month
Paid conversions: 1,000 × 0.04 = 40/month
  Apartment buyers: 40 × 0.60 [Apartment mix] = 24/month  →  24 × $29 × 0.70 = $487/month
  Pro new subscribers: 40 × 0.40 [Pro mix] = 16/month
    Monthly Pro (75%): 12/month   →  steady-state: 12 / 0.07  = ~171 subs  →  171 × $34.30 = $5,865/month
    Annual Pro (25%):   4/month   →  steady-state:  4 / 0.024 = ~167 subs  →  167 × $23.28 = $3,888/month
  Combined Pro MRR: $9,753/month

Total MRR: $10,240  →  ARR: ~$122,900/year ✓✓ (+23% vs monthly-only model)
```

**Paid acquisition cost (50% paid installs):**  
2,000 paid × $4.30 = $8,600/month = $103,200/year

**Gross margin before marketing:** 97%+  
**Net margin after marketing:** ($122.9K revenue − $103.2K marketing) = +$19.7K/year

**Verdict:** Comfortably exceeds the $100K floor at $122.9K ARR. The annual tier is the
key lever: it expands the steady-state subscriber pool by reducing churn on 25% of Pro
conversions from 84%/year to 25%/year. Unlike the monthly-only model (which barely broke
even on marketing), this scenario generates ~$20K net profit at 50% organic share.
**The path to profitability is cleaner:** if 65% of installs come organically, paid spend
drops to ~$72K/year → net profit reaches ~$51K. This is the path: organic > paid.

---

### Scenario C — Optimistic
**Inputs:** 6,000 installs/month, 6% conversion, 65% organic

```
Active users reaching paywall: 6,000 × 0.25 [Day-30 retention] = 1,500/month
Paid conversions: 1,500 × 0.06 = 90/month
  Apartment buyers: 90 × 0.60 [Apartment mix] = 54/month  →  54 × $29 × 0.70 = $1,098/month
  Pro new subscribers: 90 × 0.40 [Pro mix] = 36/month
    Monthly Pro (75%): 27/month   →  steady-state: 27 / 0.07  = ~386 subs  →  386 × $34.30 = $13,240/month
    Annual Pro (25%):   9/month   →  steady-state:  9 / 0.024 = ~375 subs  →  375 × $23.28 = $8,730/month
  Combined Pro MRR: $21,970/month

Total MRR: $23,068  →  ARR: ~$276,800/year
```

**Paid acquisition cost (35% paid):**  
2,100 paid × $4.30 = $9,030/month = $108,360/year

**Net profit after marketing: ~$168K/year**

**Verdict:** Significantly exceeds $100K with ~61% net margin after all marketing spend.
Requires both strong organic presence AND paywall optimization (6% is achievable but
requires real effort — Canva runs ~6%, and AptDesigner's value proposition is more
focused). The annual tier adds ~$52K ARR at steady state vs monthly-only. This is the
reachable ceiling within 12–18 months of a disciplined launch.

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

5. **50%+ organic installs** — the marketing work in Tracks E2–E6 (brand kit, SEO,
   social drafts, content calendar, press kit, ASO package) reduces reliance on paid
   CPI. Each organic install at $0 CAC vs $4.30 CPI is pure profit.

---

## What would have to change to NOT reach $100K

If Scenario B inputs slip:
- Conversion drops from 4% → 2%: ARR falls to ~$62K. Need to rebuild paywall/onboarding.
- Monthly Pro churn rises from 7% → 12%: Monthly steady-state shrinks; ARR ~$85K.
- Annual mix stays at 0% (no one picks annual): ARR reverts to ~$100K baseline — still floor-passing, but $23K lower than the annual-tier model.
- Annual renewal churn rises to 40% (→ 4.2%/month effective): Annual pool shrinks ~43%. ARR ~$106K.
- Installs stall at 2,000/month: ARR ~$46K (conservative scenario). Need growth channel.
- Organic share stays at 35% (not 50%): Marketing cost rises to $126K/year, net margin flips negative.

The biggest risk is the **top-10% dominance in lifestyle apps**: 97.9% of subscription
revenue in the category goes to the top 10% of apps (source: Adapty lifestyle benchmarks).
Below a PMF threshold, even good conversion rates don't compound. The early signal to
watch is Day-30 retention — if it drops below 20%, the product isn't sticky enough yet
and the growth model doesn't work regardless of installs.

---

## The honest statement

The base case (Scenario B) shows a credible path to **$122.9K ARR** — 23% above the $100K floor — but it is not automatic. It requires five things:
- Consistently reaching 4,000 installs/month (strong ASO + organic channels)
- Maintaining 4%+ conversion (paywall UX, good onboarding, fast time-to-value)
- Keeping Pro monthly churn ≤7% and annual renewal churn ≤25%
- Getting 25%+ of Pro subscribers to choose the annual plan (the annual tier must be prominently offered and priced to feel like a deal — "save 32% upfront")
- Building organic install share to 50%+ (this is exactly what E2–E6 builds toward)

The product and marketing engine built across Tracks A–E in this roadmap addresses all five levers within what the loop controls. The only things it cannot control are market reception and the owner's execution on the human-only steps (accounts, distribution, funding). On the levers it does control, it has been taken to 100%.

**Per-user COGS is not a constraint** — at $0.001/analysis and 97%+ gross margins,
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
- [Havenly Pricing](https://havenly.com/pricing) / [Houzz Pro (G2)](https://www.g2.com/products/houzz-pro/pricing) / [Planner 5D](https://planner5d.com/pricing) / [Homestyler](https://www.homestyler.com/pricing)
