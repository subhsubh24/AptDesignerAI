import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * `/api/diagnosis` and `/api/diagnosis/stream` are near-duplicate
 * implementations of the same pipeline: both run the diagnosis agent, both
 * self-review, both insert into `room_diagnoses`. The UI only ever calls the
 * STREAM route (app/projects/[projectId]/rooms/[roomId]/diagnosis/page.tsx),
 * which makes the non-stream route the easy one to fix and the wrong one to
 * fix — a correction landed there reaches no real user.
 *
 * That is not hypothetical. The `design_direction_label` fix was written
 * against the non-stream route first and would have shipped believing itself
 * done while every diagnosis the app actually creates still wrote NULL.
 *
 * So: assert the two inserts agree on the columns that matter. This is a
 * source-level ratchet rather than a behavioural test because the thing being
 * guarded IS the duplication — the only way to catch drift between two
 * hand-maintained copies is to compare the copies. Deleting the duplication
 * would be better; until then this fails loudly when they diverge.
 */

const ROUTES = {
  plain: "app/api/diagnosis/route.ts",
  stream: "app/api/diagnosis/stream/route.ts",
} as const;

/** The `.insert({...})` object literal from the room_diagnoses write. */
function roomDiagnosesInsert(relPath: string): string {
  const src = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
  const anchor = src.indexOf('.from("room_diagnoses")');
  expect(anchor, `${relPath} should write to room_diagnoses`).toBeGreaterThan(-1);
  const insertAt = src.indexOf(".insert({", anchor);
  expect(insertAt, `${relPath} should insert into room_diagnoses`).toBeGreaterThan(-1);
  const end = src.indexOf("})", insertAt);
  return src.slice(insertAt, end);
}

/**
 * Columns whose ABSENCE is silent — nothing throws, no test fails, the feature
 * they feed just stops working. Every one of these has to be written by BOTH
 * routes or neither.
 */
const REQUIRED_COLUMNS = [
  // Filtered with `.in(...)` by fetchDiagnosisExamples; SQL IN never matches
  // NULL, so omitting it disables direction-matched few-shot retrieval.
  "design_direction_label",
  // The other two quality-tracking columns from migration 010; the retrieval
  // query filters on both.
  "room_type",
  "action_list_count",
];

describe("diagnosis route parity", () => {
  const inserts = {
    plain: roomDiagnosesInsert(ROUTES.plain),
    stream: roomDiagnosesInsert(ROUTES.stream),
  };

  it.each(REQUIRED_COLUMNS)("both routes persist %s", (column) => {
    expect(inserts.plain, `${ROUTES.plain} omits ${column}`).toContain(`${column}:`);
    expect(inserts.stream, `${ROUTES.stream} omits ${column}`).toContain(`${column}:`);
  });

  it("both routes reconcile the style label after self-review", () => {
    // Self-review can rewrite the design direction after the label was
    // inferred. A route that corrects the direction without re-reconciling
    // persists a label naming a direction that no longer exists.
    for (const relPath of Object.values(ROUTES)) {
      const src = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
      expect(src, `${relPath} runs self-review`).toContain("selfReviewDiagnosis");
      expect(src, `${relPath} does not reconcile the style label`).toContain(
        "reconcileStyleLabel",
      );
    }
  });
});
