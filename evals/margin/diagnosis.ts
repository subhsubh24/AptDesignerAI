/**
 * Diagnosis suite — the `aptdesigner-diagnosis` workflow (runRoomDiagnosis).
 *
 * Runs the two-pass room diagnosis (lib/agents/room-diagnostician.ts:91, powering
 * /api/diagnosis) on a real room photo. Genuine signals:
 *   - `success` — the pipeline produced a diagnosis. The orchestrator HARD-GATES
 *     to success=false when it is high-confidence the declared room type is wrong
 *     (room-diagnostician.ts:312-323), so a clear room-type MISMATCH is an asserted
 *     failure.
 *   - completeness — a usable diagnosis has a diagnosis object, a design_direction,
 *     a non-empty action_list and missing_categories. Quality = the fraction present.
 *
 * Standalone: runRoomDiagnosis touches no Supabase hard-dependency (few-shot
 * examples degrade to [] without a DB). It needs a real room photo (vision) + a
 * Gemini key (uses googleSearch grounding, no Tavily).
 */

import { randomUUID } from "node:crypto";
import type { AgentContext } from "@/lib/agents/types";
import type { Suite } from "./suite";
import type { Grade } from "./grade";
import { mulberry32, pick } from "./prng";

export const DIAGNOSIS_QUALITY_METHOD = "diagnosis_completeness";
/** A diagnosis with at least this many action items counts as usable. */
const MIN_ACTIONS = 2;

const IMG: Record<string, string> = {
  living_room: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=1280&q=80",
  bedroom: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1280&q=80",
  dining_room: "https://images.unsplash.com/photo-1615873968403-89e068629265?w=1280&q=80",
  home_office: "https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=1280&q=80",
};

export interface DiagnosisCase {
  id: string;
  /** The room type DECLARED by the user (may deliberately mismatch the photo). */
  roomType: string;
  /** The room the photo actually shows (drives which image is used). */
  photoRoom: string;
  imageQuality: "high" | "low";
  budgetMode: string;
  userContext: string;
  keepItems: string[];
  difficulty: "easy" | "medium" | "hard";
  expect?: { shouldPass: boolean; why: string };
}

function img(room: string, quality: "high" | "low"): string {
  const base = (IMG[room] ?? IMG.living_room).split("?")[0];
  return quality === "high" ? `${base}?w=1280&q=80` : `${base}?w=200&q=30`;
}

// ── Curated cases ─────────────────────────────────────────────────────────────
const CURATED: DiagnosisCase[] = [
  {
    id: "diag-good-living-room-scandi",
    roomType: "living_room",
    photoRoom: "living_room",
    imageQuality: "high",
    budgetMode: "balanced",
    userContext: "Warm Scandinavian living room. Wants a cohesive, cozier feel.",
    keepItems: [],
    difficulty: "easy",
    expect: { shouldPass: true, why: "a clear, matching living-room photo must yield a usable diagnosis" },
  },
  {
    id: "diag-good-bedroom-calm",
    roomType: "bedroom",
    photoRoom: "bedroom",
    imageQuality: "high",
    budgetMode: "budget",
    userContext: "Calm minimalist bedroom, restful and uncluttered.",
    keepItems: [],
    difficulty: "easy",
    expect: { shouldPass: true, why: "a clear, matching bedroom photo must yield a usable diagnosis" },
  },
  {
    id: "diag-good-dining-traditional",
    roomType: "dining_room",
    photoRoom: "dining_room",
    imageQuality: "high",
    budgetMode: "balanced",
    userContext: "Traditional dining room for family dinners.",
    keepItems: [],
    difficulty: "medium",
  },
  {
    id: "diag-good-office-focus",
    roomType: "home_office",
    photoRoom: "home_office",
    imageQuality: "high",
    budgetMode: "best_possible",
    userContext: "Focused home office; good light, minimal distraction.",
    keepItems: [],
    difficulty: "medium",
  },
  // Adversarial: declared room type clearly contradicts the photo → hard gate → fail.
  {
    id: "diag-mismatch-kitchen-declared-bedroom-photo",
    roomType: "kitchen",
    photoRoom: "bedroom",
    imageQuality: "high",
    budgetMode: "balanced",
    userContext: "Kitchen refresh.",
    keepItems: [],
    difficulty: "hard",
    expect: { shouldPass: false, why: "photo is clearly a bedroom but the room is labeled kitchen — the room-type gate must fail it" },
  },
  {
    id: "diag-mismatch-office-declared-dining-photo",
    roomType: "home_office",
    photoRoom: "dining_room",
    imageQuality: "high",
    budgetMode: "balanced",
    userContext: "Set up my home office.",
    keepItems: [],
    difficulty: "hard",
    expect: { shouldPass: false, why: "photo is a dining room but labeled home office — the room-type gate should fail it" },
  },
  // Degenerate: empty brief + degraded photo (measured, not asserted).
  {
    id: "diag-degenerate-empty-brief-lowres",
    roomType: "living_room",
    photoRoom: "living_room",
    imageQuality: "low",
    budgetMode: "balanced",
    userContext: "",
    keepItems: [],
    difficulty: "hard",
  },
];

function fuzzDiagnosisCases(seed = 0xd1a6, n = 4): DiagnosisCase[] {
  const rng = mulberry32(seed);
  const rooms = Object.keys(IMG);
  const out: DiagnosisCase[] = [];
  for (let k = 0; k < n; k++) {
    const room = pick(rng, rooms);
    const quality: "high" | "low" = rng() < 0.5 ? "high" : "low";
    out.push({
      id: `diag-fuzz-${String(k).padStart(2, "0")}-${room}`,
      roomType: room,
      photoRoom: room,
      imageQuality: quality,
      budgetMode: pick(rng, ["budget", "balanced", "best_possible"]),
      userContext: rng() < 0.5 ? "" : `${room.replace(/_/g, " ")}.`,
      keepItems: [],
      difficulty: "hard",
    });
  }
  return out;
}

const cases: DiagnosisCase[] = [...CURATED, ...fuzzDiagnosisCases()];

function buildContext(c: DiagnosisCase): AgentContext {
  return {
    roomId: randomUUID(),
    roomType: c.roomType,
    roomName: c.roomType.replace(/_/g, " "),
    keepItems: c.keepItems,
    replaceItems: [],
    priorities: [],
    budgetMode: c.budgetMode,
    sourcingMode: "online",
    imageUrls: [img(c.photoRoom, c.imageQuality)],
    userContext: c.userContext,
  };
}

interface DiagResultLike {
  success: boolean;
  error?: string;
  data?: {
    diagnosis?: unknown;
    design_direction?: unknown;
    missing_categories?: unknown[];
    action_list?: unknown[];
  };
  tokensUsed?: number;
}

/** Grade a runRoomDiagnosis result on completeness — genuine, never always-pass. */
export function gradeDiagnosis(c: DiagnosisCase, result: DiagResultLike): Grade {
  const notes: string[] = [];
  const tokensUsed = result.tokensUsed ?? 0;
  const assertOutcome = (passed: boolean): boolean | null => {
    if (!c.expect) return null;
    const met = passed === c.expect.shouldPass;
    if (!met) notes.push(`EXPECTATION MISS: expected passed=${c.expect.shouldPass} (${c.expect.why}) — got passed=${passed}`);
    return met;
  };

  if (!result.success || !result.data) {
    // A hard-gated room-type mismatch lands here — for a mismatch case that's the
    // CORRECT outcome (passed=false, expectation met).
    notes.push(`diagnosis did not complete: ${result.error ?? "unknown error"}`);
    return { caseId: c.id, ran: false, passed: false, confidence: 0, qualityScore: 0, candidateCount: 0, tokensUsed, expectationMet: assertOutcome(false), notes };
  }

  const d = result.data;
  const actions = Array.isArray(d.action_list) ? d.action_list.length : 0;
  const parts = [
    Boolean(d.diagnosis),
    Boolean(d.design_direction),
    actions >= 3,
    Array.isArray(d.missing_categories) && d.missing_categories.length >= 1,
  ];
  const completeness = parts.filter(Boolean).length / parts.length; // 0..1
  const passed = Boolean(d.diagnosis) && Boolean(d.design_direction) && actions >= MIN_ACTIONS;
  if (!passed) notes.push(`incomplete diagnosis: action_items=${actions}, hasDesignDirection=${Boolean(d.design_direction)}`);

  return {
    caseId: c.id,
    ran: true,
    passed,
    confidence: Math.round(completeness * 100) / 10, // 0..10, derived from completeness
    qualityScore: completeness,
    candidateCount: actions,
    tokensUsed,
    expectationMet: assertOutcome(passed),
    notes,
  };
}

export const diagnosisSuite: Suite = {
  workflow: "diagnosis",
  workflowId: "aptdesigner-diagnosis",
  qualityMethod: DIAGNOSIS_QUALITY_METHOD,
  description: "Two-pass room diagnosis → design direction + action list (runRoomDiagnosis)",
  size: () => cases.length,
  caseMeta: (i) => ({ id: cases[i].id, difficulty: cases[i].difficulty }),
  async runCase(i) {
    const c = cases[i];
    const { runRoomDiagnosis } = await import("@/lib/agents/room-diagnostician");
    try {
      const result = (await runRoomDiagnosis(buildContext(c))) as DiagResultLike;
      return gradeDiagnosis(c, result);
    } catch (err) {
      return gradeDiagnosis(c, { success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

export function buildDiagnosisCases(): DiagnosisCase[] {
  return cases;
}
