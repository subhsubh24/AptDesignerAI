/**
 * The layer that decides whether a mobile purchase attempt actually unlocked Pro.
 *
 * Two asymmetries drive every case below, and they point in OPPOSITE directions:
 *
 *  - UNLOCKING is the expensive mistake. A resolved `purchasePackage` does not
 *    mean the entitlement is active (Google Play prepaid/deferred payments and
 *    iOS Ask to Buy both resolve with it inactive), so anything we cannot
 *    positively confirm must read as NOT unlocked.
 *  - CALLING IT A FAILURE is the other expensive mistake. A pending payment
 *    surfaced as "Purchase failed — please try again" invites a SECOND charge
 *    for the same subscription, so a pending signal must never collapse into the
 *    failure branch.
 *
 * The tests are written around those two, not around the happy path.
 */

import { describe, it, expect, vi } from "vitest";

import {
  hasActiveEntitlement,
  classifyPurchaseResult,
  classifyPurchaseError,
  ERROR_CODE_PURCHASE_CANCELLED,
  ERROR_CODE_PAYMENT_PENDING,
  ERROR_CODE_PRODUCT_ALREADY_PURCHASED,
  purchaseResultAction,
  purchaseErrorAction,
  performPurchaseAction,
  unlockHandler,
  alertHandler,
} from "@/mobile/src/lib/purchase-outcome";

const PRO = "pro";

describe("hasActiveEntitlement — only a positive confirmation unlocks", () => {
  it("is true when the entitlement is present and isActive is exactly true", () => {
    expect(hasActiveEntitlement({ entitlements: { active: { pro: { isActive: true } } } }, PRO)).toBe(true);
  });

  it("is false when the entitlement is active but under a DIFFERENT id", () => {
    // A product mapped to the wrong entitlement in the RevenueCat dashboard is a
    // real misconfiguration, and it must not unlock `pro`.
    expect(hasActiveEntitlement({ entitlements: { active: { plus: { isActive: true } } } }, PRO)).toBe(false);
  });

  it("is false for every shape that merely fails to say no", () => {
    // The payload behind RevenueCat's types is not runtime-checked, so each of
    // these is reachable rather than hypothetical — and none of them is a
    // confirmed entitlement.
    expect(hasActiveEntitlement(null, PRO)).toBe(false);
    expect(hasActiveEntitlement(undefined, PRO)).toBe(false);
    expect(hasActiveEntitlement({}, PRO)).toBe(false);
    expect(hasActiveEntitlement({ entitlements: null }, PRO)).toBe(false);
    expect(hasActiveEntitlement({ entitlements: { active: null } }, PRO)).toBe(false);
    expect(hasActiveEntitlement({ entitlements: { active: {} } }, PRO)).toBe(false);
    expect(hasActiveEntitlement({ entitlements: { active: { pro: null } } }, PRO)).toBe(false);
    expect(hasActiveEntitlement({ entitlements: { active: { pro: {} } } }, PRO)).toBe(false);
  });

  it("does not accept a TRUTHY isActive — only the boolean", () => {
    // This is the assertion that would fail if `=== true` were relaxed to a
    // truthiness check. `"false"` is the case that makes it matter: a bridge
    // that stringifies booleans would unlock Pro on an INACTIVE entitlement.
    for (const truthy of ["true", "false", 1, "yes", {}] as unknown[]) {
      expect(
        hasActiveEntitlement({ entitlements: { active: { pro: { isActive: truthy } } } }, PRO),
        `isActive=${JSON.stringify(truthy)} must not unlock`,
      ).toBe(false);
    }
  });

  it("does not throw when `active` is a non-object of the right-ish shape", () => {
    expect(() =>
      hasActiveEntitlement({ entitlements: { active: "pro" as unknown as null } }, PRO),
    ).not.toThrow();
    expect(hasActiveEntitlement({ entitlements: { active: "pro" as unknown as null } }, PRO)).toBe(false);
  });
});

describe("classifyPurchaseResult — resolved is not entitled", () => {
  it("unlocks only when the returned customerInfo carries the active entitlement", () => {
    expect(
      classifyPurchaseResult({ customerInfo: { entitlements: { active: { pro: { isActive: true } } } } }, PRO),
    ).toBe("unlocked");
  });

  it("treats a Play prepaid / deferred resolve as pending, not unlocked", () => {
    // The store accepted the transaction; the entitlement is granted only once
    // payment completes, so customerInfo comes back with it absent.
    expect(classifyPurchaseResult({ customerInfo: { entitlements: { active: {} } } }, PRO)).toBe("pending");
  });

  it("treats a missing or malformed result as pending, never unlocked", () => {
    expect(classifyPurchaseResult(null, PRO)).toBe("pending");
    expect(classifyPurchaseResult(undefined, PRO)).toBe("pending");
    expect(classifyPurchaseResult({}, PRO)).toBe("pending");
    expect(classifyPurchaseResult({ customerInfo: null }, PRO)).toBe("pending");
  });
});

describe("classifyPurchaseError — a pending charge is not a failure", () => {
  it("reads PAYMENT_PENDING_ERROR as pending", () => {
    // The whole point: this used to land in the failure branch, whose copy says
    // "please try again" — i.e. buy it a second time while the first is in flight.
    expect(classifyPurchaseError({ code: ERROR_CODE_PAYMENT_PENDING })).toBe("pending");
    expect(ERROR_CODE_PAYMENT_PENDING).toBe("20");
  });

  it("reads PURCHASE_CANCELLED_ERROR as cancelled", () => {
    expect(classifyPurchaseError({ code: ERROR_CODE_PURCHASE_CANCELLED })).toBe("cancelled");
    expect(ERROR_CODE_PURCHASE_CANCELLED).toBe("1");
  });

  it("still honours a legacy userCancelled=true when no code is recognised", () => {
    expect(classifyPurchaseError({ userCancelled: true })).toBe("cancelled");
    expect(classifyPurchaseError({ code: "999", userCancelled: true })).toBe("cancelled");
  });

  it("does NOT depend on userCancelled being set — a cancel with a null flag is still a cancel", () => {
    // RevenueCat types `userCancelled` as `boolean | null` and deprecate it. The
    // old check was `userCancelled === true`, so a null on a genuine cancel
    // raised a "Purchase failed" alert over the dialog the user just dismissed.
    expect(classifyPurchaseError({ code: ERROR_CODE_PURCHASE_CANCELLED, userCancelled: null })).toBe(
      "cancelled",
    );
  });

  it("tolerates a numeric code from a bridge that did not stringify it", () => {
    expect(classifyPurchaseError({ code: 20 })).toBe("pending");
    expect(classifyPurchaseError({ code: 1 })).toBe("cancelled");
  });

  it("reads PRODUCT_ALREADY_PURCHASED_ERROR as already-owned, not failed", () => {
    // The SECOND-TAP case. After a pending purchase the CTA re-enables, so a user
    // can tap Subscribe again; the store answers "you already own this". Without
    // its own branch that falls into "failed", whose copy says "please try again"
    // — the exact advice the pending branch exists to stop giving, one tap later.
    // The right answer is Restore.
    expect(classifyPurchaseError({ code: ERROR_CODE_PRODUCT_ALREADY_PURCHASED })).toBe(
      "already-owned",
    );
    expect(ERROR_CODE_PRODUCT_ALREADY_PURCHASED).toBe("6");
    expect(classifyPurchaseError({ code: 6 })).toBe("already-owned");
  });

  it("classifies genuine store/network errors as failed", () => {
    // STORE_PROBLEM_ERROR, NETWORK_ERROR, PRODUCT_NOT_AVAILABLE — these SHOULD
    // reach the retryable alert. Deliberately excludes "6", which is retry-proof.
    for (const code of ["2", "10", "5", "16"]) {
      expect(classifyPurchaseError({ code }), `code ${code}`).toBe("failed");
    }
  });

  it("classifies a non-object throw as failed rather than crashing", () => {
    expect(classifyPurchaseError(null)).toBe("failed");
    expect(classifyPurchaseError(undefined)).toBe("failed");
    expect(classifyPurchaseError("boom")).toBe("failed");
    expect(classifyPurchaseError(new Error("boom"))).toBe("failed");
  });

  it("does not let userCancelled=false override a pending code", () => {
    // The SDK sets `userCancelled = false` on non-cancel errors, so the flag is
    // present on a pending error too; reading the code FIRST is what keeps this
    // out of the failure branch.
    expect(classifyPurchaseError({ code: ERROR_CODE_PAYMENT_PENDING, userCancelled: false })).toBe(
      "pending",
    );
  });
});


/**
 * The ACTION layer — what the paywall is told to do.
 *
 * This replaced a test that grepped the component's source for `case 'pending':`
 * and for the gating expression. A reviewer defeated it with a one-line refactor:
 * hoist `classifyPurchaseResult(...)` into an unused variable and then call
 * `onPurchaseSuccess()` unconditionally, restoring the original
 * unlock-on-resolve bug with all assertions still green. A grep over source text
 * cannot see whether a call sits INSIDE a branch, so the decision moved into the
 * module and these tests ask it directly.
 *
 * The property that matters is one-directional: `kind: "unlock"` must be
 * unreachable without a positively-confirmed active entitlement.
 */
describe("purchaseResultAction — unlock is reachable ONLY with an active entitlement", () => {
  const active = { customerInfo: { entitlements: { active: { pro: { isActive: true } } } } };

  it("unlocks on a confirmed active entitlement", () => {
    expect(purchaseResultAction(active, PRO)).toEqual({ kind: "unlock" });
  });

  it("never unlocks for ANY other payload — it alerts instead", () => {
    // The exhaustive negative. Every one of these resolved a purchase; none of
    // them confirmed an entitlement, so none may unlock.
    const notEntitled: unknown[] = [
      null,
      undefined,
      {},
      { customerInfo: null },
      { customerInfo: {} },
      { customerInfo: { entitlements: null } },
      { customerInfo: { entitlements: { active: null } } },
      { customerInfo: { entitlements: { active: {} } } },
      { customerInfo: { entitlements: { active: { pro: null } } } },
      { customerInfo: { entitlements: { active: { pro: { isActive: false } } } } },
      { customerInfo: { entitlements: { active: { pro: { isActive: "true" } } } } },
      { customerInfo: { entitlements: { active: { plus: { isActive: true } } } } },
    ];
    for (const payload of notEntitled) {
      const action = purchaseResultAction(payload as never, PRO);
      expect(action.kind, `${JSON.stringify(payload)} must not unlock`).toBe("alert");
    }
  });

  it("tells the truth on the pending path — no success claim, and no retry invitation", () => {
    const action = purchaseResultAction({ customerInfo: { entitlements: { active: {} } } }, PRO);
    if (action.kind !== "alert") throw new Error("expected an alert");
    // Must not assert Pro is active (F4.1: never render a success state the
    // operation did not produce), and must not invite a second purchase.
    expect(action.body).not.toMatch(/\bis active\b/i);
    expect(action.body).not.toMatch(/try again/i);
    expect(action.body).toMatch(/no need to buy again/i);
  });
});

describe("purchaseErrorAction — what the user is told when it throws", () => {
  it("stays SILENT on a cancel", () => {
    expect(purchaseErrorAction({ code: ERROR_CODE_PURCHASE_CANCELLED })).toEqual({ kind: "silent" });
  });

  it("never unlocks on any error, including unrecognised ones", () => {
    for (const err of [
      { code: ERROR_CODE_PAYMENT_PENDING },
      { code: ERROR_CODE_PRODUCT_ALREADY_PURCHASED },
      { code: "2" },
      { code: "999" },
      null,
      "boom",
      new Error("boom"),
    ]) {
      expect(purchaseErrorAction(err).kind, `${JSON.stringify(err)}`).not.toBe("unlock");
    }
  });

  it("does not say 'try again' on either non-failure outcome", () => {
    // This is the defect the whole change exists for: a charge in flight, or one
    // the store already holds, must never be answered with a retry invitation.
    for (const code of [ERROR_CODE_PAYMENT_PENDING, ERROR_CODE_PRODUCT_ALREADY_PURCHASED]) {
      const action = purchaseErrorAction({ code });
      if (action.kind !== "alert") throw new Error("expected an alert");
      expect(action.body, `code ${code}`).not.toMatch(/try again/i);
      expect(action.body, `code ${code}`).toMatch(/not buy again|no need to buy again/i);
    }
  });

  it("DOES say 'try again' on a genuine failure, where a retry is the right advice", () => {
    const action = purchaseErrorAction({ code: "10" }); // NETWORK_ERROR
    if (action.kind !== "alert") throw new Error("expected an alert");
    expect(action.body).toMatch(/try again/i);
  });

  it("HEDGES the already-owned copy instead of promising Restore will unlock", () => {
    // A reviewer traced the primary path here — tapping Subscribe again while the
    // first purchase is still pending — and showed that Restore will then find no
    // active entitlement and answer "No active subscription was found",
    // contradicting an unconditional "Restore will unlock Pro". So both branches
    // must be named.
    const action = purchaseErrorAction({ code: ERROR_CODE_PRODUCT_ALREADY_PURCHASED });
    if (action.kind !== "alert") throw new Error("expected an alert");
    expect(action.body).toMatch(/if the payment has cleared/i);
    expect(action.body).toMatch(/still\s+processing/i);
  });
});

/**
 * Every outcome gets its OWN answer — the property a deleted grep test used to
 * assert, re-established where it can actually hold.
 *
 * `purchaseErrorAction` has no `default:` branch, so a new member of
 * `classifyPurchaseError`'s return union stops the build at the `never`
 * assignment. That is the real guard, and it is a compile-time one: it cannot be
 * renamed, aliased or commented around, which is how all three previous
 * source-text versions of this guard were defeated.
 *
 * These tests cover what the compiler cannot: that the four outcomes map to four
 * DISTINCT answers, and specifically that none of them quietly collapses into the
 * "Purchase failed. Please try again." copy. A `default:` branch reintroduced
 * alongside a missing case would compile fine and be caught here instead.
 */
describe("every purchase-error outcome has its own answer", () => {
  const BY_OUTCOME = {
    cancelled: { code: ERROR_CODE_PURCHASE_CANCELLED },
    pending: { code: ERROR_CODE_PAYMENT_PENDING },
    "already-owned": { code: ERROR_CODE_PRODUCT_ALREADY_PURCHASED },
    failed: { code: "10" },
  } as const;

  it("maps the four outcomes to four distinct actions", () => {
    const rendered = Object.entries(BY_OUTCOME).map(([outcome, err]) => {
      const action = purchaseErrorAction(err);
      return `${outcome}:${action.kind}:${action.kind === "alert" ? action.title : ""}`;
    });
    // Four inputs, four different answers — no two outcomes share a response.
    expect(new Set(rendered).size).toBe(4);
  });

  it("only the genuine-failure outcome may show the failure copy", () => {
    // The regression this replaces a grep test for: a new or mis-wired outcome
    // inheriting "Purchase failed. Please try again." Everything that is NOT a
    // real failure must say something else.
    for (const [outcome, err] of Object.entries(BY_OUTCOME)) {
      const action = purchaseErrorAction(err);
      const showsFailureCopy = action.kind === "alert" && /try again/i.test(action.body);
      expect(showsFailureCopy, `${outcome} must${outcome === "failed" ? "" : " NOT"} show the failure copy`).toBe(
        outcome === "failed",
      );
    }
  });

  it("the resolved-pending and thrown-pending paths give the SAME message", () => {
    // One user-facing state, one string. They were two near-identical strings
    // until a reviewer pointed out a user only ever sees one of them.
    const fromResolve = purchaseResultAction({ customerInfo: { entitlements: { active: {} } } }, PRO);
    const fromThrow = purchaseErrorAction({ code: ERROR_CODE_PAYMENT_PENDING });
    expect(fromResolve).toEqual(fromThrow);
  });
});

/**
 * DISPATCH — which effect fires for which action.
 *
 * The negative assertions are the point. A reviewer showed that adding
 * `onPurchaseSuccess?.()` to the component's `alert` branch unlocked Pro on every
 * alert, INCLUDING a genuine purchase failure, with every test still green. That
 * was invisible because the switch lived in a React component the web runner
 * cannot import. It lives in the module now, so the question is answerable.
 */
describe("performPurchaseAction — only an unlock action may unlock", () => {
  // The two handlers are NOMINAL types, so a bare vi.fn() is no longer
  // assignable to either slot — the factories are the only way in. They cast
  // rather than wrap, so `h.unlock` is still the mock at runtime and the
  // toHaveBeenCalled assertions below are unaffected.
  // The two handlers are NOMINAL types, so a bare vi.fn() is no longer
  // assignable to either slot — the factories are the only way in. The mocks
  // are kept alongside so the assertions below stay fully typed.
  const spies = () => {
    const unlock = vi.fn();
    const alert = vi.fn();
    return {
      unlock,
      alert,
      handlers: { unlock: unlockHandler(unlock), alert: alertHandler(alert) },
    };
  };

  it("unlocks, and does not alert, on an unlock action", () => {
    const h = spies();
    performPurchaseAction({ kind: "unlock" }, h.handlers);
    expect(h.unlock).toHaveBeenCalledTimes(1);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("alerts WITHOUT unlocking, and passes the title and body through", () => {
    const h = spies();
    performPurchaseAction({ kind: "alert", title: "T", body: "B" }, h.handlers);
    expect(h.alert).toHaveBeenCalledWith("T", "B");
    expect(h.unlock, "an alert must never unlock Pro").not.toHaveBeenCalled();
  });

  it("does neither on a silent action", () => {
    const h = spies();
    performPurchaseAction({ kind: "silent" }, h.handlers);
    expect(h.unlock).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("never unlocks for ANY action a real purchase outcome can produce", () => {
    // End to end over the module: every outcome the two classifiers can yield,
    // dispatched for real, asserting the unlock fires ONLY where an entitlement
    // was confirmed. This is the property the whole change exists to hold.
    const entitled = { customerInfo: { entitlements: { active: { pro: { isActive: true } } } } };
    const cases: Array<[string, () => void, boolean]> = [
      ["resolved + entitled", () => {}, true],
      ["resolved, not entitled", () => {}, false],
      ["thrown: cancelled", () => {}, false],
      ["thrown: pending", () => {}, false],
      ["thrown: already-owned", () => {}, false],
      ["thrown: failed", () => {}, false],
    ];
    const actions = [
      purchaseResultAction(entitled, PRO),
      purchaseResultAction({ customerInfo: { entitlements: { active: {} } } }, PRO),
      purchaseErrorAction({ code: ERROR_CODE_PURCHASE_CANCELLED }),
      purchaseErrorAction({ code: ERROR_CODE_PAYMENT_PENDING }),
      purchaseErrorAction({ code: ERROR_CODE_PRODUCT_ALREADY_PURCHASED }),
      purchaseErrorAction({ code: "10" }),
    ];
    actions.forEach((action, i) => {
      const h = spies();
      performPurchaseAction(action, h.handlers);
      const [label, , shouldUnlock] = cases[i];
      expect(h.unlock.mock.calls.length > 0, `${label} should${shouldUnlock ? "" : " NOT"} unlock`).toBe(
        shouldUnlock,
      );
    });
  });
});

/**
 * THE HANDLER-CROSSING GUARD — and why it is a TYPE test, not another assertion.
 *
 * Routing the decision through `performPurchaseAction` fixed the switch; it did
 * not fix the WIRING. With plain structural types, this call site
 *
 *     performPurchaseAction(action, {
 *       unlock: () => Alert.alert('Purchase failed', 'Please try again.'),
 *       alert:  () => { onPurchaseSuccess?.(); onDismiss(); },
 *     })
 *
 * inverts the whole property — a DECLINED card unlocks Pro — while routing
 * correctly through this tested dispatcher and passing every runtime test, both
 * tsc runs and lint. A reviewer demonstrated exactly that.
 *
 * Four SOURCE-TEXT guards were defeated on this property before this one
 * (a grep for `case`, a source slicer beaten by a different branch, by an alias,
 * and by a comment carrying the slicer's end-marker), so this is deliberately
 * not a fifth. `@ts-expect-error` is a COMPILER assertion: if any expression
 * below ever becomes legal, `npx tsc --noEmit` FAILS with "unused
 * '@ts-expect-error' directive". It cannot be renamed, aliased or commented
 * around, because it is not reading text at all.
 */
describe("performPurchaseAction — the handler roles cannot be crossed", () => {
  it("REJECTS a bare closure in either slot (the only way in is the factories)", () => {
    performPurchaseAction(
      { kind: "silent" },
      {
        // @ts-expect-error a plain () => void is not an UnlockHandler
        unlock: () => {},
        alert: alertHandler(vi.fn()),
      },
    );
    performPurchaseAction(
      { kind: "silent" },
      {
        unlock: unlockHandler(vi.fn()),
        // @ts-expect-error a plain (t, b) => void is not an AlertHandler
        alert: (_t: string, _b: string) => {},
      },
    );
  });

  it("REJECTS the swap that inverts the outcome", () => {
    const unlockBody = unlockHandler(vi.fn());
    const alertBody = alertHandler(vi.fn());
    performPurchaseAction(
      { kind: "silent" },
      {
        // @ts-expect-error an AlertHandler must not be bound to `unlock`
        unlock: alertBody,
        // @ts-expect-error an UnlockHandler must not be bound to `alert`
        alert: unlockBody,
      },
    );
  });

  it("ACCEPTS correctly-tagged handlers (the guard is not vacuous)", () => {
    // A rejection test that rejects everything proves nothing. This is the
    // positive control: the real shape still compiles and still dispatches.
    const unlock = vi.fn();
    const alert = vi.fn();
    performPurchaseAction(
      { kind: "unlock" },
      { unlock: unlockHandler(unlock), alert: alertHandler(alert) },
    );
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
});
