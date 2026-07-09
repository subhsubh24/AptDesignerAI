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
  as_of: 2026-07-09
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
  validation:                    # GTM_STANDARD S4 self-validation -- every external source this agent depends on; fail-closed
    - source: internal_metrics_api
      status: unavailable
      reason: "INTERNAL_METRICS_TOKEN not set on the deployment (owner action pending, PENDING_OPS.md set-metrics-token still status:open). Separately, this agent's own runtime has no outbound network path to aptdesignerai.com -- FOUR independent probe attempts across four runs have each failed a different way (2026-07-01: HTTP 403 policy denial; 2026-07-03: bare connection error; 2026-07-05: HTTP 502 'CONNECT tunnel failed'; 2026-07-09, this run: HTTP 502 'CONNECT tunnel failed' again, same signature as Run 6, confirmed both via direct curl and the agent-proxy's own status endpoint recentRelayFailures log at 2026-07-09T05:08:58Z) -- the practical conclusion is unchanged across all four: no reachable path to the production host from this runtime, independent of whether the owner sets the token. This unreachability is specific to aptdesignerai.com -- it does NOT mean this runtime's network access is blocked generally: WebSearch/WebFetch to OTHER external domains (baymard.com, techcrunch.com, apple.com, emarketer.com, firstchair.app) worked cleanly this run (see demand_signal.method_note) -- so setting INTERNAL_METRICS_TOKEN plus resolving JUST the aptdesignerai.com egress path (not a blanket network-policy fix) would unblock this source."
    - source: resend_email
      status: unavailable
      reason: "RESEND_API_KEY / RESEND_FROM_EMAIL not set (PENDING_OPS.md connect-email-resend still status:open); the email lifecycle runs in dry-run (nothing sent)."
    - source: stripe_reporting
      status: unavailable
      reason: "No Stripe reporting credential is connected to this agent; trial/paid/MRR/churn metrics stay 0/null."
    - source: site_gate
      status: unavailable
      reason: "SITE_GATE_PASSWORD not set on the deployment (PENDING_OPS.md set-site-gate-password still status:open); site_gate_up stays false, hard-blocking pre-launch execute-mode outreach. NOTE: this agent's own sandbox env has a SITE_GATE_PASSWORD-named value present (as it has since Run 5, alongside CRON_SECRET since Run 6) -- per S4 fail-closed and Run 5/6's established reasoning, this is validator-credential scaffolding for a DIFFERENT routine's sandbox, not evidence the production Vercel deployment has it configured; not used, not inferred as connected."
    - source: social_channels
      status: unavailable
      reason: "No social platform credentials connected (X / Instagram / TikTok / Reddit); the publishing queue stays dry-run."
    - source: web_research
      status: degraded
      reason: "WebSearch + WebFetch work broadly (this run verbatim-verified baymard.com and techcrunch.com directly). Two structural gaps persist unchanged across Runs 5-7: (1) reddit.com/old.reddit.com are hard-blocked by the WebFetch TOOL itself, not this environment's proxy -- zero Reddit posts obtainable despite Reddit being GTM_STANDARD S10's richest recommended source; (2) trustpilot.com returns HTTP 403 to WebFetch (site-side Cloudflare bot-block) on every attempt (re-confirmed this run against havenly.com's review page) -- Trustpilot-sourced claims (Havenly pricing/delivery complaints, the RoomGPT/Interior-AI 2.8/5 rating) stay WebSearch-synthesized, never independently re-fetched. Added as a structured entry this run per GTM_SCORECARD.md's self_validation_honesty gap (previously only documented in demand_signal prose)."
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
    as_of: 2026-07-09
    method_note: >-
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
    confidence: emerging          # held at Run 6's "emerging", NOT raised to "strong" despite going
                                   # 2-of-4 -> 4-of-4 verbatim-verified themes this run: the honest
                                   # gate for "strong" is source COUNT + independence per theme, not
                                   # just verbatim-ness, and that count is still thin (1-3/theme);
                                   # Reddit stays completely unreachable; still qualitative signal,
                                   # never PMF (S1/S10). Real strengthening, but not yet a tier jump.
    themes:
      - theme: "Furniture-shopping choice paralysis (multi-hour, no clear starting point)"
        sources: "eMarketer (Arielle Feger, published 2026-05-18, emarketer.com/content/why-furniture-shopping-broken-how-ai-starting-fix) -- VERBATIM-VERIFIED via direct fetch (Run 6): Dan Bennett (CMO, furniture.com) quoted as 'nine hours and 13 tabs used just to find a solution to a furniture problem'; Baymard Institute independent UX research -- now itself VERBATIM-VERIFIED this run (see method_note), not just cited as a stat; Hacker News 'Why buying furniture is so miserable' -- item?id=35267253 (found via hn.algolia.com search API; Run 5's cited id=35266271 was wrong; the corrected item page itself still 429s under direct fetch this run too, so this one citation stays URL-corrected but not re-quoted)"
        solved_by_product: "yes -- sourcing real, budget-fit products directly cuts the multi-tab search cost"
        recency: "durable AND current -- the eMarketer piece is 7 weeks old (2026-05-18) and cites the same order-of-magnitude pain (9hrs/13 tabs) as the hand-verified version"
      - theme: "AI room-render tools generate furniture that isn't real or buyable"
        sources: "First Chair blog (published 2026-06-15, firstchair.app/blog/home-ai-alternatives) -- VERBATIM-VERIFIED via direct fetch (Run 6): 'Most AI room tools generate concepts you can't purchase.' / 'The furniture in those renders doesn't exist.' / 'Decorify only shows Wayfair products, which means your room will look like it came from one store.' / 'The furniture in those images is often fabricated or impossible to source.'; independently corroborates the RoomGPT/Interior AI Trustpilot finding (2.8/5 on 3 reviews, WebSearch-synthesized only -- trustpilot.com still 403s to direct WebFetch, re-confirmed this run); Business of Home trade press, 2025 (the 2023 wave of AI interior-design apps has produced no clear winner)"
        solved_by_product: "yes -- closest to this product's core differentiator (real purchasable products vs. hallucinated furniture); the First Chair critique of single-retailer tools (Decorify/Wayfair-only) also validates this product's multi-retailer sourcing as a distinct angle, not just 'real vs fake'"
        recency: "durable AND current -- First Chair post is 3 weeks old relative to Run 6 (2026-06-15); the single most independently-corroborated theme across three research sessions (Run 5/6/7) using different source sets"
      - theme: "Prior full-service e-design (Havenly, Modsy) is expensive and/or fails on delivery"
        sources: "TechCrunch on Modsy's 2022-07-17 shutdown -- VERBATIM-VERIFIED this run on the corrected URL (see method_note): CEO-attributed 'capital constraints,' plus customer quotes citing $4,500 and $50,000 in undelivered orders/refunds; Havenly Trustpilot pricing-markup and late-delivery complaints -- still WebSearch-synthesized only (trustpilot.com 403s to direct WebFetch, re-confirmed this run): a coffee table priced '$511 versus $265 at retailers' via Havenly's concierge markup, and delivery ETAs unavailable weeks after order per aggregated review summaries"
        solved_by_product: "partially -- self-serve software at the existing 29-dollar one-time tier undercuts concierge pricing and sidesteps the delivery/refund failure mode, but does not remove retailer-side fulfillment risk"
        recency: "Modsy's collapse reads as capital/M&A-driven per trade press, not a demand verdict -- does not disconfirm the underlying need, but flags the human-concierge business model as fragile; does not apply to a software-only product"
      - theme: "AR 'view in room' has not solved the visualize-before-buying trust gap"
        sources: "Baymard Institute (baymard.com/blog/deprioritize-view-in-room-augmented-reality, dated 2024-05-15) -- VERBATIM-VERIFIED via direct fetch this run: '87% of test participants who encountered View in Room chose not to use it', only '6%... sought out and used it proactively', top cited reasons 'negative prior experiences, real-life space constraints, insufficient instructions, clunky controls, low-quality 3D models'; IKEA Place review aggregation (confusing placement UX, objects reading as illustrations) -- still WebSearch-synthesized, not independently re-fetched"
        solved_by_product: "yes, via a different mechanism -- a considered AI mockup of the user's actual photographed room rather than a live AR camera overlay"
        recency: "the Baymard article is 2024-05-15 -- older than the other themes' sources, so read as DURABLE ongoing UX research rather than a current spike; no evidence the finding has reversed since (First Chair's 2026-06-15 piece, verified Run 6, independently corroborates the same underlying trust gap from a different angle)"
    disconfirming:
      - "Business of Home (2025): the 2023 wave of AI interior-design apps has produced no clear winner; some entrants described as lightly scammy cash grabs -- a real category-fatigue signal (carried over from Run 5)"
      - "A cited survey found consumers rating general-purpose ChatGPT as a better design-consultation experience than dedicated apps -- a free-substitute threat to any positioning that is just 'AI gives you design ideas' (carried over from Run 5)"
      - "AR view-in-room already had a large, well-resourced attempt (IKEA/Wayfair/Amazon) that is independently shown to be avoided by most users -- confirms the visualize-before-buying job is unsolved but shows that adding visualization alone is not sufficient (now verbatim-verified this run via the Baymard source itself)"
      - "Reddit remains completely unreachable for a third straight run -- still a hard TOOL-level block on reddit.com/old.reddit.com specifically (see method_note); still not read as disconfirming, just an unresolved tooling gap"
    positioning_implication: >-
      Still directional -- confidence held at emerging, NOWHERE NEAR the S3 bar for a business-case
      number change or a roadmap steer (that needs quantified, statistically significant,
      causally revenue-linked evidence; this stays qualitative pain-signal, exactly what S10 says
      never becomes a hard number). The now-fully-verbatim-verified evidence (4/4 themes) sharpens
      the SAME positioning read prior runs reached directionally: lead with "real, buyable,
      budget-fit furniture sourced from multiple retailers for your actual room" over an
      undifferentiated "AI design ideas" claim, and keep entry pricing low relative to
      Havenly/Modsy-style concierge pricing (now backed by a directly-quoted $511-vs-$265 markup
      example and a directly-quoted Modsy collapse). store-listing.md and press-kit.md lead with
      real sourced products and the one-time-price framing -- consistent, no further copy change
      needed beyond this run's Pro Annual removal (see learnings, an unrelated honesty fix, not a
      demand-signal-driven change). The multi-retailer angle (vs. Decorify's single-retailer
      limitation) remains a genuinely new, evidence-backed differentiation point worth surfacing
      in a FUTURE ASO/copy pass closer to launch (still not actioned now).
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
    - "CIRCUIT BREAKER (Run 7, still fired): same 4 core owner blockers unresolved for a 7th consecutive run (SITE_GATE_PASSWORD, RESEND_API_KEY+RESEND_FROM_EMAIL, INTERNAL_METRICS_TOKEN, CRON_SECRET) -- verified directly against PENDING_OPS.md this run (set-site-gate-password / connect-email-resend / set-metrics-token / set-cron-secret all still status:open). PENDING_OPS.md's own as_of DID move (2026-06-29 -> 2026-07-09), but the diff (git log -p) shows it was the Product Factory's own Run 72 housekeeping commit (#516, refreshing as_of + fixing a phantom 'Anthropic' spend-cap mention) -- not an owner action on any of the 4 blockers, all of which remain status:open verbatim. No growth-engine code work was needed (engine remains complete at 100%); correct output stays a quiet, honest no-op on execution."
    - "NEW (Run 7): re-confirmed the aptdesignerai.com unreachability a FOURTH time -- HTTP 502 'CONNECT tunnel failed', the same signature as Run 6, cross-checked against the agent-proxy's own /__agentproxy/status recentRelayFailures log (timestamp 2026-07-09T05:08:58Z, two entries). No new information here; recorded per S4's re-probe-every-run rule rather than assumed unchanged."
    - "docs/quality/QUALITY_SCORECARD.md (independent Quality Auditor) moved since Run 6: now as_of 2026-07-05, overall RAISED C->B (functional_reality closed C->A), but ship_gate_met is STILL false -- design_taste is now the sole sub-A ship-critical dimension. Read as DATA only, not re-graded here; phase correctly stays pre_launch (QUALITY_SCORECARD is the marketing-maturity gate input, ANALYSIS_PLAYBOOK.md) since ship_gate_met remains false."
    - "docs/growth/GTM_SCORECARD.md now exists (first GTM Auditor run, as_of 2026-07-06): overall C, ship_gate_met false on ONE ship-critical F -- business_case_honesty (the base ARR $122.9K was mislabeled as a year-1 result when it is a steady-state figure; honest floor reached ~year 3). CROSS-CHECKED this run: the Product Factory ALREADY fixed this independently at PR #508 (2026-07-06, docs(business-case): correct floor timing) -- docs/BUSINESS_CASE.md now reads floor_met_year1:false with the corrected steady-state/~year-3 framing, predating even the scorecard's own as_of. Read as DATA, not re-graded (owned by the Auditor); the fix already landed, so this ship-critical gap looks resolved pending the Auditor's next pass re-confirming it."
    - "Fixed this run: the scorecard's SECOND top_gap (artifact_freshness, severity 2, non-ship-critical) -- store-listing.md and press-kit.md had advertised the Pro Annual ($399/yr) tier since PR #150 (2026-06-27, predates every prior Growth Agent run), while migration 021 (the DB tier constraint it needs) is still unapplied (PENDING_OPS.md apply-migration-021, status:open) -- an annual checkout would fail with a Postgres constraint violation, so both docs advertised a plan visitors could not actually purchase. Removed the Pro Annual line from the Apple + Google Play copy blocks in store-listing.md and from press-kit.md's facts table + boilerplate, each replaced with a dated note (not inside the copy-paste-target fenced blocks) explaining the omission and when to re-add it. Independent reviewer (maker!=checker, fresh subagent) reviewed and approved after two rounds: round 1 flagged that the audit trail itself (GROWTH_STATUS learnings, GROWTH_MEMORY Run 5/6) still carried the FALSE self-report that these docs had 'correctly omitted' Pro Annual all along (they had not -- see next line); round 2 fix addresses that."
    - "CORRECTION (Run 7): the Run 5/6 learning claiming store-listing.md/press-kit.md 'correctly omitted' Pro Annual was FALSE at the time it was written (not merely stale) -- PR #150 added Pro Annual to store-listing.md on 2026-06-27, before Run 5 (2026-07-03) ever ran. GROWTH_MEMORY.md Run 5/6 entries are append-only history and are NOT edited (rewriting past entries would itself be dishonest); this correction stands as the transparent record instead. Lesson: a 'grep clean' / 'consistency checked' claim in a learning must cite the actual command run or the actual lines read, not just assert the conclusion -- an unverified assertion masquerading as a check is exactly the failure mode the GTM Auditor exists to catch."
    - "NEW (Run 7): closed both of Run 6's open demand_signal verification gaps via direct WebFetch -- Baymard Institute's AR-avoidance article (dated 2024-05-15, baymard.com) and TechCrunch's Modsy shutdown piece (on the CORRECTED URL; Run 5/6's cited path was a guess that 404s) both fetched cleanly with verbatim quotes. All 4 demand_signal themes now carry at least one directly-fetched, hand-verified quote (up from 2 of 4). Held confidence at 'emerging' rather than raising to 'strong' -- per-theme source COUNT is still thin (1-3/theme) and Reddit stays completely unreachable, so verbatim-ness alone doesn't clear the higher bar. Added a structured `web_research` validation entry (status:degraded) per GTM_SCORECARD's self_validation_honesty gap, which previously only had this documented in demand_signal prose."
    - "Funnel remains 0/null across every metric -- no connected source has reported numbers. Correct and honest: no fabrication."
    - "Confirmed no docs/growth/MARKETING_HOLD kill-switch file exists (checked first, per GTM_STANDARD S13) and no approved_channels record exists in PENDING_OPS.md (per S9) -- consistent with staying in PREPARE with zero paid/new-channel action. site_gate_up:false AND ship_gate_met:false (QUALITY_SCORECARD) -- both lanes of S6 outreach stay hard-off. Zero outreach drafts this run, correct."
    - "ASO keyword research from Run 3 remains blocked: competition estimates are not verifiable via App Store Connect Search Ads from this agent. No new attempt this run -- still owner-gated."
    - "This session's sandbox env still carries SITE_GATE_PASSWORD (since Run 5) and CRON_SECRET (since Run 6) -- same S4 fail-closed reasoning applied again: presence in this agent's own sandbox is not evidence of production config. Not used, not inferred as connected."
  next_actions:
    - "CIRCUIT BREAKER -- Owner: set SITE_GATE_PASSWORD in Vercel (2-min setup) to enable execute-mode + flip site_gate_up to true in GROWTH_STATUS"
    - "CIRCUIT BREAKER -- Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL (15-min setup) to activate all lifecycle email sends"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API (currently 503) -- this runtime's network restriction is scoped to aptdesignerai.com specifically, not general egress (see validation block)"
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron"
    - "Owner: apply migration 021 (pro_annual tier constraint) so the Pro Annual line can be safely re-added to store-listing.md + press-kit.md -- both currently correctly omit it pending this"
    - "Next run: re-check whether the independent GTM Auditor has re-graded GTM_SCORECARD.md against the two fixes landed this run (business-case floor timing via PR #508, store-listing/press-kit Pro Annual removal) -- if ship_gate_met is still false, read the new top_gaps as this run's priority work per GTM_STANDARD S8"
    - "Next run: verify ASO keyword competition claims via App Store Connect Search Ads before landing keyword change"
  owner_blockers:
    - "PRIORITY 1 -- Set SITE_GATE_PASSWORD in Vercel (2 min): gates app pre-launch, unblocks execute-mode outreach -- PENDING_OPS.md item set-site-gate-password"
    - "PRIORITY 2 -- Set RESEND_API_KEY + RESEND_FROM_EMAIL (verified domain, 15 min): unblocks ALL lifecycle email sends -- docs/growth/CONNECT.md Step 1"
    - "PRIORITY 3 -- Set INTERNAL_METRICS_TOKEN: opens funnel metrics pull API (currently 503) -- docs/growth/CONNECT.md Step 2"
    - "PRIORITY 4 -- Set CRON_SECRET + apply migration 025: activates daily activation email cron -- PENDING_OPS.md"
    - "PRIORITY 5 -- Apply DB migrations 021/022/023/026/027/029 to prod -- PENDING_OPS.md (021 also unblocks re-adding Pro Annual to marketing copy)"
    - "PRIORITY 6 -- Connect/authorize social accounts -- docs/growth/CONNECT.md Step 4"
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
