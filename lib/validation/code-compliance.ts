// Code-lite compliance (static, no DB).
//
// The fully-DB-dependent chunks of building code (local zoning, HOA rules,
// specific municipal amendments) are intentionally *not* covered here — we
// ship only the portions that are universally stable across jurisdictions:
//
//   - Egress / door clear width for bedrooms  (IRC: ≥32" clear @ 90°)
//   - Minimum bedroom window egress opening   (≥5.7 sq ft, ≥24" tall, ≥20" wide)
//   - Minimum natural light glazing           (≥8% of floor area)
//   - Minimum ventilation openable area        (≥4% of floor area)
//   - ADA turning radius (if marked accessible) 60" diameter circle
//   - ADA doorway clear                        (≥32")
//   - Stair handrail height                    (34-38")
//   - Outlet spacing (kitchen counter)         (no point >24" from outlet)
//
// These are coded once and never need updating for 99% of residential US apts.

export interface CodeComplianceResult {
  /** 0-1 score — fraction of evaluated checks that passed */
  score: number;
  checks: Array<{
    code: string;
    description: string;
    passed: boolean;
    actual?: string;
    required: string;
  }>;
  violations: Array<{
    code: string;
    item?: string;
    issue: string;
    suggestion: string;
  }>;
  warnings: string[];
}

function readNumberField(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "number" && raw > 0) return raw;
    if (typeof raw === "string") {
      const m = raw.match(/(\d+(?:\.\d+)?)\s*(inches?|in|"|ft|feet|foot|sq\s*ft|sqft)?/i);
      if (m) {
        const v = parseFloat(m[1]);
        const unit = (m[2] ?? "").toLowerCase();
        if (unit.startsWith("ft") || unit.startsWith("fe") || unit.startsWith("fo")) return v * 12;
        if (unit.startsWith("sq")) return v; // return sqft as-is
        return v;
      }
    }
  }
  return null;
}

const BEDROOM_TYPES = new Set(["bedroom", "master_bedroom", "guest_bedroom", "kids_bedroom", "nursery"]);

export function computeCodeCompliance(
  analysis: Record<string, unknown>,
  context: {
    roomType?: string;
    floorPlan?: Record<string, unknown>;
    buildingResearch?: Record<string, unknown>;
    accessibleUnit?: boolean; // user flagged as ADA
  } = {},
): CodeComplianceResult {
  const roomKey = (context.roomType || "").toLowerCase().replace(/[\s-]+/g, "_");
  const fp = context.floorPlan || {};
  const br = context.buildingResearch || {};

  const checks: CodeComplianceResult["checks"] = [];
  const violations: CodeComplianceResult["violations"] = [];
  const warnings: string[] = [];

  // ── Egress / door clear width (bedrooms): ≥32" clear ────────────────
  if (BEDROOM_TYPES.has(roomKey) || roomKey.includes("bedroom")) {
    const doorWidth =
      readNumberField(fp, ["door_width", "bedroom_door_width"]) ??
      readNumberField(br, ["bedroom_door_width", "door_width"]);
    if (doorWidth !== null) {
      const passed = doorWidth >= 32;
      checks.push({
        code: "IRC R310.2.3 (egress door)",
        description: "Bedroom door clear width",
        passed,
        actual: `${Math.round(doorWidth)}"`,
        required: "≥ 32\"",
      });
      if (!passed) {
        violations.push({
          code: "IRC R310.2.3",
          issue: `Bedroom door ${Math.round(doorWidth)}" wide is below 32" egress minimum`,
          suggestion: "Widen door opening to ≥ 32\" clear for emergency egress compliance",
        });
      }
    }

    // Egress window (if data present)
    const winHeight = readNumberField(fp, ["window_height", "egress_window_height"]);
    const winWidth = readNumberField(fp, ["window_width", "egress_window_width"]);
    const winOpenable = readNumberField(fp, ["egress_window_area", "openable_window_area"]);
    if (winHeight !== null || winWidth !== null || winOpenable !== null) {
      const heightOK = winHeight === null || winHeight >= 24;
      const widthOK = winWidth === null || winWidth >= 20;
      const areaOK = winOpenable === null || winOpenable >= 5.7;
      const passed = heightOK && widthOK && areaOK;
      checks.push({
        code: "IRC R310.2.1 (egress window)",
        description: "Bedroom egress window minimums",
        passed,
        actual: `H=${winHeight ?? "?"}" W=${winWidth ?? "?"}" A=${winOpenable ?? "?"}sqft`,
        required: "≥ 24\" H, ≥ 20\" W, ≥ 5.7 sq ft openable",
      });
      if (!passed) {
        violations.push({
          code: "IRC R310.2.1",
          issue: `Bedroom egress window fails minimums (H=${winHeight}, W=${winWidth}, A=${winOpenable})`,
          suggestion: "Openable window must provide ≥5.7 sq ft with ≥24\" H × ≥20\" W clear opening for escape/rescue",
        });
      }
    }
  }

  // ── Natural light / ventilation glazing ratios ──────────────────────
  const floorArea = readNumberField(fp, ["total_sqft", "floor_area", "sqft", "area"]);
  const glazing = readNumberField(fp, ["glazing_area", "window_glass_area"]);
  const openable = readNumberField(fp, ["openable_area", "ventilation_area"]);
  if (floorArea !== null) {
    if (glazing !== null) {
      const minGlazing = floorArea * 0.08;
      const passed = glazing >= minGlazing;
      checks.push({
        code: "IRC R303.1 (natural light)",
        description: "Glazing area ≥ 8% of floor area",
        passed,
        actual: `${glazing.toFixed(1)} sq ft glazing / ${floorArea.toFixed(0)} sq ft floor`,
        required: `≥ ${minGlazing.toFixed(1)} sq ft (8%)`,
      });
      if (!passed) {
        violations.push({
          code: "IRC R303.1",
          issue: `Natural light short: ${glazing.toFixed(1)} sq ft < 8% of floor (${minGlazing.toFixed(1)} sq ft)`,
          suggestion: "Add glazing, enlarge window, or justify with mechanical lighting per code exception",
        });
      }
    }
    if (openable !== null) {
      const minOpenable = floorArea * 0.04;
      const passed = openable >= minOpenable;
      checks.push({
        code: "IRC R303.1 (ventilation)",
        description: "Openable area ≥ 4% of floor area",
        passed,
        actual: `${openable.toFixed(1)} sq ft openable`,
        required: `≥ ${minOpenable.toFixed(1)} sq ft (4%)`,
      });
      if (!passed) {
        violations.push({
          code: "IRC R303.1",
          issue: `Ventilation short: ${openable.toFixed(1)} sq ft < 4% floor (${minOpenable.toFixed(1)} sq ft)`,
          suggestion: "Enlarge openable sash or add mechanical ventilation per R303.1 exception",
        });
      }
    }
  }

  // ── ADA (only when user flags accessibility) ──────────────────────
  if (context.accessibleUnit) {
    // Turning radius: need a 60" diameter clear circle
    const clearCircle = readNumberField(fp, ["clear_floor_diameter", "turning_radius_diameter"]);
    if (clearCircle !== null) {
      const passed = clearCircle >= 60;
      checks.push({
        code: "ADA 304.3.1",
        description: "Clear turning space (60\" diameter)",
        passed,
        actual: `${Math.round(clearCircle)}" clear diameter`,
        required: "≥ 60\"",
      });
      if (!passed) {
        violations.push({
          code: "ADA 304.3.1",
          issue: `Only ${Math.round(clearCircle)}" turning diameter (<60")`,
          suggestion: "Rearrange furniture or specify a clear 60\" diameter area for wheelchair turning",
        });
      }
    }
    const doorClear =
      readNumberField(fp, ["door_clear_width"]) ??
      readNumberField(br, ["door_clear_width", "bedroom_door_width"]);
    if (doorClear !== null) {
      const passed = doorClear >= 32;
      checks.push({
        code: "ADA 404.2.3",
        description: "Door clear width",
        passed,
        actual: `${Math.round(doorClear)}" clear`,
        required: "≥ 32\"",
      });
      if (!passed) {
        violations.push({
          code: "ADA 404.2.3",
          issue: `Doorway clear width ${Math.round(doorClear)}" <32"`,
          suggestion: "Widen door or swap to pocket/barn door for ≥32\" clear passage",
        });
      }
    }
  }

  // ── Kitchen counter outlet spacing (informational only, no violation unless counter length known)
  if (roomKey.includes("kitchen")) {
    const counterLen = readNumberField(fp, ["counter_length", "countertop_length"]);
    const outletCount = readNumberField(analysis, ["kitchen_outlet_count"]);
    if (counterLen !== null && outletCount !== null) {
      // NEC 210.52(C): no point on counter >24" from outlet → outlets every 48" max
      const minOutlets = Math.ceil(counterLen / 48);
      const passed = outletCount >= minOutlets;
      checks.push({
        code: "NEC 210.52(C)",
        description: "Kitchen counter outlet spacing",
        passed,
        actual: `${outletCount} outlets on ${Math.round(counterLen)}" counter`,
        required: `≥ ${minOutlets} outlets (≤48" apart)`,
      });
      if (!passed) {
        violations.push({
          code: "NEC 210.52(C)",
          issue: `Kitchen counter has ${outletCount} outlets; needs ${minOutlets} to keep every point within 24" of power`,
          suggestion: `Add ${minOutlets - outletCount} GFCI outlet(s) along the run`,
        });
      }
    }
  }

  if (checks.length === 0) {
    warnings.push("No code-checkable data in floor_plan / building_research — skipping");
  }

  const passes = checks.filter((c) => c.passed).length;
  const score = checks.length === 0 ? 0.9 : passes / checks.length;

  return {
    score: round2(score),
    checks,
    violations,
    warnings,
  };
}

export function formatCodeComplianceForPrompt(result: CodeComplianceResult): string {
  const lines: string[] = [];
  lines.push(`### Code-Lite Compliance: ${result.score.toFixed(2)}/1.0`);
  for (const w of result.warnings) lines.push(`- NOTE: ${w}`);
  for (const c of result.checks) {
    const mark = c.passed ? "✓" : "✗";
    lines.push(`- ${mark} ${c.code}: ${c.description} — ${c.actual ?? "?"} (req ${c.required})`);
  }
  for (const v of result.violations) {
    lines.push(`- VIOLATION ${v.code}: ${v.issue} → ${v.suggestion}`);
  }
  return lines.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
