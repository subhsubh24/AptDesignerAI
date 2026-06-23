# ROADMAP — the build plan to a sellable, store-accepted product

This is the **convergence anchor** for the autonomous loop. `VISION.md` is the
*why* and *what good looks like*; this file is the *what to build, in what order,
and when to STOP*. Read it every run alongside `VISION.md`. The loop builds toward
the **Definition of Done** below, phase by phase, and then **stops building and
hands off** — it does not run forever.

## The goal (one sentence)
Ship two things — the **web app** and a **native mobile app** (iOS + Android) —
polished and complete enough to be **submitted to the App Store and Play Store and
accepted with high confidence**, monetized by **subscription**, and primed (via a
marketing engine + waitlist) to generate **reliable revenue (target ≥ $100K/yr)**.

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
- C1. Subscription model: monthly + annual tiers, a free trial, and a clear
  free→paid moment that lands on **real value** (a beautiful, trustworthy result),
  not a nag. Free tier limited by genuine COGS (per-design inference cost).
- C2. Billing integration: App Store / Play in-app purchase via **RevenueCat**
  (cross-platform entitlements) on mobile; Stripe (or RC web billing) on web.
  Build the code; **live keys / production billing config stay human-applied**
  (recorded in `PENDING_OPS.md`).
- C3. Paywall UI (web + native) that clears the design bar; restore-purchases,
  manage-subscription, and entitlement gating wired through one source of truth.
- C4. Server-side entitlement checks (never trust the client) feeding usage limits.

### Track D — Store readiness & compliance (the acceptance bar)
- D1. Legal: privacy policy + terms of service pages (web-hosted, linked in both
  apps). **Account deletion** in-app (Apple 5.1.1(v) — required).
- D2. Data handling: Apple **App Privacy** nutrition labels + Google **Data Safety**
  form content prepared; ATT prompt only if actually tracking.
- D3. Store assets: app icon, screenshots (all required sizes), preview text,
  keywords/ASO, support URL, marketing URL.
- D4. Stability: no crashes on the core path; sensible permissions usage strings;
  passes a self-run pre-submission checklist (see Definition of Done).

### Track E — Marketing engine (separate from the app; build + stage)
- E1. **Waitlist landing page** (own route or static site): brand, hero, value
  prop, email capture, "coming to App Store / Play" CTA. Clears the design bar.
- E2. Brand kit: name/wordmark (working name: *AptDesignerAI* — rename-able),
  palette already exists, social avatars/banners, OG images.
- E3. Content + ASO: launch copy, FAQ, a few SEO articles / "how it works",
  app-store description variants, screenshots with captions.
- E4. Owned-channel drafts: scheduled-post drafts (X/IG/TikTok/Reddit), an email
  welcome sequence for the waitlist. **Staged as drafts** — see Human Core.
- E5. Analytics/attribution scaffolding so launch spend is measurable.

> **Marketing autonomy boundary:** the loop may BUILD and STAGE all of the above.
> It may NOT publish publicly, send bulk email, or spend ad money until the owner
> connects the relevant account and funds it — those are login/payment-gated. The
> loop never invents public claims or fake metrics, and never posts under the
> owner's identity without a connected, owner-authorized channel.

## Definition of Done (the STOP gate)
The loop **stops building new features and opens ONE issue titled
`FACTORY: ready for submission`** (with the Human Core checklist below) when ALL of
these are true and verified in CI:
- [ ] Track A complete: web app reliable, on-design, secure (RLS clean).
- [ ] Track B complete: Expo app builds via EAS, core journey works natively,
      not a thin wrapper, clears the design bar.
- [ ] Track C complete: subscription + paywall + RevenueCat entitlements wired;
      server-side gating; live keys listed in `PENDING_OPS.md`.
- [ ] Track D complete: privacy policy + terms + in-app account deletion live;
      privacy/data-safety content prepared; all store assets generated.
- [ ] Track E1–E3 complete: waitlist page + brand kit + ASO/store copy staged.
- [ ] A self-run **pre-submission checklist** passes (no crashes on core path,
      required URLs present, permission strings set, no debug/placeholder content).

Until then, keep advancing the lowest incomplete phase. After then, do **not**
keep adding scope — the loop's job is finished; the owner submits.

## Human Core (the unavoidable ~5% — only the owner can do these)
These are gated behind verified-human login / payment and are NOT loop work:
1. Apple Developer account ($99/yr) + Google Play account ($25) + identity verify.
2. Signing certs / provisioning / EAS credentials; accept Apple & Google agreements.
3. Production billing setup (App Store/Play subscriptions, RevenueCat live keys,
   Stripe live keys) — apply the `PENDING_OPS.md` entries.
4. Apply pending DB migrations to prod (`supabase db push`).
5. Connect + fund marketing/ad/social accounts to flip staged campaigns live.
6. Final submission in App Store Connect / Play Console and responding to review.

## Guardrails carried over (do not trade away)
- `VISION.md` design bar; LLM cost contract; determinism; security & RLS bar.
- Billing/auth/payments: code may be built and reviewed, but **live secrets and
  go-live config are human-applied** via `PENDING_OPS.md` — never committed, never
  auto-activated.
- Migrations human-applied; nothing outside the repo; never edit `.claude/` or
  `.github/`.
