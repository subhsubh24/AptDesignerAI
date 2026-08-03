/**
 * The mobile paywall must not offer a RevenueCat "Annual" package while Pro
 * Annual is gated off on the backend (lib/billing/stripe.ts's
 * isAnnualBillingEnabled(), migration 021 unapplied) — a purchase the store
 * would charge but the backend cannot yet grant entitlement for. See
 * mobile/src/lib/paywall-annual-gate.ts.
 */
import { describe, it, expect } from "vitest";

import { shouldOfferPackage } from "@/mobile/src/lib/paywall-annual-gate";

describe("shouldOfferPackage — the mobile Pro Annual gate", () => {
  it("drops an annual package when annual billing is not enabled", () => {
    expect(shouldOfferPackage(true, false)).toBe(false);
  });

  it("offers an annual package once annual billing is enabled", () => {
    expect(shouldOfferPackage(true, true)).toBe(true);
  });

  it("always offers a non-annual package, regardless of the flag", () => {
    expect(shouldOfferPackage(false, false)).toBe(true);
    expect(shouldOfferPackage(false, true)).toBe(true);
  });
});
