# GROWTH STATUS — AptDesignerAI

The single, machine-readable source of truth for growth & marketing progress, owned by the Growth
Agent (the daily cloud routine). The factory dashboard reads the fenced GROWTH_STATUS block below,
exactly like it reads BUSINESS_CASE_SUMMARY in docs/BUSINESS_CASE.md.

## Contract (read before editing)
- The Growth Agent updates the block below every run, in the same run it does growth work.
- Real data only — never invent numbers. A metric no connected source has reported stays 0 or null.
- The block MUST be valid, parseable YAML — no invalid escapes (write $100K, never \$100K); quote any
  value containing a colon or backtick. preflight fails on a malformed block.
- Cross-project shape: identical keys across AptDesignerAI / HighlightMagic / GroceryManager.
- phase advances pre_launch -> launching -> post_launch. Post-launch is the most important window.
- as_of is stamped every update; a stale as_of is itself a signal.
- HOW to fill funnel/experiments/learnings honestly (diagnose the binding constraint, compute
  significance, never fabricate, "insufficient data" when N is small): follow the data-science
  method in docs/growth/ANALYSIS_PLAYBOOK.md.

```yaml
GROWTH_STATUS:
  project: AptDesignerAI
  as_of: 2026-07-05
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
  validation:                    # GTM_STANDARD S4 self-validation -- every external source this agent depends on; fail-closed
    - source: internal_metrics_api
      status: unavailable
      reason: "INTERNAL_METRICS_TOKEN not set on the deployment (owner action pending). Separately, this agent's own runtime has no outbound network path to aptdesignerai.com -- three independent probe attempts across three runs have each failed a different way (2026-07-01: HTTP 403 policy denial; 2026-07-03: bare connection error; 2026-07-05, this run: HTTP 502 'CONNECT tunnel failed', confirmed both via direct curl and the agent-proxy's own status endpoint recentRelayFailures log) -- the failure mode keeps changing but the practical conclusion is identical across all three: no reachable path to the production host from this runtime, independent of whether the owner sets the token. IMPORTANT SCOPE CORRECTION (this run): this unreachability is specific to aptdesignerai.com -- it does NOT mean this runtime's network access is blocked generally. WebSearch and WebFetch to OTHER external domains (apple.com, news.ycombinator.com, emarketer.com, firstchair.app) worked cleanly this run (see demand_signal.method_note) -- so setting INTERNAL_METRICS_TOKEN plus resolving JUST the aptdesignerai.com egress path (not a blanket network-policy fix) would unblock this source."
    - source: resend_email
      status: unavailable
      reason: "RESEND_API_KEY / RESEND_FROM_EMAIL not set; the email lifecycle runs in dry-run (nothing sent)."
    - source: stripe_reporting
      status: unavailable
      reason: "No Stripe reporting credential is connected to this agent; trial/paid/MRR/churn metrics stay 0/null."
    - source: site_gate
      status: unavailable
      reason: "SITE_GATE_PASSWORD not set; site_gate_up stays false, hard-blocking pre-launch execute-mode outreach."
    - source: social_channels
      status: unavailable
      reason: "No social platform credentials connected (X / Instagram / TikTok / Reddit); the publishing queue stays dry-run."
  pending_approvals: []          # GTM_STANDARD S9 Tier-B channel plans awaiting owner approval -- none proposed (no data supports one yet)
  funnel:                        # REAL numbers only; 0/null until a connected source reports them
    visitors_7d: 0
    waitlist_signups_total: 0
    waitlist_signups_7d: 0
    visitor_to_waitlist_rate: null
    trial_starts_total: 0
    paid_conversions_total: 0
    trial_to_paid_rate: null
    active_subscribers: 0
    mrr_usd: 0
    churn_rate_30d: null
  acquisition:
    cac_usd: null
    ltv_usd: null
    ltv_cac_ratio: null
    top_channel: null
  pmf:                           # LEADING indicator behind the number (FACTORY_STANDARD S9); 0/null pre-launch
    activation_rate: null        # share of new users who reach first value (room photo -> useful mockup / the "aha")
    retention_d1: null
    retention_d7: null
    retention_d30: null          # a flattening return-cohort curve is the strongest PMF signal
    organic_share_rate: null     # share of new visitors arriving via shared designs / referral (self-spread)
    signal: none                 # none | weak | emerging | strong  (pre-PMF => prioritize PRODUCT, not acquisition)
  demand_signal:                 # GTM_STANDARD S10 -- pre-launch demand validation (leading indicator, NOT PMF)
    as_of: 2026-07-05
    method_note: >-
      CORRECTED characterization from Run 5, which attributed a blanket "network egress policy"
      block to WebFetch generally. Re-tested this run: WebSearch works fully (real results with
      quoted excerpts) and WebFetch succeeds broadly this session (apple.com, the
      news.ycombinator.com homepage, emarketer.com, firstchair.app all fetched cleanly with real
      verbatim quotes below) -- so the prior "this environment blocks all external fetch"
      conclusion was overstated. What actually blocks, precisely: (1) reddit.com AND
      old.reddit.com are hard-blocked by the WebFetch TOOL itself ("Claude Code is unable to fetch
      from ... reddit.com") -- a tool-level restriction, not this environment's proxy; (2)
      trustpilot.com returns HTTP 403 to WebFetch (Cloudflare bot-block, site-side); (3)
      news.ycombinator.com/item?id=... pages return HTTP 429 on every attempt even though the HN
      homepage loads fine -- a site-side rate-limit on that endpoint, not a policy block. Net
      effect for Reddit/Trustpilot specifically is unchanged (still unreachable), but for the
      first time this run TWO themes below carry a hand-verified, dated, named-source VERBATIM
      quote fetched directly from the source page (clears the S10 "URL + verbatim quote" bar),
      instead of only WebSearch's own synthesized summary. Also found and FIXED a mis-cited
      source: Run 5's Hacker News URL (item?id=35266271) does not resolve to the intended "Why
      buying furniture is so miserable" thread -- the correct id, found via HN's own Algolia
      search API (hn.algolia.com/api/v1/search), is 35267253; that item page itself still 429s
      under direct fetch, so the corrected URL is recorded but not independently re-quoted.
    confidence: emerging          # raised from Run 5's "weak" -- 2 of 4 themes now carry a real
                                   # verbatim-verified, dated, named-source quote (not just search
                                   # synthesis); still capped below "strong": Reddit remains
                                   # completely unreachable, source count per theme stays small,
                                   # and this is still qualitative demand signal, never PMF (S1/S10)
    themes:
      - theme: "Furniture-shopping choice paralysis (multi-hour, no clear starting point)"
        sources: "eMarketer (Arielle Feger, published 2026-05-18, emarketer.com/content/why-furniture-shopping-broken-how-ai-starting-fix) -- VERBATIM-VERIFIED via direct fetch this run: Dan Bennett (CMO, furniture.com) quoted as 'nine hours and 13 tabs used just to find a solution to a furniture problem'; Baymard Institute independent UX research (87% of users avoid AR view-in-room, fall back to manual measuring -- carried over from Run 5, not re-fetched this run); Hacker News 'Why buying furniture is so miserable' -- CORRECTED URL this run: news.ycombinator.com/item?id=35267253 (found via hn.algolia.com search API; Run 5's cited id=35266271 was wrong and did not resolve to this thread; the corrected item page itself 429s under direct fetch, so this citation is URL-corrected but not re-quoted)"
        solved_by_product: "yes -- sourcing real, budget-fit products directly cuts the multi-tab search cost"
        recency: "durable AND current -- the eMarketer piece is 7 weeks old (2026-05-18) and cites the same order-of-magnitude pain (9hrs/13 tabs) as Run 5's search-synthesized version, now hand-verified"
      - theme: "AI room-render tools generate furniture that isn't real or buyable"
        sources: "First Chair blog (published 2026-06-15, firstchair.app/blog/home-ai-alternatives) -- VERBATIM-VERIFIED via direct fetch this run: 'Most AI room tools generate concepts you can't purchase.' / 'The furniture in those renders doesn't exist.' / 'Decorify only shows Wayfair products, which means your room will look like it came from one store.' / 'The furniture in those images is often fabricated or impossible to source.'; independently corroborates Run 5's RoomGPT/Interior AI Trustpilot finding (2.8/5 on 3 reviews, re-confirmed via WebSearch this run: 'Terrible... Do not waste your money... bathroom came out the size of a doll's bath' -- the Trustpilot page itself still 403s to direct WebFetch, so this specific quote remains WebSearch-synthesized, not independently re-fetched); Business of Home trade press, 2025 (the 2023 wave of AI interior-design apps has produced no clear winner)"
        solved_by_product: "yes -- closest to this product's core differentiator (real purchasable products vs. hallucinated furniture); the First Chair critique of single-retailer tools (Decorify/Wayfair-only) also validates this product's multi-retailer sourcing as a distinct angle, not just 'real vs fake'"
        recency: "durable AND current -- First Chair post is 3 weeks old (2026-06-15); this is the single most independently-corroborated theme across two separate research sessions (Run 5 and this run) using different source sets"
      - theme: "Prior full-service e-design (Havenly, Modsy) is expensive and/or fails on delivery"
        sources: "Carried over from Run 5, not re-verified this run (lower priority; no new information surfaced): TechCrunch on Modsy's 2022 shutdown mid-refund (techcrunch.com/2022/07/17); Havenly Trustpilot pricing-markup and late-delivery complaints"
        solved_by_product: "partially -- self-serve software at the existing 29-dollar one-time tier undercuts concierge pricing and sidesteps the delivery/refund failure mode, but does not remove retailer-side fulfillment risk"
        recency: "Modsy's collapse reads as capital/M&A-driven per trade press, not a demand verdict -- does not disconfirm the underlying need, but flags the human-concierge business model as fragile; does not apply to a software-only product"
      - theme: "AR 'view in room' has not solved the visualize-before-buying trust gap"
        sources: "Carried over from Run 5, not re-verified this run: Baymard Institute (87% avoidance, independent research, not vendor-sourced); IKEA Place review aggregation (confusing placement UX, objects reading as illustrations)"
        solved_by_product: "yes, via a different mechanism -- a considered AI mockup of the user's actual photographed room rather than a live AR camera overlay"
        recency: "durable, ongoing UX problem, not a fad"
    disconfirming:
      - "Business of Home (2025): the 2023 wave of AI interior-design apps has produced no clear winner; some entrants described as lightly scammy cash grabs -- a real category-fatigue signal (carried over from Run 5)"
      - "A cited survey found consumers rating general-purpose ChatGPT as a better design-consultation experience than dedicated apps -- a free-substitute threat to any positioning that is just 'AI gives you design ideas' (carried over from Run 5)"
      - "AR view-in-room already had a large, well-resourced attempt (IKEA/Wayfair/Amazon) that is independently shown to be avoided by most users -- confirms the visualize-before-buying job is unsolved but shows that adding visualization alone is not sufficient (carried over from Run 5)"
      - "Reddit remains completely unreachable this run too -- now confirmed as a hard TOOL-level block on reddit.com/old.reddit.com specifically, not a broader environment policy (see method_note); still not read as disconfirming, just an unresolved tooling gap"
    positioning_implication: >-
      Still directional -- confidence raised from weak to emerging but NOWHERE NEAR the S3 bar for
      a business-case number change or a roadmap steer (that needs quantified, statistically
      significant, causally revenue-linked evidence; this stays qualitative pain-signal, exactly
      what S10 says never becomes a hard number). The now-verbatim-verified evidence sharpens the
      SAME positioning read Run 5 reached directionally: lead with "real, buyable, budget-fit
      furniture sourced from multiple retailers for your actual room" (now additionally
      differentiated from single-retailer tools like Decorify, per the First Chair critique) over
      an undifferentiated "AI design ideas" claim, and keep entry pricing low relative to
      Havenly/Modsy-style concierge pricing. store-listing.md and press-kit.md already lead with
      real sourced products and the one-time-price framing -- no copy change needed this run. The
      multi-retailer angle (vs. Decorify's single-retailer limitation) is a genuinely new,
      evidence-backed differentiation point worth surfacing in a FUTURE ASO/copy pass closer to
      launch (recorded here, not actioned now -- pre-launch copy is already honest and consistent,
      and this alone is not enough new information to justify editing live marketing copy this run).
  channels: []                   # [{name, status, reach_7d, clicks_7d, signups_7d, ctr, notes}]
  experiments: []                # [{id, hypothesis, status, result, lift_pct, started, decided}]
  email:
    list_size: 0
    double_opt_in: true
    last_stage_sent: null
    open_rate: null
    click_rate: null
  content:
    published_7d: 0
    scheduled_next_7d: 0
    organic_sessions_7d: 0
  outreach:                      # curated 1:1 strategic email DRAFTS for the owner to send (docs/growth/OUTREACH.md); real numbers only
    drafted_7d: 0                # high-confidence outreach drafts the agent queued for owner review
    owner_sent_7d: 0             # owner-reported sends (the agent never sends)
    replies_7d: 0                # owner-reported replies; never fabricate
    signal: none                 # none | weak | emerging | strong
  learnings:
    - "CIRCUIT BREAKER (Run 6, still fired): same 3 core owner blockers unresolved for a 6th consecutive run (SITE_GATE_PASSWORD, RESEND_API_KEY+RESEND_FROM_EMAIL, INTERNAL_METRICS_TOKEN). PENDING_OPS.md's own as_of is still 2026-06-29 -- unchanged since Run 3, now spanning Runs 3-6 (~6 days) -- confirming no owner action has landed. No growth-engine code work was needed (engine remains complete at 100%); correct output stays a quiet, honest no-op on execution, not busywork."
    - "NEW (Run 6): re-confirmed the aptdesignerai.com unreachability a third way -- this run's curl attempts returned HTTP 502 'CONNECT tunnel failed' (Run 4 saw a 403 policy denial, Run 5 a bare connection error, now a 502). Cross-checked against the agent-proxy's own /__agentproxy/status endpoint, whose recentRelayFailures log independently confirms the same host + timestamp. Three different failure signatures across three probe attempts (Runs 4-6), same practical conclusion every time: no reachable path to this specific host from this runtime."
    - "IMPORTANT CORRECTION (Run 6): Run 5's conclusion that 'this session's network egress policy blocks WebFetch generally' was overstated. Retested this run: WebSearch works fully and WebFetch succeeds cleanly on apple.com, the news.ycombinator.com homepage, emarketer.com, and firstchair.app. The real, narrower picture: reddit.com/old.reddit.com are hard-blocked by the WebFetch TOOL itself (not this environment); trustpilot.com 403s (Cloudflare bot-block, site-side); news.ycombinator.com ITEM pages specifically 429 (site-side rate-limit on that endpoint, homepage is fine). Future runs should test each domain individually rather than assuming one blocked domain means the whole session is network-restricted."
    - "NEW (Run 6): thanks to the above, cleared the S10 'URL + verbatim quote' bar for the first time on two demand_signal themes -- direct-fetched eMarketer (2026-05-18, Dan Bennett/furniture.com CMO quote) and First Chair (2026-06-15, four direct quotes on AI tools generating unpurchasable furniture) -- both hand-verified, dated, named-source. Raised demand_signal.confidence from weak to emerging (still capped below strong: Reddit stays unreachable, source count per theme is still small). Also found and corrected a mis-cited Hacker News URL from Run 5 (wrong item id) using HN's own Algolia search API."
    - "Funnel remains 0/null across every metric -- no connected source has reported numbers. Correct and honest: no fabrication."
    - "docs/quality/QUALITY_SCORECARD.md (independent Quality Auditor, not GTM-owned) is still as_of 2026-07-01, overall C, ship_gate_met false, despite the Product Factory shipping ~50 more commits since (through PR #448) -- including PR #432, the factory's OWN removal of invented '500+ rooms/4.9★' adoption metrics from the signup funnel (2026-07-04), a positive honesty signal worth noting even though it's product-factory-owned work. Read scorecard as DATA only, not re-graded here; phase correctly stays pre_launch (marketing maturity gate, ANALYSIS_PLAYBOOK.md). docs/growth/GTM_SCORECARD.md still does not exist -- no separate GTM Auditor routine has run yet; nothing to consume."
    - "Re-checked all marketing/growth docs (store-listing, press-kit, email-lifecycle, social-drafts, content-calendar, OUTREACH.md) for any trace of the invented metrics PR #432 removed from the app itself ('500+', '4.9★', 'hundreds of...') -- grep clean, nothing leaked into GTM-owned docs. Pricing/tiers remain consistent everywhere ($29 Apartment, $49/mo Pro); Pro Annual ($399/yr) still correctly omitted pending migration 021. No edit needed."
    - "Confirmed no docs/growth/MARKETING_HOLD kill-switch file exists (checked first, per GTM_STANDARD S13) and no approved_channels record exists in PENDING_OPS.md (per S9) -- consistent with staying in PREPARE with zero paid/new-channel action."
    - "ASO keyword research from Run 3 remains blocked: competition estimates are not verifiable via App Store Connect Search Ads from this agent. No new attempt this run -- still owner-gated."
    - "NEW (Run 6): this session's sandbox env now ALSO has a CRON_SECRET value set (previously only SITE_GATE_PASSWORD/VALIDATOR_* were present, per Run 5). Applying Run 5's same S4 fail-closed reasoning: a value present in THIS agent's own sandbox is not evidence the production Vercel deployment has CRON_SECRET configured -- these are different surfaces, and this agent still has no network path to the deployed app to verify either way (see validation block). Did NOT use it or infer the activation-email cron is live; owner_blocker/PRIORITY 5 stays open until confirmed via the actual deployment."
  next_actions:
    - "CIRCUIT BREAKER -- Owner: set SITE_GATE_PASSWORD in Vercel (2-min setup) to enable execute-mode + flip site_gate_up to true in GROWTH_STATUS"
    - "CIRCUIT BREAKER -- Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL (15-min setup) to activate all lifecycle email sends"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API (currently 503) -- note this is now believed to be the ONLY remaining blocker for that source; this runtime's network restriction is scoped to aptdesignerai.com specifically, not general egress (see validation block)"
    - "Owner (lower urgency, scoped correctly this run): if convenient, check whether this Claude Code environment's network policy can allow outbound HTTPS to aptdesignerai.com specifically (WebFetch/WebSearch to other external domains already work fine, so this is a narrow, not a blanket, ask)"
    - "Recommend (not built by this agent -- .github/workflows is out of the loop's blast radius): a scheduled CI job that calls GET /api/internal/growth-metrics and commits a small JSON snapshot into the repo would let this agent read real numbers without needing outbound network access itself"
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron"
    - "Next run: attempt to verbatim-verify the 2 carried-over demand_signal themes (Havenly/Modsy Trustpilot complaints, Baymard AR-avoidance stat) via direct WebFetch now that non-Reddit/non-Trustpilot fetch access is confirmed working this session"
    - "Next run: verify ASO keyword competition claims via App Store Connect Search Ads before landing keyword change"
  owner_blockers:
    - "PRIORITY 1 -- Set SITE_GATE_PASSWORD in Vercel (2 min): gates app pre-launch, unblocks execute-mode outreach -- PENDING_OPS.md item set-site-gate-password"
    - "PRIORITY 2 -- Set RESEND_API_KEY + RESEND_FROM_EMAIL (verified domain, 15 min): unblocks ALL lifecycle email sends -- docs/growth/CONNECT.md Step 1"
    - "PRIORITY 3 -- Set INTERNAL_METRICS_TOKEN: opens funnel metrics pull API (currently 503) -- docs/growth/CONNECT.md Step 2"
    - "PRIORITY 4 (re-scoped this run, was a blanket network-policy ask) -- If convenient, confirm this environment can reach aptdesignerai.com specifically; other external domains already work, so PRIORITY 3 may only need the token, not a network-policy change"
    - "PRIORITY 5 -- Set CRON_SECRET + apply migration 025: activates daily activation email cron -- PENDING_OPS.md"
    - "PRIORITY 6 -- Apply DB migrations 021/022/023/026/027 to prod -- PENDING_OPS.md"
    - "PRIORITY 7 -- Connect/authorize social accounts -- docs/growth/CONNECT.md Step 4"
  links:
    in_app_analytics: null
    owner_doc: docs/growth/GROWTH_STATUS.md
```

## How to read it (owner)

- awaiting_connect: true + engine_built: true => engine code is live but channels not yet connected; agent prepares creative, takes no external action; see owner_blockers.
- funnel is the headline: waitlist signups pre-launch, then trial->paid + MRR + churn post-launch.
- experiments is where compounding happens post-launch; learnings is the data-grounded read.

## Phase notes

- Pre-launch: the number that matters is waitlist signups; most of the block is 0/null (correct/honest).
- Launching: trial starts + first conversions appear; experiments run on paywall + onboarding.
- Post-launch: ground every assumption on REAL conversion/retention/CAC data; run continuous
  experiments; double down on what converts; feed winners back into the business case.
