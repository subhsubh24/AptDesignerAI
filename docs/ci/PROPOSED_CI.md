# PROPOSED CI — make the loop's quality gates REQUIRED checks (owner applies)

> **STATUS: APPLIED.** `.github/workflows/ci.yml` is live with the `lint` and `journeys`
> jobs, and `journeys` has run green on the default branch. The real workflow has since
> moved ahead of the snapshot in `docs/ci/ci.yml` (it gained `paths-ignore`, a
> `concurrency` cancel block, and the auto-migrate job). Treat `docs/ci/ci.yml` as an
> archived proposal, not a file to copy. The sections below remain useful as the
> rationale for each job. What is still OWNER-ONLY: promoting `lint` and `journeys` to
> **required** checks in branch protection.


**Why:** today the required checks are `verify` (tsc+tests) / `build` / `mobile`. The
**functional journey suite** (BUILDS≠WORKS) and **lint** are NOT required — so a change that
builds + passes unit tests but is broken for a real user, or that's lint-dirty, can still
auto-merge. This closes that gap (loop-health harness proposal: "gates not enforced in CI").

**Why this is staged, not applied:** the headless loop must NOT edit `.github/` (it trips a
sensitive-file permission prompt that hangs the run). So the loop built everything it can
(journey suite, route inventory, lint-clean, a code-level TEST-ONLY rate-limit bypass) and stages
the workflow here. **A workflow-scope human applies steps 1–3 below.**

The product side is already in place: `e2e/journeys.spec.ts` (outcome-asserting, self-seeding via
`e2e/helpers/seed.ts`), `e2e/ROUTE_INVENTORY.md`, `scripts/run-journeys.sh` (emits
`E2E_JOURNEYS_PASSED=1`), lint at zero (F1), and `rateLimitBypassedForTest()` gated on
`E2E_RATE_LIMIT_BYPASS` (wired into the shared limiter + the signup/waitlist limiters).

---

## Step 1 — add these two jobs (merge into `.github/workflows/ci.yml`)

```yaml
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint   # eslint; F1 keeps this at zero — a new warning fails the gate

  journeys:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      # Throwaway, fully-migrated local DB (applies ALL supabase/migrations/*):
      - run: supabase start
      - run: supabase db reset --no-seed
      # Capture the local stack's keys into env for the build + seeder:
      - run: |
          echo "NEXT_PUBLIC_SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d= -f2)" >> $GITHUB_ENV
          echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2)" >> $GITHUB_ENV
          echo "SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2)" >> $GITHUB_ENV
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      # Start the production build on the dedicated journey port, wait for ready:
      - run: npm run start -- -p 3100 &
      - run: npx wait-on http://localhost:3100 --timeout 120000
      - run: bash scripts/run-journeys.sh        # runs e2e/journeys.spec.ts, needs E2E_AUTH_STACK=1
    env:
      CI: "1"
      E2E_AUTH_STACK: "1"                          # so the AUTHENTICATED journeys actually run (not skipped)
      # GOTCHA (a) — auth/redirect must resolve on localhost in CI. Supabase stack:
      NEXT_PUBLIC_SITE_URL: "http://localhost:3100"
      PLAYWRIGHT_BASE_URL: "http://localhost:3100"
      # (next-auth stacks use AUTH_TRUST_HOST=true + AUTH_URL instead — GroceryManager's gotcha.)
      # GOTCHA (b) — the self-seeding suite hammers the API from ONE runner IP and trips per-IP
      # rate limits. TEST-ONLY bypass, gated on this env var that PRODUCTION NEVER SETS:
      E2E_RATE_LIMIT_BYPASS: "1"
```

## Step 2 — make them required
Repo → Settings → Branches → branch protection for `claude/ai-apartment-design-app-iHAdb` →
**Require status checks to pass** → add **`lint`** and **`journeys`** to the existing
`verify` / `build` / `mobile`.

## Step 3 — VERIFY GREEN BEFORE REQUIRING (do not skip)
Push this workflow on a throwaway branch and confirm the **`journeys`** job goes **green** there
first. Only then mark it required. **Never make a flaky/red check required** — it would block the
loop's auto-merge entirely. If `journeys` is flaky, fix/stabilize it before requiring (keep `lint`
required regardless — it's deterministic).

---

## Notes / gotchas carried forward (so your first run is green)
- **(a) trusted host / localhost redirect:** set the base-URL env (`NEXT_PUBLIC_SITE_URL` +
  `PLAYWRIGHT_BASE_URL` = `http://localhost:3100`) so any auth redirect resolves on the CI host.
  (next-auth equivalent, which GroceryManager hit: `AUTH_TRUST_HOST=true` + `AUTH_URL`.)
- **(b) rate limits from one CI IP:** `E2E_RATE_LIMIT_BYPASS=1` is set ONLY in the `journeys`
  job. The code (`lib/utils/rate-limiter.ts` + the signup/waitlist routes) honors it; production
  must NEVER set it (it logs a loud warning if set, so an accidental prod set is visible).
- **Supabase CLI key extraction:** `supabase status -o env` field names can shift between CLI
  versions — if a key comes through empty, run `supabase status -o env` once in the job and adjust
  the `grep` keys.
- Existing `verify` / `build` / `mobile` checks stay as-is; this only ADDS `lint` + `journeys`.

---

## Optional: auto-migrate-on-deploy (kill the recurring "apply migrations" toil)

**What it does:** after a change merges to the default branch AND the gate passes, applies any new
`supabase/migrations/*` to prod automatically — so the owner never hand-runs `supabase db push`
again. **Tradeoff (decide consciously):** it removes the human checkpoint on schema changes.
Mitigated by — migrations go through the 2-reviewer + RLS-reviewer gate before merge; the job runs
ONLY on the default branch, ONLY after `verify`+`build` pass; `db push` is forward-only (NEVER a
reset). **Strongly recommended safety net:** enable Supabase **Point-in-Time Recovery / daily
backups** on the project before turning this on, so any bad migration is recoverable.

### Add this job to `.github/workflows/ci.yml`
```yaml
  migrate:
    # post-merge only — NEVER on PRs/previews — and only after the gate is green
    if: github.event_name == 'push' && github.ref == 'refs/heads/claude/ai-apartment-design-app-iHAdb'
    needs: [verify, build]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase link --project-ref "$SUPABASE_PROJECT_REF"
      - run: supabase db push            # forward-only; applies only NEW migrations. NEVER `db reset`.
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_PROJECT_REF:  ${{ secrets.SUPABASE_PROJECT_REF }}
      SUPABASE_DB_PASSWORD:  ${{ secrets.SUPABASE_DB_PASSWORD }}
```
*(Ensure the workflow's `on:` includes `push:` to the default branch. `db push` is non-interactive
with `SUPABASE_DB_PASSWORD` set.)*

### Owner one-time setup
1. Set three **GitHub Actions secrets** (Repo → Settings → Secrets and variables → Actions — UI is
   safest for secret values; or `gh secret set <NAME> --repo subhsubh24/AptDesignerAI`):
   - `SUPABASE_ACCESS_TOKEN` (Supabase dashboard → Account → Access Tokens)
   - `SUPABASE_PROJECT_REF` (your project ref)
   - `SUPABASE_DB_PASSWORD` (the project DB password)
2. Enable Supabase **PITR/backups** (the recoverability net).
3. Apply the `migrate` job (workflow scope), like the lint/journeys jobs above.
Once done, you never hand-apply a migration again — every future one self-applies post-merge.
