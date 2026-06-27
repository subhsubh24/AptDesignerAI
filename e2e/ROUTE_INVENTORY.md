# Route & Flow Inventory — runtime functional coverage

Proves coverage is **complete**: every route/flow, the spec that exercises it, the
**intended outcome** asserted (not `status < 400`), and the tracked gaps. This is the
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
| `/login` | public | real form (`#email`/`#password` + "Sign In") | ✅ |
| `/dashboard` (logged out) | structural | redirects to `/login` | ✅ |
| `/account` (logged out) | structural | redirects to `/login` | ✅ |
| `/saved` (logged out) | structural | redirects to `/login` | ✅ |
| `/` | structural | resolves to `/login` (logged out) / `/dashboard`; no boundary | ✅ |
| `/pricing` | public | real heading; status < 400; no boundary | ✅ |
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
- **Per-room design routes** (`/projects/[id]/rooms/[id]/{focus,diagnosis,products,mockups,bundles,compare}`)
  once a seeded project fixture exists.

## Human-only (cannot run headlessly — verify manually, never assume working)
- Real **payment capture** on a live card (Stripe live mode).
- **Email deliverability** (signup confirmation, lifecycle) to a real inbox.
- **Native/device store purchases** (StoreKit / RevenueCat sandbox) in the mobile app.
- **Push delivery** to a real device.

## How CI runs the authed tier
Stand up an ephemeral, fully-migrated Supabase-local DB (all `supabase/migrations` applied,
`pgvector`/`pg_trgm` extensions present), boot the app against it with the service-role env,
set `E2E_AUTH_STACK=1`, then `bash scripts/run-journeys.sh`. Captcha/bot protection fails open
without a key, so seeded signups work. See `PENDING_OPS.md` for the exact CI job to add
(`.github/` is human-applied — the loop cannot edit it).
