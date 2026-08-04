/**
 * The mobile paywall's pre-load display (shown before RevenueCat's real
 * offering resolves, or when RC is unconfigured) must include the $29
 * Apartment one-time tier alongside Pro Monthly — not just the subscription.
 * See mobile/src/lib/paywall-fallback.ts for why: the business case
 * (docs/BUSINESS_CASE.md) credits that low-commitment entry tier with the
 * majority of modeled conversions, and a buyer who opens the paywall before
 * the network round-trip resolves previously never saw it.
 */
import { describe, it, expect } from "vitest";

import { FALLBACK_OPTIONS } from "@/mobile/src/lib/paywall-fallback";

describe("FALLBACK_OPTIONS — the mobile paywall's pre-load display", () => {
  it("includes both the Apartment one-time tier and Pro Monthly", () => {
    const labels = FALLBACK_OPTIONS.map((o) => o.label);
    expect(labels).toContain("Apartment");
    expect(labels).toContain("Monthly");
  });

  it("lists the Apartment tier first — the low-commitment entry point is the default", () => {
    // The whole point of this fallback is that a buyer who opens the paywall
    // before RC's real offering loads sees the cheap entry tier, not just the
    // subscription. A future edit that silently reorders the array back to
    // Monthly-first would regress that intent while still passing a plain
    // membership assertion.
    expect(FALLBACK_OPTIONS[0]?.label).toBe("Apartment");
  });

  it("prices the Apartment tier at its real, live $29 one-time price", () => {
    const apartment = FALLBACK_OPTIONS.find((o) => o.label === "Apartment");
    expect(apartment?.price).toBe("$29 one-time");
    expect(apartment?.isRecurring).toBe(false);
  });

  it("prices Pro Monthly at its real, live $49/month price", () => {
    const monthly = FALLBACK_OPTIONS.find((o) => o.label === "Monthly");
    expect(monthly?.price).toBe("$49 / month");
    expect(monthly?.isRecurring).toBe(true);
  });

  it("excludes Pro Annual — it stays gated off until annual billing is live", () => {
    const labels = FALLBACK_OPTIONS.map((o) => o.label);
    expect(labels).not.toContain("Annual");
  });

  it("carries no purchasable package on any fallback option", () => {
    // These display before the real RC offering loads, so none of them can
    // be purchased yet — the sheet's CTA warns instead of charging.
    for (const option of FALLBACK_OPTIONS) {
      expect(option.pkg).toBeNull();
    }
  });
});
