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
  as_of: 2026-07-13
  phase: pre_launch              # pre_launch | launching | post_launch
  engine_built: true             # is the growth-execution engine live in code? (true iff engine_pct == 100)
  engine_pct: 100                # % of the 5 engine pieces shipped (preflight-verified): waitlist, email, queue, metrics, runbook
  channels_connected: []         # owner-authorized channels actually wired (e.g. [x, instagram, email])
  awaiting_connect: true         # true => agent only prepares creative; takes NO external action
  site_gate_up: false            # pre-launch SITE GATE (E8) confirmed up? HARD precondition for pre_launch execute-mode outreach
  validation:                    # GTM_STANDARD S4 self-validation -- every external source this agent depends on; fail-closed
    - source: internal_metrics_api
      status: unavailable
      reason: "INTERNAL_METRICS_TOKEN not set on the deployment (owner action pending, PENDING_OPS.md set-metrics-token still status:open). Separately, this agent's own runtime has no outbound network path to aptdesignerai.com -- SIX independent probe attempts across six runs have each failed (2026-07-01: HTTP 403 policy denial; 2026-07-03: bare connection error; 2026-07-05: HTTP 502 'CONNECT tunnel failed'; 2026-07-09: HTTP 502 'CONNECT tunnel failed'; 2026-07-11: HTTP 000 / connect_rejected 'gateway answered 502 to CONNECT'; 2026-07-13, this run: same connect_rejected/502-to-CONNECT signature, cross-checked directly against the agent-proxy's own /__agentproxy/status recentRelayFailures log, two entries timestamped 2026-07-13T05:07:41Z) -- the practical conclusion is unchanged across all six: no reachable path to the production host from this runtime, independent of whether the owner sets the token. This unreachability is specific to aptdesignerai.com -- it does NOT mean this runtime's network access is blocked generally (see web_research below, still degraded only on Reddit/Trustpilot specifically) -- so setting INTERNAL_METRICS_TOKEN plus resolving JUST the aptdesignerai.com egress path (not a blanket network-policy fix) would unblock this source."
    - source: resend_email
      status: unavailable
      reason: "RESEND_API_KEY / RESEND_FROM_EMAIL not set (PENDING_OPS.md connect-email-resend still status:open); the email lifecycle runs in dry-run (nothing sent). Run 9 additionally wired lib/email/index.ts to force dry-run on every marketing-lifecycle stage (activation/win-back/paid-welcome; NOT the transactional waitlist_confirm) until EMAIL_PHYSICAL_ADDRESS is also set, per the GTM Auditor's CAN-SPAM footer nit -- so even once RESEND_API_KEY lands, marketing sends stay safely dry-run until the postal address is set too (PENDING_OPS.md set-email-physical-address)."
    - source: stripe_reporting
      status: unavailable
      reason: "No Stripe Reporting API integration exists in the codebase (grepped app/ -- zero hits for a reporting.stripe.com call); trial-start/conversion-rate metrics are documented in docs/growth/CONNECT.md as living in 'Stripe's reporting API' but that integration is UNBUILT, not merely unconnected -- distinct from internal_metrics_api (which reads the app's own DB and only needs INTERNAL_METRICS_TOKEN). Surfaced as its own next_action this run per the GTM Auditor's self-validation-honesty nit (GTM_SCORECARD.md auditor_run 2): this is a Product-Factory build gap, not a pure owner env-var connect step, so it is NOT added to PENDING_OPS.md/owner_blockers (no action an owner can take today would unblock it) -- MRR/active-subscriber/churn numbers already surface via internal_metrics_api once INTERNAL_METRICS_TOKEN is set; this source is specifically about trial-start/paid-conversion RATE metrics."
    - source: site_gate
      status: unavailable
      reason: "SITE_GATE_PASSWORD not set on the deployment (PENDING_OPS.md set-site-gate-password still status:open); site_gate_up stays false, hard-blocking pre-launch execute-mode outreach. NOTE: this agent's own sandbox env has a SITE_GATE_PASSWORD-named value present (as it has since Run 5, alongside CRON_SECRET since Run 6) -- per S4 fail-closed and Run 5/6's established reasoning, this is validator-credential scaffolding for a DIFFERENT routine's sandbox, not evidence the production Vercel deployment has it configured; not used, not inferred as connected."
    - source: social_channels
      status: unavailable
      reason: "No social platform credentials connected (X / Instagram / TikTok / Reddit); the publishing queue stays dry-run."
    - source: web_research
      status: degraded
      reason: "WebSearch + WebFetch work broadly (baymard.com and techcrunch.com were verbatim-verified via direct fetch in Run 7 and remain the basis for demand_signal's citations; no re-fetch needed this run, no new claim added). Two structural gaps persist unchanged across Runs 5-9, re-probed again this run: (1) reddit.com is still hard-blocked by the WebFetch TOOL itself ('Claude Code is unable to fetch from www.reddit.com') -- zero Reddit posts obtainable despite Reddit being GTM_STANDARD S10's richest recommended source; (2) trustpilot.com/review/havenly.com still returns HTTP 403 to WebFetch (site-side Cloudflare bot-block), re-confirmed this run directly. Trustpilot-sourced claims (Havenly pricing/delivery complaints, the RoomGPT/Interior-AI 2.8/5 rating) stay WebSearch-synthesized, never independently re-fetched. No change from Run 7's structured entry."
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
    as_of: 2026-07-13
    method_note: >-
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
    - "CIRCUIT BREAKER (Run 9, still fired): same 4 core owner blockers unresolved for a 9th consecutive run (SITE_GATE_PASSWORD, RESEND_API_KEY+RESEND_FROM_EMAIL, INTERNAL_METRICS_TOKEN, CRON_SECRET) -- verified directly against PENDING_OPS.md this run (set-site-gate-password / connect-email-resend / set-metrics-token / set-cron-secret all still status:open; PENDING_OPS.md as_of 2026-07-10 before this run's own edit, and the moves since Run 8 remain Product Factory housekeeping, not action on any of the 4 growth blockers). This blocker set has now been open, unchanged, since Run 1 (2026-06-27) -- 9 runs / ~16 days on setup steps CONNECT.md estimates at well under 20 minutes combined."
    - "NEW (Run 9): re-confirmed the aptdesignerai.com unreachability a SIXTH time -- connect_rejected / gateway 502 to CONNECT, identical signature to Runs 6-8, cross-checked against the agent-proxy's own /__agentproxy/status recentRelayFailures log (two entries, 2026-07-13T05:07:41Z). No new information."
    - "MAJOR (Run 9): the independent GTM Auditor re-graded for the first time since Run 1 -- docs/growth/GTM_SCORECARD.md now auditor_run 2, as_of 2026-07-13, overall C->B. Both Run-1 top gaps genuinely fixed (business_case_honesty F->B, artifact_freshness B->A, both already landed by the Product Factory pre-Run-9). The ONE remaining ship-critical gap named: business_case_honesty=B because BUSINESS_CASE.md modeled ~37.9% of steady-state MRR on the Pro Annual tier (currently non-transactable -- migration 021 unapplied, ANNUAL_BILLING_ENABLED off) with no disclosure it's gated off. Per GTM_STANDARD S8 this is the highest-priority value-bar-clearing GTM work -- fixed it THIS run: added a disclosure blockquote to the Pro Annual section (citing PENDING_OPS.md apply-migration-021 + PR #597) and tightened the 'annual mix stays 0%' scenario from a vague '~$100K baseline' to the precisely computed (node script, not eyeballed) $99,926 ARR = ~$99.9K, honestly 'at, not over' the floor. Independent maker!=checker reviewer (fresh subagent) independently re-derived the same $99,926 figure and confirmed the disclosure matches PENDING_OPS.md exactly -- APPROVED. This is the single highest-leverage GTM Auditor gap closed this run; if it holds, business_case_honesty should raise B->A and the GTM ship gate (all 4 ship-critical dims A/A+) would be MET next audit pass."
    - "SECONDARY (Run 9): GTM_AUDIT_MEMORY.md's Run-2 notes also flagged two cheap non-ship-critical raises: self_validation_honesty A->A+ (surface stripe_reporting as its own distinct source, not just indirectly via the metrics-token path) and compliance A->A+ (render a full CAN-SPAM footer -- physical postal address -- in the staged lifecycle email templates; the opt-out backing already exists via migration 027). Did both this run: (1) investigated stripe_reporting and found it is actually an UNBUILT Stripe Reporting API integration (zero code hits), distinct from internal_metrics_api -- documented that distinction honestly in the validation block and as a next_action rather than a PENDING_OPS owner-action (no owner lever exists yet); (2) wired lib/email/templates/lifecycle.ts to render EMAIL_PHYSICAL_ADDRESS in both HTML and text footers when set, and made lib/email/index.ts force dry-run on every marketing-lifecycle stage (activation/win-back/paid-welcome) -- but NOT the transactional waitlist_confirm -- until the address is set, so a non-compliant email can never leave the system even after RESEND_API_KEY goes live. Added PENDING_OPS.md item set-email-physical-address. Added 5 new tests (31/31 email tests pass); `npx tsc --noEmit` and `npx eslint .` clean; validate-capabilities.mjs required declaring the new env var (done, non_credential_allowlist) -- preflight's validate-capabilities gate now passes again."
    - "Demand-signal re-probe (Run 9): both structural gaps (Reddit tool-blocked, Trustpilot site-blocked) tested again and unchanged. No new citation attempted -- Run 7 already closed the verbatim-verification gap on all 4 themes; this run's growth-analytics effort went to the GTM Auditor gap above instead, correctly (higher-leverage, per GTM_STANDARD S8's 'fix the named top_gap before new GTM work')."
    - "Funnel remains 0/null across every metric -- no connected source has reported numbers. Correct and honest: no fabrication."
    - "Confirmed no docs/growth/MARKETING_HOLD kill-switch file exists (checked first, per GTM_STANDARD S13) and no approved_channels record / docs/growth/MARKETING_APPROVED exists (per S9/S13) -- consistent with staying in PREPARE with zero paid/new-channel action. site_gate_up:false AND ship_gate_met:false (QUALITY_SCORECARD still C, unchanged since Run 8) -- both lanes of S6 outreach stay hard-off. Zero outreach drafts this run, correct."
    - "ASO keyword research from Run 3 remains blocked: competition estimates are not verifiable via App Store Connect Search Ads from this agent. No new attempt this run -- still owner-gated."
  next_actions:
    - "CIRCUIT BREAKER (9th run) -- Owner: set SITE_GATE_PASSWORD in Vercel (2-min setup) to enable execute-mode + flip site_gate_up to true in GROWTH_STATUS"
    - "CIRCUIT BREAKER (9th run) -- Owner: set RESEND_API_KEY + RESEND_FROM_EMAIL (15-min setup) to activate all lifecycle email sends"
    - "Owner: set INTERNAL_METRICS_TOKEN to open funnel metrics pull API -- this runtime's network restriction is scoped to aptdesignerai.com specifically, not general egress (see validation block)"
    - "Owner: set CRON_SECRET + apply migration 025 to activate activation email cron"
    - "Owner: apply migration 021 (pro_annual tier constraint) + set ANNUAL_BILLING_ENABLED=true so the Pro Annual line can be safely re-added to store-listing.md/press-kit.md and the disclosure in BUSINESS_CASE.md can be retired"
    - "Owner (new, Run 9): set EMAIL_PHYSICAL_ADDRESS on the deployment so marketing-lifecycle emails clear the CAN-SPAM footer requirement -- code + tests already ship (PENDING_OPS.md set-email-physical-address); zero action needed beyond the env var"
    - "Next run: re-check whether the independent GTM Auditor has re-graded GTM_SCORECARD.md again (auditor_run 2 as of this run) -- confirm business_case_honesty raised B->A after this run's disclosure fix, which would meet the GTM ship gate"
    - "Next run: reconsider whether the QUALITY_SCORECARD's persistence-cutover gap (functional_reality C, unchanged since Run 8) has moved -- not a GTM action, but material context for launch timing"
    - "Next run: verify ASO keyword competition claims via App Store Connect Search Ads before landing keyword change"
    - "Product-Factory build note (not owner-actionable today): a real Stripe Reporting API integration would let trial-start/paid-conversion RATE metrics surface distinctly from the DB-derived MRR/subscriber counts already unlocked by INTERNAL_METRICS_TOKEN -- see the stripe_reporting validation entry."
  owner_blockers:
    - "PRIORITY 1 -- Set SITE_GATE_PASSWORD in Vercel (2 min): gates app pre-launch, unblocks execute-mode outreach -- PENDING_OPS.md item set-site-gate-password (open 9 consecutive runs / ~16 days)"
    - "PRIORITY 2 -- Set RESEND_API_KEY + RESEND_FROM_EMAIL (verified domain, 15 min): unblocks ALL lifecycle email sends -- docs/growth/CONNECT.md Step 1 (open 9 consecutive runs / ~16 days)"
    - "PRIORITY 3 -- Set INTERNAL_METRICS_TOKEN: opens funnel metrics pull API -- docs/growth/CONNECT.md Step 2"
    - "PRIORITY 4 -- Set CRON_SECRET + apply migration 025: activates daily activation email cron -- PENDING_OPS.md"
    - "PRIORITY 5 -- Apply DB migrations 021/022/023/026/027/029 to prod -- PENDING_OPS.md (021 also unblocks re-adding Pro Annual to marketing copy + retiring the new BUSINESS_CASE.md disclosure note)"
    - "PRIORITY 6 -- Set EMAIL_PHYSICAL_ADDRESS (new, Run 9): unblocks CAN-SPAM-compliant marketing-lifecycle sends once RESEND_API_KEY also lands -- PENDING_OPS.md set-email-physical-address"
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
