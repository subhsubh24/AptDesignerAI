/**
 * Shared types for the Gemini Computer Use agent — the loop that drives a
 * remote browser (via Browserbase) to accomplish high-level goals like
 * "find every floor-plan variant on this building's site" or "verify this
 * product is in stock at its current listed price."
 *
 * The agent loop translates Gemini `function_call` parts into BrowserDriver
 * method calls, then feeds the resulting screenshot back as a
 * `function_response`. See agent-loop.ts for the orchestration.
 */

// ─── Predefined action names emitted by the Computer Use model ──────────

export type PredefinedActionName =
  | "open_web_browser"
  | "wait_5_seconds"
  | "go_back"
  | "go_forward"
  | "search"
  | "navigate"
  | "click_at"
  | "hover_at"
  | "type_text_at"
  | "key_combination"
  | "scroll_document"
  | "scroll_at"
  | "drag_and_drop";

// ─── Safety decisions from Gemini's internal safety system ──────────────

/**
 * When the model proposes a risky action (captcha, purchase, login, accepting
 * ToS), it attaches a safety_decision. Per the Computer Use terms, we MUST
 * honor `require_confirmation` — either get user consent or abort. We treat
 * any such decision as an abort-by-default since this agent runs unattended.
 */
export interface SafetyDecision {
  explanation: string;
  decision: "require_confirmation";
}

// ─── Function call shape (Gemini response part) ─────────────────────────

export interface AgentFunctionCall {
  name: string;
  args: Record<string, unknown> & { safety_decision?: SafetyDecision };
}

export interface ActionExecutionResult {
  name: string;
  ok: boolean;
  /** Human-readable error if the action failed. */
  error?: string;
  /** True if the action was skipped due to a safety/policy check. */
  blocked?: boolean;
  blockedReason?: string;
}

// ─── Agent step log (one full turn: think → act → observe) ──────────────

export interface AgentStepLog {
  turnNumber: number;
  /** The model's free-text reasoning for this turn (if any). */
  thoughts: string;
  actions: AgentFunctionCall[];
  actionResults: ActionExecutionResult[];
  /** URL after actions were executed. */
  urlAfter: string;
  /** Milliseconds spent in this turn. */
  durationMs: number;
}

// ─── Final result of a complete agent run ───────────────────────────────

export type AgentStopReason =
  | "completed"
  | "max_turns"
  | "safety_blocked"
  | "driver_error"
  | "model_error";

export interface AgentRunResult<T = unknown> {
  status: AgentStopReason;
  /** The model's final text output (summary / answer). */
  finalText: string;
  /**
   * Caller-specific parsed output. For the floor-plan navigator this is
   * `{ variants: FloorPlanVariant[] }`; for the product verifier it's
   * `{ price, in_stock, dimensions, ... }`. Populated by a post-processor
   * that a concrete agent (floor-plan-navigator, product-verifier) runs
   * after the loop finishes.
   */
  parsedOutput?: T;
  steps: AgentStepLog[];
  totalTurns: number;
  error?: string;
}

// ─── Driver abstraction ─────────────────────────────────────────────────

/**
 * Abstracts over the actual browser-control runtime. Today we implement
 * only a BrowserbaseDriver (remote Chrome via CDP). A PlaywrightDriver for
 * local dev can be added by implementing the same surface.
 *
 * All coordinates passed in are ABSOLUTE pixel coordinates — the agent loop
 * denormalizes the model's 0-999 grid before calling the driver.
 */
export interface BrowserDriver {
  /** Viewport width in pixels (used to denormalize model coordinates). */
  readonly screenWidth: number;
  /** Viewport height in pixels. */
  readonly screenHeight: number;

  /** Open the initial browser session. Must be called before any action. */
  openBrowser(): Promise<void>;

  /** Capture a PNG screenshot of the current viewport. */
  screenshot(): Promise<Buffer>;

  /** Return the URL of the active page. */
  currentUrl(): Promise<string>;

  /** Navigate directly to a URL. */
  navigate(url: string): Promise<void>;

  goBack(): Promise<void>;
  goForward(): Promise<void>;

  clickAt(x: number, y: number): Promise<void>;
  hoverAt(x: number, y: number): Promise<void>;

  typeTextAt(
    x: number,
    y: number,
    text: string,
    pressEnter: boolean,
    clearBefore: boolean,
  ): Promise<void>;

  keyCombination(keys: string): Promise<void>;

  scrollDocument(direction: "up" | "down" | "left" | "right"): Promise<void>;
  scrollAt(
    x: number,
    y: number,
    direction: "up" | "down" | "left" | "right",
    magnitude: number,
  ): Promise<void>;

  dragAndDrop(
    x: number,
    y: number,
    destX: number,
    destY: number,
  ): Promise<void>;

  /** Pause (typically for animations / dynamic content). */
  wait(ms: number): Promise<void>;

  /** Release the browser session. Idempotent. */
  dispose(): Promise<void>;
}

// ─── Agent loop config ──────────────────────────────────────────────────

export interface AgentLoopConfig {
  /** Initial navigation target; the agent starts from a screenshot of this. */
  startUrl: string;
  /** High-level goal for the agent. */
  goal: string;
  /** Optional system prompt — overrides the default safety-focused default. */
  systemPrompt?: string;
  /** Hard cap on turns (default 15). Each turn is one LLM call. */
  maxTurns?: number;
  /** Predefined actions to disable for this run (e.g. lock out drag_and_drop). */
  excludedPredefinedFunctions?: string[];
  /** Called after every turn — useful for streaming progress to the client. */
  onStep?: (step: AgentStepLog) => void;
}
