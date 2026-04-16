/**
 * Safety-decision policy for the Computer Use agent.
 *
 * Gemini's Computer Use model tags risky actions (captchas, purchases,
 * logins, accepting ToS, sending messages) with a `safety_decision` of
 * `require_confirmation`. Per the Computer Use terms of service, the
 * developer MUST either obtain end-user confirmation or abort.
 *
 * Because this agent runs UNATTENDED (triggered by an API route, not a
 * user interactively watching), we treat every `require_confirmation`
 * as an abort. Use cases that need interactive confirmation should build
 * a streaming UI around `runComputerUseAgent` and pass a custom handler.
 *
 * We ALSO block by URL pattern — even absent a safety_decision — to
 * prevent the agent from wandering into auth flows, checkouts, or
 * financial surfaces. Safer to fail loudly than accidentally fill a
 * login form.
 */

import type { AgentFunctionCall, SafetyDecision } from "./types";

export interface SafetyPolicy {
  /** If true, any require_confirmation aborts the run. Default true. */
  abortOnRequireConfirmation?: boolean;
  /** Disallowed URL regexes. Action is blocked if currentUrl matches. */
  blockedUrlPatterns?: RegExp[];
  /** Additional action names to refuse regardless of safety_decision. */
  blockedActionNames?: string[];
}

export const DEFAULT_SAFETY_POLICY: SafetyPolicy = {
  abortOnRequireConfirmation: true,
  blockedUrlPatterns: [
    /accounts\.google\.com/i,
    /login/i,
    /signin/i,
    /sign-in/i,
    /checkout/i,
    /payment/i,
    /cart/i,
    /\/auth\//i,
  ],
  blockedActionNames: [],
};

export interface SafetyVerdict {
  /** If false, the action MUST NOT be executed. */
  allow: boolean;
  /** Human-readable reason for the block (logged + returned to the model). */
  reason?: string;
  /** True when the block is fatal — abort the whole run. */
  abortRun?: boolean;
}

/**
 * Decide whether an action is safe to execute given the current URL and
 * the model's own safety_decision (if any).
 */
export function evaluateAction(
  action: AgentFunctionCall,
  currentUrl: string,
  policy: SafetyPolicy = DEFAULT_SAFETY_POLICY,
): SafetyVerdict {
  const safety = action.args?.safety_decision as SafetyDecision | undefined;

  if (safety?.decision === "require_confirmation") {
    return {
      allow: false,
      reason: `Model tagged action "${action.name}" as requires-confirmation: ${safety.explanation}`,
      abortRun: policy.abortOnRequireConfirmation !== false,
    };
  }

  if (policy.blockedActionNames?.includes(action.name)) {
    return {
      allow: false,
      reason: `Action "${action.name}" is blocked by policy`,
      abortRun: false,
    };
  }

  if (policy.blockedUrlPatterns?.length) {
    for (const pat of policy.blockedUrlPatterns) {
      if (pat.test(currentUrl)) {
        return {
          allow: false,
          reason: `Current URL matches blocked pattern ${pat} — refusing to act on a sensitive page`,
          abortRun: true,
        };
      }
    }
  }

  return { allow: true };
}
