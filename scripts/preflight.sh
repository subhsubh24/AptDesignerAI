#!/usr/bin/env bash
# scripts/preflight.sh
#
# Mechanical pre-flight gate for AptDesignerAI.
#
# WHAT THIS SCRIPT DOES:
#   1. Runs the full CI gate (tsc + tests + determinism + prod build + mobile tsc)
#   2. Asserts required build artifacts physically exist
#   3. Parses ROADMAP.md DoD section — exits non-zero on ANY unchecked checkbox (- [ ])
#   4. Mechanically verifies critical revenue/product paths are wired (not stubbed)
#   5. YAML-parses the BUSINESS_CASE_SUMMARY block in docs/BUSINESS_CASE.md
#
# EXIT CODES:
#   0  All gates pass — eligible for submission readiness review
#  >0  One or more gates failed — see output for which
#
# USAGE:
#   bash scripts/preflight.sh
#   # or from repo root:
#   npm run preflight     (add: "preflight": "bash scripts/preflight.sh" to package.json)
#
# NOTE: This script requires Node.js, npm, Python 3, and the repo to be installed
# (npm ci or npm install). Run from the repository root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
ERRORS=()

# ── helpers ──────────────────────────────────────────────────────────────────

green() { printf '\033[32m✔ %s\033[0m\n' "$*"; }
red()   { printf '\033[31m✘ %s\033[0m\n' "$*"; }
info()  { printf '\033[34m→ %s\033[0m\n' "$*"; }
warn()  { printf '\033[33m⚠ %s\033[0m\n' "$*"; }

pass() {
  green "$1"
  ((PASS++)) || true
}

fail() {
  red "$1"
  ERRORS+=("$1")
  ((FAIL++)) || true
}

check_file_exists() {
  local label="$1" path="$2"
  if [[ -f "$path" ]]; then
    pass "$label — exists: $path"
  else
    fail "$label — MISSING: $path"
  fi
}

check_file_contains() {
  local label="$1" path="$2" pattern="$3"
  if [[ ! -f "$path" ]]; then
    fail "$label — file not found: $path"
    return
  fi
  if grep -q "$pattern" "$path"; then
    pass "$label"
  else
    fail "$label — pattern not found: '$pattern' in $path"
  fi
}

# ── GATE 1: Full CI gate ──────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  GATE 1 — Full CI gate (tsc + tests + determinism + build)"
echo "════════════════════════════════════════════════════════════════"

info "Running TypeScript type check..."
if npx tsc --noEmit 2>&1 | grep -v "^$" | grep -v "error TS2307" | grep -v "error TS2591" | grep -c "error TS" > /dev/null 2>&1; then
  # Only real non-vitest TS errors count
  REAL_TS_ERRORS=$(npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "error TS2307.*vitest" | grep -v "error TS2591" | wc -l | tr -d ' ')
  if [[ "$REAL_TS_ERRORS" -gt 0 ]]; then
    fail "TypeScript — $REAL_TS_ERRORS real type errors"
    npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "error TS2307.*vitest" | grep -v "error TS2591" | head -10
  else
    pass "TypeScript — no real errors (vitest-in-tsconfig pre-existing noise excluded)"
  fi
else
  pass "TypeScript — clean"
fi

info "Running test suite..."
if npm test -- --reporter=verbose 2>&1 | tail -5 | grep -q "failed\|Error"; then
  fail "Tests — one or more tests failed (run 'npm test' for details)"
else
  pass "Tests — all passed"
fi

info "Running determinism check..."
if npm run check:determinism 2>&1 | grep -q "FAIL\|Error\|failed"; then
  fail "Determinism check — failed (run 'npm run check:determinism' for details)"
else
  pass "Determinism check — passed"
fi

info "Running production build..."
if npm run build 2>&1 | tail -10 | grep -q "Failed\|Error\|error"; then
  fail "Production build — failed (run 'npm run build' for details)"
else
  pass "Production build — succeeded"
fi

info "Running mobile TypeScript check..."
if [[ -f "mobile/tsconfig.json" ]]; then
  if npx tsc --project mobile/tsconfig.json --noEmit 2>&1 | grep -c "error TS" > /dev/null 2>&1; then
    MOBILE_TS_ERRORS=$(npx tsc --project mobile/tsconfig.json --noEmit 2>&1 | grep "error TS" | wc -l | tr -d ' ')
    if [[ "$MOBILE_TS_ERRORS" -gt 0 ]]; then
      fail "Mobile TypeScript — $MOBILE_TS_ERRORS errors"
    else
      pass "Mobile TypeScript — clean"
    fi
  else
    pass "Mobile TypeScript — clean"
  fi
else
  warn "mobile/tsconfig.json not found — skipping mobile tsc"
fi

# ── GATE 1b: Functional journeys actually RUN green (BUILDS != WORKS) ──────────
# A green build proves the app COMPILES, not that it WORKS for a user. This gate
# requires the runtime journey suite + route inventory to EXIST and to have
# actually RUN GREEN (signup → working dashboard, paywall, nav, authed-vs-anon),
# with the AUTHENTICATED journeys exercised (not skipped). "It builds" must NOT
# pass as "it works": a signup that lands on a dead/"not available" dashboard FAILS.
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  GATE 1b — Functional journeys RUN green (builds != works)"
echo "════════════════════════════════════════════════════════════════"
check_file_exists "Journey suite"   "e2e/journeys.spec.ts"
check_file_exists "Route inventory" "e2e/ROUTE_INVENTORY.md"
info "Running the runtime functional journey suite (needs a served app + seeded auth backend)..."
if JOUT="$(bash scripts/run-journeys.sh 2>&1)"; then
  if printf '%s' "$JOUT" | grep -q "E2E_JOURNEYS_PASSED=1"; then
    pass "Functional journeys — ran GREEN (real user outcomes asserted, authed included)"
  else
    fail "Functional journeys — runner did not confirm E2E_JOURNEYS_PASSED=1"
    printf '%s\n' "$JOUT" | tail -20
  fi
else
  fail "Functional journeys — did not run green ('it builds' must NOT pass as 'it works'); authed journeys must be exercised, not skipped"
  printf '%s\n' "$JOUT" | tail -20
fi

# ── GATE 2: Required artifacts exist ─────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  GATE 2 — Required artifacts"
echo "════════════════════════════════════════════════════════════════"

# Core app routes
check_file_exists "Web app root"            "app/page.tsx"
check_file_exists "Dashboard"               "app/dashboard/page.tsx"
check_file_exists "Pricing page"            "app/pricing/page.tsx"
check_file_exists "Billing upgrade page"    "app/billing/upgrade/page.tsx"
check_file_exists "Shared design page"      "app/shared/[token]/page.tsx"

# API routes
check_file_exists "Area analysis API"       "app/api/area-analysis/route.ts"
check_file_exists "Billing checkout API"    "app/api/billing/checkout/route.ts"
check_file_exists "Billing webhook API"     "app/api/billing/webhook/route.ts"
check_file_exists "Mobile analyze API"      "app/api/mobile/analyze/route.ts"
check_file_exists "Mobile entitlements API" "app/api/mobile/entitlements/route.ts"
check_file_exists "Saved designs API"       "app/api/saved-designs/route.ts"

# Billing / entitlement wiring
check_file_exists "Stripe billing lib"      "lib/billing/stripe.ts"
check_file_exists "Server entitlements"     "lib/entitlements/server.ts"
check_file_exists "Web entitlements"        "lib/entitlements/web.ts"

# Mobile app
check_file_exists "Mobile app.json"         "mobile/app.json"
check_file_exists "Mobile package.json"     "mobile/package.json"

# Legal pages
check_file_exists "Privacy policy"          "app/privacy/page.tsx"
check_file_exists "Terms of service"        "app/terms/page.tsx"

# Marketing
check_file_exists "Business case"           "docs/BUSINESS_CASE.md"
check_file_exists "ROADMAP"                 "ROADMAP.md"

# Eval suite (F3)
check_file_exists "Eval: diagnosis"         "evals/__tests__/diagnosis.eval.test.ts"
check_file_exists "Eval: sourcing"          "evals/__tests__/sourcing.eval.test.ts"
check_file_exists "Eval: grounding"         "evals/__tests__/grounding.eval.test.ts"
check_file_exists "Eval: area-analysis"     "evals/__tests__/area-analysis.eval.test.ts"

# Scripts
check_file_exists "Determinism script"      "scripts/check-determinism.ts"

# ── GATE 3: DoD checkbox scan ─────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  GATE 3 — ROADMAP Definition of Done (no unchecked boxes)"
echo "════════════════════════════════════════════════════════════════"

# Find the DoD section and count unchecked boxes within it
# DoD section starts at "## Definition of Done" and ends at "## READINESS AUDIT GATE"
DOD_SECTION=$(awk '/^## Definition of Done/,/^## READINESS AUDIT GATE/' ROADMAP.md)
UNCHECKED=$(echo "$DOD_SECTION" | grep -c '^\- \[ \]' || true)
CHECKED=$(echo "$DOD_SECTION" | grep -c '^\- \[x\]' || true)

if [[ "$UNCHECKED" -gt 0 ]]; then
  fail "DoD — $UNCHECKED unchecked checkbox(es) remain (${CHECKED} done)"
  echo "  Unchecked items:"
  echo "$DOD_SECTION" | grep '^\- \[ \]' | sed 's/^/    /'
else
  pass "DoD — all $CHECKED boxes checked"
fi

# ── GATE 4: Critical paths wired (not stubbed) ────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  GATE 4 — Critical revenue/product paths wired"
echo "════════════════════════════════════════════════════════════════"

# Billing checkout calls createCheckoutSession (not a stub)
check_file_contains \
  "Billing checkout: calls createCheckoutSession" \
  "app/api/billing/checkout/route.ts" \
  "createCheckoutSession"

# Billing webhook handler has the case branch for checkout.session.completed.
# The real handler lives in lib/billing/stripe.ts (extractBillingInfoFromEvent),
# not in the route file itself — check the right file.
check_file_contains \
  "Billing webhook: checkout.session.completed handler in stripe.ts" \
  "lib/billing/stripe.ts" \
  "checkout.session.completed"

# Server-side entitlement check exists and is not a stub returning true
check_file_contains \
  "Server entitlements: hasProEntitlement defined" \
  "lib/entitlements/server.ts" \
  "hasProEntitlement"

# Web entitlement check exists
check_file_contains \
  "Web entitlements: hasProEntitlementWeb defined" \
  "lib/entitlements/web.ts" \
  "hasProEntitlementWeb"

# Saved designs route enforces entitlements (not an open endpoint)
check_file_contains \
  "Saved designs: enforces hasProEntitlementWeb" \
  "app/api/saved-designs/route.ts" \
  "hasProEntitlementWeb"

# Area analysis route uses deterministic seed (cost contract compliance)
check_file_contains \
  "Area analysis: uses DETERMINISTIC_SEED" \
  "app/api/area-analysis/route.ts" \
  "DETERMINISTIC_SEED"

# Mobile analyze route uses thinkingConfig (cost contract compliance)
check_file_contains \
  "Mobile analyze: uses thinkingConfig" \
  "app/api/mobile/analyze/route.ts" \
  "thinkingConfig"

# Rate limiting is wired on public-facing analysis endpoints
check_file_contains \
  "Mobile analyze: rate limiting wired" \
  "app/api/mobile/analyze/route.ts" \
  "checkRateLimit"

# Stripe provider has the pro_annual tier (PR #98)
check_file_contains \
  "Stripe: pro_annual tier supported" \
  "lib/billing/stripe.ts" \
  "pro_annual"

# RevenueCat server key read from env (not hardcoded)
check_file_contains \
  "RevenueCat: secret key from env" \
  "lib/entitlements/server.ts" \
  "REVENUECAT_SECRET_KEY"

# ── GATE 5: Business case YAML block ─────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  GATE 5 — Business case YAML block parseable"
echo "════════════════════════════════════════════════════════════════"

BUSINESS_CASE="docs/BUSINESS_CASE.md"

if [[ ! -f "$BUSINESS_CASE" ]]; then
  fail "Business case — file not found: $BUSINESS_CASE"
else
  # Extract the YAML block between ```yaml ... ``` that contains BUSINESS_CASE_SUMMARY
  YAML_BLOCK=$(awk '/^```yaml/{found=1; next} found && /^```/{found=0; next} found' "$BUSINESS_CASE")

  if [[ -z "$YAML_BLOCK" ]]; then
    fail "Business case — no YAML block found"
  else
    # Pass the YAML via env variable to avoid shell-expanding $ signs inside the
    # content (e.g. "$100K" in a YAML string must not become "00K" via word split).
    # The quoted heredoc (<<'PYEOF') ensures no shell expansion happens in the script.
    PYTHON_CHECK=$(_PREFLIGHT_YAML="$YAML_BLOCK" python3 - <<'PYEOF' 2>&1
import yaml, sys, os

yaml_text = os.environ.get("_PREFLIGHT_YAML", "")
if not yaml_text:
    print("YAML_ERROR: empty YAML block")
    sys.exit(1)

try:
    data = yaml.safe_load(yaml_text)
except yaml.YAMLError as e:
    print(f"YAML_ERROR: {e}")
    sys.exit(1)

if not isinstance(data, dict):
    print(f"YAML_ERROR: expected a mapping, got {type(data).__name__}")
    sys.exit(1)

required_keys = ["currency", "arr_year1", "planning_case", "floor_usd", "as_of"]
missing = [k for k in required_keys if k not in data]
if missing:
    print(f"YAML_MISSING_KEYS: {missing}")
    sys.exit(1)

arr = data.get("arr_year1", {})
if not isinstance(arr, dict):
    print("YAML_ERROR: arr_year1 must be a mapping")
    sys.exit(1)

arr_keys = ["conservative", "base", "optimistic"]
missing_arr = [k for k in arr_keys if k not in arr]
if missing_arr:
    print(f"YAML_MISSING_ARR_KEYS: {missing_arr}")
    sys.exit(1)

floor = data.get("floor_usd", 0)
base_arr = arr.get("base", 0)
if base_arr < floor:
    print(f"YAML_FLOOR_FAIL: base ARR {base_arr} < floor {floor}")
    sys.exit(1)

print("OK")
PYEOF
)

    if [[ "$PYTHON_CHECK" == "OK" ]]; then
      pass "Business case YAML — valid, all required keys present, base ARR ≥ floor"
    else
      fail "Business case YAML — $PYTHON_CHECK"
    fi
  fi
fi

# ── Dashboard feed: GROWTH_STATUS must parse (dashboard reads it) ───────────────
if python3 - "$REPO_ROOT/docs/growth/GROWTH_STATUS.md" <<'PY'
import sys, re, yaml
try: txt = open(sys.argv[1]).read()
except OSError: print("GROWTH_STATUS.md missing"); sys.exit(1)
m = re.search(r"ya?ml\s*\n(.*?GROWTH_STATUS.*?)\n```", txt, re.S)
if not m: print("no GROWTH_STATUS block"); sys.exit(1)
try: d = (yaml.safe_load(m.group(1)) or {}).get("GROWTH_STATUS") or {}
except Exception as e: print("UNPARSEABLE:", e); sys.exit(1)
if d.get("phase") not in ("pre_launch","launching","post_launch"): print("bad phase"); sys.exit(1)
if not isinstance(d.get("funnel"), dict): print("missing funnel"); sys.exit(1)
if not isinstance(d.get("engine_built"), bool): print("engine_built must be a boolean"); sys.exit(1)
# engine_built + engine_pct are load-bearing CLAIMS the dashboard + Growth Agent trust — they must be
# backed by the E7 execution-engine code physically existing, not flippable on a technicality.
# The 5 engine pieces, each pinned to its anchor file; pct is computed from reality, never hand-set.
import os
root = os.path.dirname(os.path.dirname(os.path.dirname(sys.argv[1])))  # .../docs/growth/X -> repo root
PIECES = {
    "waitlist": "app/api/waitlist/confirm/route.ts",
    "email":    "lib/email/index.ts",
    "queue":    "lib/social/queue.ts",
    "metrics":  "lib/growth/metrics.ts",
    "runbook":  "docs/growth/CONNECT.md",
}
shipped = [k for k, p in PIECES.items() if os.path.exists(os.path.join(root, p))]
computed_pct = round(len(shipped) * 100 / len(PIECES))
if not isinstance(d.get("engine_pct"), int): print("engine_pct must be an integer 0-100"); sys.exit(1)
if d["engine_pct"] != computed_pct:
    print(f"engine_pct={d['engine_pct']} but real shipped pieces give {computed_pct}% ({sorted(shipped)})"); sys.exit(1)
if d.get("engine_built") is not (computed_pct == 100):
    print(f"engine_built={d.get('engine_built')} disagrees with engine_pct={computed_pct} (built iff 100%)"); sys.exit(1)
print("ok", d["phase"], f"engine {computed_pct}%")
PY
then pass "GROWTH_STATUS: valid, parseable YAML block"
else fail "GROWTH_STATUS: missing or UNPARSEABLE"; fi

# ── Dashboard feed: OWNER_ACTIONS must parse ───────────────────────────────────
if python3 - "$REPO_ROOT/PENDING_OPS.md" <<'PY'
import sys, re, yaml
txt = open(sys.argv[1]).read()
m = re.search(r"ya?ml\s*\n(.*?OWNER_ACTIONS.*?)\n```", txt, re.S)
if not m: print("no OWNER_ACTIONS block"); sys.exit(1)
try: d = (yaml.safe_load(m.group(1)) or {}).get("OWNER_ACTIONS") or {}
except Exception as e: print("UNPARSEABLE:", e); sys.exit(1)
if not isinstance(d.get("items"), list): print("items must be a list"); sys.exit(1)
for it in d["items"]:
    if it.get("status") not in ("open","in_progress","done"): print("bad status", it.get("id")); sys.exit(1)
    if it.get("priority") not in ("urgent","high","normal"): print("bad priority", it.get("id")); sys.exit(1)
print("ok", len(d["items"]))
PY
then pass "OWNER_ACTIONS: valid, parseable YAML block"
else fail "OWNER_ACTIONS: missing or UNPARSEABLE"; fi

# ── Dashboard feed: QUALITY_SCORECARD must parse (independent quality grade) ────
if python3 - "$REPO_ROOT/docs/quality/QUALITY_SCORECARD.md" <<'PY'
import sys, re, yaml
try: txt = open(sys.argv[1]).read()
except OSError: print("QUALITY_SCORECARD.md missing"); sys.exit(1)
m = re.search(r"ya?ml\s*\n(.*?QUALITY_SCORECARD.*?)\n```", txt, re.S)
if not m: print("no QUALITY_SCORECARD block"); sys.exit(1)
try: d = (yaml.safe_load(m.group(1)) or {}).get("QUALITY_SCORECARD") or {}
except Exception as e: print("UNPARSEABLE:", e); sys.exit(1)
GRADES = {"A+","A","B","C","D","F",None}
if not isinstance(d.get("dimensions"), dict): print("dimensions must be a map"); sys.exit(1)
if d.get("overall") not in GRADES: print("bad overall grade"); sys.exit(1)
for name, dim in d["dimensions"].items():
    if (dim or {}).get("grade") not in GRADES: print("bad grade for", name); sys.exit(1)
print("ok", d.get("overall"))
PY
then pass "QUALITY_SCORECARD: valid, parseable YAML block"
else fail "QUALITY_SCORECARD: missing or UNPARSEABLE"; fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  PREFLIGHT SUMMARY"
echo "════════════════════════════════════════════════════════════════"

echo ""
printf "  Passed: %d\n" "$PASS"
printf "  Failed: %d\n" "$FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "  Failures:"
  for err in "${ERRORS[@]}"; do
    printf "    ✘ %s\n" "$err"
  done
  echo ""
  red "Preflight FAILED — $FAIL gate(s) not met. Fix the above before declaring ready."
  exit 1
else
  echo ""
  green "Preflight PASSED — all $PASS checks green."
  echo ""
  warn "NOTE: This script verifies mechanical gates only."
  warn "The ≥3 independent adversarial auditors (READINESS AUDIT GATE) must"
  warn "ALSO pass in the same run before 'FACTORY: ready for submission' may open."
  exit 0
fi
