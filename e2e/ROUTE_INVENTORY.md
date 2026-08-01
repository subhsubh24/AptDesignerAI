# Route & Flow Inventory — runtime functional coverage

Records runtime functional coverage: which routes/flows have a spec, the **intended
outcome** it asserts (not `status < 400`), and what is still uncovered. It does NOT
claim every route is covered — **20 of the 35 `app/**/page.tsx` routes appear in the
table below**, and all 15 that do not are listed under "Tracked gaps" so the
shortfall is counted rather than implied away. (Counts derived from
`find app -name page.tsx` against the backticked paths in the table; if you edit
either, re-derive rather than adjusting by hand — a hand-count is how the previous
version of this line came to be wrong.) This is the
companion to the **BUILDS ≠ WORKS** guard in `ROADMAP.md` — a route/flow with no
outcome-asserting runtime test is an UNVALIDATED GAP and may not be certified "works".

Suite: `e2e/journeys.spec.ts` · helpers: `e2e/helpers/seed.ts` · runner: `scripts/run-journeys.sh`

## Tiers
- **PUBLIC + STRUCTURAL** — no auth backend; runs anywhere (local dev or CI).
- **AUTHENTICATED** — self-seeds a confirmed user via the admin client, signs in via the
  real UI. Gated on `E2E_AUTH_STACK=1` + service-role env (Supabase-local in CI).

## Coverage

| Route / flow | Tier | Outcome asserted | Spec |
|---|---|---|---|
| `/signup` | public | real form (`#name`/`#email`/`#password` + "Create Account"); no error boundary | ✅ |
| `/signup` → `/dashboard` (real UI signup) | authed | new account is usable immediately, lands on a working dashboard, NO "check your email" dead-end (no email verification) | ✅ |
| `/login` | public | real form (`#email`/`#password` + "Sign In") **+ the "Forgot password?" link points at `/forgot-password`** — account recovery is reachable from where the user gets stuck | ✅ |
| `/forgot-password` | public | real form (`#email` + "Send reset link"); no boundary | ✅ |
| `/forgot-password` (submit) | public | reaches a DEFINITE outcome — "Check your inbox" (a send was attempted) or the honest "we'll reset it for you" support fallback when the email provider is not connected; never a silent no-op, never an inbox promise with nothing sent | ✅ |
| `/reset-password` | public | resolves to a real state (password form or "That link has expired"), never a stuck link-checking spinner | ✅ |
| `/dashboard` (logged out) | structural | redirects to `/login` | ✅ |
| `/account` (logged out) | structural | redirects to `/login` | ✅ |
| `/saved` (logged out) | structural | redirects to `/login` | ✅ |
| `/` | structural | resolves to `/login` (logged out) / `/dashboard`; no boundary | ✅ |
| `/pricing` | public | real heading; status < 400; no boundary | ✅ |
| `/waitlist` | public | the signup form itself — labelled email input + submit button; copy without a way to join is the BUILDS ≠ WORKS case | ✅ |
| `/faq` | public | a named question is present AND its `<details>` EXPANDS to reveal the real answer (a disclosure that never opens answers nothing); ≥10 entries | ✅ |
| `/privacy` | public | the Apple 5.1.1(v) load-bearing content: the "Device permissions" section and the "permanently removes all your content" deletion promise | ✅ |
| `/terms` | public | the real agreement — ≥5 `h2` sections, not a stub | ✅ |
| `/guides` | public | ≥3 guide links that are FOLLOWED, not just counted — an index whose entries lead nowhere is worse than none | ✅ |
| `/guides/color-palette-guide` | public | reached by clicking through from the index; renders its own `h1`, no boundary | ✅ |
| `/guides/ai-vs-professional-design` | public | navigated to directly (not via index click-through); renders its own `h1`, no boundary | ✅ |
| `/guides/material-coherence` | public | navigated to directly (not via index click-through); renders its own `h1`, no boundary | ✅ |
| `/gallery` | public | real heading + ≥2 curated example cards (`h3`) render, not an empty shell | ✅ |
| `/support` | public | a real contact route scoped to `<main>` ("Email support" + a mailto) — the page-wide locator was satisfied by the footer's "Contact us" on every page | ✅ |
| sign-in → `/dashboard` | authed | **"Welcome to AptDesigner" + "Start designing" render; NO "Something went wrong"** (canonical guard) | ✅ |
| core flow entry (onboarding) | authed | "Start designing" advances without error | ✅ |
| `/login` (logged in) | authed | redirects to `/dashboard` | ✅ |
| `/account` (logged in) | authed | renders real screen; no boundary | ✅ |
| `/billing/upgrade?tier=pro` | authed | real checkout entry renders; no boundary | ✅ |

## Tracked gaps (next coverage to add — listed honestly, not silently skipped)
- **Full core pipeline E2E** (photo upload → area-analysis → diagnosis → product sourcing →
  mockup render returning a REAL image). Needs image fixtures + deterministic provider
  behavior (or recorded responses) so it isn't flaky/expensive. Currently only the onboarding
  ENTRY is asserted authed.
- **Checkout completion** (Stripe **test-mode** session → webhook → entitlement reflected in
  UI). Needs Stripe test keys + a webhook stub in the test env; today only the upgrade entry
  screen is asserted.
- **Save & share** (`/saved/[id]`, `/shared/[token]` happy path with a seeded design).
- **Per-room design routes.** Six of them — `setup`, `diagnosis`, `products`, `bundles`,
  `mockups`, `compare` — ARE axe-scanned with a seeded project by
  `DESIGN_DENSE_A11Y_ROUTES` (`journeys.spec.ts`), which asserts each route's OWN `h1` so a
  404 cannot score clean. What they lack is an outcome-asserting FUNCTIONAL pass, not a
  smoke check. `focus` is **not** in that scan and has no coverage of any kind: opening it
  starts the room-analysis pipeline, so scanning it would be slow and dependent on live LLM
  behaviour (`journeys.spec.ts:271-273`).
- **The 15 routes absent from the table**, in full, so the number above is checkable:
  - marketing / content (1): `/picks`
  - product (9): `/projects/[projectId]`, `/projects/[projectId]/rooms/[roomId]`, and the seven
    per-room routes above (`setup`, `focus`, `diagnosis`, `products`, `bundles`, `mockups`,
    `compare`) — six a11y-scanned, none functionally asserted
  - billing outcomes (2): `/billing/checkout-success`, `/billing/checkout-cancel`
  - sharing / waitlist (3): `/saved/[id]`, `/shared/[token]`, `/waitlist/confirmed`

## Human-only (cannot run headlessly — verify manually, never assume working)
- Real **payment capture** on a live card (Stripe live mode).
- **Email deliverability** (waitlist confirmation, lifecycle) to a real inbox. NOTE: account
  signup no longer depends on email (the route auto-confirms — see PENDING_OPS); if verification
  is ever re-enabled, the signup→email round-trip must be covered before it ships.
- **Native/device store purchases** (StoreKit / RevenueCat sandbox) in the mobile app.
- **Push delivery** to a real device.

## How CI runs the authed tier
Stand up an ephemeral, fully-migrated Supabase-local DB (all `supabase/migrations` applied,
`pgvector`/`pg_trgm` extensions present), boot the app against it with the service-role env,
set `E2E_AUTH_STACK=1`, then `bash scripts/run-journeys.sh`. Captcha/bot protection fails open
without a key, so seeded signups work. That `journeys` job now EXISTS in
`.github/workflows/ci.yml` and has run green on the default branch — this section
describes what it does, not something still to be added.
