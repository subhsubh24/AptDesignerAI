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
| Public + structural | yes | yes — 5 distinct states × 2 widths |
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

Captures are deterministic by construction — animations disabled, caret hidden,
fonts awaited — so re-running against an unchanged app should not produce a
diff for its own sake.
