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
if npx playwright test "$SPEC"; then
  echo "E2E_JOURNEYS_PASSED=1"
  exit 0
fi
echo "E2E_JOURNEYS_PASSED=0 (journey suite failed — a flow builds but does not work)"
exit 1
