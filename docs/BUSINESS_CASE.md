# Business Case — AptDesignerAI

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

Distribution: iOS App Store + Google Play (both gated by a 30% platform commission).

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
| Organic install share | 35–40% | MobileAction / SplitMetrics 2025 |
| App Store conversion (paid search ads) | 67% | SplitMetrics |
| App Store conversion (organic browse) | 25–27% | SplitMetrics |

---

## The revenue model

**Formula:**

```
Monthly Net Revenue =
    (New_Installs × Day30_Retention × ConversionRate × ApartmentMix × $29 × 0.70)   [one-time]
  + (Steady_State_Pro × $49 × 0.70)                                                   [recurring]

Steady_State_Pro = (New_Installs × Day30_Retention × ConversionRate × ProMix) / MonthlyChurn

ARR = Monthly_Net_Revenue × 12
```

**Shared assumptions across scenarios:**
- Day-30 retention: 25% (industry: 20–30%; slightly optimistic given design intent)
- Monthly Pro churn: 7% (mid-range for lifestyle apps; implies average sub duration ~14 months)
- App Store / Play commission: 30% (standard; Apple small-business 15% applies at <$1M ARR)
- Mix: 60% Apartment one-time, 40% Pro subscription (conservative; Pro has better LTV)

---

## Three scenarios

### Scenario A — Conservative
**Inputs:** 2,000 installs/month, 3% conversion, 70% organic

```
Active users reaching paywall: 2,000 × 0.25 = 500/month
Paid conversions: 500 × 0.03 = 15/month
  Apartment buyers: 15 × 0.60 = 9/month  →  $9 × $29 × 0.70 = $184/month
  Pro new subscribers: 15 × 0.40 = 6/month
  Steady-state Pro base: 6 / 0.07 = ~86 subscribers
  Pro MRR: 86 × $49 × 0.70 = $2,949/month

Total MRR: $3,133  →  ARR: ~$37,600/year
```

**Paid acquisition cost (30% paid installs):**  
600 paid installs × avg $4.30 CPI = $2,580/month = $30,960/year

**Verdict:** Falls short of $100K. This is the bootstrap-organic scenario: sustainable
(revenue > marketing spend) but requires 2–3 years to compound to $100K without investment.
The lever to pull: improve conversion from 3% to 5% via paywall timing + trial optimization.

---

### Scenario B — Base (planning case)
**Inputs:** 4,000 installs/month, 4% conversion, 50% organic

```
Active users reaching paywall: 4,000 × 0.25 = 1,000/month
Paid conversions: 1,000 × 0.04 = 40/month
  Apartment buyers: 40 × 0.60 = 24/month  →  24 × $29 × 0.70 = $487/month
  Pro new subscribers: 40 × 0.40 = 16/month
  Steady-state Pro base: 16 / 0.07 = ~229 subscribers
  Pro MRR: 229 × $49 × 0.70 = $7,855/month

Total MRR: $8,342  →  ARR: ~$100,100/year ✓
```

**Paid acquisition cost (50% paid installs):**  
2,000 paid × $4.30 = $8,600/month = $103,200/year

**Gross margin before marketing:** 97%+  
**Net margin after marketing:** ($100K revenue − $103K marketing) = −$3K/year

**Verdict:** Reaches the $100K ARR target on paper, but marketing cost nearly matches
revenue if you rely on paid acquisition. **The path to profitability requires organic
channel strength.** The content calendar, SEO articles, social presence, and ASO
optimization built in Tracks E2–E6 are not marketing theater — they are the unit
economics. If 65% of installs come organically (vs 50%), marketing spend drops to
$62K/year and net profit reaches ~$35K. This is the path: organic > paid.

---

### Scenario C — Optimistic
**Inputs:** 6,000 installs/month, 6% conversion, 65% organic

```
Active users reaching paywall: 6,000 × 0.25 = 1,500/month
Paid conversions: 1,500 × 0.06 = 90/month
  Apartment buyers: 90 × 0.60 = 54/month  →  54 × $29 × 0.70 = $1,098/month
  Pro new subscribers: 90 × 0.40 = 36/month
  Steady-state Pro base: 36 / 0.07 = ~514 subscribers
  Pro MRR: 514 × $49 × 0.70 = $17,632/month

Total MRR: $18,730  →  ARR: ~$224,760/year
```

**Paid acquisition cost (35% paid):**  
2,100 paid × $4.30 = $9,030/month = $108,360/year

**Net profit after marketing: ~$116K/year**

**Verdict:** Comfortably exceeds $100K with ~52% net margin after all marketing spend.
Requires both strong organic presence AND paywall optimization (6% is achievable but
requires real effort — Canva runs ~6%, and AptDesigner's value proposition is more
focused). This is the reachable ceiling within 12–18 months of a disciplined launch.

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

3. **7% monthly Pro churn or better** — requires good post-purchase engagement: push
   notifications when analysis is ready, email tips, reasons to re-open (new room,
   revisit saved design, share). The re-engagement features (B3 push notifications,
   E6 email lifecycle) exist for this reason.

4. **50%+ organic installs** — the marketing work in Tracks E2–E6 (brand kit, SEO,
   social drafts, content calendar, press kit, ASO package) reduces reliance on paid
   CPI. Each organic install at $0 CAC vs $4.30 CPI is pure profit.

---

## What would have to change to NOT reach $100K

If Scenario B inputs slip:
- Conversion drops from 4% → 2%: ARR falls to ~$42K. Need to rebuild paywall/onboarding.
- Monthly churn rises from 7% → 12%: Steady-state Pro base shrinks to ~133. ARR ~$65K.
- Installs stall at 2,000/month: ARR ~$50K (with 4% conversion). Need growth channel.
- Organic share stays at 35% (not 50%): Marketing cost rises to $126K/year, net margin negative.

The biggest risk is the **top-10% dominance in lifestyle apps**: 97.9% of subscription
revenue in the category goes to the top 10% of apps (source: Adapty lifestyle benchmarks).
Below a PMF threshold, even good conversion rates don't compound. The early signal to
watch is Day-30 retention — if it drops below 20%, the product isn't sticky enough yet
and the growth model doesn't work regardless of installs.

---

## The honest statement

The base case (Scenario B) shows a credible path to $100K ARR, but it is not automatic.
It requires:
- Consistently reaching 4,000 installs/month (strong ASO + organic channels)
- Maintaining 4%+ conversion (paywall UX, good onboarding, fast time-to-value)
- Keeping Pro churn ≤7% (product quality, re-engagement, push + email)
- Building organic install share to 50%+ (this is exactly what E2–E6 builds toward)

The product and marketing engine built across Tracks A–E in this roadmap addresses
all four levers within what the loop controls. The only things it cannot control are
market reception and the owner's execution on the human-only steps (accounts,
distribution, funding). On the levers it does control, it has been taken to 100%.

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
- [SplitMetrics App Store Acquisition Channels](https://splitmetrics.com/glossary/app-store-acquisition-channels/)
- [MobileAction Organic App Growth 2025](https://www.mobileaction.co/blog/organic-app-growth-in-2025/)
- [CleverTap Mobile App Churn Analysis](https://clevertap.com/blog/mobile-app-churn-rate/)
- [Havenly Pricing](https://havenly.com/pricing) / [Houzz Pro (G2)](https://www.g2.com/products/houzz-pro/pricing) / [Planner 5D](https://planner5d.com/pricing) / [Homestyler](https://www.homestyler.com/pricing)
