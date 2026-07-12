/**
 * margin_eval — the repo-specific Margin eval RUNNER for `aptdesigner-search`.
 *
 * Drives the REAL metered path: each case in the input matrix (evals/margin/cases.ts)
 * runs through `runAgenticSearch` — the exact orchestrator the /api/search route uses —
 * so the live Gemini/DeepSeek providers (lib/ai/gemini.ts, lib/ai/deepseek.ts) emit their
 * per-call economics to Margin via the published `margin-meter` SDK, exactly as in
 * production. This runner then GRADES each run against the genuine pipeline signal
 * (validation.isValid + validation.confidence/10) and emits the outcome. The result is an
 * accurate STATISTICAL cost-per-outcome for AptDesignerAI that Margin can auto-tune on.
 *
 * It is a .ts (tsx) runner, not .py, ON PURPOSE: the metered path IS the TypeScript
 * provider stack, so faithfully exercising it means calling it in-process.
 *
 * SAFETY / CI GUARD: this makes REAL LLM + web-search calls and costs money, so it is
 * on-demand / scheduled ONLY. It refuses to run — making ZERO calls — when running in CI
 * or when the required keys are absent. The keyless CI gate never invokes it, and even if
 * it did, this guard keeps it a no-op.
 *
 * Run (see evals/margin/README.md for the full guide):
 *   MARGIN_INGEST_URL=https://margin-ai-rho.vercel.app MARGIN_INGEST_KEY=mgk_… \
 *   GEMINI_API_KEY=… TAVILY_API_KEY=… \
 *   MARGIN_EVAL_MAX_CASES=8 MARGIN_EVAL_USD_CAP=5 \
 *   npx tsx scripts/margin_eval.ts
 *
 * Test a CANDIDATE config (re-run under an override) by setting provider/model env, e.g.:
 *   AI_PROVIDER=gemini … npx tsx scripts/margin_eval.ts        # force all agents onto Gemini
 *   AI_PROVIDER=deepseek DEEPSEEK_API_KEY=… … npx tsx scripts/margin_eval.ts
 */

import { randomUUID } from "node:crypto";
import type { AgentContext } from "@/lib/agents/types";
import { buildCaseMatrix, type MarginEvalCase } from "@/evals/margin/cases";
import { gradeCase, summarize, QUALITY_METHOD, type Grade, type GradableResult } from "@/evals/margin/grade";

const WORKFLOW_ID = "aptdesigner-search";

// Rough LOCAL cost estimate — ONLY to enforce the $ cap. Margin computes the real,
// per-model cost server-side from the emitted tokens; this is a deliberately
// conservative blended rate so the cap trips early rather than late.
const USD_PER_TOKEN = 3e-6;

function num(env: string | undefined, dflt: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function log(msg: string): void {
  console.log(msg);
}

async function main(): Promise<number> {
  // ── Guard: on-demand only; never make real calls in CI or keyless ────────────
  if (process.env.CI) {
    log("margin_eval: refusing to run under CI (real LLM/web calls cost money). No-op.");
    return 0;
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  const missing: string[] = [];
  if (!geminiKey) missing.push("GEMINI_API_KEY (vision deep-scoring)");
  if (!tavilyKey) missing.push("TAVILY_API_KEY (product web search)");
  if (missing.length) {
    log(`margin_eval: fail-safe skip — missing required key(s): ${missing.join(", ")}.`);
    log("            This runner is on-demand only and makes ZERO calls without them.");
    return 0;
  }
  const marginEnabled = Boolean(process.env.MARGIN_INGEST_KEY);
  if (!marginEnabled) {
    log("margin_eval: WARNING — MARGIN_INGEST_KEY unset. Cases will run and be graded");
    log("            LOCALLY, but nothing will be emitted to Margin. Set the key to record.");
  }

  // Default to a Gemini-only run when no DeepSeek key is present, so a case never
  // dies on a hard 'DEEPSEEK_API_KEY is not set' throw (that error carries no HTTP
  // status, so the provider-factory account-error fallback does NOT catch it).
  if (!process.env.DEEPSEEK_API_KEY && !process.env.AI_PROVIDER) {
    process.env.AI_PROVIDER = "gemini";
  }

  // ── Establish the eval batch id BEFORE loading the meter/providers ───────────
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionId = `eval:${runId}`;
  process.env.MARGIN_SESSION_ID = sessionId; // tags every provider recordCall as this batch

  // Dynamic import AFTER env is set so getMeter() memoises with the session tag.
  const { runAgenticSearch } = await import("@/lib/agents/orchestrator");
  const { getMeter } = await import("@/lib/observability/margin-meter");

  const maxCases = num(process.env.MARGIN_EVAL_MAX_CASES, 8);
  const usdCap = num(process.env.MARGIN_EVAL_USD_CAP, 5);
  const filter = (process.env.MARGIN_EVAL_FILTER || "").trim(); // substring on id or difficulty

  let cases = buildCaseMatrix();
  if (filter) cases = cases.filter((c) => c.id.includes(filter) || c.difficulty === filter);

  log("─".repeat(78));
  log(`margin_eval — workflow=${WORKFLOW_ID} batch=${sessionId}`);
  log(`provider=${process.env.AI_PROVIDER || "deepseek(+gemini fallback)"}  emit=${marginEnabled ? "on" : "off"}`);
  log(`matrix=${buildCaseMatrix().length} cases  running≤${maxCases}  $cap≈${usdCap}  ${filter ? `filter="${filter}"` : ""}`);
  log("─".repeat(78));

  const grades: Grade[] = [];
  let estCostUsd = 0;
  let ran = 0;

  for (const c of cases) {
    if (ran >= maxCases) {
      log(`\n[cap] case cap reached (${maxCases}); stopping.`);
      break;
    }
    if (estCostUsd >= usdCap) {
      log(`\n[cap] est. $${estCostUsd.toFixed(2)} ≥ $${usdCap} cap; stopping before next case.`);
      break;
    }

    const ctx = buildContext(c);
    const started = Date.now();
    let result: GradableResult;
    try {
      // The REAL metered path — providers emit per-call economics (tagged sessionId).
      result = (await runAgenticSearch(ctx, c.missingCategories)) as GradableResult;
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    const grade = gradeCase(c, result);
    grades.push(grade);
    ran++;
    estCostUsd += grade.tokensUsed * USD_PER_TOKEN;

    // Emit the graded OUTCOME (the unit of productivity) for this case.
    if (marginEnabled) {
      await getMeter()
        ?.recordOutcome({
          workflowId: WORKFLOW_ID,
          passed: grade.passed,
          qualityScore: grade.qualityScore,
          qualityMethod: QUALITY_METHOD,
        })
        ?.catch(() => {});
    }

    const secs = ((Date.now() - started) / 1000).toFixed(0);
    const mark = grade.expectationMet === false ? "  ✗EXPECT-MISS" : grade.expectationMet === true ? "  ✓expect" : "";
    log(
      `[${String(ran).padStart(2, "0")}] ${c.difficulty.padEnd(6)} ${c.id}\n` +
        `     passed=${grade.passed}  conf=${grade.confidence.toFixed(1)}  q=${grade.qualityScore.toFixed(2)}  ` +
        `cands=${grade.candidateCount}  tok=${grade.tokensUsed}  ${secs}s  est$≈${estCostUsd.toFixed(2)}${mark}`,
    );
    for (const n of grade.notes) log(`       · ${n}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const s = summarize(grades);
  log("\n" + "═".repeat(78));
  log(
    `SUMMARY  ran=${s.ran}/${s.total}  passRate=${(s.passRate * 100).toFixed(0)}%  ` +
      `avgQuality=${s.avgQuality.toFixed(2)}  avgConf=${s.avgConfidence.toFixed(1)}  ` +
      `tokens=${s.totalTokens}  est$≈${estCostUsd.toFixed(2)}`,
  );
  log(`EXPECTATIONS  checked=${s.expectationsChecked}  misses=${s.expectationMisses}`);
  if (marginEnabled) log(`Emitted to Margin as batch ${sessionId} (calls tagged; outcomes via recordOutcome).`);
  log("═".repeat(78));

  // Give any in-flight, non-blocking call emits from the last case time to flush.
  // The providers fire recordCall through the meter's `emit()` (fire-and-forget
  // off-Vercel); the fetches are bounded by the meter's 4s timeout.
  await new Promise((r) => setTimeout(r, 5000));

  // A defined-outcome regression (e.g. an impossible-budget case that PASSED) is a
  // real failure worth a non-zero exit for schedulers; a clean measurement is 0.
  return s.expectationMisses > 0 ? 1 : 0;
}

function buildContext(c: MarginEvalCase): AgentContext {
  return {
    roomId: randomUUID(),
    roomType: c.roomType,
    roomName: c.roomLabel,
    keepItems: c.keepItems,
    replaceItems: c.replaceItems,
    priorities: c.priorities,
    budgetMode: c.budgetMode,
    sourcingMode: "online",
    imageUrls: c.imageUrls,
    budgetDollars: c.budgetDollars,
    userContext: c.userContext,
  };
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("margin_eval: fatal", err);
    process.exit(2);
  });
