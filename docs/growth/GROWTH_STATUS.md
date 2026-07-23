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
  as_of: 2026-07-23
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
  validation:                    # GTM_STANDARD S4 self-validation -- every external source this agent depends on; fail-closed
    - source: internal_metrics_api
      status: unavailable
      reason: "INTERNAL_METRICS_TOKEN not set on the deployment (owner action pending, PENDING_OPS.md set-metrics-token still status:open). Separately, this agent's own runtime has no outbound network path to aptdesignerai.com -- TEN independent probe attempts across ten runs have each failed (2026-07-01: HTTP 403 policy denial; 2026-07-03: bare connection error; 2026-07-05/07-09: HTTP 502 'CONNECT tunnel failed'; 2026-07-11 through 07-19: connect_rejected / gateway 502 to CONNECT, cross-checked against /__agentproxy/status recentRelayFailures each time; 2026-07-23, this run: re-probed both the root URL and the metrics API directly via curl through the agent-proxy -- both still `connect_rejected` / gateway 502 to CONNECT ('CONNECT tunnel failed'), cross-checked directly against /__agentproxy/status recentRelayFailures (two entries, 2026-07-23T05:08:37-38Z), identical signature to Runs 6-12) -- the practical conclusion is unchanged across all ten probes: no reachable path to the production host from this runtime, independent of whether the owner sets the token. This unreachability is specific to aptdesignerai.com -- it does NOT mean this runtime's network access is blocked generally (see web_research below, still degraded only on Reddit/Trustpilot specifically) -- so setting INTERNAL_METRICS_TOKEN plus resolving JUST the aptdesignerai.com egress path (not a blanket network-policy fix) would unblock this source."
    - source: resend_email
      status: unavailable
      reason: "RESEND_API_KEY / RESEND_FROM_EMAIL not set (PENDING_OPS.md connect-email-resend still status:open); the email lifecycle runs in dry-run (nothing sent). Marketing-lifecycle stages (activation/win-back/paid-welcome; NOT the transactional waitlist_confirm) additionally force dry-run until EMAIL_PHYSICAL_ADDRESS is also set (lib/email/index.ts, per the GTM Auditor's CAN-SPAM footer nit) -- re-verified this run (PENDING_OPS.md set-email-physical-address still status:open) that this fail-closed gate is unchanged."
    - source: stripe_reporting
      status: unavailable
      reason: "No Stripe Reporting API integration exists in the codebase (re-grepped app/ this run -- zero hits for a reporting.stripe.com call); trial-start/conversion-rate metrics are documented in docs/growth/CONNECT.md as living in 'Stripe's reporting API' but that integration is UNBUILT, not merely unconnected -- distinct from internal_metrics_api (which reads the app's own DB and only needs INTERNAL_METRICS_TOKEN). This is a Product-Factory build gap, not a pure owner env-var connect step, so it stays out of PENDING_OPS.md/owner_blockers (no action an owner can take today would unblock it) -- MRR/active-subscriber/churn numbers already surface via internal_metrics_api once INTERNAL_METRICS_TOKEN is set; this source is specifically about trial-start/paid-conversion RATE metrics."
    - source: site_gate
      status: unavailable
      reason: "SITE_GATE_PASSWORD not set on the deployment (PENDING_OPS.md set-site-gate-password still status:open); site_gate_up stays false, hard-blocking pre-launch execute-mode outreach. NOTE: this agent's own sandbox env has a SITE_GATE_PASSWORD-named value present (since Run 5) -- per S4 fail-closed and Run 5/6's established reasoning, this is validator-credential scaffolding for a DIFFERENT routine's sandbox, not evidence the production Vercel deployment has it configured; not used, not inferred as connected."
    - source: social_channels
      status: unavailable
      reason: "No social platform credentials connected (X / Instagram / TikTok / Reddit); the publishing queue stays dry-run."
    - source: web_research
      status: degraded
      reason: "WebSearch + WebFetch work broadly (baymard.com, techcrunch.com, monaverse.com, apps.apple.com were all verbatim-verified via direct fetch in prior runs; this run added a THIRD new verbatim-verified citation -- a direct WebFetch of BBB's Havenly, Inc. complaints page, bbb.org/us/co/denver/profile/interior-designer/havenly-inc-1296-90260312/complaints, fetched cleanly with dated 2025/2026 complaints -- see demand_signal). Two structural gaps persist unchanged across Runs 5-12, re-probed again this run (2026-07-23): (1) reddit.com is still hard-blocked by the WebFetch TOOL itself ('Claude Code is unable to fetch from www.reddit.com') -- zero Reddit posts obtainable despite Reddit being GTM_STANDARD S10's richest recommended source; (2) trustpilot.com/review/havenly.com still returns HTTP 403 to WebFetch (site-side Cloudflare bot-block), re-confirmed this run directly. 7th consecutive re-probe of both gaps with the same result -- unchanged. NEW this run: found that bbb.org (unlike trustpilot.com) is NOT blocked -- a usable direct-fetch alternative for Havenly-specific dated complaints going forward."
    - source: gtm_scorecard
      status: available
      reason: "docs/growth/GTM_SCORECARD.md (auditor_run 3, as_of 2026-07-20) now reports ship_gate_met: true for the GTM Factory's OWN work quality (metric_integrity A+, business_case_honesty A, roadmap_steer_justification A+, self_validation_honesty A+, overall A). Verified directly against the file this run. IMPORTANT -- this is a SEPARATE gate from the PRODUCT readiness gate: GTM_STANDARD S6's outbound-readiness precondition is the independent docs/quality/QUALITY_SCORECARD.md reporting ship_gate_met, which remains FALSE (re-verified this run: as_of 2026-07-20, overall C, functional_reality C / design_taste B / business_case_strength B all still below A). The GTM Auditor grading the GTM Factory's honesty A does not unlock outreach; only the Product Quality Auditor grading the PRODUCT ready does. Recording this distinction explicitly so a future run does not conflate the two scorecards."
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
    as_of: 2026-07-23
    method_note: >-
      Run 13: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403,
      re-confirmed this run -- 7th consecutive re-probe with the same result). Per Run 12's
      next_action, targeted the thinner themes (1/3/4) instead of only theme 2. Theme 1 (furniture
      sizing/fit frustration) surfaced only WebSearch-synthesized retailer-complaint aggregates (City
      Furniture, Jennifer Furniture, Rooms2Go -- items not fitting the room/delivery team refusing to
      place them), not independently verbatim-fetchable at the source, so no addition there. Theme 4
      (AR view-in-room) surfaced only re-paraphrased Baymard stats already cited, no new source. Theme
      3 (prior full-service e-design fails on price/delivery) DID surface a genuinely new,
      directly-fetched, verbatim-verified source: BBB's Havenly, Inc. complaints page
      (bbb.org/us/co/denver/profile/interior-designer/havenly-inc-1296-90260312/complaints) fetched
      cleanly via WebFetch (unlike trustpilot.com/review/havenly.com, which still 403s) -- a NEW
      reachable source for Havenly-specific complaints, distinct from the blocked Trustpilot source.
      Dated, verbatim complaints: a $6,772.06 charge without approval (7/24/2025); a $3,000 rug ordered
      2/17/2026, promised delivery Feb 28-Mar 4, still no ETA by 3/26/2026; an $814 discontinued-item
      charge left unrefunded after multiple requests (9/17/2025); "I cannot get someone on the phone
      and am continually connected to a bot" (6/2/2026). This corroborates the existing TechCrunch/Modsy
      citation with a SECOND independent, directly-fetched publisher for theme 3 (up from 1), and the
      dates (spanning mid-2025 through mid-2026) show the pricing/delivery/refund pain is CURRENT, not
      a one-time 2022 collapse story. Held `confidence` at "emerging", NOT raised to "strong": the
      strengthening is one new source in one of four themes -- S10's "strong" bar is source count +
      independence PER THEME, and themes 1/2/4 are unchanged since Run 12. Real, incremental progress;
      also opens BBB as a standing usable source for future Havenly/competitor-complaint research
      (recorded in web_research validation above) since it is not blocked the way Trustpilot is.
    prior_notes: >-
      Run 12: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403,
      re-confirmed this run -- 6th consecutive re-probe with the same result). Additionally ran a
      fresh WebSearch angle targeting theme 1 (furniture-shopping decision fatigue/survey data) and
      theme 2 (AI app reviews using words like "waste of money") -- theme 1's search surfaced only
      WebSearch-synthesized stats (3D Cloud, SpeakWise, First Chair aggregate blog posts), not a new
      independently-fetchable verbatim source, so theme 1 stays at its existing 3-source base (no
      regression, no addition). Theme 2's search DID surface a genuinely new, directly-fetched,
      verbatim-verified source from a NEW source type -- real paying-customer App Store reviews,
      not a blog/press citation: apps.apple.com's Interium ("AI Interior Design") review page,
      fetched cleanly via WebFetch, three 1-star reviews verbatim-quoted (see theme 2 sources). This
      is a fourth independent theme-2 source and a new specific failure mode beyond "furniture isn't
      buyable" (First Chair) and "styling drift/spatial-blindness" (MONA): the AI output does not
      honor the user's actual instruction -- one reviewer describes asking the app to "rearrange"
      existing room items and instead receiving "a whole new furnitures" restructuring "nothing like
      i asked for." This directly validates AptDesignerAI's design commitment to grounding mockups in
      the user's actual photographed room and stated intent, rather than generating a disconnected
      redesign. Held `confidence` at "emerging", NOT raised to "strong": the strengthening is again
      concentrated in theme 2 (now 4 independent sources, 3 verbatim-verified) while themes 1/3/4 are
      unchanged since Run 7/11 -- S10's "strong" bar is source count + independence PER THEME, so one
      strong theme does not lift the overall read. Real, incremental, source-type-diversifying
      progress (App Store reviews are a materially different evidentiary class than blog/press
      citations -- unmediated paying-customer language) -- not a tier jump.
      Run 11: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403,
      re-confirmed this run). Additionally ran ONE fresh WebSearch with a new query angle (not a
      re-probe of a known-blocked source) and found a genuinely NEW, dated, independent citation for
      theme 2 -- monaverse.com/blog/ai-interior-design-tools, "Most AI Interior Design Tools Were
      Built for the Wrong Room" by Justin Melillo (MONA Blog, published 2026-06-10) -- VERBATIM-VERIFIED
      via direct WebFetch this run: "The furniture changes because most AI room design tools generate
      each image from scratch, with no persistent model of the space" (the "styling drift" problem --
      a design element the owner approved in one render mutates in the next: "the bouclé is now caramel
      leather, the rug lost its border, and the pendant grew a third arm"), plus a distinct spatial-
      accuracy complaint ("Most do not" understand floorplans properly -- renders can place "a window
      where your client has a party wall"). This is a NEW angle beyond the existing "furniture isn't
      buyable" framing (First Chair, Run 6) -- it corroborates the same underlying theme (AI room tools
      fail on the physical/spatial reality of a room) from a third independent, named, dated publisher,
      raising theme 2's source count to 4 (2 now verbatim-verified: First Chair + MONA). Held
      `confidence` at "emerging", NOT raised to "strong": the strengthening is concentrated in ONE of
      four themes (S10's "strong" bar is source count + independence PER THEME, not just one theme
      improving), and Reddit stays completely unreachable across every theme. Real, incremental
      progress -- not a tier jump.
      Run 10: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403, re-confirmed
      this run). No new citation attempted -- same reasoning as Runs 8-9: the 4 themes already carry a
      directly-fetched, hand-verified quote each (Run 7), and re-running the same blocked probes adds no
      evidence. Held confidence at "emerging" (unchanged). This run's primary work was closing a real
      FACTORY_STANDARD S22 computation-integrity gap on the business case (see learnings), not new
      demand-signal research -- diminishing-returns reasoning unchanged since Run 8.
      Run 9: re-probed both structural gaps per S10's every-run requirement -- unchanged (reddit.com
      hard-blocked by the WebFetch tool itself; trustpilot.com/review/havenly.com HTTP 403). No new
      citation attempted -- same reasoning as Run 8: the 4 themes already carry a directly-fetched,
      hand-verified quote each (Run 7), and re-running the same blocked probes adds no evidence. Held
      confidence at "emerging" (unchanged). This run's primary work was fixing the GTM Auditor's named
      business-case-honesty gap (see learnings), not demand-signal research.
      Run 8: re-probed both structural gaps per S10's every-run requirement -- unchanged. reddit.com
      is still hard-blocked by the WebFetch TOOL itself ("Claude Code is unable to fetch from
      www.reddit.com"); trustpilot.com/review/havenly.com still returns HTTP 403 (site-side
      Cloudflare bot-block). No new citation attempted this run -- the existing 4 themes already
      carry a directly-fetched, hand-verified quote each (Run 7), and re-running the same blocked
      probes without a new angle would not change the evidence base. Held confidence at Run 7's
      "emerging" (unchanged; see below for why not "strong"). Prior method_note (Run 7) follows
      verbatim for the full verification history:
      Run 7: closed out Run 6's two carried-over-but-unverified citations via direct WebFetch.
      Baymard Institute's AR-avoidance article (baymard.com/blog/deprioritize-view-in-room-
      augmented-reality) fetched cleanly -- VERBATIM-VERIFIED, dated 2024-05-15: "87% of test
      participants who encountered 'View in Room' chose not to use it" / "66% of users opted out
      of using AR and another 21% said they would but then didn't" / only "6% ... sought out and
      used it proactively." TechCrunch's Modsy piece also fetched cleanly on the CORRECTED URL
      (techcrunch.com/2022/07/17/modsy-quietly-shut-down-while-some-customers-were-still-awaiting-
      refunds/ -- Run 5/6 cited a shorter, non-resolving path guess) -- VERBATIM-VERIFIED:
      "Capital constraints and uncertain market conditions forced the company to cease operations
      on July 6" (CEO Shanna Tellerman) / a customer stating "We have $4,500 in undelivered or
      unanswered return request" / another "I had $50,000 of in-process orders that are in limbo."
      Re-probed the two known tooling gaps -- both unchanged: trustpilot.com still 403s to
      WebFetch (Havenly's own review page remains unreachable; the earlier "2.8/5 on 3 reviews"
      Interior-AI citation and the Havenly pricing-markup citation both stay WebSearch-synthesized,
      not independently re-fetched), and the corrected HN item (id=35267253) still 429s. Net: 4 of
      4 themes now carry at least one directly-fetched, hand-verified, dated, named-source verbatim
      quote (up from 2 of 4 in Run 6) -- Reddit and Trustpilot remain the only structurally
      unreachable sources, and per-theme source COUNT is still small (1-3 sources/theme, mostly one
      per publisher). Also independently found + fixed (per S4/GTM_SCORECARD artifact_freshness):
      store-listing.md and press-kit.md had been advertising the Pro Annual ($399/yr) tier since
      PR #150 (2026-06-27) despite migration 021 (the DB tier constraint it needs) still being
      unapplied -- a plan visitors could not actually purchase. Removed it from both public-facing
      docs this run (see learnings) rather than treating this as a demand-signal task; noted here
      only because it was surfaced while re-reading these same docs for the positioning check.
    confidence: emerging          # held at "emerging" since Run 6, NOT raised to "strong": the honest
                                   # gate for "strong" is source COUNT + independence per theme, not
                                   # just verbatim-ness, and that count is still thin (1-2/theme);
                                   # Reddit stays completely unreachable; still qualitative signal,
                                   # never PMF (S1/S10). Real strengthening (theme 3 now 2 verbatim
                                   # sources, Run 13), but not yet a tier jump.
    themes:
      - theme: "Furniture-shopping choice paralysis (multi-hour, no clear starting point)"
        sources: "eMarketer (Arielle Feger, published 2026-05-18, emarketer.com/content/why-furniture-shopping-broken-how-ai-starting-fix) -- VERBATIM-VERIFIED via direct fetch (Run 6): Dan Bennett (CMO, furniture.com) quoted as 'nine hours and 13 tabs used just to find a solution to a furniture problem'; Baymard Institute independent UX research -- now itself VERBATIM-VERIFIED this run (see method_note), not just cited as a stat; Hacker News 'Why buying furniture is so miserable' -- item?id=35267253 (found via hn.algolia.com search API; Run 5's cited id=35266271 was wrong; the corrected item page itself still 429s under direct fetch this run too, so this one citation stays URL-corrected but not re-quoted)"
        solved_by_product: "yes -- sourcing real, budget-fit products directly cuts the multi-tab search cost"
        recency: "durable AND current -- the eMarketer piece is 7 weeks old (2026-05-18) and cites the same order-of-magnitude pain (9hrs/13 tabs) as the hand-verified version"
      - theme: "AI room-render tools generate furniture that isn't real or buyable"
        sources: "First Chair blog (published 2026-06-15, firstchair.app/blog/home-ai-alternatives) -- VERBATIM-VERIFIED via direct fetch (Run 6): 'Most AI room tools generate concepts you can't purchase.' / 'The furniture in those renders doesn't exist.' / 'Decorify only shows Wayfair products, which means your room will look like it came from one store.' / 'The furniture in those images is often fabricated or impossible to source.'; MONA blog (Justin Melillo, published 2026-06-10, monaverse.com/blog/ai-interior-design-tools) -- VERBATIM-VERIFIED via direct fetch (Run 11): 'The furniture changes because most AI room design tools generate each image from scratch, with no persistent model of the space' (the 'styling drift' failure mode -- an approved design mutates between renders: 'the bouclé is now caramel leather, the rug lost its border, and the pendant grew a third arm'), plus a spatial-accuracy complaint ('Most do not' understand floorplans -- can render 'a window where your client has a party wall'); Interium ('AI Interior Design') App Store review page (apps.apple.com/us/app/ai-interior-design-interium/id6499216812) -- VERBATIM-VERIFIED via direct fetch (Run 12), a NEW source TYPE (real paying-customer reviews, not blog/press): three 1-star reviews quoted verbatim, including 'The app advertises that you can take a photo of a room and have it rearrange the furniture and items into a new design. Unfortunately, that is not how the app actually works,' and 'it still gives me an image of whole new furnitures and it restructures my whole house, nothing like i asked for'; independently corroborates the RoomGPT/Interior AI Trustpilot finding (2.8/5 on 3 reviews, WebSearch-synthesized only -- trustpilot.com still 403s to direct WebFetch, re-confirmed this run); Business of Home trade press, 2025 (the 2023 wave of AI interior-design apps has produced no clear winner)"
        solved_by_product: "yes -- closest to this product's core differentiator (real purchasable, persistent products vs. hallucinated/drifting furniture); the First Chair critique of single-retailer tools (Decorify/Wayfair-only) validates this product's multi-retailer sourcing, the MONA 'styling drift'/spatial-accuracy critique validates grounding mockups in the user's actual photographed room rather than from-scratch generation, and the Interium reviews validate a THIRD angle -- honoring the user's actual room/request rather than substituting a generic AI redesign -- three distinct, product-relevant differentiation angles now evidenced"
        recency: "durable AND current -- First Chair (2026-06-15) and MONA (2026-06-10) are both ~5 weeks old relative to this run, and the Interium App Store reviews are live/current (no archive date, but reflect the app's present-day behavior); now the most independently-corroborated theme across five research sessions (Run 5/6/7/11/12) using different source sets and source TYPES (press, blog, App Store reviews), 3 of 4 sources verbatim-verified"
      - theme: "Prior full-service e-design (Havenly, Modsy) is expensive and/or fails on delivery"
        sources: "TechCrunch on Modsy's 2022-07-17 shutdown -- VERBATIM-VERIFIED via direct fetch (Run 7): CEO-attributed 'capital constraints,' plus customer quotes citing $4,500 and $50,000 in undelivered orders/refunds; BBB Havenly, Inc. complaints page (bbb.org/us/co/denver/profile/interior-designer/havenly-inc-1296-90260312/complaints) -- VERBATIM-VERIFIED via direct fetch (Run 13), a SECOND independent directly-fetched publisher: a $6,772.06 charge without customer approval (7/24/2025), a $3,000 rug with no delivery ETA a month past its promised window (3/26/2026), an $814 discontinued-item charge left unrefunded after multiple requests (9/17/2025), and 'I cannot get someone on the phone and am continually connected to a bot' (6/2/2026) -- dates spanning mid-2025 to mid-2026 show this is CURRENT, ongoing pain, not a historical artifact; Havenly Trustpilot pricing-markup complaints -- still WebSearch-synthesized only (trustpilot.com 403s to direct WebFetch, re-confirmed this run): a coffee table priced '$511 versus $265 at retailers' via Havenly's concierge markup"
        solved_by_product: "partially -- self-serve software at the existing 29-dollar one-time tier undercuts concierge pricing and sidesteps the delivery/refund/no-phone-support failure mode the BBB complaints document directly, but does not remove retailer-side fulfillment risk"
        recency: "Modsy's collapse reads as capital/M&A-driven per trade press, not a demand verdict -- does not disconfirm the underlying need, but flags the human-concierge business model as fragile; the NEW BBB citations are dated across mid-2025-mid-2026, showing the pricing/delivery/refund/support pain is CURRENT and recurring at a live competitor (Havenly), not just a defunct one (Modsy) -- the strongest recency evidence this theme has had to date"
      - theme: "AR 'view in room' has not solved the visualize-before-buying trust gap"
        sources: "Baymard Institute (baymard.com/blog/deprioritize-view-in-room-augmented-reality, dated 2024-05-15) -- VERBATIM-VERIFIED via direct fetch this run: '87% of test participants who encountered View in Room chose not to use it', only '6%... sought out and used it proactively', top cited reasons 'negative prior experiences, real-life space constraints, insufficient instructions, clunky controls, low-quality 3D models'; IKEA Place review aggregation (confusing placement UX, objects reading as illustrations) -- still WebSearch-synthesized, not independently re-fetched"
        solved_by_product: "yes, via a different mechanism -- a considered AI mockup of the user's actual photographed room rather than a live AR camera overlay"
        recency: "the Baymard article is 2024-05-15 -- older than the other themes' sources, so read as DURABLE ongoing UX research rather than a current spike; no evidence the finding has reversed since (First Chair's 2026-06-15 piece, verified Run 6, independently corroborates the same underlying trust gap from a different angle)"
    disconfirming:
      - "Business of Home (2025): the 2023 wave of AI interior-design apps has produced no clear winner; some entrants described as lightly scammy cash grabs -- a real category-fatigue signal (carried over from Run 5)"
      - "A cited survey found consumers rating general-purpose ChatGPT as a better design-consultation experience than dedicated apps -- a free-substitute threat to any positioning that is just 'AI gives you design ideas' (carried over from Run 5)"
      - "AR view-in-room already had a large, well-resourced attempt (IKEA/Wayfair/Amazon) that is independently shown to be avoided by most users -- confirms the visualize-before-buying job is unsolved but shows that adding visualization alone is not sufficient (now verbatim-verified this run via the Baymard source itself)"
      - "Reddit remains completely unreachable across six straight runs (Run 6-12, S10's TOS-gated-for-commercial-mining source) -- still a hard TOOL-level block on reddit.com/old.reddit.com specifically (see method_note); still not read as disconfirming, just an unresolved tooling gap"
    positioning_implication: >-
      Still directional -- confidence held at emerging, NOWHERE NEAR the S3 bar for a business-case
      number change or a roadmap steer (that needs quantified, statistically significant,
      causally revenue-linked evidence; this stays qualitative pain-signal, exactly what S10 says
      never becomes a hard number). The verbatim-verified evidence base sharpens the SAME
      positioning read prior runs reached directionally: lead with "real, buyable, budget-fit
      furniture sourced from multiple retailers for your actual room" over an undifferentiated
      "AI design ideas" claim, and keep entry pricing low relative to Havenly/Modsy-style concierge
      pricing (backed by a directly-quoted $511-vs-$265 markup example and a directly-quoted Modsy
      collapse). Run 11 adds a THIRD evidence-backed differentiation angle alongside "real/buyable"
      and "multi-retailer": persistent, spatially-grounded mockups (the MONA citation's "styling
      drift" and floorplan-blind-render complaints are a named, dated, real problem this product's
      actual-photographed-room approach directly answers). store-listing.md and press-kit.md lead
      with real sourced products and the one-time-price framing -- consistent, no copy change
      needed this run (research-only addition). All three angles (real/buyable, multi-retailer,
      persistent-spatial-grounding) remain worth surfacing together in a FUTURE ASO/copy pass
      closer to launch (still not actioned now).
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
    - "CIRCUIT BREAKER (Run 13, still fired): same 5 core owner blockers unresolved for a 13th consecutive run (SITE_GATE_PASSWORD, RESEND_API_KEY+RESEND_FROM_EMAIL, INTERNAL_METRICS_TOKEN, CRON_SECRET, EMAIL_PHYSICAL_ADDRESS) -- verified directly against PENDING_OPS.md this run (as_of still 2026-07-14, unchanged since Run 10; every one of the 5 still status:open, plus apply-migration-021). The core 4 have now been open, unchanged, since Run 1 (2026-06-27) -- 13 runs / ~26 days on setup steps CONNECT.md estimates at well under 20 minutes combined. git log shows the Product Factory shipped Runs 99-107 in the interim (#666-#683): a DEEP AUDIT, several security/mobile/a11y/F2-coverage fixes, and a billing past_due grace-period feature -- verified none touched a GTM-owned doc (store-listing/press-kit/social-drafts/content-calendar/email docs/OUTREACH.md all clean) -- none of it a growth-channel connection."
    - "SIGNIFICANT (Run 13): the independent GTM Auditor's weekly pass landed (auditor_run 3, as_of 2026-07-20, between Run 12 and this run) and the GTM Factory's OWN ship gate is now MET -- overall A, ship_gate_met:true, business_case_honesty raised B->A (the annual-tier disclosure fix Run 9 landed is now confirmed and graded), all four ship-critical GTM dimensions A/A+. This is the Run-12 next_action closing out as expected. IMPORTANT DISTINCTION recorded explicitly this run (added a gtm_scorecard validation entry): this is NOT the gate that unlocks outbound marketing. GTM_STANDARD S6's outreach precondition is the SEPARATE, PRODUCT-side docs/quality/QUALITY_SCORECARD.md reporting ship_gate_met -- re-verified this run, still FALSE (as_of 2026-07-20, overall C, functional_reality/design_taste/business_case_strength all still below A). Both S6 lanes stay hard-off; conflating the two scorecards would be a real self-validation error, so this run made the distinction structural (its own validation-block entry) rather than a one-line note."
    - "Re-confirmed the aptdesignerai.com unreachability a TENTH time (curl/agent-proxy, both the root URL and the metrics API directly: connect_rejected / gateway 502 to CONNECT 'CONNECT tunnel failed', identical signature to Runs 6-12, cross-checked against /__agentproxy/status recentRelayFailures, two entries 2026-07-23T05:08:37-38Z). No new signature this run; practical conclusion unchanged."
    - "NEW (Run 13): demand-signal research targeted the thinner themes (1/3/4) per Run 12's own next_action, rather than theme 2 again. Found a genuinely new, directly-fetched, verbatim-verified source for theme 3: BBB's Havenly, Inc. complaints page -- NOT blocked, unlike trustpilot.com/review/havenly.com (still 403s, re-confirmed this run). Dated complaints spanning 7/24/2025 through 6/2/2026 (an unapproved $6,772.06 charge, a $3,000 rug with no delivery ETA a month past its window, an unrefunded $814 discontinued-item charge, 'continually connected to a bot' with no phone support) show the pricing/delivery/refund/support pain at a live competitor is CURRENT, not a one-time 2022 Modsy-shutdown story. This is theme 3's second independent verbatim source (up from 1) and opens BBB as a standing usable research channel going forward. Themes 1 and 4 fresh-angle attempts found only WebSearch-synthesized aggregates, correctly not added as unverified citations. Held confidence at 'emerging' -- one theme strengthened, not all four."
    - "Funnel remains 0/null across every metric -- no connected source has reported numbers. Correct and honest: no fabrication."
    - "Confirmed no docs/growth/MARKETING_HOLD kill-switch file exists (checked first, per GTM_STANDARD S13) and no approved_channels record / docs/growth/MARKETING_APPROVED exists (per S9/S13) -- consistent with staying in PREPARE with zero paid/new-channel action. site_gate_up:false AND ship_gate_met:false (QUALITY_SCORECARD still C) -- both lanes of S6 outreach stay hard-off. Zero outreach drafts this run, correct."
    - "ASO keyword research from Run 3 remains blocked: competition estimates are not verifiable via App Store Connect Search Ads from this agent. No new attempt this run -- still owner-gated."
  next_actions:
    - "CIRCUIT BREAKER (13th run) -- Owner: set SITE_GATE_PASSWORD in Vercel (2-min setup) to enable execute-mode + flip site_gate_up to true in GROWTH_STATUS"
    - "CIRCUIT BREAKER (13th run) -- Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL (15-min setup) to activate all lifecycle email sends"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API -- this runtime's network restriction is scoped to aptdesignerai.com specifically, not general egress (see validation block)"
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron"
    - "Owner: apply migration 021 (pro_annual tier constraint) + set ANNUAL_BILLING_ENABLED=true -- the named cause of QUALITY_SCORECARD's business_case_strength regression (shippable-today ARR $99,926 is below the $100K floor without it). The GTM_SCORECARD business_case_honesty gap this used to also block is now separately closed (Run 3, GTM ship gate met) -- this migration is purely a product-readiness/business-case-strength blocker now, not a GTM-honesty one. Also unblocks re-adding Pro Annual to marketing copy."
    - "Owner: set EMAIL_PHYSICAL_ADDRESS on the deployment so marketing-lifecycle emails clear the CAN-SPAM footer requirement -- code + tests already ship (PENDING_OPS.md set-email-physical-address); zero action needed beyond the env var"
    - "Next run: re-check whether the independent Product Quality Auditor's next pass moved functional_reality/design_taste/business_case_strength off C/B -- THIS is the gate that unlocks outreach (GTM_SCORECARD being A does not), so it is the single most important scorecard to watch now"
    - "Next run: verify ASO keyword competition claims via App Store Connect Search Ads before landing keyword change"
    - "Next run: continue targeting themes 1/2/4 with fresh angles (theme 3 got this run's new BBB source; themes 1 and 4 still sit on WebSearch-synthesized-only or single-source evidence) -- would do the most to eventually justify a 'strong' confidence read"
    - "Next run: try BBB.org (confirmed reachable this run, unlike Trustpilot) for other AI-interior-design-app competitors' complaint pages, not just Havenly -- a promising new research channel opened this run"
    - "Product-Factory build note (not owner-actionable today): a real Stripe Reporting API integration would let trial-start/paid-conversion RATE metrics surface distinctly from the DB-derived MRR/subscriber counts already unlocked by INTERNAL_METRICS_TOKEN -- see the stripe_reporting validation entry."
  owner_blockers:
    - "PRIORITY 1 -- Set SITE_GATE_PASSWORD in Vercel (2 min): gates app pre-launch, unblocks execute-mode outreach -- PENDING_OPS.md item set-site-gate-password (open 13 consecutive runs / ~26 days)"
    - "PRIORITY 2 -- Set RESEND_API_KEY + RESEND_FROM_EMAIL (verified domain, 15 min): unblocks ALL lifecycle email sends -- docs/growth/CONNECT.md Step 1 (open 13 consecutive runs / ~26 days)"
    - "PRIORITY 3 -- Set INTERNAL_METRICS_TOKEN: opens funnel metrics pull API -- docs/growth/CONNECT.md Step 2"
    - "PRIORITY 4 -- Set CRON_SECRET + apply migration 025: activates daily activation email cron -- PENDING_OPS.md"
    - "PRIORITY 5 -- Apply migration 021 + set ANNUAL_BILLING_ENABLED=true (also unblocks re-adding Pro Annual to marketing copy): the named cause of QUALITY_SCORECARD's business_case_strength regression (shippable-today ARR $99,926 is below the $100K floor without it)"
    - "PRIORITY 6 -- Apply remaining DB migrations 022/023/026/027/029 to prod -- PENDING_OPS.md"
    - "PRIORITY 7 -- Set EMAIL_PHYSICAL_ADDRESS: unblocks CAN-SPAM-compliant marketing-lifecycle sends once RESEND_API_KEY also lands -- PENDING_OPS.md set-email-physical-address"
    - "PRIORITY 8 -- Connect/authorize social accounts -- docs/growth/CONNECT.md Step 4"
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
