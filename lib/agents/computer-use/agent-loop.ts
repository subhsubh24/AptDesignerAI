/**
 * Gemini Computer Use agent loop.
 *
 * The Computer Use model emits `function_call` parts describing UI actions
 * (click_at, type_text_at, navigate, ...). Each action is executed against
 * a BrowserDriver, and the resulting screenshot is sent back to the model
 * as a `function_response`. The loop continues until the model stops
 * emitting actions, the max-turns ceiling is hit, a safety block aborts,
 * or the driver errors.
 *
 * This bypasses the regular `geminiProvider.chat()` wrapper because:
 *   1. Computer Use is multi-turn function-calling — chat() is one-shot.
 *   2. We need to ECHO the model's `thoughtSignature` parts back so
 *      Gemini 3 doesn't 400 on sequential function-call continuations.
 *   3. The payload shape differs (function_response parts with inline_data
 *      blobs) enough to justify a direct SDK call.
 *
 * See https://ai.google.dev/gemini-api/docs/computer-use for the protocol.
 */

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { selectModel } from "@/lib/ai/models";
import { createLogger } from "@/lib/logging/logger";
import { evaluateAction, DEFAULT_SAFETY_POLICY, type SafetyPolicy } from "./safety";
import type {
  AgentFunctionCall,
  AgentLoopConfig,
  AgentRunResult,
  AgentStepLog,
  ActionExecutionResult,
  BrowserDriver,
} from "./types";

const log = createLogger("computer-use-agent");

const DEFAULT_SYSTEM_PROMPT = `You are controlling a web browser to accomplish a user's goal.

Operating principles:
- Think before you act. Before each action, briefly state what you see and why you're clicking/typing where you are.
- Prefer the shortest path. If a direct URL gets you there faster than clicking through menus, navigate directly.
- When searching or filling forms, type the complete value in one action with type_text_at (it clears the field for you).
- If a page is still loading (spinners, skeleton UI), use wait_5_seconds rather than clicking blindly.
- Don't try to bypass captchas, login walls, payment flows, or legal-consent banners. Stop and report.
- When the goal is achieved, respond with the requested data as plain text (no further function calls).

Respond format:
- When still working: emit a function_call for the next action. Include a short text part explaining your reasoning.
- When done: emit a text part only, containing the final answer in the format the user requested.`;

let genaiClient: GoogleGenAI | null = null;
function getGenaiClient(): GoogleGenAI {
  if (!genaiClient) {
    genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genaiClient;
}

// ─── Coordinate denormalization ─────────────────────────────────────────
// Computer Use emits coordinates on a 0-999 grid regardless of viewport
// size; we scale back to absolute pixels before calling the driver.

function denormalize(coord: number, extent: number): number {
  return Math.round((coord / 1000) * extent);
}

// ─── Content shape helpers ──────────────────────────────────────────────
// The `@google/genai` SDK typings for function_call / function_response are
// strict-but-evolving. We use loose Record shapes locally to stay
// forward-compatible with field additions (safety_decision, etc.).

type ContentPart = Record<string, unknown>;
type Content = { role: string; parts: ContentPart[] };

// ─── Action executor ────────────────────────────────────────────────────

async function executeAction(
  action: AgentFunctionCall,
  driver: BrowserDriver,
): Promise<ActionExecutionResult> {
  const { name, args } = action;
  try {
    switch (name) {
      case "open_web_browser":
        // Already open — this is typically the first call.
        return { name, ok: true };

      case "wait_5_seconds":
        await driver.wait(5000);
        return { name, ok: true };

      case "go_back":
        await driver.goBack();
        return { name, ok: true };

      case "go_forward":
        await driver.goForward();
        return { name, ok: true };

      case "search":
        // The model uses this to reset to the default search engine.
        await driver.navigate("https://www.google.com");
        return { name, ok: true };

      case "navigate": {
        const url = args.url as string;
        if (typeof url !== "string") return { name, ok: false, error: "missing url" };
        await driver.navigate(url);
        return { name, ok: true };
      }

      case "click_at": {
        const x = denormalize(args.x as number, driver.screenWidth);
        const y = denormalize(args.y as number, driver.screenHeight);
        await driver.clickAt(x, y);
        return { name, ok: true };
      }

      case "hover_at": {
        const x = denormalize(args.x as number, driver.screenWidth);
        const y = denormalize(args.y as number, driver.screenHeight);
        await driver.hoverAt(x, y);
        return { name, ok: true };
      }

      case "type_text_at": {
        const x = denormalize(args.x as number, driver.screenWidth);
        const y = denormalize(args.y as number, driver.screenHeight);
        const text = String(args.text ?? "");
        const pressEnter = args.press_enter !== false; // default true
        const clearBefore = args.clear_before_typing !== false; // default true
        await driver.typeTextAt(x, y, text, pressEnter, clearBefore);
        return { name, ok: true };
      }

      case "key_combination": {
        const keys = String(args.keys ?? "");
        if (!keys) return { name, ok: false, error: "missing keys" };
        await driver.keyCombination(keys);
        return { name, ok: true };
      }

      case "scroll_document": {
        const direction = args.direction as "up" | "down" | "left" | "right";
        await driver.scrollDocument(direction);
        return { name, ok: true };
      }

      case "scroll_at": {
        const x = denormalize(args.x as number, driver.screenWidth);
        const y = denormalize(args.y as number, driver.screenHeight);
        const direction = args.direction as "up" | "down" | "left" | "right";
        const magnitude = typeof args.magnitude === "number"
          ? denormalize(args.magnitude, driver.screenHeight)
          : 600;
        await driver.scrollAt(x, y, direction, magnitude);
        return { name, ok: true };
      }

      case "drag_and_drop": {
        const x = denormalize(args.x as number, driver.screenWidth);
        const y = denormalize(args.y as number, driver.screenHeight);
        const destX = denormalize(args.destination_x as number, driver.screenWidth);
        const destY = denormalize(args.destination_y as number, driver.screenHeight);
        await driver.dragAndDrop(x, y, destX, destY);
        return { name, ok: true };
      }

      default:
        return { name, ok: false, error: `unhandled action: ${name}` };
    }
  } catch (e) {
    return { name, ok: false, error: (e as Error).message };
  }
}

// ─── Main loop ──────────────────────────────────────────────────────────

export async function runComputerUseAgent<T = unknown>(
  driver: BrowserDriver,
  config: AgentLoopConfig,
  options: {
    safetyPolicy?: SafetyPolicy;
    model?: string;
    /** Optional parser to convert the model's final text into structured data. */
    parseFinal?: (finalText: string) => T | undefined;
  } = {},
): Promise<AgentRunResult<T>> {
  const maxTurns = config.maxTurns ?? 15;
  const model = options.model ?? selectModel("computer_use");
  const policy = options.safetyPolicy ?? DEFAULT_SAFETY_POLICY;
  const ai = getGenaiClient();

  const steps: AgentStepLog[] = [];
  let finalText = "";
  let status: AgentRunResult<T>["status"] = "max_turns";
  let errorMsg: string | undefined;

  try {
    await driver.openBrowser();
    await driver.navigate(config.startUrl);
    // Give the initial page a beat to render before the first screenshot.
    await driver.wait(1500);

    // Initial turn: send the goal + a screenshot of the starting page.
    const initialShot = await driver.screenshot();
    const contents: Content[] = [
      {
        role: "user",
        parts: [
          { text: config.goal },
          {
            inlineData: {
              mimeType: "image/png",
              data: initialShot.toString("base64"),
            },
          },
        ],
      },
    ];

    const computerUseTool: Record<string, unknown> = {
      computerUse: { environment: "ENVIRONMENT_BROWSER" },
    };
    if (config.excludedPredefinedFunctions?.length) {
      (computerUseTool.computerUse as Record<string, unknown>).excludedPredefinedFunctions =
        config.excludedPredefinedFunctions;
    }

    for (let turn = 1; turn <= maxTurns; turn++) {
      const turnStart = Date.now();

      // ── Model call ───────────────────────────────────────────────
      const response = await ai.models.generateContent({
        model,
        contents: contents as unknown as Parameters<typeof ai.models.generateContent>[0]["contents"],
        config: {
          systemInstruction: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          tools: [computerUseTool],
          // Higher thinking budget helps the model plan multi-step nav.
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const candidate = response.candidates?.[0];
      const parts = (candidate?.content?.parts ?? []) as ContentPart[];

      // Echo the full model message (including thoughtSignatures) back into
      // the history. Gemini 3 requires signatures for function-call continuity.
      contents.push({ role: "model", parts });

      const thoughts = parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n");

      const actions: AgentFunctionCall[] = parts
        .filter((p) => p.functionCall)
        .map((p) => p.functionCall as AgentFunctionCall);

      // No actions → the model is done. Record final text and exit.
      if (actions.length === 0) {
        finalText = thoughts;
        status = "completed";
        steps.push({
          turnNumber: turn,
          thoughts,
          actions: [],
          actionResults: [],
          urlAfter: await driver.currentUrl(),
          durationMs: Date.now() - turnStart,
        });
        config.onStep?.(steps[steps.length - 1]);
        break;
      }

      // ── Execute actions ──────────────────────────────────────────
      const actionResults: ActionExecutionResult[] = [];
      let aborted = false;
      const urlBefore = await driver.currentUrl();

      for (const action of actions) {
        // Check Gemini's built-in safety_decision embedded in args. Unattended
        // agents must not proceed on require_confirmation — the spec says human
        // confirmation is mandatory and cannot be bypassed programmatically.
        const safetyDecision = action.args?.safety_decision as
          | { decision?: string; explanation?: string }
          | undefined;
        if (safetyDecision?.decision === "require_confirmation") {
          log.warn("Gemini safety gate triggered — aborting unattended run", {
            action: action.name,
            explanation: safetyDecision.explanation ?? "(no explanation)",
          });
          actionResults.push({
            name: action.name,
            ok: false,
            blocked: true,
            blockedReason: `Gemini safety: ${safetyDecision.explanation ?? "require_confirmation"}`,
          });
          aborted = true;
          break;
        }

        const verdict = evaluateAction(action, urlBefore, policy);
        if (!verdict.allow) {
          log.warn("Action blocked by safety policy", {
            action: action.name,
            reason: verdict.reason,
          });
          actionResults.push({
            name: action.name,
            ok: false,
            blocked: true,
            blockedReason: verdict.reason,
          });
          if (verdict.abortRun) {
            aborted = true;
            break;
          }
          continue;
        }
        const result = await executeAction(action, driver);
        actionResults.push(result);
      }

      if (aborted) {
        // Send a function_response back to the model explaining the block
        // before we close the loop — this lets the model emit a clean
        // final text rather than stalling on an unanswered function call.
        try {
          const blockedResult = actionResults.find((r) => r.blocked);
          const shot = await driver.screenshot();
          const currentUrl = await driver.currentUrl();
          const abortResponses: ContentPart[] = actions
            .slice(0, actionResults.length)
            .map((action, idx) => {
              const r = actionResults[idx];
              return {
                functionResponse: {
                  name: action.name,
                  response: {
                    url: currentUrl,
                    error: r.blocked
                      ? `Action blocked: ${r.blockedReason ?? "safety policy"}`
                      : r.ok
                        ? "ok"
                        : r.error ?? "action failed",
                  },
                  parts: [{ inlineData: { mimeType: "image/png", data: shot.toString("base64") } }],
                },
              };
            });
          if (abortResponses.length) contents.push({ role: "user", parts: abortResponses });
          errorMsg = blockedResult?.blockedReason;
        } catch {
          // best-effort — don't let abort cleanup crash the run
        }

        status = "safety_blocked";
        steps.push({
          turnNumber: turn,
          thoughts,
          actions,
          actionResults,
          urlAfter: await driver.currentUrl().catch(() => urlBefore),
          durationMs: Date.now() - turnStart,
        });
        config.onStep?.(steps[steps.length - 1]);
        break;
      }

      // Settle wait: use a short fixed delay so the screenshot captures
      // post-action state. Navigation actions get a longer wait since the
      // new page may still be loading.
      const navigationActions = new Set(["navigate", "go_back", "go_forward", "click_at", "key_combination"]);
      const didNavigate = actions.some((a) => navigationActions.has(a.name));
      await driver.wait(didNavigate ? 1200 : 600);

      // ── Send function_responses with new screenshot ──────────────
      const shot = await driver.screenshot();
      const currentUrl = await driver.currentUrl();
      const responseParts: ContentPart[] = actions.map((action, idx) => {
        const result = actionResults[idx];
        return {
          functionResponse: {
            name: action.name,
            response: {
              url: currentUrl,
              ...(result.ok ? {} : { error: result.error ?? "action failed" }),
            },
            // Inline screenshot lets the model see the new page state.
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: shot.toString("base64"),
                },
              },
            ],
          },
        };
      });
      contents.push({ role: "user", parts: responseParts });

      const step: AgentStepLog = {
        turnNumber: turn,
        thoughts,
        actions,
        actionResults,
        urlAfter: currentUrl,
        durationMs: Date.now() - turnStart,
      };
      steps.push(step);
      config.onStep?.(step);

      log.debug("turn complete", {
        turn,
        actions: actions.map((a) => a.name),
        url: currentUrl,
      });
    }
  } catch (e) {
    const err = e as Error;
    log.error("Computer Use agent failed", { error: err.message, stack: err.stack });
    status = "model_error";
    errorMsg = err.message;
  } finally {
    await driver.dispose().catch(() => {
      /* ignore — session cleanup is best-effort */
    });
  }

  const parsedOutput = status === "completed" && options.parseFinal
    ? options.parseFinal(finalText)
    : undefined;

  return {
    status,
    finalText,
    parsedOutput,
    steps,
    totalTurns: steps.length,
    error: errorMsg,
  };
}
