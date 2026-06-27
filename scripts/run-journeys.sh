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
#                                                journeys are skipped).
#
# Exit: 0 + "E2E_JOURNEYS_PASSED=1" on green; non-zero otherwise.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="${1:-full}"
SPEC="e2e/journeys.spec.ts"

[ -f "$SPEC" ] || { echo "run-journeys: $SPEC missing"; exit 1; }
[ -f "e2e/ROUTE_INVENTORY.md" ] || { echo "run-journeys: e2e/ROUTE_INVENTORY.md missing"; exit 1; }

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
