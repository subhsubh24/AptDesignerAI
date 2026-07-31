#!/usr/bin/env bash
# scripts/run-journeys.sh
#
# Runs the runtime functional JOURNEY suite (e2e/journeys.spec.ts) and emits the
# readiness marker `E2E_JOURNEYS_PASSED=1` on green. This is the mechanism behind
# the BUILDS != WORKS guard: a green build must NOT reach "ready" until the real
# user journeys have ACTUALLY RUN against a running app and asserted their
# intended outcomes.
#
# Modes:
#   bash scripts/run-journeys.sh                 full — requires E2E_AUTH_STACK=1
#                                                + Supabase service-role env so the
#                                                AUTHENTICATED journeys actually run.
#   bash scripts/run-journeys.sh --public-only   always-on subset only (local proof
#                                                that the runner executes; authed
#                                                journeys are skipped). Needs no
#                                                credentials — a placeholder
#                                                Supabase identity is supplied
#                                                when none is set (see below).
#
# Exit: 0 + "E2E_JOURNEYS_PASSED=1" on green; non-zero otherwise.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="${1:-full}"
SPEC="e2e/journeys.spec.ts"

[ -f "$SPEC" ] || { echo "run-journeys: $SPEC missing"; exit 1; }
[ -f "e2e/ROUTE_INVENTORY.md" ] || { echo "run-journeys: e2e/ROUTE_INVENTORY.md missing"; exit 1; }

# --public-only advertises itself as the always-on subset that proves the runner
# executes locally. It could not: with NO Supabase env, lib/supabase/middleware.ts
# takes its documented "no Supabase configured — bypass auth entirely (local dev
# mode)" branch, which serves protected routes to logged-out visitors and 307s
# /login + /signup to /dashboard. The public tier's OWN assertions are then
# structurally unsatisfiable — "protected route bounces a logged-out visitor",
# "login page renders the real form", "signup page renders the real form" all
# fail — and the runner reports E2E_JOURNEYS_PASSED=0, i.e. a FALSE RED that
# reads exactly like a product regression.
#
# So supply the same placeholder Supabase identity the CI `build` job uses. It
# turns the real auth path ON while resolving to nothing, which is precisely the
# logged-out state this tier asserts about. Only defaulted when the caller set
# neither var, so a real local stack always wins.
#
# Scoped to --public-only ON PURPOSE. The full mode must keep failing loudly
# without real credentials — preflight GATE 1b runs THAT mode, and defaulting
# there would let a placeholder identity masquerade as an exercised auth stack.
if [ "$MODE" = "--public-only" ] && [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && [ -z "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then
  # Byte-for-byte the pair the CI `build` job sets (.github/workflows/ci.yml).
  export NEXT_PUBLIC_SUPABASE_URL="https://placeholder.supabase.co"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder"
  echo "run-journeys: no Supabase env set — using the placeholder identity so the auth"
  echo "  path is ON and the logged-out assertions are meaningful. (Without it the"
  echo "  middleware bypasses auth entirely and this tier fails for config reasons.)"
fi

if [ "$MODE" != "--public-only" ] && [ -z "${E2E_AUTH_STACK:-}" ]; then
  echo "run-journeys: E2E_AUTH_STACK not set — the AUTHENTICATED journeys (sign-in →"
  echo "  working dashboard, core flow, paywall, account) would be SKIPPED. Readiness"
  echo "  requires them to actually RUN: stand up the seeded Supabase-local auth backend,"
  echo "  set service-role env + E2E_AUTH_STACK=1, then re-run. (Use --public-only to prove"
  echo "  the runner executes locally without an auth backend.)"
  exit 2
fi

echo "run-journeys: running $SPEC (mode=$MODE)..."
# --workers=1 is a REQUIREMENT, not a tuning choice, and this is the only place
# it can be enforced: both CI and the documented local regeneration command go
# through this script, while playwright.config.ts sets `workers: CI ? 2 :
# undefined` (i.e. parallel in both).
#
# e2e/__screenshots__/README.md already states it ("`--workers=1` is not a
# preference"), because a run at two workers produced a BLANK 4.7KB /login
# capture — the page shot mid-paint — while every DOM assertion in that test
# passed. Three serial re-runs reproduced the real 471KB screen byte-for-byte.
# Until now that requirement lived only in prose, so the runner the README tells
# you to invoke did the exact thing the README forbids.
#
# The pixel guard in __tests__/design/screenshot-manifest.test.ts is the
# backstop, not the remedy: it can only reject a blank artifact after one is
# produced, and it only ever sees COMMITTED files.
#
# COST, measured rather than assumed: the public tier ran 1.4m at the default
# worker count and 1.1m at --workers=1 on a cold cache (same container, same
# 16 tests). Serial is not the slower option here — parallel workers contend for
# the same dev server and the same CPU. Expect that margin to narrow, not invert,
# as the authed tier grows; the requirement stands either way, because a capture
# of a half-painted page is worth less than the minute it saves.
if npx playwright test "$SPEC" --workers=1; then
  echo "E2E_JOURNEYS_PASSED=1"
  exit 0
fi
echo "E2E_JOURNEYS_PASSED=0 (journey suite failed — a flow builds but does not work)"
exit 1
