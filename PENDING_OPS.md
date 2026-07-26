# Pending Operations

Operations that require manual (human) action at deploy time — migrations, live
secrets, billing config. The loop never runs these; it records them here and the
owner applies them. The daily digest + the factory dashboard read this file (the
dashboard parses the fenced OWNER_ACTIONS YAML block below).

```yaml
OWNER_ACTIONS:
  project: AptDesignerAI
  as_of: 2026-07-14
  items:
    - id: reconcile-canonical-domain
      title: "DONE — canonical domain = aptdesignerai.com; app.json associatedDomains + email from-address reconciled (owner: host AASA + verify email auth, below)"
      priority: high
      status: done
      why: "Deep audit (Run 40) found a domain split: code fallbacks + store-listing + privacy/terms docs use aptdesignerai.com (dominant), but mobile/app.json `ios.associatedDomains` used applinks:aptdesignerai.com and lib/email's from-address used hello@aptdesigner.ai — risking silent iOS Universal Link failure (share links open Safari) and bounced transactional email. Owner chose .com (2026-06-30)."
      how: "DONE in-repo: mobile/app.json -> applinks:aptdesignerai.com; lib/email DEFAULT_FROM -> hello@aptdesignerai.com; .ai test fixtures (paid-welcome, cors, waitlist-double-opt-in) updated to .com. REMAINING owner-core steps: (1) verify SPF/DKIM are configured for aptdesignerai.com so hello@aptdesignerai.com authenticates (else transactional email still bounces); (2) host the iOS AASA file at https://aptdesignerai.com/.well-known/apple-app-site-association with your Apple Team ID — see the 'iOS Universal Links' section below."
      blocks: none
    - id: enforce-ci-required-checks
      title: "DONE — lint + public functional-journey CI jobs are now REQUIRED checks"
      priority: high
      status: done
      why: "Previously only verify/build/mobile were required, so a BUILDS!=WORKS (broken-for-a-user) or lint-dirty change could still auto-merge. Now closed."
      how: "DONE: ci.yml carries verify/mobile/build/lint/journeys; journeys runs the public/structural tier (--public-only) — boots the prod build with placeholder env + dummy LLM keys and asserts real public pages render. Proven GREEN on a real run, THEN added to required_status_checks ([verify, mobile, build, lint, journeys], strict=false, enforce_admins=false). The loop merges via `gh pr merge --squash --auto`, so a red required check BLOCKS the merge. Resolves issue #181."
      followup: "AUTHED journey tier (signup->working dashboard, paywall unlock) needs a supabase-local seed that is not yet green under `next start` in CI (sign-in not reaching /dashboard). Add it as a separate required job once stabilized. enforce_admins stays false until Growth + Quality-Auditor routines also merge via --auto (today they don't, so admin-enforcement could strand their PRs)."
      blocks: none
    - id: auto-migrate-on-deploy
      title: "(Optional) enable auto-migrate-on-deploy so migrations stop being a manual step (docs/ci/PROPOSED_CI.md)"
      priority: normal
      status: open
      why: "Migrations are currently hand-applied (`supabase db push`) every time the factory adds one — recurring owner toil. The staged `migrate` CI job applies new migrations automatically post-merge after the gate passes. TRADEOFF: removes the human checkpoint on schema changes (mitigated: 2-reviewer+RLS gate pre-merge, default-branch-only, forward-only push, never reset). Decide consciously."
      how: "1) Enable Supabase PITR/backups (recoverability net). 2) Set GitHub Actions secrets SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD (Settings->Secrets, or gh secret set). 3) Apply the `migrate` job from docs/ci/PROPOSED_CI.md (workflow scope). After this you never hand-apply a migration again. (Skip if you prefer keeping the manual checkpoint.)"
      blocks: none
    - id: spend-caps
      title: Set HARD daily API spend caps + alerts in every provider dashboard
      priority: urgent
      status: open
      why: "The app is live on Vercel and calls paid APIs (Gemini, Tavily, Browserbase, Stripe); an abuse spike or runaway loop can run up cost. A provider-side spend cap is the only hard backstop."
      how: "Set hard daily budgets/limits + 50%-of-cap alerts in each provider console (Google AI Studio / Gemini, DeepSeek, Tavily, Browserbase), and regenerate any key you suspect is exposed."
      blocks: launch-safety
    - id: connect-channels
      title: Connect + authorize marketing channels to switch the Growth Agent into execute mode
      priority: high
      status: open
      why: "The Growth Agent stays in honest prepare-only mode until the owner connects their own authorized channels; the staged marketing engine (Track E) cannot run demand-gen otherwise."
      how: "Connect your own accounts/keys (X/Instagram/TikTok/Reddit, an email provider) to the deployed app's growth settings, server-side. The agent never holds live secrets; the deployed app sends."
      blocks: growth-execution
    - id: set-site-gate-password
      title: "Set SITE_GATE_PASSWORD to gate the app pre-launch (waitlist stays public)"
      priority: high
      status: open
      why: "Before the Growth Agent drives any pre-launch traffic, the app should be password-gated so the public can't see the unfinished product; the waitlist/landing routes stay exempt so people can still join. Once the product is launch-ready (ship-critical QUALITY_SCORECARD A/A+ + readiness), unset it to open the app."
      how: "The gate middleware now ships (Run 39, PR #173 — lib/security/site-gate.ts). Set SITE_GATE_PASSWORD to a value of your choice on the deployment (Vercel env). Behavior once set: non-exempt browser routes redirect to /waitlist (API routes return 503) while /waitlist + /api/waitlist + legal/marketing pages stay public; unlock your own browser by visiting any URL once with ?gate=<password> (sets an httpOnly cookie). Then flip GROWTH_STATUS.site_gate_up: true so the Growth Agent can begin pre-launch outreach. At launch, UNSET SITE_GATE_PASSWORD to open the app. Never commit the value."
      blocks: pre-launch-marketing
    - id: cutover-to-persistent-data
      title: "Cut the DATA layer over to real Supabase Postgres (set DATA_BACKEND=supabase) — persistence is a launch blocker"
      priority: high
      status: open
      why: "The app's DATA layer is currently the in-memory store (lib/store/memory-store.ts); real Supabase is used for AUTH only. Data 'persists only for the lifetime of the server process', so on Vercel serverless (or any restart / multi-replica host) a user's projects/rooms/diagnoses/saved-designs do NOT survive across instances — the retention-critical 'revisit your saved designs' journey is broken in production, and the 26/26 RLS policies never execute at runtime. This is why QUALITY_SCORECARD.functional_reality is C and DoD Track A stays unchecked. The persistent path is now BUILT + code-reviewed behind a flag (PR #531): setting DATA_BACKEND=supabase routes ALL data ops through a real user-scoped Supabase client with RLS enforced. It ships INERT (default = memory) so the cutover is a deliberate owner step, not a blind flip."
      how: "1) Apply ALL pending migrations to the prod Supabase project (`supabase db push`, or run the numbered supabase/migrations/*.sql in order — see the other apply-migration-* items). 2) Confirm NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (+ SUPABASE_SERVICE_ROLE_KEY) are set on the deployment. 3) Set DATA_BACKEND=supabase on the deployment (Vercel env) and redeploy. 4) VERIFY the money path survives a cold start: create a project/room, run a diagnosis, save a design, then redeploy (or restart) and confirm the saved design is still there and RLS blocks another user from reading it. If creds are missing while DATA_BACKEND=supabase, the app FAILS LOUD by design (no silent fallback to the non-persistent store). Do NOT flip this until the migrations are applied — an un-migrated schema will error on first query."
      blocks: launch
    - id: apply-migration-021
      title: "Apply migration 021_stripe_customers_annual_tier.sql AND set ANNUAL_BILLING_ENABLED=true to enable annual billing"
      priority: normal
      status: open
      why: "PR #98 added the pro_annual ($399/yr) tier; the tier CHECK constraint must be extended in the DB or annual checkouts will fail. Run 84 (#597) discovered the pricing page + /billing/upgrade were still advertising/serving annual checkout WHILE 021 was unapplied — a completed annual purchase would CHARGE the customer on Stripe, then fail the webhook's stripe_customers upsert with a CHECK violation (charged, no entitlement). #597 gates annual end-to-end behind ANNUAL_BILLING_ENABLED (default OFF): the checkout route refuses pro_annual, the pricing-page annual CTA is hidden, and /billing/upgrade?tier=pro_annual redirects to /pricing. So annual is safely OFF until BOTH the migration is applied AND the flag is set."
      how: "1) Run `supabase db push` (or paste supabase/migrations/021_stripe_customers_annual_tier.sql into the Supabase SQL Editor). 2) In the SAME deploy, set ANNUAL_BILLING_ENABLED=true on the Vercel deployment and redeploy — this un-gates the checkout route + pricing CTA + upgrade page. 3) Verify a pro_annual checkout in Stripe TEST mode writes tier='pro_annual' to stripe_customers without a CHECK violation and the entitlement unlocks. Do NOT set the flag before the migration is applied."
      blocks: annual-billing
    - id: ensure-tavily-key-prod
      title: "Ensure TAVILY_API_KEY is set on the prod deployment (now boot-required)"
      priority: normal
      status: open
      why: "Run 84 (#596) made a missing TAVILY_API_KEY FAIL the production boot (assertProductionEnv) instead of 500-ing 5-30s into the first product search — the search/sourcing pipeline (lib/ai/tavily.ts) throws without it. If the current prod deploy is serving working searches the key is already set (no action). But if it is unset, the NEXT deploy will now hard-fail at boot by design — set TAVILY_API_KEY in Vercel env before redeploying. (The CI journeys boot is exempt via E2E_AUTH_STACK=1; this only affects real prod.)"
      how: "Confirm TAVILY_API_KEY is present in the Vercel Production env (Settings -> Environment Variables). Get a key at https://app.tavily.com if missing. No code change needed."
      blocks: none
    - id: enable-stripe-customer-portal
      title: "Activate & configure the Stripe Customer Portal so /account 'Manage subscription' works"
      priority: normal
      status: open
      why: "Run 76 (#543) added self-serve subscription management: POST /api/billing/portal -> Stripe billingPortal.sessions.create, linked from /account. Stripe requires the Customer Portal to be ACTIVATED + configured in the Dashboard before session creation succeeds; until then the route returns 502 and web subscribers cannot self-manage/cancel. No code or secret change is needed — only the dashboard config."
      how: "Stripe Dashboard -> Settings -> Billing -> Customer portal: activate the portal; enable 'cancel subscription', 'update payment method', and invoice history; set the business/return info. Configure BOTH test mode and live mode (separate). The route already reads STRIPE_SECRET_KEY from env, so nothing to commit."
      blocks: none
    - id: email-verification-deferred
      title: "Account email verification is intentionally OFF (no email pipeline) — re-enable ONLY with the round-trip test"
      priority: normal
      status: open
      why: "Signup previously required an email confirmation link, but no transactional-email pipeline exists pre-launch, so every new user dead-ended at 'check your email' with no email ever arriving. Decision: signup now creates an already-confirmed account server-side (app/api/auth/signup/route.ts) — no verification. This is the correct pre-launch call; do NOT 'fix' it back to requiring verification while the email loop is unverified."
      how: "If you WANT email verification later: (1) connect a real provider for Supabase Auth (custom SMTP / Resend) with a verified domain; (2) FIRST add the signup->receive-email->click-link->confirmed round-trip to the journey suite (ROADMAP F4.1) so it is proven end to end; (3) only then switch the flow back to requiring confirmation. Never ship a verification gate whose email send is not round-trip-tested."
      blocks: none
    - id: apply-migrations-022-023
      title: "Apply migrations 022 (waitlist double opt-in) + 023 (social publishing queue) to prod"
      priority: normal
      status: open
      why: "Run 34 added double opt-in columns to waitlist_emails (022) and the social_post_queue table (023). Until 022 is applied, waitlist sign-ups can't be stored/confirmed as pending; until 023 is applied, the social publishing queue has no table. Both are idempotent and admin-only (RLS enabled, no policy on 023; 017's boundary unchanged on 022)."
      how: "Run `supabase db push` (or paste supabase/migrations/022_waitlist_double_opt_in.sql then 023_social_post_queue.sql into the Supabase SQL Editor, in order)."
      blocks: growth-execution
    - id: apply-migration-024
      title: "Apply migration 024_harden_handle_new_user_search_path.sql to prod (security hardening)"
      priority: normal
      status: open
      why: "Run 36 (PR #151): pins search_path on the SECURITY DEFINER signup-trigger handle_new_user() (Supabase 'Function Search Path Mutable' lint / privilege-escalation surface). Idempotent, behaviour-preserving (body already fully-qualifies public.profiles)."
      how: "Run `supabase db push` (or paste supabase/migrations/024_harden_handle_new_user_search_path.sql into the SQL Editor). Verify: `select proname, proconfig from pg_proc where proname='handle_new_user';` should show `{search_path=}`."
    - id: rate-limit-redis
      title: "Move rate limiter state from in-memory to Upstash Redis before scaling"
      priority: normal
      status: open
      why: "The in-memory rate limiter (added Run 32, PR #111) AND the per-user/day spend limiter (added Run 33, PR #119, lib/utils/spend-limiter.ts) both reset on cold start and are per-Vercel-function-instance. On multi-instance deployments a single user can bypass per-user limits by hitting different instances. Pre-launch this is acceptable; before significant traffic the state must move to a shared store."
      how: "Install the Upstash Redis Vercel integration (1-click from Vercel dashboard → Integrations), set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars, swap lib/utils/rate-limiter.ts AND lib/utils/spend-limiter.ts to use @upstash/ratelimit (Sliding Window) / a shared Redis counter."
      blocks: rate-limiting-at-scale
    - id: connect-email-resend
      title: "Connect Resend to switch the email lifecycle from dry-run to live (E7.2)"
      priority: high
      status: open
      why: "lib/email (PR #117) ships in dry-run by default — it logs every send but transmits nothing until a provider key is present. The staged E4/E6 email lifecycle cannot actually reach users until this is connected."
      how: "Create a Resend account, verify your sending domain (SPF/DKIM DNS records), create a sending API key, then set RESEND_API_KEY + RESEND_FROM_EMAIL (an address on the verified domain) on the deployment. Leave GROWTH_EMAIL_DRY_RUN unset to go live automatically. Full runbook: docs/growth/CONNECT.md Step 1."
      blocks: growth-execution
    - id: apply-migration-025
      title: "Apply migration 025_user_email_stages.sql to prod (activation email idempotency)"
      priority: normal
      status: open
      why: "The daily activation email cron (/api/cron/activation-emails) uses the user_email_stages table to ensure each lifecycle stage (activation_1/2/3) is sent exactly once per user. Without this table, the cron errors on every run and no activation emails fire."
      how: "Run `supabase db push` (or paste supabase/migrations/025_user_email_stages.sql into the Supabase SQL Editor)."
      blocks: activation-emails
    - id: apply-migration-026
      title: "Apply migration 026_waitlist_referral.sql to prod (waitlist referral loop)"
      priority: normal
      status: open
      why: "Run 44 (PR #226): adds referral_code (unique partial index) + referred_by columns to waitlist_emails so the referral loop can issue/attribute codes. Until applied, the waitlist POST insert fails (column not found) and sign-ups 500. Idempotent; admin-only table, RLS boundary from 017 unchanged (no new policy)."
      how: "Run `supabase db push` (or paste supabase/migrations/026_waitlist_referral.sql into the Supabase SQL Editor)."
      blocks: growth-execution
    - id: apply-migration-027
      title: "Apply migration 027_user_email_preferences.sql to prod (CAN-SPAM opt-out)"
      priority: normal
      status: open
      why: "Run 44 (PR #227): adds the user_email_preferences tenant table (RLS keyed on auth.uid()=user_id) backing the /account email opt-out. The marketing send paths (win-back webhook, activation cron) read it via the admin client and the /account toggle writes it. Until applied, the toggle's GET/PUT and the send-path checks error. Idempotent."
      how: "Run `supabase db push` (or paste supabase/migrations/027_user_email_preferences.sql into the Supabase SQL Editor)."
      blocks: marketing-email-compliance
    - id: apply-migration-028
      title: "Apply migration 028_handle_new_user_nonblocking.sql to prod (signup can never be blocked by profile insert)"
      priority: normal
      status: open
      why: "Run 2026-07-02 outage: the on_auth_user_created trigger's insert into public.profiles threw in prod (RLS/drift), rolling back the auth.users insert — so NEITHER app signup NOR the Supabase dashboard could create ANY account, surfacing only as a generic 'Something went wrong'. 028 wraps the profile insert so a failure is logged (raise warning) and swallowed: the user is still created, the profile can be backfilled. Keeps the 024 hardening (search_path=''). Until applied, prod signup remains exposed to the same hard-block failure mode. Idempotent (create or replace function). NOTE: previously untracked here — added Run 88 after a reviewer flagged the gap (028 existed in supabase/migrations/ with no owner-action entry)."
      how: "Run `supabase db push` (or paste supabase/migrations/028_handle_new_user_nonblocking.sql into the Supabase SQL Editor). Verify: create a test account via the app AND the dashboard; both succeed even if a profiles-insert warning is logged."
      blocks: signup-reliability
    - id: apply-migration-029
      title: "Apply migration 029_grant_stripe_customers_access.sql to prod (explicit stripe_customers GRANTs)"
      priority: normal
      status: open
      why: "Run 59 (PR #386): migration 018 created stripe_customers with RLS but NO explicit table-level GRANTs, relying on Supabase default-privilege auto-grants. The paywall→entitlement-unlock journey surfaced `permission denied for table stripe_customers` for BOTH the service-role entitlement read (getWebBillingStatus/hasProEntitlementWeb via getAdminClient) AND the seed — i.e. `supabase db reset` (CI journeys backend) does not reliably apply those default grants to migration-created tables. 029 makes them explicit: service_role full DML (webhook + entitlement reads), authenticated SELECT (so the existing own-row RLS SELECT policy is reachable); anon stays ungranted. Idempotent + a harmless no-op on hosted Supabase where the default privileges already cover these roles — apply defensively so the table's access model is explicit and portable. RLS boundary unchanged (GRANT and RLS are independent gates)."
      how: "Run `supabase db push` (or paste supabase/migrations/029_grant_stripe_customers_access.sql into the Supabase SQL Editor). Verify: SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='stripe_customers' — expect authenticated=SELECT, service_role=SELECT/INSERT/UPDATE/DELETE, no anon."
      blocks: none
    - id: set-cron-secret
      title: "Set CRON_SECRET to activate the lifecycle email cron jobs"
      priority: normal
      status: open
      why: "Three daily crons share CRON_SECRET (vercel.json): /api/cron/activation-emails (10:00 UTC, A1/A2/A3 to signed-up users who have not started an analysis), /api/cron/winback-emails (11:00 UTC, E2/E3 to cancelled subscribers), and /api/cron/habit-emails (12:00 UTC, B1/B2/B3 to users who ran their first analysis but have not upgraded — Run 92). Each returns 503 until CRON_SECRET is set. Vercel automatically includes Authorization: Bearer {CRON_SECRET} on cron invocations. (Even once set, all three stay in dry-run until RESEND_API_KEY + EMAIL_PHYSICAL_ADDRESS are also set — see connect-email-resend / set-email-physical-address.)"
      how: "Generate: `openssl rand -hex 32`. Set CRON_SECRET in Vercel environment variables (Production + Preview). No code change needed."
      blocks: activation-emails, winback-emails, habit-emails
    - id: set-metrics-token
      title: "Set INTERNAL_METRICS_TOKEN to open the growth-metrics pull API (E7.4)"
      priority: high
      status: open
      why: "GET /api/internal/growth-metrics (PR #118) is closed by default (returns 503) until the token is set. The daily Growth Agent needs it to read REAL funnel numbers (waitlist + subscriber counts) into GROWTH_STATUS instead of leaving them 0/null."
      how: "Generate a long random secret (`openssl rand -hex 32`) and set INTERNAL_METRICS_TOKEN on the deployment. Verify per docs/growth/CONNECT.md Step 2 (curl with Authorization: Bearer)."
      blocks: growth-execution
    - id: set-email-physical-address
      title: "Set EMAIL_PHYSICAL_ADDRESS so marketing-lifecycle emails carry the CAN-SPAM-required postal address"
      priority: normal
      status: open
      why: "GTM Auditor (docs/growth/GTM_SCORECARD.md, auditor_run 2) named a compliance nit: the activation/win-back/paid-welcome lifecycle templates (lib/email/templates/lifecycle.ts) render an unsubscribe link but no physical mailing address, which CAN-SPAM requires on every commercial email. The loop cannot invent a real business address, so this is owner-core. Growth Agent Run 9 wired the template to render EMAIL_PHYSICAL_ADDRESS when set, and made lib/email/index.ts force dry-run on every marketing-lifecycle stage (not the transactional waitlist_confirm) until the address is set — so a non-compliant email can never actually leave the system even after RESEND_API_KEY goes live."
      how: "Set EMAIL_PHYSICAL_ADDRESS (e.g. \"123 Main St, Springfield, ST 00000\") on the deployment (Vercel env). No code change needed — the footer renders it automatically and the compliance dry-run gate lifts once both this AND RESEND_API_KEY are set."
      blocks: marketing-email-compliance
    - id: tune-daily-spend-cap
      title: "(Optional) tune DAILY_PAID_CALL_LIMIT for the paid-API spend ceiling (G7)"
      priority: normal
      status: open
      why: "The per-user/day spend circuit breaker (PR #119) defaults to 60 paid calls/user/day. This is a code-level backstop; the durable protection is the provider-dashboard hard caps in the `spend-caps` item above."
      how: "Set DAILY_PAID_CALL_LIMIT (integer > 0) on the deployment only if 60/user/day is too low/high for your real usage; otherwise leave unset."
      blocks: none
```

## Pending

### Supabase auth rate limits — the server-side half of G4 login lockout/backoff (added 2026-07-25, Run 113, Track G4)

Run 113 closed the **user-enumeration** half of ROADMAP G4 on the web sign-in path (`lib/auth/login-errors.ts` — a wrong password, an unknown address, an unconfirmed account, a banned account and an SSO-managed address now all return one identical message). The **lockout/backoff** half is still open, and the loop deliberately did not fake it:

- The web app signs in **client-side** (`app/(auth)/login/page.tsx` → `supabase.auth.signInWithPassword`), so there is no server route of ours in the path to count attempts on. A client-side attempt counter is trivially bypassed by calling the GoTrue endpoint directly — shipping one would look like a control while providing none, which is worse than none.
- The real enforcement point for password-guessing at this architecture is **Supabase's own auth rate limiting**, which is project config, not code.

**Owner step (before public launch):**
1. Supabase Dashboard → Authentication → Rate Limits. Review/lower the **sign-in / token endpoint** limit (per IP, per hour) to a value that stops credential-stuffing while clearing real usage.
2. Confirm the **anonymous sign-in** and **token refresh** limits are also set.
3. **Verify:** from a throwaway IP, attempt the wrong password past the configured limit and confirm GoTrue starts returning 429. Our client already maps 429 → "Too many sign-in attempts. Please wait a moment and try again." (`LOGIN_ERROR_RATE_LIMITED`), so the user-facing half is already wired and will light up the moment the limit is enforced.

Only if the owner wants app-level lockout beyond what Supabase offers does this become loop work — and it would require moving sign-in to a server route that sets session cookies via `@supabase/ssr` (a real architectural change, not a small one). **Keep G4 unchecked until either this owner step is applied or that route is built.**

---

### `sharp` HIGH advisory in next/image's runtime image optimizer — unfixable at Next 16 (added 2026-07-24, Run 111, Track F/security)

Run 111 bumped Next.js 16.2.4 → 16.2.11, clearing all 21 HIGH advisories on the `next` package itself. Two HIGH advisories remain **inside next's own dependency subtree** and are **not resolvable at the Next 16 line** (npm's only `fixAvailable` is a downgrade to `next@9`, a non-viable major); both are pre-existing (lockfile pins identical before/after the bump):

- **`sharp@0.34.5`** — inherited libvips CVEs (HIGH). `sharp` is an **optional runtime dependency of next/image's image-optimization pipeline**, which this app actively uses (`next/image` with external `remotePatterns` on the room focus/mockups/setup pages) — i.e. this sits on the production image-serving path, NOT dev/build tooling. Flagged explicitly so it is not lost among the dev-tooling deferrals below.
- **`postcss@8.4.31`** — HIGH, vendored inside `next`'s own tree (separate from the app's `@tailwindcss/postcss`).

**Owner step (monitor, not headlessly buildable):** track the Next.js release notes; when a 16.2.x / 16.3.x patch re-pins `sharp`/`postcss` to non-vulnerable versions, bump `next` again. Until then there is no safe headless fix (forcing `sharp`/`postcss` outside next's declared range risks breaking image optimization / the build). Lower-urgency dev/build-tooling advisories also outstanding (`vite`, `ws`, `@babel/core`, `protobufjs`) — resolvable with `npm audit fix` but deferred as unattended-merge risk.

---

### Waitlist "30% off, no promo code required" discount — back the marketing promise (added 2026-07-22, Run 104, Track D/E)

The waitlist marketing copy makes a concrete launch commitment with **no backing mechanism**:
- `app/waitlist/page.tsx:33` — "Waitlist members get 30% off their first paid plan at launch. No promo code required."
- `app/waitlist/confirmed/page.tsx:64` — "...with your 30% early-access discount."

Nothing in code creates, assigns, or auto-applies a discount, and the launch email that would carry it is a manual send (`connect-email-resend` still open). If the owner does not wire this before launch, the promise becomes a **broken commitment** to every waitlist member. The mechanism is live billing config (Stripe coupon + auto-apply), which is human-only per the billing/secrets guardrail — the loop cannot build it headlessly.

**Owner step (before public launch / any waitlist outreach):**
1. Create a **30% off** coupon in Stripe (suggested id `EARLY30`), scoped to first paid plan; decide duration (`once` for subscriptions vs one-time Pro).
2. Make it apply **without a promo code** for waitlist members — either auto-apply the coupon at checkout for the waitlist cohort, or pre-attach it to their Stripe customer, so the "no promo code required" claim holds.
3. Wire the code/mechanism into the launch email (Email 4) send.
4. **Verify:** run a waitlist member through checkout in Stripe TEST mode and confirm 30% comes off the first charge with no code entered.

Alternative if the discount is dropped: remove the two copy lines above so the site makes no unbacked promise.

---

### Wire `npm run test:coverage` into the CI verify job (added 2026-07-02, Run 52 — PR #314, Track F2)

The vitest coverage floors were raised toward reality (25/19/30/25 → 40/30/42/40, ~10pt under the measured ≈50/39/54/51) so a genuine coverage regression now fails `npm run test:coverage`. **But nothing runs that command in CI** — the `verify` job (and `scripts/preflight.sh`) run bare `vitest run` (no `--coverage`), so a coverage drop is not yet gated on merge. The loop cannot edit `.github/`, so this is an owner step.

**Owner step:** add a coverage step to `.github/workflows/ci.yml` (either extend the `verify` job or add a small job):
```yaml
      - name: Coverage floors
        run: npm run test:coverage   # vitest run --coverage; fails if below vitest.config.ts thresholds
```
Keep it non-`RUN_EVALS` (the live-eval job already covers that path) so it stays deterministic and free.

**Verify:** open a throwaway PR that deletes a well-covered test file → the coverage step should go red on the lowered numbers; revert.

---

### Activation email cron + migration 025 (added 2026-06-28, Growth Agent Run 2)

The daily activation email cron fires A1 (T+1d), A2 (T+3d), and A3 (T+7d) to new users who have not yet started an analysis. Two owner steps are required to activate it:

**1. Apply migration 025** (`supabase/migrations/025_user_email_stages.sql`):
```sh
supabase db push
# or paste the file into Supabase SQL Editor
```
Creates `user_email_stages (user_id, stage UNIQUE)` — the idempotency table that prevents double-sends if the cron re-runs or Vercel retries.

**2. Set `CRON_SECRET`** in Vercel environment variables:
```sh
openssl rand -hex 32   # generates a secure secret
# paste the result as CRON_SECRET in Vercel → Settings → Environment Variables
```
Vercel automatically passes `Authorization: Bearer $CRON_SECRET` on cron invocations (see [Vercel Cron docs](https://vercel.com/docs/cron-jobs)). The endpoint returns 503 until the secret is set.

**Also required to actually send emails:** `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (see connect-email-resend item above). Without these, cron runs in dry-run: it logs what it *would* send but transmits nothing.

**Verify (after all three are set):**
1. Trigger the cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://aptdesignerai.com/api/cron/activation-emails`
2. Response: `{ "ok": true, "results": [{"stage":"activation_1",...},...] }`
3. Check Resend dashboard for a delivered email (or Vercel logs for dry-run output if RESEND_API_KEY not yet set).

---

### Cloudflare Turnstile — bot protection on public forms (added 2026-06-27, Run 35 — PR #141, Track G5)

The waitlist form now supports Cloudflare Turnstile but ships **inert** until the owner connects
Cloudflare. With neither key set, the widget renders nothing and the server fails open, so the
form is unchanged.

**To enable bot protection on the waitlist:**
1. Create a free Turnstile widget at https://dash.cloudflare.com → Turnstile. Add your production
   domain (and `localhost` for testing). Copy the **Site Key** and **Secret Key**.
2. Set on the deployment (Vercel → Environment Variables):
   ```
   TURNSTILE_SECRET_KEY=<secret-key>          # server-only — NEVER prefix with NEXT_PUBLIC_
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site-key>  # public widget key
   ```
   Set **both together** — a secret with no site key blocks all sign-ups (no token sent); a site
   key with no secret renders the widget but the server still fails open.
3. **Rebuild/redeploy** after setting `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — `NEXT_PUBLIC_*` values are
   inlined at build time, so the widget will not appear until a new build runs.
4. Verify: load `/waitlist` → the Turnstile widget renders → submit → a sign-up without solving the
   challenge is rejected (HTTP 400).

**Signup form (now loop-covered — Run 38, PR #169):** the signup page POSTs to the server route
`/api/auth/signup`, which verifies the Turnstile token, and the page now renders the `<Turnstile>`
widget (same closed-but-inert pattern as the waitlist). So there is **no separate owner step** for
signup beyond setting the same two keys above and redeploying — once `TURNSTILE_SECRET_KEY` +
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set, BOTH the waitlist and signup forms enforce the challenge.
Verify after deploy: load `/signup` → the widget renders → a sign-up without solving it is rejected.
(G5 is ticked in the ROADMAP: the code covers both forms; only the keys are owner-applied.)

### Growth-engine env vars (added 2026-06-27, Run 33 — PRs #117/#118/#120) — see docs/growth/CONNECT.md

The growth execution engine ships **closed by default**; set these on the deployment (Vercel → Environment Variables) to switch each capability live. None are committed.

| Env var | Capability | Effect until set |
|---------|-----------|------------------|
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Email lifecycle sending (E7.2) | Dry-run — emails logged, not sent |
| `GROWTH_EMAIL_DRY_RUN` | Email mode override (optional) | Unset = auto-live once key present |
| `INTERNAL_METRICS_TOKEN` | Growth-metrics pull API (E7.4) + social-queue API (E7.3) | Both endpoints return 503 (closed) |
| `DAILY_PAID_CALL_LIMIT` | Paid-API spend ceiling tune (G7, optional) | Defaults to 60/user/day |
| `X_API_KEY` / `INSTAGRAM_ACCESS_TOKEN` / `TIKTOK_ACCESS_TOKEN` / `REDDIT_CLIENT_ID` (+ each provider's secret set) | Social publishing per channel (E7.3) | That channel stays dry-run — queue flush reports `dryRun: true`, nothing posts publicly |
| `GROWTH_SOCIAL_DRY_RUN` | Social mode override (optional) | `1` forces dry-run on every channel regardless of credentials |

> **Note (E7.3, Run 34):** the social publishing queue ships the safe dry-run path only; the per-channel *live API client* is a follow-on build, so setting a channel credential prepares it but does not yet post publicly this release. See docs/growth/CONNECT.md Step 4.

Full step-by-step + verify commands: **docs/growth/CONNECT.md**.

### 021_stripe_customers_annual_tier.sql — extend tier CHECK constraint for pro_annual (added 2026-06-26, PR #98 — apply before enabling annual billing)

Migration 021 extends the `stripe_customers.tier` column's CHECK constraint to include `'pro_annual'`. Without this, the Stripe webhook handler fails with a Postgres constraint violation when recording an annual subscription, preventing the customer row from being written.

**Apply via:**
```sh
supabase db push
# or paste into Supabase SQL Editor:
# supabase/migrations/021_stripe_customers_annual_tier.sql
```

**What it does:**
```sql
ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS stripe_customers_tier_check;
ALTER TABLE stripe_customers ADD CONSTRAINT stripe_customers_tier_check
  CHECK (tier IN ('apartment', 'pro', 'pro_annual'));
```

**Also set the new env var** (Vercel + Stripe dashboard):
```
STRIPE_PRICE_ID_PRO_ANNUAL=<price_...>   # recurring yearly price of $399.00 USD
```
Create the price in Stripe dashboard → Products → "AptDesigner Pro" → Add pricing → Recurring yearly → $399.00 USD. Copy the resulting `price_...` ID into the env var.

**Verify:**
```sql
-- After applying migration:
SELECT tier FROM stripe_customers LIMIT 1;   -- should not fail
-- Test upsert with pro_annual tier in Stripe test mode
```

---

### Playwright E2E CI wiring (added 2026-06-25, PR #87 — wire before F4 gate can be ticked)

PR #87 adds `playwright.config.ts`, `e2e/public-pages.spec.ts`, and `e2e/a11y.spec.ts`. The E2E suite is ready to run but is not yet wired into CI (the loop cannot write `.github/workflows/`).

**Steps:**
1. Add a Playwright job to `.github/workflows/ci.yml` (or a new `e2e.yml`):
   ```yaml
   e2e:
     runs-on: ubuntu-latest
     env:
       PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
       PLAYWRIGHT_BASE_URL: "http://localhost:3000"
       CI: "true"
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: '20'
           cache: 'npm'
       - run: npm ci
       - run: npm run build
       - run: npx playwright test
   ```
   The pre-installed Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — `playwright.config.ts` already points there via `launchOptions.executablePath`. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` prevents re-downloading.
2. Add the job as a required check in GitHub repository settings (Settings → Branches → Branch protection → Require status checks → add `e2e`).

**Why it matters:** Without this, the axe-core accessibility scans and public-pages smoke tests never run in CI. F4 cannot be ticked until the gate actually executes and passes.

---

### Functional JOURNEY suite — CI wiring for the AUTHENTICATED tier (added 2026-06-27 — BUILDS ≠ WORKS gate)

`e2e/journeys.spec.ts` + `e2e/helpers/seed.ts` + `e2e/ROUTE_INVENTORY.md` + `scripts/run-journeys.sh`
add runtime, outcome-asserting journeys. The PUBLIC/STRUCTURAL tier runs with no backend (verified
green locally on the dedicated port 3100). The AUTHENTICATED tier (sign-in → **working populated
dashboard**, core-flow entry, paywall, account) self-seeds a confirmed user via the admin client and
needs a **real auth backend** — it SKIPS until one is provided. `scripts/preflight.sh` (GATE 1b) now
fails unless the journey suite RAN GREEN with the authed tier exercised — so this must be wired for
the readiness gate to ever pass. The loop cannot edit `.github/`.

**Steps:**
1. In the e2e CI job, stand up an ephemeral, FULLY-MIGRATED Supabase-local DB before the tests:
   ```yaml
   # in the e2e job, before `npx playwright test`:
   - run: npx supabase start            # Postgres + GoTrue auth + PostgREST (docker)
   - run: npx supabase db reset --yes   # applies ALL supabase/migrations (+ pgvector/pg_trgm)
   - run: npm run build
   - run: npm run start &               # serve the app against the local stack
     env:
       NEXT_PUBLIC_SUPABASE_URL: ${{ env.SUPABASE_LOCAL_URL }}
       NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ env.SUPABASE_LOCAL_ANON_KEY }}
       SUPABASE_SERVICE_ROLE_KEY: ${{ env.SUPABASE_LOCAL_SERVICE_ROLE_KEY }}
       GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY_TEST }}
   - run: bash scripts/run-journeys.sh  # fails red on any broken journey
     env:
       E2E_AUTH_STACK: "1"
       PLAYWRIGHT_BASE_URL: "http://localhost:3000"
       NEXT_PUBLIC_SUPABASE_URL: ${{ env.SUPABASE_LOCAL_URL }}
       SUPABASE_SERVICE_ROLE_KEY: ${{ env.SUPABASE_LOCAL_SERVICE_ROLE_KEY }}
   ```
   Local Supabase auto-confirms signups, so the seeded confirmed users sign in without an email link.
   Captcha/bot protection fails open without a key, so seeded signups work. For Stripe-dependent paywall
   assertions, set Stripe **test-mode** keys (`STRIPE_SECRET_KEY` test) so checkout entry renders.
2. Keep `e2e` a required check (already covered above).

**Manual-only — cannot run headlessly; verify by hand, never assume working:**
- Real **payment capture** on a live card (Stripe live mode) → entitlement unlock.
- **Email deliverability** (signup confirmation + lifecycle) to a real inbox.
- **Native/device store purchases** (StoreKit / RevenueCat **sandbox**) in the Expo app.
- **Push delivery** to a real device.
After the next deploy, manually confirm **signup → confirmation email → login → working dashboard** on
the deployed URL (guards against prod env/migration drift, e.g. migrations 022/023 not yet applied).

---

### 020_fix_saved_designs_rls_column_filter.sql — security: fix share-link RLS policy mismatch (added 2026-06-25, PR #84)

Migration 019 (not yet applied) and migration 020 (new this run) must be applied **together, in order**, on the same deployment:

```sh
# Apply both in one session — 019 first, then 020 immediately after.
psql $DATABASE_URL -f supabase/migrations/019_fix_saved_designs_rls.sql
psql $DATABASE_URL -f supabase/migrations/020_fix_saved_designs_rls_column_filter.sql
```

**Why two migrations?** Migration 019 drops the too-permissive policy from migration 015 and adds a JWT-claim policy. Migration 020 fixes a mismatch: the app (`app/api/shared/[token]/route.ts`) uses a PostgREST column filter (`.eq("share_token", token)`) — not a JWT claim — so the 019 policy returns 0 rows for every share link. Migration 020 replaces it with the correct column-filter policy: `USING (is_public = true AND share_token IS NOT NULL)`.

**Verify (run as anon role):**
```sql
-- Must return 0 rows (no token filter provided — enumeration blocked):
SELECT id FROM saved_designs WHERE is_public = true LIMIT 5;

-- Must return exactly 1 row for a valid token:
SELECT id FROM saved_designs WHERE share_token = '<valid-token>' AND is_public = true;
```

---

### 019_fix_saved_designs_rls.sql — security: require share_token in RLS policy (added 2026-06-25, PR #78)

⚠️ **Apply 019 together with 020 (see entry above).** Do not apply 019 alone — it uses the JWT-claim approach which breaks share links; 020 fixes it immediately after.

---

### RUN_EVALS=1 CI job — wire eval suite into GitHub Actions (added 2026-06-25, Track A5)

PR #73 adds three live eval test files (`evals/__tests__/diagnosis.eval.test.ts`, `sourcing.eval.test.ts`, `grounding.eval.test.ts`) that call the real Gemini pipeline when `RUN_EVALS=1` is set. The loop cannot write `.github/workflows/` (triggers the sensitive-file permission hook in headless runs), so this job must be wired manually.

**Steps:**
1. Add a new workflow file `.github/workflows/evals.yml` (or add a job to the existing `ci.yml`):
   ```yaml
   jobs:
     evals:
       runs-on: ubuntu-latest
       if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
       env:
         GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
         RUN_EVALS: "1"
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: '20'
             cache: 'npm'
         - run: npm ci
         - run: npx vitest run evals/__tests__/diagnosis.eval.test.ts evals/__tests__/sourcing.eval.test.ts evals/__tests__/grounding.eval.test.ts
           timeout-minutes: 15
   ```
2. Add `GEMINI_API_KEY` to GitHub Actions secrets (Settings → Secrets → New secret).
3. Schedule: `cron: '0 6 * * *'` (daily at 06:00 UTC) or run on `workflow_dispatch` for manual invocation.
4. A failure in this job means a pipeline regression — investigate before merging new model/prompt changes.

**Why it matters:** Without this job, the eval suite only runs locally when a developer manually sets `RUN_EVALS=1`. The loop cannot verify pipeline quality on merge without a live eval gate.

### iOS Universal Links — Apple App Site Association file (added 2026-06-24, PR #56 — apply before App Store submission)

PR #56 adds `ios.associatedDomains: ["applinks:aptdesignerai.com"]` to `app.json`. iOS Universal Links require a signed AASA file hosted at a specific path.

**Steps:**
1. Create the file `public/.well-known/apple-app-site-association` in your web deployment (or serve it directly) with:
   ```json
   {
     "applinks": {
       "apps": [],
       "details": [
         {
           "appID": "<TEAM_ID>.ai.aptdesigner.app",
           "paths": ["/saved/*", "/results/*", "/shared/*"]
         }
       ]
     }
   }
   ```
   Replace `<TEAM_ID>` with your 10-character Apple Developer Team ID (found in Xcode → Signing & Capabilities or developer.apple.com/account).
2. The file must be served at `https://aptdesignerai.com/.well-known/apple-app-site-association` with `Content-Type: application/json` (no `.json` extension in the URL).
3. After EAS build: test by tapping an `https://aptdesignerai.com/saved/...` link on a physical iPhone — it should open the app rather than Safari.

Note: Only link paths listed in `paths` will open the app. The list above restricts to in-app routes; it does NOT hijack marketing/landing pages.

### EAS project ID for push token registration (added 2026-06-24, PR #56 — set before production EAS build)

`use-push-notifications.ts` resolves the EAS project ID via `Constants.expoConfig?.extra?.eas?.projectId`. Without it, `getExpoPushTokenAsync` uses a development fallback that may not work in standalone builds.

**Steps (UPDATED Run 36, PR #149 — now env-driven, no hardcoding):**
1. Create an EAS project at https://expo.dev if you haven't already:
   ```bash
   cd mobile && npx eas init
   ```
   (`eas init` writes the id into the config; the dynamic `mobile/app.config.ts` will pick it up.)
2. **Preferred:** set `EAS_PROJECT_ID=<your-eas-project-id>` rather than hardcoding it.
   `mobile/app.config.ts` (added PR #149) overlays `app.json` and reads
   `extra.eas.projectId` from `process.env.EAS_PROJECT_ID`. Set it in:
   - `mobile/.env.local` (gitignored) for local dev, and
   - EAS environment variables for CI/cloud builds.
   No need to edit `app.json` — keep the project id out of the committed config.

Verify: build a standalone app → install on a physical device → launch → accept notification permission → check AsyncStorage `expoPushToken` key contains a valid `ExponentPushToken[...]` string.

**EAS build/submit config (added Run 36, PR #149):** `mobile/eas.json` now defines
development/preview/production build profiles and preview/production submit profiles.
For `eas submit`, set these EAS environment variables (referenced as `$EXPO_*` in eas.json,
so no Apple creds are committed): `EXPO_APPLE_ID`, `EXPO_ASC_APP_ID` (App Store Connect app id),
`EXPO_APPLE_TEAM_ID`. Android submit uses the production track — supply the Play service-account
key via EAS (`serviceAccountKeyPath` or the EAS-stored credential). The actual `eas build` +
`eas submit` + TestFlight remain human steps (require the Apple/Google accounts + signing).

**App Store Connect privacy "nutrition label" (owner, at submission — added Run 89):** the iOS
privacy MANIFEST (`ios.privacyManifests` in `mobile/app.json`) is now in code — it declares
required-reason API usage (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1,
DiskSpace E174.1) and `NSPrivacyTracking:false`, closing the ITMS-91053 rejection vector. This is
NECESSARY but NOT sufficient: App Store Connect ALSO requires the app's own data-collection
disclosure (the privacy "nutrition label" questionnaire) to be completed in the ASC UI at
submission — the app collects room PHOTOS and account data (email) via Supabase, used for app
functionality, not linked to identity for tracking, not used for tracking. `NSPrivacyCollectedDataTypes`
is intentionally left `[]` in the manifest (that field is for third-party-SDK self-declaration; the
app's first-party collection is declared in the ASC questionnaire). Fill this in when submitting.

### Future: server-side push token storage (added 2026-06-24, PR #56 — implement when re-engagement sends are needed)

PR #56 stores the Expo push token in AsyncStorage only. For server-initiated re-engagement sends (e.g., "your design is ready" notifications), the token needs to be synced to Supabase.

**When ready to implement:**
1. Add `supabase/migrations/019_device_push_tokens.sql`:
   ```sql
   CREATE TABLE device_push_tokens (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     token text NOT NULL,
     platform text NOT NULL CHECK (platform IN ('ios', 'android')),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE(user_id, token)
   );
   ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users manage own tokens" ON device_push_tokens
     FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
   ```
2. Add `POST /api/mobile/push-token` endpoint that upserts the token (Bearer JWT auth, same pattern as `/api/mobile/saved-designs`).
3. Call the endpoint from `registerForPushNotificationsAsync` after `AsyncStorage.setItem`.

This is a future integration — the current AsyncStorage storage means the token survives app reinstalls and is available when the server-side integration is built.

### Stripe web billing — secrets + webhook + Price IDs (added 2026-06-24, PR #50; updated Run 29 — add Pro Annual)

PR #50 (C1 Stripe web billing) requires the following before live purchases work.

**Vercel env vars (Production + Preview):**
```
STRIPE_SECRET_KEY=<sk_live_...>
STRIPE_WEBHOOK_SECRET=<whsec_...>
STRIPE_PRICE_ID_APARTMENT=<price_...>     # one-time $29 product
STRIPE_PRICE_ID_PRO_MONTHLY=<price_...>  # recurring $49/month product
STRIPE_PRICE_ID_PRO_ANNUAL=<price_...>   # recurring $399/year product (added Run 29)
```

**Stripe dashboard steps:**
1. Create three Products in the Stripe dashboard:
   - "AptDesigner Apartment" — one-time price of $29.00 USD
   - "AptDesigner Pro" — recurring monthly price of $49.00 USD
   - "AptDesigner Pro Annual" — recurring yearly price of $399.00 USD
2. Copy the Price IDs (starting with `price_`) into the env vars above.
3. Register the webhook endpoint:
   - Go to Stripe → Developers → Webhooks → Add endpoint
   - URL: `https://<your-vercel-url>/api/billing/webhook`
   - Events to send: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

**Supabase migration — apply migration 018:**
```
supabase db push
```
This creates the `stripe_customers` table with RLS (file: `supabase/migrations/018_stripe_customers.sql`).

Verify:
1. Hit `/billing/upgrade?tier=apartment` — page renders with $29 price
2. POST `/api/billing/checkout` with valid auth → returns `{ sessionId, url }` pointing to Stripe
3. Complete a test purchase in Stripe test mode → stripe_customers row appears in Supabase
4. GET `/api/mobile/entitlements` (web user) → `{ tier: "apartment" }` for the buyer

Note: `hasProEntitlementWeb()` gates the web saved-design limit, and the Pro-only
generation widening is wired via `hasProSubscriptionWeb()` (Run 114) — that one
requires tier `pro`/`pro_annual` specifically, since `hasProEntitlementWeb()`
also returns true for this one-time Apartment purchase. The per-user DAILY
paid-call ceiling is still tier-blind; see issue #699.

### RevenueCat keys — mobile + server (added 2026-06-24, PRs #42 + #43 — set before EAS build and before production Vercel deploy)

PR #42 (C2/C3 RevenueCat mobile SDK) and PR #43 (C4 server-side entitlement check) require two separate keys.

**Mobile (EAS / local dev):** Add to `mobile/.env.local` (gitignored) and to EAS environment variables:
```
EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY=<your-rc-public-sdk-key>
```
- Find this in your RevenueCat dashboard → Project → API Keys → Public SDK keys → iOS / Android key.
- When absent: the paywall UI shows (hardcoded prices) but purchases and restore are no-ops. `isPro` is always false. Graceful degradation — safe for local dev.
- When present: live Offerings are fetched, real purchases go through the App Store / Play Store.

**Server (Vercel env vars):** Add to Vercel project environment variables (Production + Preview):
```
REVENUECAT_SECRET_KEY=<your-rc-secret-key>
```
- Find this in your RevenueCat dashboard → Project → API Keys → Secret API keys.
- This is a server-only key — **never use EXPO_PUBLIC_ prefix** or it leaks to the client bundle.
- When absent: `hasProEntitlement()` logs a console.error and returns `true` (fail-open) — free-tier save limit is not enforced. Fix by setting the key.
- When present: save limit is enforced for non-Pro users (FREE_SAVE_LIMIT = 3).

Verify:
1. Mobile: build with key set → "Start Free Trial" reaches the OS purchase dialog
2. Server: Pro subscriber with ≥3 saves → POST `/api/mobile/saved-designs` succeeds (HTTP 201)
3. Server: Free user with ≥3 saves → POST returns HTTP 403 `{ subscription_required: true }`

### Mobile env vars — Supabase + API URL (added 2026-06-24, updated PR #32 — set before EAS build or local dev on device)
PR #28 (B2 mobile auth) and PR #32 (B2 photo upload + AI analysis) require these env vars.
Create `mobile/.env.local` (gitignored) with:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
EXPO_PUBLIC_API_URL=https://<your-vercel-deployment-url>
```

For EAS Build: add these as EAS environment variables in your EAS project dashboard
(https://expo.dev/accounts/<user>/projects/aptdesignerai/environment-variables).
Use the same values as your Supabase project (same project as the web app).
`EXPO_PUBLIC_API_URL` should point to your Vercel deployment (e.g. `https://aptdesignerai.vercel.app`).

Verify: launch the mobile app → login screen should appear → select a photo → choose room type → analysis runs and shows real AI results.

### Supabase Storage bucket: room-photos (added 2026-06-24 — create before testing mobile upload)
PR #32 uploads mobile photos to a `room-photos` Supabase Storage bucket. Create it if it does not exist:

1. Go to your Supabase project dashboard → Storage → New bucket
2. Name: `room-photos`
3. Public: **Yes** (images are fetched by Gemini via their public URL)
4. Add an RLS INSERT policy so authenticated users can upload:
   ```sql
   -- Allow authenticated users to upload to their own folder
   CREATE POLICY "Authenticated users can upload room photos"
   ON storage.objects FOR INSERT
   TO authenticated
   WITH CHECK (bucket_id = 'room-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
   ```
5. Verify: upload a test image from the mobile app → confirm it appears in the bucket under `<user-id>/<timestamp>.jpg`

### 017_waitlist.sql (added 2026-06-24 — apply when PR #22 merges)
Creates the `waitlist_emails` table (email capture for iOS/Android waitlist). RLS enabled with NO policy — service-role only.

```sql
-- Already in supabase/migrations/017_waitlist.sql
-- Apply via: supabase db push
-- Verify: \d waitlist_emails  →  id, email (UNIQUE), source, created_at
--         SELECT count(*) FROM pg_policies WHERE tablename = 'waitlist_emails';  →  0 (correct)
```

## Applied

### 2026-06-24 — applied to production via `supabase db push`
- ✅ `supabase/migrations/015_saved_designs_sharing.sql` — `share_token` / `is_public`
  columns + unique index + public-read policy on `saved_designs` (share-links feature).
- ✅ `supabase/migrations/016_rls_computer_use_tables.sql` — enabled RLS (no policy) on
  `computer_use_verified_products` and `computer_use_agent_logs`, closing the anon-key
  exposure ("RLS Disabled in Public"). **Security Advisor confirmed clean.**

## Production notes (for context — not action items)
- The app is deployed on **Vercel**; production branch = `claude/ai-apartment-design-app-iHAdb`
  (the loop's default branch), so **every auto-merged PR deploys live**. CI gates
  `verify` + `build` + `mobile` are all required, so a broken build cannot ship.
- Production env vars are configured in Vercel project settings (not in the repo).
- Future migrations / live secrets / billing keys go under **Pending** above as they
  arise; apply them at the next deploy and move them to **Applied**.
