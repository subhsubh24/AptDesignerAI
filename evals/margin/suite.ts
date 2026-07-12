/**
 * The Suite abstraction — one AI workflow's eval, behind a uniform surface the
 * runner drives generically (select one via `--workflow`, or run all).
 *
 * Each suite owns: its Margin `workflowId` (so calls + outcomes attribute to the
 * right workflow), its input matrix, and a genuine grader that maps the REAL
 * pipeline signal to a `Grade`. `runCase` runs one case through the real metered
 * path (providers auto-emit the per-call economics) and returns the graded
 * outcome; the runner emits that outcome and enforces cost caps.
 */

import type { Grade } from "./grade";

export interface Suite {
  /** CLI slug for `--workflow` selection, e.g. "search" | "fit-scoring" | "diagnosis". */
  workflow: string;
  /** Margin workflow_id the calls + outcomes attribute to, e.g. "aptdesigner-search". */
  workflowId: string;
  /** How the outcome was graded — recorded as the outcome's qualityMethod. */
  qualityMethod: string;
  description: string;
  /** Number of cases in the matrix. */
  size(): number;
  /** Lightweight metadata for logging without materialising the whole case. */
  caseMeta(i: number): { id: string; difficulty: string };
  /** Run case `i` through the REAL metered path and grade it. Dynamic-imports the
   *  pipeline internally so importing the suite never preloads the providers. */
  runCase(i: number): Promise<Grade>;
}
