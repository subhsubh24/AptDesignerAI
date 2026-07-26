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
| `/signup` → `/dashboard` (real UI signup) | authed | new account is usable immediately, lands on a working dashboard, NO "check your email" dead-end (no email verification) | ✅ |
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
| `/projects/[id]/rooms/[id]/{diagnosis,products,mockups,bundles,compare}` | authed | axe (WCAG 2 A/AA): zero critical/serious on each surface's chrome + **empty state**, against a seeded project+room; no boundary. **`focus` is NOT covered — see tracked gaps** | ✅ |

## Tracked gaps (next coverage to add — listed honestly, not silently skipped)
- **Full core pipeline E2E** (photo upload → area-analysis → diagnosis → product sourcing →
  mockup render returning a REAL image). Needs image fixtures + deterministic provider
  behavior (or recorded responses) so it isn't flaky/expensive. Currently only the onboarding
  ENTRY is asserted authed.
- **Checkout completion** (Stripe **test-mode** session → webhook → entitlement reflected in
  UI). Needs Stripe test keys + a webhook stub in the test env; today only the upgrade entry
  screen is asserted.
- **Save & share** (`/saved/[id]`, `/shared/[token]` happy path with a seeded design).
- **`/projects/[id]/rooms/[id]/focus` — not scanned at all.** Deliberately excluded from the seeded
  a11y loop: FocusPage's mount effect auto-POSTs to `/api/area-analysis` when the room has no
  analysis, ungated on whether the room even has photos. Scanning it would make the `journeys` job
  issue a real Gemini call (the job supplies a deliberately-invalid key and its own comment states
  the journeys don't call the LLMs), and the 180s provider timeout dwarfs Playwright's 30s default,
  so a slow failure would be a flaky red. Covering it needs a fixture that pre-seeds the analysis so
  the mount effect no-ops. This is the largest single design surface in the app and it is currently
  unscanned — do not read the row above as including it.
- **Per-room design routes, POPULATED state.** The five surfaces above are now scanned by axe against a
  seeded project+room (`seedProjectAndRoom` in `journeys.spec.ts`), but a fresh room has no
  diagnosis, products or mockups — so what is covered is each surface's page chrome and its EMPTY
  state. Scanning a POPULATED diagnosis/mockups/compare additionally needs a diagnosis + sourcing
  fixture (the money-path cassette seeds a mockup only). Until that exists, the dense populated
  layouts are still unscanned; do not read the ✅ above as covering them.
- **Outcome assertions on the per-room surfaces.** The seeded scans assert a11y + no error
  boundary, not that each surface renders its intended content.

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
without a key, so seeded signups work. See `PENDING_OPS.md` for the exact CI job to add
(`.github/` is human-applied — the loop cannot edit it).
