/**
 * What the mobile paywall promises at the point of purchase.
 *
 * The property is narrow and legal, not aesthetic: the terms shown before the
 * buyer consents must describe what the STORE will actually do (Apple App Store
 * 3.1.2, Google Play subscription policy). The sheet rendered the subscription
 * answer for every package RevenueCat returned, so a NON-SUBSCRIPTION package —
 * a lifetime unlock, a credit pack — was sold with "renewing automatically until
 * you cancel", "Manage or cancel anytime in your subscription settings", and
 * "By subscribing". Three false statements at the moment of consent.
 *
 * These tests assert the one-time branches say none of those things, and that
 * the subscription branches are unchanged.
 */

import { describe, it, expect } from "vitest";

import {
  classifyProductShape,
  planLabel,
  purchaseAgreementLead,
  purchaseCtaLabel,
  purchaseDisclosure,
} from "@/mobile/src/lib/paywall-disclosure";

/** Words that are only true of a renewing subscription. */
const RECURRENCE_CLAIMS = [/renew/i, /automatically/i, /subscription settings/i, /cancel/i];

describe("purchaseDisclosure — a one-time purchase is never described as renewing", () => {
  it("makes NO recurrence or cancellation claim for a one-time purchase", () => {
    const copy = purchaseDisclosure({
      isRecurring: false,
      isRestorable: true,
      hasFreeTrial: false,
      price: "$99.99",
    });
    // "there is nothing to cancel" is the one legitimate use of the word, so
    // check the CLAIMS rather than the vocabulary.
    expect(copy).not.toMatch(/renew/i);
    expect(copy).not.toMatch(/automatically/i);
    expect(copy).not.toMatch(/subscription settings/i);
    expect(copy).not.toMatch(/until you cancel/i);
    expect(copy).toContain("$99.99");
    expect(copy).toMatch(/once/i);
    expect(copy).toMatch(/one-time purchase/i);
  });

  it("offers the restore path, which is the real equivalent of 'manage'", () => {
    // A non-consumable has nothing to cancel, but App Review does require a
    // restore mechanism — so the sentence has to point somewhere, not nowhere.
    const copy = purchaseDisclosure({ isRecurring: false, isRestorable: true, hasFreeTrial: false, price: "$99.99" });
    expect(copy).toMatch(/restore purchases/i);
  });

  it("does NOT promise a free trial on a one-time purchase even if the flag is set", () => {
    // A trial is a subscription concept. If a non-subscription product somehow
    // reports one, saying nothing beats promising a free phase the store will
    // not honour.
    const copy = purchaseDisclosure({ isRecurring: false, isRestorable: true, hasFreeTrial: true, price: "$99.99" });
    expect(copy).not.toMatch(/free trial/i);
    expect(copy).not.toMatch(/renew/i);
    expect(copy).toMatch(/one-time purchase/i);
  });

  it("still states the amount when the price is unknown-free (no price, no lie)", () => {
    const copy = purchaseDisclosure({ isRecurring: false, isRestorable: true, hasFreeTrial: false, price: null });
    expect(copy).not.toMatch(/\$/);
    expect(copy).not.toMatch(/charged/i);
    expect(copy).toMatch(/one-time purchase/i);
  });
});

describe("purchaseDisclosure — the subscription copy is unchanged", () => {
  it("discloses the recurring amount, the renewal, and HOW to cancel", () => {
    const copy = purchaseDisclosure({
      isRecurring: true,
      isRestorable: true,
      hasFreeTrial: false,
      price: "$49 / month",
    });
    expect(copy).toContain("$49 / month");
    expect(copy).toMatch(/renewing automatically until you cancel/i);
    // 3.1.2(v) and Play both require the cancellation METHOD, not just that one
    // exists.
    expect(copy).toMatch(/App Store or Google Play subscription settings/i);
  });

  it("describes the trial as a phase that ENDS in a charge, never as free forever", () => {
    const copy = purchaseDisclosure({
      isRecurring: true,
      isRestorable: true,
      hasFreeTrial: true,
      price: "$399 / year",
    });
    expect(copy).toMatch(/free trial then renews at \$399 \/ year/i);
    expect(copy).toMatch(/before it ends/i);
    expect(copy).toMatch(/App Store or Google Play subscription settings/i);
  });

  it("falls back to a priceless but still accurate sentence", () => {
    const noPrice = purchaseDisclosure({ isRecurring: true, isRestorable: true, hasFreeTrial: false, price: null });
    expect(noPrice).toMatch(/renews automatically until you cancel/i);
    const noPriceTrial = purchaseDisclosure({ isRecurring: true, isRestorable: true, hasFreeTrial: true, price: null });
    expect(noPriceTrial).toMatch(/charged when your free trial ends/i);
  });

  it("makes at least one recurrence claim on EVERY subscription branch", () => {
    // The mirror of the one-time assertions: guards against a future edit that
    // strips the required disclosure from a subscription instead of adding it
    // to the one-off.
    for (const hasFreeTrial of [true, false]) {
      for (const price of ["$49 / month", null]) {
        const copy = purchaseDisclosure({ isRecurring: true, isRestorable: true, hasFreeTrial, price });
        expect(RECURRENCE_CLAIMS.some((re) => re.test(copy))).toBe(true);
      }
    }
  });
});

describe("purchaseAgreementLead", () => {
  it("says 'purchasing', not 'subscribing', for a one-time purchase", () => {
    expect(purchaseAgreementLead(false)).toBe("By purchasing you agree to our");
    expect(purchaseAgreementLead(false)).not.toMatch(/subscrib/i);
  });

  it("says 'subscribing' for a subscription", () => {
    expect(purchaseAgreementLead(true)).toMatch(/subscribing/i);
  });
});

describe("purchaseCtaLabel", () => {
  it("does not invite the user to 'Subscribe' to a one-time purchase", () => {
    expect(purchaseCtaLabel({ isRecurring: false, hasFreeTrial: false })).toBe("Purchase");
    expect(purchaseCtaLabel({ isRecurring: false, hasFreeTrial: true })).toBe("Purchase");
  });

  it("keeps the subscription labels", () => {
    expect(purchaseCtaLabel({ isRecurring: true, hasFreeTrial: true })).toBe("Start Free Trial");
    expect(purchaseCtaLabel({ isRecurring: true, hasFreeTrial: false })).toBe("Subscribe");
  });
});

describe("planLabel — a raw store product id is not a plan name", () => {
  it("prefers the store-localised product title", () => {
    expect(planLabel("Lifetime Access", "com.aptdesignerai.lifetime")).toBe("Lifetime Access");
  });

  it("falls back to the identifier rather than rendering nothing", () => {
    // Nameless is worse than ugly — an option with no label is unpickable.
    expect(planLabel(null, "com.aptdesignerai.lifetime")).toBe("com.aptdesignerai.lifetime");
    expect(planLabel(undefined, "id")).toBe("id");
    expect(planLabel("   ", "id")).toBe("id");
  });
});

/**
 * The consumable case, which the FIRST draft of this module got wrong in the
 * most instructive way: it replaced "renews automatically until you cancel"
 * with "Use Restore Purchases to get it back on another device" for EVERY
 * non-subscription package — including the credit pack the module's own header
 * names as the motivating example. StoreKit keeps no persistent record of a
 * consumed transaction, so restore cannot return it. One false promise swapped
 * for another, on the exact product it was written for, with a green test
 * certifying it.
 */
describe("purchaseDisclosure — a consumable is never promised a restore", () => {
  it("omits the restore sentence for a non-restorable one-time purchase", () => {
    const copy = purchaseDisclosure({
      isRecurring: false,
      isRestorable: false,
      hasFreeTrial: false,
      price: "$9.99",
    });
    expect(copy).not.toMatch(/restore/i);
    expect(copy).toMatch(/one-time purchase/i);
    expect(copy).not.toMatch(/renew/i);
    expect(copy).toContain("$9.99");
  });

  it("still offers restore for a non-consumable", () => {
    const copy = purchaseDisclosure({
      isRecurring: false,
      isRestorable: true,
      hasFreeTrial: false,
      price: "$99.99",
    });
    expect(copy).toMatch(/restore purchases/i);
  });
});

/**
 * `classifyProductShape` reads the PRODUCT. The first draft read
 * `pkg.packageType` — the offering SLOT — which misfiles a CUSTOM-slot
 * subscription as a one-time purchase and drops its renewal disclosure. That is
 * the undisclosed-auto-renewal direction, which is the one Apple 3.1.2 and the
 * FTC actually enforce.
 */
describe("classifyProductShape", () => {
  it("treats an auto-renewable subscription as recurring however it is slotted", () => {
    expect(
      classifyProductShape({
        productCategory: "SUBSCRIPTION",
        productType: "AUTO_RENEWABLE_SUBSCRIPTION",
        subscriptionPeriod: "P1M",
      }).isRecurring,
    ).toBe(true);
    // The CUSTOM-slot case that defeated the packageType approach: the slot
    // says nothing, but the product plainly renews.
    expect(
      classifyProductShape({
        productCategory: "SUBSCRIPTION",
        productType: "UNKNOWN",
        subscriptionPeriod: null,
      }).isRecurring,
    ).toBe(true);
    expect(
      classifyProductShape({ productCategory: null, productType: null, subscriptionPeriod: "P1Y" })
        .isRecurring,
    ).toBe(true);
  });

  it("treats Google Play prepaid subscriptions as recurring", () => {
    expect(classifyProductShape({ productType: "PREPAID_SUBSCRIPTION" }).isRecurring).toBe(true);
  });

  it("treats a consumable as one-time AND non-restorable", () => {
    const shape = classifyProductShape({
      productCategory: "NON_SUBSCRIPTION",
      productType: "CONSUMABLE",
    });
    expect(shape).toEqual({ isRecurring: false, isRestorable: false });
  });

  it("treats a non-consumable as one-time but restorable", () => {
    const shape = classifyProductShape({
      productCategory: "NON_SUBSCRIPTION",
      productType: "NON_CONSUMABLE",
    });
    expect(shape).toEqual({ isRecurring: false, isRestorable: true });
  });

  it("ASSUMES IT RENEWS when nothing conclusive says otherwise", () => {
    // The asymmetry that decides the default: an undisclosed auto-renewal is
    // enforced negative-option billing; an over-disclosed one-off is corrected
    // by the store's own purchase sheet moments later.
    for (const product of [null, undefined, {}, { productCategory: "UNKNOWN", productType: "UNKNOWN" }]) {
      expect(classifyProductShape(product).isRecurring, JSON.stringify(product)).toBe(true);
    }
  });

  it("NEVER claims restorability it cannot prove", () => {
    for (const product of [null, undefined, {}, { productType: "UNKNOWN" }]) {
      expect(classifyProductShape(product).isRestorable, JSON.stringify(product)).toBe(false);
    }
  });
});
