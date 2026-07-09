# Store Growth Playbook — ASO + App Store Connect automation + Apple Search Ads

Shared, product-agnostic playbook for any store-distributed product (iOS/Android). It is
STORE-SPECIFIC, so per FACTORY_STANDARD §19 it lives here (the product repo), NOT in
FACTORY_STANDARD. The GTM factory reads this as its store-growth doctrine; the product factory
reads §A/§B for store-readiness. Real-data + honesty rules apply throughout — NEVER fabricate
installs, rankings, reviews, or ROAS. All PAID actions are gated by GTM_STANDARD §9 (paid only
within the owner's funded account + an approved budget cap; new channel or over-cap =
propose-and-approve).

## A. ASO alpha (organic App Store search — free distribution)
Ground every choice in real keyword data (§C); never invent volumes.
- **Title formula (ASO-led):** `[GENERIC KEYWORD/PHRASE] + [BRAND]`, never `[BRAND] + [GENERIC]` —
  autocomplete favors the leading generic term. (Exception: a UGC/ads-led product inverts this and
  ranks #1 for the BRAND term first.)
- **Never repeat a keyword** across title, subtitle, and keyword field — repetition wastes indexing
  surface. Maximize unique keyword coverage.
- **Keywords in screenshots get indexed** — put target keywords in the first 1–3 screenshot captions.
- **Screenshots sell the OUTCOME, not features** — "Stop doomscrolling for good," not "AI-powered
  focus engine." The first 3 screenshots matter more than everything else combined; they ARE the ad.
- **Custom Product Pages (CPPs) — the underused edge:** build multiple store-page variants, each
  targeting one search intent (a category term, a competitor name, a specific feature) with its own
  screenshots/preview/URL. Apple shows a measurable conversion lift vs. a one-size page; ~⅔ of top
  apps ignore CPPs — don't.
- **First-party data > social hot-takes:** infer algorithm shifts from your OWN indexing/ranking
  data, never from social-media panic ("Apple killed ASO" is usually noise).

## B. App Store Connect automation (loop-built; submission human-core)
Use the App Store Connect API as early as possible — it removes hours of manual ASC UI work.
- **The loop MAY, via the ASC API:** push/optimize metadata (title, subtitle, keywords, promo text,
  description), create + configure subscription/IAP products, create Custom Product Pages, upload
  ASO-optimized screenshots, and prepare a build/version to a DRAFT / "Prepare for Submission" state.
- **Human-core (owner only — never automate):** the Apple Developer account, app signing, the final
  SUBMIT for review, live billing keys, any spend. The loop prepares everything to draft; the owner
  reviews + submits.
- **Owner connect:** an ASC API key (issuer id + key id + .p8) set as an owner secret; the loop
  never holds signing certs or live keys.
- **Compliance:** cross-reference the CURRENT Apple/Google review guidelines each run (fetch live);
  never game rankings; keep the business case on the Apple Small Business Program 15% tier where
  eligible (< $1M proceeds).

## C. Keyword research (data-backed idea + ASO validation)
- **Owner-connect a keyword-research source** (a keyword volume/difficulty tool with an API/MCP) so
  the loop validates ideas + ASO on REAL search-volume/difficulty data, not guesses.
- **KILL/BUILD gate:** score candidates on volume × difficulty × relevance × monetization; pursue
  only validated ones (until enough proprietary first-party data exists to get creative).
- Feed winning keywords into the ASA pipeline (§D) and the ASO fields (§A).

## D. Apple Search Ads (paid CAPTURE — GATED by GTM §9 budget cap)
ASA CAPTURES existing high-intent demand (~65% of downloads follow a search); it does not CREATE
demand like Meta. **Paid execution is autonomous ONLY within the owner's funded ASA account + an
approved budget cap (GTM_STANDARD §9); new channel or over-cap = propose-and-approve. The loop
plans/structures/optimizes; it never exceeds the cap and never fabricates ROAS.**
1. **Capture, don't create** — weak POSITIONING kills you here (you're in a lineup of competitors),
   not weak creative. Be the no-brainer for a warm, searching buyer.
2. **Account structure — 4 buckets:** Discovery (find new keywords) · Generic (category terms) ·
   Brand (your own name) · Competitors (rivals' names). Add top-performer campaigns as winners emerge.
3. **The page IS the ad** — ASA has almost no creative levers, so §A screenshots + CPPs are the
   lever. Route each campaign to a CPP built for that intent (competitor searchers → a "why we're
   better" page; category searchers → a category page).
4. **Match-type discipline:** Exact Match first (you control spend); Broad Match ONLY inside
   Discovery. When a keyword wins in Exact, add it as a NEGATIVE in Discovery so campaigns don't bid
   against each other (don't pay Apple twice for one search).
5. **Competitor keywords** are the highest-ROI start — intercept installs rivals paid to create.
   (Respect trademark/ToS: bid on terms; never misuse a mark in creative.)
6. **Protect your brand** — always run a funded Brand campaign, ESPECIALLY paired with every
   influencer/creator push: a creator video spikes brand search within hours; if your Brand campaign
   isn't live + funded before it drops, a competitor collects your demand.
7. **ROAS is the only number that matters** — optimize revenue / ROAS / payback / LTV, NOT
   installs/CPI/CTR/CPC (vanity). A pricier high-intent install worth 5× beats a cheap low-intent
   one. Never optimize for installs.
8. **Keyword pipeline (VC-portfolio model):** Discovery surfaces → move to its own Exact Match
   campaign → it proves on REVENUE → graduate winners to a top-performer campaign → raise bid →
   repeat. Most fail, a few print, the machine compounds.
9. **Scale sideways, not just up:** new countries (CA/UK/AU/NZ are often cheaper + better-ROAS than
   the crowded US — test markets as a variable), new keyword/competitor tests, more CPPs, tighter
   segmentation — not just higher bids.
10. **Start slow:** ASA moves slower than Meta — modest bids, wait 24–48h, raise gradually. A small
    ASA budget at launch also aids initial keyword indexing (search match OFF, use Advanced).
11. **Screenshot design wins auctions** — Apple rewards relevance: better screenshots → higher
    conversion → better relevance → lower cost per user. Design is part of your bid.

## E. The flywheel (ASA is a NET, not a standalone channel)
Organic content + creators build awareness → awareness → App Store searches → ASA captures the
high-intent searches → revenue → revenue funds more content/creators → more search demand → every
ad dollar works harder. Standalone, ASA is mediocre; behind a real funnel + a live Brand campaign
it is often the most profitable channel. It pays back exactly as much demand as you drive into it.

## Hard boundaries (reaffirmed)
Real metrics only — never fabricate installs/rankings/ROAS/reviews. Paid only within the owner's
funded account + approved budget cap (GTM §9). Never create accounts, never auto-submit to the
store, never hold signing/live keys. Respect Apple/Google ToS + trademark law. First-party data +
honesty over social-media noise.

## Owner connects this unlocks (the factory surfaces these in OWNER_ACTIONS)
- **ASC API key** (issuer id + key id + .p8) — unlocks metadata / IAP / CPP / screenshot automation (§B).
- **Keyword-research tool** (API/MCP) — unlocks data-backed ASO + idea validation (§C).
- **A funded Apple Search Ads account + an approved daily/monthly budget cap** — unlocks autonomous
  ASA ops within the cap (§D / GTM §9).
