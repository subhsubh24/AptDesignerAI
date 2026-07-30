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

import { describe, it, expect } from "vitest";

import {
  hasActiveEntitlement,
  classifyPurchaseResult,
  classifyPurchaseError,
  ERROR_CODE_PURCHASE_CANCELLED,
  ERROR_CODE_PAYMENT_PENDING,
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

  it("never returns a third value the caller does not handle", () => {
    // The paywall branches on exactly two outcomes; a new one would silently
    // fall into the pending copy.
    const outcomes = new Set([
      classifyPurchaseResult({ customerInfo: { entitlements: { active: { pro: { isActive: true } } } } }, PRO),
      classifyPurchaseResult({}, PRO),
    ]);
    expect([...outcomes].sort()).toEqual(["pending", "unlocked"]);
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

  it("classifies genuine store/network errors as failed", () => {
    // STORE_PROBLEM_ERROR, NETWORK_ERROR, PRODUCT_NOT_AVAILABLE — these SHOULD
    // reach the retryable alert.
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
