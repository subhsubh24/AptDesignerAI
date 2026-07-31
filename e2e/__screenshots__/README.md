# Journey screenshots (ROADMAP F7)

Committed PNGs captured by `e2e/journeys.spec.ts` via
`captureJourneyStep()` (`e2e/helpers/screenshot.ts`), at both widths F7
requires — `-desktop` (1280×800) and `-mobile` (390×844), full page.

They exist so the F5 deep-audit lens and the readiness auditors have real
artifacts to LOOK at on both axes F7 defines:

- **FUNCTIONAL** — does the screen visibly show the INTENDED OUTCOME of that
  journey step (populated, correct data, the real produced artifact), catching
  what DOM assertions miss: a blank screen, a stuck spinner, a broken image, a
  dead end the selector-based assertions happily passed.
- **DESIGN** — intentional, on-brand, clears the `VISION.md` bar; not
  blank/broken/overlapping/unstyled/off-brand.

A FAIL on EITHER axis is release-blocking even when the DOM assertions pass.
**Capture-and-forget does not satisfy F7** — the recorded verdict is half the
requirement, and lives in `docs/loop-memory.md` for the deep audit and in the
readiness-issue evidence for the gate.

## Coverage — PARTIAL, and F7 stays unticked because of it

| Tier | Captured | Committed here |
|---|---|---|
| Public + structural (signup, login, forgot-password, reset-password, pricing) | yes | yes — 5 distinct states × 2 widths |
| Public content (waitlist, FAQ, privacy, terms, guides index, guide article, support) | yes | yes — 7 distinct states × 2 widths |
| Authenticated (dashboard, onboarding, account, paywall, free-tier gate) | yes, when the suite runs with the auth stack | **no** |
| Design-dense room surfaces (setup, diagnosis, products, bundles, mockups, compare) | yes, when the suite runs with the auth stack | **no** |

**Why 5 states and not 9.** The three protected-route bounces (`/dashboard`,
`/account`, `/saved` logged out) and `/` all resolve to the SAME rendered
`/login` screen, which `public-login-form-*` already captures — their PNGs came
out byte-identical, so committing them under five names added ~2.1MB and no
evidence. What those journeys actually prove is the REDIRECT, which their URL
assertions cover. Every committed PNG here is a visually distinct screen.

The capture call sites for the authed and design-dense steps are in place and
run as part of the suite. They are not committed because the authenticated tier
needs a seeded Supabase-local backend (`E2E_AUTH_STACK=1` + service-role env),
which the CI `journeys` job provides but a plain container does not — so the
loop can generate them in CI but cannot commit them from a local run.

Until every route/state in `e2e/ROUTE_INVENTORY.md` has a committed PNG **and**
a recorded dual-axis verdict, **F7 remains `- [ ]`**. Preflight GATE 1c enforces
the honest-tick half: ticking F7 with an empty or placeholder directory fails.

## Regenerating

```bash
npm run build
npx next start -p 3100          # with the app's required env set
CI=1 PLAYWRIGHT_BASE_URL=http://localhost:3100 bash scripts/run-journeys.sh --public-only
```

**Run it serially.** `--workers=1` is not a preference. A run at two workers
produced a BLANK 4.7KB `/login` desktop capture — the page shot mid-paint —
while every DOM assertion in that test passed. Three serial re-runs reproduced
the real 471KB screen byte-for-byte. `__tests__/design/screenshot-manifest.test.ts`
now decodes pixels and fails a blank artifact, so this cannot be committed
silently, but the remedy is still to re-capture serially.

Captures are near-deterministic — animations disabled, caret hidden, fonts
awaited (all bounded; see `e2e/helpers/screenshot.ts`). "Near", not "perfectly":
re-running against an unchanged app reproduces the great majority of these files
byte-for-byte, while a few move by single-digit bytes on a sub-pixel antialiasing
difference at one rounded corner. Expect the occasional few-byte churn; treat a
LARGE diff, or a diff on many files at once, as a real visual change worth
looking at.
