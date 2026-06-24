# ROADMAP — the build plan to a sellable, store-accepted product

This is the **convergence anchor** for the autonomous loop. `VISION.md` is the
*why* and *what good looks like*; this file is the *what to build, in what order,
and when to STOP*. Read it every run alongside `VISION.md`. The loop builds toward
the **Definition of Done** below, phase by phase, and then **stops building and
hands off** — it does not run forever.

## The goal (one sentence)
Drive BOTH the **product** (web app + native iOS/Android app, store-acceptable with
high confidence, subscription-monetized) AND the **marketing engine** to **100% of
everything within the loop's control**, so that a paid launch targeting **≥ $100K/yr**
is gated only by the handful of things a human must physically do (accounts, signing,
funding) — nothing else.

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

## Definition of Done (the STOP gate)
Do NOT declare done until BOTH product AND marketing are genuinely 100% (see "The bar"
above). The loop **stops building new features and opens ONE issue titled
`FACTORY: ready for submission`** (with the ordered Owner Handoff checklist below) when
ALL of these are true and verified in CI:
- [ ] Track A complete: web app reliable, on-design, secure (RLS clean), AND the
      A5 live eval suite exists and passes. (Was prematurely ticked before A5 was
      added — A5 is a Track A requirement and is not yet built.)
- [ ] Track B complete: Expo app builds via EAS, core journey works natively,
      not a thin wrapper, clears the design bar. **[B1 done; B2 photo-capture (PR #26) + B2 auth (PR #28) done; B3 app.json brand config done (PR #29); B2 backend analyze endpoint (PR #32) + mobile upload/analyze/results UX (PR #33) + B2 saved designs (PR #37) done; B3 push notifications + deep links + ESLint gate fix done (PR #56); B4 polish done (PRs #46, #47); B5 parity pending]**
- [ ] Track C complete: subscription + paywall + RevenueCat entitlements wired;
      server-side gating; live keys listed in `PENDING_OPS.md`.
      **[C1 Stripe billing done (PR #50); web enforcement wired (PR #52); C2/C3 RC mobile SDK + paywall done (PR #42); C4 server-side gate done (PR #43)]**
- [ ] Track D complete: privacy policy + terms + in-app account deletion live;
      privacy/data-safety content prepared; all store assets generated.
      **[D1 done (PR #23); D2 App Privacy labels staged (PR #30); D3 store listing copy staged (PR #30); D4 stability done (PR #53); screenshots still pending]**
- [ ] **Marketing = 100% (Track E COMPLETE, E1–E6):** waitlist + brand + site/SEO +
      ASO package + content calendar + full email lifecycle + owned-channel campaigns
      + referral/share loops + analytics — all BUILT and STAGED, launch-ready.
      **[E1 waitlist (PR #22); E2 brand kit (PR #44); E3 /support + guides + SEO + FAQ (#48/#54); E4 email + social drafts (#49); E5 analytics done (PR #58); E6 pending]**
- [ ] A self-run **pre-submission checklist** passes (no crashes on core path,
      required URLs present, permission strings set, no debug/placeholder content).
- [ ] **Business case (`docs/BUSINESS_CASE.md`) is complete and credible:** a
      bottoms-up, research-grounded estimate showing a realistic path to ≥ $100K/yr
      (price × conversion × users − COGS), with three scenarios, positive per-user
      margin, and — if the base case falls short — the explicit levers needed (which
      you then build). Numbers cited, not invented.
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
