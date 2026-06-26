import { describe, it, expect } from "vitest";
import {
  evaluateAction,
  DEFAULT_SAFETY_POLICY,
  type SafetyPolicy,
} from "@/lib/agents/computer-use/safety";
import type { AgentFunctionCall } from "@/lib/agents/computer-use/types";

const SAFE_URL = "https://www.example.com/products";

function makeAction(name: string, args: Record<string, unknown> = {}): AgentFunctionCall {
  return { name, args };
}

function makeConfirmationAction(name: string): AgentFunctionCall {
  return {
    name,
    args: { safety_decision: { decision: "require_confirmation", explanation: "sensitive operation" } },
  };
}

describe("DEFAULT_SAFETY_POLICY", () => {
  it("aborts on require_confirmation by default", () => {
    expect(DEFAULT_SAFETY_POLICY.abortOnRequireConfirmation).toBe(true);
  });

  it("blocks auth and payment URL patterns", () => {
    const blocked = [
      "https://accounts.google.com/signin",
      "https://example.com/login",
      "https://example.com/signin",
      "https://example.com/sign-in",
      "https://example.com/checkout",
      "https://example.com/payment",
      "https://example.com/cart",
      "https://example.com/auth/callback",
    ];
    for (const url of blocked) {
      const verdict = evaluateAction(makeAction("click"), url, DEFAULT_SAFETY_POLICY);
      expect(verdict.allow, `should block ${url}`).toBe(false);
    }
  });
});

describe("evaluateAction — require_confirmation", () => {
  it("blocks and aborts when safety_decision is require_confirmation and policy aborts", () => {
    const action = makeConfirmationAction("click");
    const verdict = evaluateAction(action, SAFE_URL, DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(false);
    expect(verdict.abortRun).toBe(true);
  });

  it("blocks but does not abort when abortOnRequireConfirmation is false", () => {
    const policy: SafetyPolicy = { ...DEFAULT_SAFETY_POLICY, abortOnRequireConfirmation: false };
    const action = makeConfirmationAction("click");
    const verdict = evaluateAction(action, SAFE_URL, policy);
    expect(verdict.allow).toBe(false);
    expect(verdict.abortRun).toBeFalsy();
  });

  it("includes a reason in the verdict", () => {
    const action = makeConfirmationAction("navigate");
    const verdict = evaluateAction(action, SAFE_URL, DEFAULT_SAFETY_POLICY);
    expect(verdict.reason).toBeTruthy();
    expect(verdict.reason).toContain("navigate");
  });
});

describe("evaluateAction — blockedActionNames", () => {
  it("blocks an action whose name is in the blocked list without aborting the run", () => {
    const policy: SafetyPolicy = { ...DEFAULT_SAFETY_POLICY, blockedActionNames: ["submit_form"] };
    const action = makeAction("submit_form");
    const verdict = evaluateAction(action, SAFE_URL, policy);
    expect(verdict.allow).toBe(false);
    expect(verdict.abortRun).toBeFalsy();
  });

  it("allows actions not in the blocked list", () => {
    const policy: SafetyPolicy = { ...DEFAULT_SAFETY_POLICY, blockedActionNames: ["submit_form"] };
    const action = makeAction("click");
    const verdict = evaluateAction(action, SAFE_URL, policy);
    expect(verdict.allow).toBe(true);
  });

  it("empty blockedActionNames array allows all actions", () => {
    const action = makeAction("drag_and_drop");
    const verdict = evaluateAction(action, SAFE_URL, DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(true);
  });
});

describe("evaluateAction — blocked URL patterns", () => {
  it("blocks actions when currentUrl matches a blocked pattern and aborts run", () => {
    const verdict = evaluateAction(makeAction("click"), "https://example.com/login/page", DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(false);
    expect(verdict.abortRun).toBe(true);
  });

  it("includes a descriptive reason mentioning the blocked pattern", () => {
    const verdict = evaluateAction(makeAction("click"), "https://example.com/checkout/step1", DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toContain("sensitive page");
  });

  it("allows actions on safe URLs", () => {
    const verdict = evaluateAction(makeAction("scroll_document"), SAFE_URL, DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(true);
  });

  it("custom blockedUrlPatterns override default ones", () => {
    const policy: SafetyPolicy = {
      abortOnRequireConfirmation: true,
      blockedUrlPatterns: [/admin/i],
      blockedActionNames: [],
    };
    expect(evaluateAction(makeAction("click"), "https://example.com/admin/dashboard", policy).allow).toBe(false);
    // /login/ is not in this custom policy, so it should be allowed
    expect(evaluateAction(makeAction("click"), "https://example.com/login", policy).allow).toBe(true);
  });
});

describe("evaluateAction — priority order", () => {
  it("require_confirmation check runs before URL check", () => {
    // On a blocked URL + require_confirmation: require_confirmation verdict fires first
    const action = makeConfirmationAction("navigate");
    const verdict = evaluateAction(action, "https://example.com/login", DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(false);
    // reason should mention the action name, not the URL pattern
    expect(verdict.reason).toContain("navigate");
  });
});

describe("evaluateAction — allow path", () => {
  it("returns allow:true with no abortRun for a clean action on a safe URL", () => {
    const verdict = evaluateAction(makeAction("screenshot"), SAFE_URL, DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(true);
    expect(verdict.abortRun).toBeFalsy();
  });

  it("allow:true has no reason field", () => {
    const verdict = evaluateAction(makeAction("wait_5_seconds"), SAFE_URL, DEFAULT_SAFETY_POLICY);
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toBeUndefined();
  });
});
