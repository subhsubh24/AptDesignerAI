/**
 * margin_eval — the repo-specific Margin eval RUNNER (multi-workflow).
 *
 * Drives one or ALL AI-workflow eval suites through the REAL metered path so the
 * live Gemini/DeepSeek providers emit per-call economics via `margin-meter`, then
 * grades each case on its genuine pipeline signal and emits the outcome. Result:
 * an accurate STATISTICAL cost-per-outcome per workflow that Margin can auto-tune.
 *
 * Suites (evals/margin/suites.ts): `search`, `fit-scoring`, `diagnosis`.
 * Select one with `--workflow <name>`; omit (or `all`) to run every suite.
 *
 * A .ts (tsx) runner, not .py, ON PURPOSE: the metered path IS the TypeScript
 * provider stack, so faithfully exercising it means calling it in-process.
 *
 * SAFETY / CI GUARD: real LLM + web-search calls cost money, so it is on-demand /
 * scheduled ONLY. It refuses to run — ZERO calls — under CI or without keys.
 *
 * Run (see evals/margin/README.md):
 *   GEMINI_API_KEY=… TAVILY_API_KEY=… MARGIN_INGEST_URL=… MARGIN_INGEST_KEY=… \
 *   MARGIN_EVAL_MAX_CASES=6 MARGIN_EVAL_USD_CAP=5 \
 *   npx tsx scripts/margin_eval.ts --workflow all
 */

import { selectSuites, suiteNames } from "@/evals/margin/suites";
import { summarize, type Grade } from "@/evals/margin/grade";
import type { Suite } from "@/evals/margin/suite";

// Rough LOCAL cost estimate — ONLY to enforce the $ cap. Margin computes the real,
// per-model cost server-side from the emitted tokens; this is a deliberately
// conservative blended rate so the cap trips early rather than late.
const USD_PER_TOKEN = 3e-6;

function num(env: string | undefined, dflt: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
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
  const missing: string[] = [];
  if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY (vision + pipeline)");
  if (!process.env.TAVILY_API_KEY) missing.push("TAVILY_API_KEY (search suite product web search)");
  if (missing.length) {
    log(`margin_eval: fail-safe skip — missing required key(s): ${missing.join(", ")}.`);
    log("            This runner is on-demand only and makes ZERO calls without them.");
    return 0;
  }
  const marginEnabled = Boolean(process.env.MARGIN_INGEST_KEY);
  if (!marginEnabled) {
    log("margin_eval: WARNING — MARGIN_INGEST_KEY unset. Cases run + grade LOCALLY,");
    log("            but nothing is emitted to Margin. Set the key to record.");
  }

  // Gemini-only when no DeepSeek key (a missing key throws with no HTTP status, so
  // the provider-factory account-error fallback does NOT catch it).
  if (!process.env.DEEPSEEK_API_KEY && !process.env.AI_PROVIDER) {
    process.env.AI_PROVIDER = "gemini";
  }

  // ── Select suites ────────────────────────────────────────────────────────────
  let suites: Suite[];
  try {
    suites = selectSuites(arg("--workflow"));
  } catch (e) {
    log(`margin_eval: ${(e as Error).message}`);
    return 2;
  }

  // ── Establish the eval batch id BEFORE the meter/providers load ──────────────
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionId = `eval:${runId}`;
  process.env.MARGIN_SESSION_ID = sessionId; // tags every provider recordCall as this batch

  const { getMeter } = await import("@/lib/observability/margin-meter");

  const maxCasesPerSuite = num(process.env.MARGIN_EVAL_MAX_CASES, 6);
  const usdCap = num(process.env.MARGIN_EVAL_USD_CAP, 5);
  const filter = (process.env.MARGIN_EVAL_FILTER || "").trim();

  log("─".repeat(78));
  log(`margin_eval — batch=${sessionId}  suites=[${suites.map((s) => s.workflow).join(", ")}] of [${suiteNames().join(", ")}]`);
  log(`provider=${process.env.AI_PROVIDER || "deepseek(+gemini fallback)"}  emit=${marginEnabled ? "on" : "off"}  ≤${maxCasesPerSuite}/suite  $cap≈${usdCap}  ${filter ? `filter="${filter}"` : ""}`);

  const allGrades: Grade[] = [];
  let estCostUsd = 0;
  let stop = false;

  for (const suite of suites) {
    if (stop) break;
    // Attribute this suite's provider CALLS + our outcomes to its workflow_id.
    process.env.MARGIN_WORKFLOW_ID = suite.workflowId;
    log("\n" + "═".repeat(78));
    log(`SUITE ${suite.workflow} → workflow_id=${suite.workflowId} (${suite.size()} cases): ${suite.description}`);
    log("─".repeat(78));

    const suiteGrades: Grade[] = [];
    let ranInSuite = 0;
    for (let i = 0; i < suite.size(); i++) {
      if (ranInSuite >= maxCasesPerSuite) {
        log(`  [cap] per-suite case cap (${maxCasesPerSuite}) reached.`);
        break;
      }
      if (estCostUsd >= usdCap) {
        log(`  [cap] est. $${estCostUsd.toFixed(2)} ≥ $${usdCap} cap; stopping.`);
        stop = true;
        break;
      }
      const meta = suite.caseMeta(i);
      if (filter && !meta.id.includes(filter) && meta.difficulty !== filter) continue;

      const started = Date.now();
      const grade = await suite.runCase(i); // REAL metered path (providers auto-emit calls)
      suiteGrades.push(grade);
      allGrades.push(grade);
      ranInSuite++;
      estCostUsd += grade.tokensUsed * USD_PER_TOKEN;

      if (marginEnabled) {
        await getMeter()
          ?.recordOutcome({
            workflowId: suite.workflowId,
            passed: grade.passed,
            qualityScore: grade.qualityScore,
            qualityMethod: suite.qualityMethod,
          })
          ?.catch(() => {});
      }

      const secs = ((Date.now() - started) / 1000).toFixed(0);
      const mark = grade.expectationMet === false ? "  ✗EXPECT-MISS" : grade.expectationMet === true ? "  ✓expect" : "";
      log(
        `  [${String(ranInSuite).padStart(2, "0")}] ${meta.difficulty.padEnd(6)} ${meta.id}\n` +
          `       passed=${grade.passed}  conf=${grade.confidence.toFixed(1)}  q=${grade.qualityScore.toFixed(2)}  ` +
          `signal=${grade.candidateCount}  tok=${grade.tokensUsed}  ${secs}s  est$≈${estCostUsd.toFixed(2)}${mark}`,
      );
      for (const n of grade.notes) log(`         · ${n}`);
    }

    const ss = summarize(suiteGrades);
    log(`  ── ${suite.workflow}: ran=${ss.ran}/${ss.total}  passRate=${(ss.passRate * 100).toFixed(0)}%  avgQ=${ss.avgQuality.toFixed(2)}  misses=${ss.expectationMisses}  tokens=${ss.totalTokens}`);
  }

  // ── Overall summary ──────────────────────────────────────────────────────────
  const s = summarize(allGrades);
  log("\n" + "═".repeat(78));
  log(
    `TOTAL  ran=${s.ran}/${s.total}  passRate=${(s.passRate * 100).toFixed(0)}%  ` +
      `avgQuality=${s.avgQuality.toFixed(2)}  avgConf=${s.avgConfidence.toFixed(1)}  ` +
      `tokens=${s.totalTokens}  est$≈${estCostUsd.toFixed(2)}`,
  );
  log(`EXPECTATIONS  checked=${s.expectationsChecked}  misses=${s.expectationMisses}`);
  if (marginEnabled) log(`Emitted to Margin as batch ${sessionId} (calls tagged per-suite workflow_id; outcomes via recordOutcome).`);
  log("═".repeat(78));

  // Let in-flight non-blocking call emits from the last case flush (bounded by the
  // meter's 4s timeout; off-Vercel waitUntil doesn't extend lifetime).
  await new Promise((r) => setTimeout(r, 5000));

  // A defined-outcome regression (an asserted case that went the wrong way) is a
  // real failure worth a non-zero exit for schedulers; a clean measurement is 0.
  return s.expectationMisses > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("margin_eval: fatal", err);
    process.exit(2);
  });
