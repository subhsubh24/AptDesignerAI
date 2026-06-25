# ROADMAP — the build plan to a sellable, store-accepted product

This is the **convergence anchor** for the autonomous loop. `VISION.md` is the
*why* and *what good looks like*; this file is the *what to build, in what order,
and when to STOP*. Read it every run alongside `VISION.md`. The loop builds toward
the **Definition of Done** below, phase by phase, and then **stops building and
hands off** — it does not run forever.

## The goal (one sentence)
Drive BOTH the **product** (web app + native iOS/Android app, store-acceptable with
high confidence, subscription-monetized) AND the **marketing engine** to **100% of
everything within the loop's control** — with monetization optimized to **MAXIMIZE
revenue (≥ $100K/yr is the floor, not the target)** — so that a paid launch is gated
only by the handful of things a human must physically do (accounts, signing, funding)
— nothing else.

## The bar — do NOT declare done early (read this)
This loop does not stop at "good enough." It stops only when BOTH of these are
**genuinely 100%** and CI-verified:
- **Product = 100%:** you are highly confident the app would be **accepted into the
  App Store / Play Store** on submission — no missing flows, no crashes, no policy
  violations, no placeholder content, billing wired, compliance complete.
- **Marketing = 100%:** a complete, launch-ready marketing engine is BUILT and
  STAGED — waitlist + brand + site/SEO + ASO + content + owned-channel campaigns +
  analytics — such that the moment the owner connects/funds accounts, demand
  generation runs. A finished product with no marketing is NOT done, and vice versa.
- **Honest contract on revenue:** no code can *guarantee* $100K/yr — that's a market
  outcome. What you CAN and MUST do is take every controllable lever to 100% so the
  ONLY thing between the owner and revenue is the market itself. "Done" means: *I have
  built every lever I control to maximize the $100K/yr shot, and the only remaining
  steps are ones I literally cannot perform.* Do not fake a guarantee; do not refuse
  to finish chasing impossible certainty. When that bar is truly met, say so plainly.

## The business case — ESTIMATE whether $100K/yr is reachable (living artifact)
Building the product is not enough; you must show the money math. Maintain a living
`docs/BUSINESS_CASE.md` that gives a **bottoms-up, defensible estimate** of whether
this app can realistically reach **≥ $100K/yr**, and keep it updated as the product
and pricing evolve.
- **Bottoms-up model:** ARR ≈ paying_users × price × 12 − churn − refunds − fees,
  where paying_users = installs/visitors × signup% × free→paid conversion%. Show the
  formula with explicit numbers, not vibes.
- **Ground every input in RESEARCH** (use WebSearch/WebFetch): category pricing
  benchmarks, typical app-store/freemium **conversion rates** (free→paid is usually a
  few %), retention/churn norms for this category, and realistic install/traffic
  assumptions for the launch channels you're building. Cite sources; never invent a
  metric.
- **Unit economics / margin:** compute **per-user COGS** from the real per-design
  inference cost (this is exactly why the LLM cost contract matters) and show the
  gross margin at the chosen price. A plan that's unprofitable per user does not pencil.
- **Three scenarios:** conservative / base / optimistic, each with the install +
  conversion + price inputs that produce it. State which is the planning case.
- **Honesty + levers:** if the base case does NOT reach $100K/yr, say so plainly and
  spell out exactly what would have to change to get there (higher price tier, better
  conversion via the paywall/onboarding, a specific growth channel, add-on/usage
  revenue) — and then prioritize building those levers. The goal is a credible path,
  not a flattering number.
- This artifact is itself **value-bar-clearing work**: keep it current; a stale or
  hand-wavy business case is a gap, not a nicety.
- **MAXIMIZE revenue — $100K is the FLOOR, not the target.** $100K/yr is the MINIMUM
  bar to call this worth shipping, NOT the goal. The goal is to maximize the credible
  revenue ceiling: do NOT settle once the base case crosses $100K — build the
  monetization machine as strong as it defensibly can be, and make the OPTIMISTIC
  scenario the ambition you build toward (every number still honest + researched; the
  anti-gaming rule holds absolutely). Treat these revenue levers as first-class,
  value-bar-clearing work and push each to its defensible maximum: (1) PRICING & TIERS
  — good-better-best, a higher Pro/Studio tier, annual plans, one-time + subscription
  mix, priced to real value/benchmarks; (2) CONVERSION — optimize the free→paid moment
  (paywall timing/design, onboarding, trial, time-to-wow); (3) RETENTION & LTV — reduce
  churn, lengthen lifetime (re-engagement, save/share loops); (4) EXPANSION REVENUE —
  add-ons, usage/credit packs, team/client/pro plans, referrals; (5) MARGIN — drive
  per-user COGS down so more of each dollar is profit; (6) REACH — more defensible
  acquisition channels (organic-first, ASO, content, SEO). Document each lever's upside
  in the business case and build the best-return ones. This does NOT break convergence:
  revenue-maximization means building the BEST monetization + growth machine within the
  submission-readiness goal — it does NOT mean running forever. You still STOP and hand
  off when product + marketing are 100% and the business case shows a strong, MAXIMIZED,
  credible path (floor ≥$100K, reaching toward the optimistic ceiling). Continuous
  revenue optimization with real post-launch conversion/retention data is the owner's
  job after launch, not a reason to never ship. Maximize the machine, then hand off.
- **THIS is the governing "is it worth it" number — not any external dashboard
  estimate.** A separate dashboard may show a rough heuristic ARR (often ~price ×
  a small assumed user count); that is an order-of-magnitude gauge, NOT the gate.
  The Definition of Done is governed by THIS bottoms-up business case, not that
  heuristic.
- **NEVER game the number (hard anti-reward-hacking rule).** Do NOT inflate the
  price string, invent a user count, or pad assumptions to make any estimate read
  higher. Pricing must be set by real value + researched benchmarks and JUSTIFIED in
  the business case (and consistent with the actual paywall/Stripe/RevenueCat config),
  never reverse-engineered to hit a target. A higher number that isn't real is a
  FAILURE, not progress. Reviewer B rejects any pricing/business-case change whose
  only effect is to move an estimate without a defensible, value-based rationale.
- **Revenue is moved by DISTRIBUTION, CONVERSION, and RETENTION — not by more
  features.** A complete, polished app with no audience still earns little; that is
  the real constraint. So when pushing toward the $100K path, weight effort toward
  the things that actually move it: the marketing/growth engine (Track E), free→paid
  conversion (paywall + onboarding + time-to-wow), retention/re-engagement, a
  defensible price tier, and reach — over piling on additional product surface. Build
  product to "store-acceptable and delightful," then let the growth levers carry ARR.
- **Honest ceiling (do not chase the impossible):** no pre-launch code can make the
  app *actually worth* $100K/yr — realized revenue is a post-launch market outcome
  that needs real users + the human-only launch steps. "Done" = you have built every
  controllable lever to 100% AND the business case shows a CREDIBLE path to ≥ $100K/yr
  at a defensible price. Do not loop forever waiting for an estimate to cross a
  threshold; deliver the credible path + the levers, then hand off.
- **KEEP IT LIVING — recompute, don't write-once (this file must improve over time).**
  The business case was written once and must NOT be left to rot. RE-COMPUTE the model
  whenever any of these change: pricing/tiers, a revenue lever ships (conversion,
  retention, expansion), per-user COGS, or new evidence/benchmarks. Note: building more
  FEATURES does NOT change the number — only levers, pricing, margin, reach, and real
  data do; so improving this file means recomputing when those move, not when feature
  count grows. ANCHOR the model to the ACTUAL paywall/Stripe/RevenueCat config — if the
  doc's prices (e.g. $29/$49) ever diverge from the real product config, that drift is a
  bug: fix it and recompute. Stamp each revision with a 'last recomputed' date + a one-
  line changelog of what moved and why. POST-LAUNCH (owner activity): re-ground every
  assumption on the REAL conversion/retention/CPI data from the analytics (Track E5) —
  that is when this goes from a researched projection to a data-backed forecast.
- **MACHINE-READABLE SUMMARY BLOCK (required — the dashboard reads THIS, not prose).**
  `docs/BUSINESS_CASE.md` MUST begin with a fenced summary block so tools read one
  structured source instead of scraping prose (which mis-grabs monthly figures or
  COGS/marketing dollar lines). Keep it in sync with the analysis below it; the
  `arr_year1.base` value MUST equal the base-scenario ANNUAL ARR in the body. Exact
  format:
  ```yaml
  # BUSINESS_CASE_SUMMARY (machine-readable; keep in sync with the analysis below)
  currency: USD
  arr_year1:            # year-1 ARR in whole dollars, per scenario
    conservative: <int>
    base: <int>
    optimistic: <int>
  planning_case: base
  floor_usd: 100000
  floor_met_year1: <true|false>          # is arr_year1.base >= floor_usd?
  time_to_floor: "<e.g. ~year 2 in the base case>"   # only if floor not met in year 1
  as_of: <YYYY-MM-DD>
  ```
  All three sibling projects use this IDENTICAL block shape, so values are comparable.

## Full autonomy (granted)
You have full autonomy to do whatever genuinely advances the goal: create any files
or pages, add routes/features, spin up new code, build INTERNAL TOOLS (admin dashboards,
analytics, content generators, asset pipelines, growth/experiment scaffolding), add
marketing surfaces, write documentation — anything that moves product or marketing
toward 100%. The brakes, value bar, review gates, security/RLS bar, and the
billing/secrets + marketing-publish boundaries below still apply (they make the
autonomy SAFE, they do not limit ambition). If something would clearly help the goal
and isn't yet on this ROADMAP, add it as a new phase and build it.

## Operating model (how the loop uses this file)
- Work is **milestone/phase-driven**, not scattershot. Each run: read this file,
  find the **lowest-numbered phase that is not yet complete**, and advance it with
  the highest-value, file-disjoint changes available (per the loop's normal value
  bar, disjoint rule, maker/checker review, CI gate, and brakes).
- **Coherence over volume.** A store-acceptable app is one cohesive product, not a
  pile of disconnected PRs. Prefer fewer changes that move a phase materially
  forward over many that don't. Do **not** pad runs to hit a count.
- **Spend:** the loop runs on the cheapest viable model. Cheap-but-incoherent is a
  false economy here — rework burns more than it saves. If a change needs real
  architectural judgment, do it properly or defer it; never ship slop that a later
  run (or Apple) has to reject.
- **Track the plan:** when a phase's checklist item is genuinely done, tick it in
  this file (in the final bookkeeping PR, same rules as the other ledger files).
- **LIVING ARTIFACTS — every artifact stays consistent with reality.** Every doc,
  copy, and config the loop produces — README, ARCHITECTURE.md, the business case,
  marketing copy, store-listing/ASO, privacy/data-safety docs, the pre-submission
  checklist, loop-memory, IMPROVEMENT_LOG, PENDING_OPS, ROADMAP — is LIVING: when the
  thing it describes changes (code, pricing, positioning, data flows, architecture),
  UPDATE the artifact in the SAME work so it never contradicts reality. A doc that
  contradicts the current product is a BUG (and a store/review/trust risk), and fixing
  it clears the value bar. TWO failure modes to avoid equally: (a) STALE — write-once
  docs that drift out of date; (b) CHURN — rewriting things for their own sake. The
  rule is *consistency with reality*, not constant rewriting: refresh an artifact when
  its subject changes; do NOT churn STABLE ANCHORS (VISION.md, the cost/determinism
  rules, the guard tests) just to look busy — those are intentionally stable ratchets.

## Progress format contract (machine-readable — the dashboard reads THIS)
Record progress as MARKDOWN CHECKBOXES, not prose. An external dashboard derives
build-progress from the Track checkboxes and submission-readiness from the
Definition-of-Done checkboxes — so any progress that lives ONLY in a prose note or a
`(PR #…)` reference is INVISIBLE to it and reads as 0%. Rules:
- EVERY Track item (A1, B2, C3, …) and EVERY Definition-of-Done item is a
  `- [ ]` / `- [x]` markdown checkbox. PR-reference annotations are fine, but they go
  IN ADDITION to ticking the box, never instead of it.
- When the verified-artifacts guard below is satisfied for an item, tick its checkbox
  (`- [x]`) in the bookkeeping PR. A parent Track item is `- [x]` only when the whole
  item is genuinely complete; keep it `- [ ]` while partial (note sub-progress inline).
- Checkboxes are the SINGLE SOURCE OF TRUTH for progress — keep them in sync with
  reality every bookkeeping run.
- **ONE-TIME RECONCILE (do this on your next run):** scan the whole ROADMAP, convert
  any Track item that is NOT yet a checkbox into one, then tick every item whose
  artifacts are present on the default branch with a green gate, and UN-tick any box
  that is not actually satisfied. After this pass, the Track + Definition-of-Done
  checkboxes accurately reflect real, verified state.

## DONE means VERIFIED ARTIFACTS, not self-assessment (hard guard)
The loop has been over-eager ticking its own boxes. A box counts as done ONLY when
ALL of the following are objectively true IN THE SAME RUN — never on intent, a plan,
or an open/CI-pending PR:
1. **The change is merged to the default branch** (verify with `git`/`gh` — not just
   that a PR exists or "should" pass).
2. **The artifacts physically exist** in the merged tree: the actual files the item
   promises are present and non-empty — e.g. a rendered page/route file, a real image/
   asset (not a 0-byte or placeholder), a migration file, a doc with real content. If
   the item claims a screenshot/icon/preview, the binary must exist; if it claims a
   page, the route file must exist and build.
3. **The full gate was RE-RUN GREEN in this run** on the merged result — the relevant
   commands (`npx tsc --noEmit`, `npm test`, `npm run check:determinism`, the prod
   `build`, and for `/mobile` its own typecheck) pass; CI's required checks
   (`verify` + `build` + `mobile`) are green on what landed. A box may not be ticked
   on a red or not-yet-run gate.
4. **For quality/eval items**, the live check actually executed and passed (e.g. the
   `RUN_EVALS=1` suite ran against the real pipeline), not "tests would pass."
When you tick a box in the bookkeeping PR, cite the concrete evidence (merged PR #,
the file path(s) that now exist, and that the gate is green). If you cannot show the
artifact + a green gate, the item is NOT done — leave it unchecked and keep working.
This applies to every track box AND every Definition-of-Done box, including the final
"ready for submission" decision: do not open `FACTORY: ready for submission` until you
have re-verified the whole DoD against real artifacts and a green gate in that run.

## Tracks & phases

### Track A — Web app (exists; bring to paid quality)
- A1. Core journey is reliable end-to-end (photo → understand → diagnose →
  source → mockup), no dead ends, real empty/loading/error states.
- A2. Clears the `VISION.md` **design bar** everywhere (no vibe-coded surfaces).
- A3. Performance: fast first-result ("time-to-wow"), no obvious latency leaks.
- A4. Accounts, data model, and RLS are correct and secure (see SECURITY & RLS).
- A5. **Eval coverage — currently the biggest quality gap.** Today the eval
  harness is *structural scaffolding only*: `evals/runner.ts` scoring + a single
  gold case with a **placeholder image URL**, and **zero live `.eval.test.ts`
  files that call the real pipeline** (the `RUN_EVALS=1` gate exists but nothing
  uses it to hit the model). Evals are how we *know* the output is good, not just
  that it compiles — so build them out, treating eval growth as first-class,
  value-bar-clearing work:
  1. **Runnable golden fixtures** using REAL test images (committed under
     `evals/gold/` or a fetchable fixtures host), covering the core scenarios —
     not `example.com` placeholders.
  2. **A live `.eval.test.ts` per core pipeline stage** — room/apartment
     understanding, diagnosis, product-sourcing relevance, and mockup grounding —
     gated behind `RUN_EVALS=1`, calling the ACTUAL pipeline and scoring with
     `scoreAgainstExpectations`.
  3. **Run them in the loop's own environment** (where the Gemini key + prod-like
     network exist); do NOT depend on a developer laptop. Wire a `RUN_EVALS=1`
     job so eval regressions are visible. Live eval calls cost tokens — that
     spend is expected and approved as a cost of knowing the product is good.
  4. **Grow the gold set over time** so output-quality regressions are caught
     before users (and Apple reviewers) see them.

### Track B — Native mobile app (Expo / React Native) — NEW
Lives in `/mobile` (its own `package.json`; share TypeScript domain logic with the
web app where clean to do so — extract shared modules rather than copy-paste).
- B1. Expo app scaffold builds and runs (EAS-ready); navigation + design system
  ported to native (NOT a thin web wrapper — Apple rejects those under guideline
  4.2 "minimum functionality").
- B2. Core journey works natively: camera/photo capture, upload, results, saved
  designs. Native feel: gestures, haptics, skeletons, offline/error states.
- B3. Push notifications (re-engagement), deep links, app icon + splash.
- B4. Native polish pass against the design bar; tablet/large-screen layout sane.
- B5. Parity with the web app's value (a user can reach a beautiful room on phone).

### Track C — Monetization (subscription)
- [x] C1. Subscription model: monthly + annual tiers, a free trial, and a clear
  free→paid moment that lands on **real value** (a beautiful, trustworthy result),
  not a nag. Free tier limited by genuine COGS (per-design inference cost).
  **(PR #50 — Stripe checkout, webhook, stripe_customers table, upgrade/success/cancel pages; PR #52 — hasProEntitlementWeb() wired into /api/saved-designs POST, FREE_SAVE_LIMIT_WEB=3)**
- [x] C2. Billing integration: App Store / Play in-app purchase via **RevenueCat**
  (cross-platform entitlements) on mobile; Stripe (or RC web billing) on web.
  Build the code; **live keys / production billing config stay human-applied**
  (recorded in `PENDING_OPS.md`). **(PR #42 — RC SDK, logIn/logOut lifecycle)**
- [x] C3. Paywall UI (web + native) that clears the design bar; restore-purchases,
  manage-subscription, and entitlement gating wired through one source of truth.
  **(PR #42 — live Offerings, purchasePackage, restorePurchases, user-cancel)**
- [x] C4. Server-side entitlement checks (never trust the client) feeding usage limits.
  **(PR #43 — hasProEntitlement(), FREE_SAVE_LIMIT=3, fail-open on RC outage)**

### Track D — Store readiness & compliance (the acceptance bar)
- D1. Legal: privacy policy + terms of service pages (web-hosted, linked in both
  apps). **Account deletion** in-app (Apple 5.1.1(v) — required).
- D2. Data handling: Apple **App Privacy** nutrition labels + Google **Data Safety**
  form content prepared; ATT prompt only if actually tracking.
- D3. Store assets: app icon, screenshots (all required sizes), preview text,
  keywords/ASO, support URL, marketing URL.
- [x] D4. Stability: no crashes on the core path; sensible permissions usage strings;
  passes a self-run pre-submission checklist (see Definition of Done).
  **(PR #53 — app/global-error.tsx + focus/error.tsx + docs/pre-submission-checklist.md)**

### Track E — Marketing engine (separate from the app; build + stage)
- E1. **Waitlist landing page** (own route or static site): brand, hero, value
  prop, email capture, "coming to App Store / Play" CTA. Clears the design bar.
- [x] E2. Brand kit: name/wordmark (working name: *AptDesignerAI* — rename-able),
  palette already exists, social avatars/banners, OG images.
  **(PR #44 — docs/brand-kit.md + public/wordmark.svg)**
- [x] E3. Content + ASO: launch copy, FAQ, a few SEO articles / "how it works",
  app-store description variants, screenshots with captions.
  **(PR #48 — /support page; PR #54 — /guides hub + 3 SEO articles (colour palette, AI vs pro, material coherence) + FAQ expansion (2 new Pricing items))**
- [x] E4. Owned-channel drafts: scheduled-post drafts (X/IG/TikTok/Reddit), an email
  welcome sequence for the waitlist. **Staged as drafts** — see Human Core.
  **(PR #49 — docs/email-welcome-sequence.md + docs/social-drafts.md)**
- [x] E5. Analytics/attribution scaffolding so launch spend is measurable.
  **(PR #58 — @vercel/analytics + <Analytics /> page views + 7 typed funnel events with call sites + docs/analytics.md)**
- E6. **Launch-ready growth engine (marketing must hit 100%, not just "staged").**
  Beyond E1–E5, build everything a real launch needs, staged and ready to flip on:
  full content calendar + a batch of ready-to-post drafts per channel; the complete
  email lifecycle (welcome → activation → conversion → win-back); referral/share
  loops in-product; an ASO package ready to paste into App Store Connect / Play
  Console (title, subtitle, keywords, description variants, screenshot captions);
  press-kit / launch-day assets; landing-page conversion polish + A/B variants; and
  any internal tooling that makes ongoing growth cheap to run. Marketing is "100%"
  only when the owner could launch demand-gen the same day they connect accounts.

> **Marketing autonomy boundary:** the loop may BUILD and STAGE all of the above.
> It may NOT publish publicly, send bulk email, or spend ad money until the owner
> connects the relevant account and funds it — those are login/payment-gated. The
> loop never invents public claims or fake metrics, and never posts under the
> owner's identity without a connected, owner-authorized channel.

### Track F — World-class quality, validation & evals (the excellence bar)
The product must be demonstrably top-grade — not "tests pass," but rigorously
validated so we KNOW the output is excellent. Build and ENFORCE these; each is a
required gate or a recurring audit, not a nicety.
- [ ] F1. **Lint clean + ENFORCED.** Drive `npx eslint .` to ZERO errors and zero
  new warnings, then keep it clean. Reviewer A rejects any change that introduces a
  lint error/warning. (Owner promotes `lint` to a required CI check once it is green;
  until then the loop keeps every new diff lint-clean and burns down the backlog.)
- [ ] F2. **Coverage floor.** Enforce a meaningful test-coverage threshold on the
  critical paths (the validation/math/agents modules) via `vitest --coverage`; a
  regression below the floor fails the gate. Cover real branch behavior, not lines-
  for-lines' sake.
- [ ] F3. **Eval coverage COMPLETE (extends A5).** A live `.eval.test.ts` for EVERY
  core pipeline stage — apartment/room understanding, diagnosis, product-sourcing
  relevance, mockup grounding — each calling the real pipeline (`RUN_EVALS=1`) and
  scoring against a GROWING gold set of real fixtures. Wire a scheduled eval run so
  AI-output-quality regressions are caught before users/reviewers see them.
- [ ] F4. **E2E + accessibility + visual + performance gates (UX is the product).**
  Playwright end-to-end tests for the core journey (web; and the mobile core flow as
  feasible); automated accessibility checks (e.g. axe) on key pages with no critical
  violations; visual-regression on the design-bar surfaces; a Lighthouse/performance
  budget on the hot paths. These catch what unit tests cannot.
- [ ] F5. **Periodic DEEP AUDIT (holistic, not per-diff).** On a recurring cadence
  (see the routine), a whole-codebase audit beyond per-change review: security/RLS,
  performance, accessibility, dead/duplicate code, consistency with the design system,
  dependency health, eval gaps, **ARTIFACT FRESHNESS & CONSISTENCY** (do README,
  ARCHITECTURE.md, the business case, marketing copy, store-listing/ASO, and privacy
  docs still match the CURRENT code, pricing, and positioning? flag any stale claim or
  contradiction as a fix — see LIVING ARTIFACTS above), and "does this still read as
  world-class?" Findings become prioritized, value-bar-clearing work. This is how
  quality is continuously re-validated in depth without pretending to re-review every
  character every run.

## Definition of Done (the STOP gate)
Every box below must meet the "DONE means VERIFIED ARTIFACTS" guard above —
artifacts exist in the merged tree AND the full gate was re-run green in the same run.
Do NOT declare done until BOTH product AND marketing are genuinely 100% (see "The bar"
above). The loop **stops building new features and opens ONE issue titled
`FACTORY: ready for submission`** (with the ordered Owner Handoff checklist below) when
ALL of these are true and verified in CI:
- [ ] Track A complete: web app reliable, on-design, secure (RLS clean), AND the
      A5 live eval suite exists and passes. (Was prematurely ticked before A5 was
      added — A5 is a Track A requirement and is not yet built.)
- [ ] Track B complete: Expo app builds via EAS, core journey works natively,
      not a thin wrapper, clears the design bar. **[B1 done; B2 photo-capture (PR #26) + B2 auth (PR #28) done; B3 app.json brand config done (PR #29); B2 backend analyze endpoint (PR #32) + mobile upload/analyze/results UX (PR #33) + B2 saved designs (PR #37) done; B3 push notifications + deep links + ESLint gate fix done (PR #56); B4 polish done (PRs #46, #47); B5 native share from saved designs done (PR #65)]**
- [ ] Track C complete: subscription + paywall + RevenueCat entitlements wired;
      server-side gating; live keys listed in `PENDING_OPS.md`.
      **[C1 Stripe billing done (PR #50); web enforcement wired (PR #52); C2/C3 RC mobile SDK + paywall done (PR #42); C4 server-side gate done (PR #43)]**
- [ ] Track D complete: privacy policy + terms + in-app account deletion live;
      privacy/data-safety content prepared; all store assets generated.
      **[D1 done (PR #23); D2 App Privacy labels staged (PR #30); D3 store listing copy staged (PR #30); D4 stability done (PR #53); screenshots still pending]**
- [x] **Marketing = 100% (Track E COMPLETE, E1–E6):** waitlist + brand + site/SEO +
      ASO package + content calendar + full email lifecycle + owned-channel campaigns
      + referral/share loops + analytics — all BUILT and STAGED, launch-ready.
      **[E1 waitlist (PR #22); E2 brand kit (PR #44); E3 /support + guides + SEO + FAQ (#48/#54); E4 email + social drafts (#49); E5 analytics done (PR #58); E6 content calendar (PR #62) + press kit (PR #63) + email lifecycle (PR #64) + mobile share (PR #65) done]**
- [ ] **Track F complete (world-class quality bar):** lint clean + enforced (F1);
      coverage floor met (F2); the full per-stage live eval suite passes (F3);
      E2E + accessibility + visual + performance gates green (F4); the periodic deep
      audit is running and its last pass surfaced no unaddressed critical findings (F5).
- [ ] A self-run **pre-submission checklist** passes (no crashes on core path,
      required URLs present, permission strings set, no debug/placeholder content).
- [ ] **Business case (`docs/BUSINESS_CASE.md`) is complete, credible, and
      revenue-MAXIMIZED:** a bottoms-up, research-grounded model with three scenarios
      and positive per-user margin, showing a credible path with a FLOOR ≥ $100K/yr —
      AND documenting the revenue-maximization levers (pricing/tiers, conversion,
      retention/LTV, expansion, margin, reach) with the high-return ones actually built,
      so the credible ceiling is pushed as high as it defensibly goes (toward the
      optimistic scenario), not settled at $100K. Numbers cited, not invented; no gaming.
      **(Re-open: was ticked for the ≥$100K floor (PR #61); now also requires the
      maximization levers built + documented.)**
- [ ] **Confidence statement:** you can honestly state that the product would be
      accepted to the stores with high confidence, every marketing lever within your
      control is built, AND the business case shows a credible ≥ $100K/yr path — i.e.
      only the human-only steps below remain.

Until then, keep advancing the lowest incomplete phase. After then, do **not**
keep adding scope — the loop's job is finished; the owner runs the handoff.

## Owner Handoff — remaining steps, IN ORDER (only what the loop CANNOT do)
When Done, the `FACTORY: ready for submission` issue MUST contain a NUMBERED,
in-ORDER checklist of the remaining steps — and ONLY steps that are genuinely
impossible for the loop (verified-human login, payment, identity, physical
submission). For each step: what to do, why, where (the exact dashboard/URL), and
which `PENDING_OPS.md` entry it corresponds to. Do NOT include anything the loop
could have done itself — if it could, do it instead of listing it. Keep this list in
true execution order so the owner can go top-to-bottom. The canonical order:
1. Apple Developer account ($99/yr) + Google Play account ($25) + identity verify.
2. Signing certs / provisioning / EAS credentials; accept Apple & Google agreements.
3. Production billing setup (App Store/Play subscriptions, RevenueCat live keys,
   Stripe live keys) — apply the `PENDING_OPS.md` entries.
4. Apply any pending DB migrations to prod (`supabase db push`).
5. Connect + fund marketing/ad/social/email accounts to flip the staged campaigns live.
6. Final submission in App Store Connect / Play Console and responding to review.
Also ensure end-user + operator DOCUMENTATION exists in the repo (how the product
works, how the marketing engine is wired, how to run/flip each staged campaign).

## Guardrails carried over (do not trade away)
- `VISION.md` design bar; LLM cost contract; determinism; security & RLS bar.
- Billing/auth/payments: code may be built and reviewed, but **live secrets and
  go-live config are human-applied** via `PENDING_OPS.md` — never committed, never
  auto-activated.
- Migrations human-applied; nothing outside the repo; never edit `.claude/` or
  `.github/`.
