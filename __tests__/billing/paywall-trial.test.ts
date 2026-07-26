/**
 * `productHasFreeTrial` — the check that decides whether the mobile paywall is
 * allowed to say "free trial".
 *
 * The failure this guards against is one-directional and expensive: claiming a
 * trial that the store product does not have means the buyer reads "you won't
 * be charged until the trial ends", taps, and is charged immediately. So every
 * uncertain case must resolve to FALSE. The tests below are written around that
 * asymmetry rather than around the happy path.
 */

import { describe, it, expect } from "vitest";

import {
  productHasFreeTrial,
  resolveFreeTrial,
  ELIGIBILITY_ELIGIBLE,
} from "@/mobile/src/lib/paywall-trial";

// RevenueCat's INTRO_ELIGIBILITY_STATUS values.
const UNKNOWN = 0;
const INELIGIBLE = 1;
const NO_INTRO_OFFER = 3;

describe("productHasFreeTrial — positive cases", () => {
  it("detects a StoreKit introductory offer priced at zero", () => {
    expect(productHasFreeTrial({ introPrice: { price: 0 } })).toBe(true);
  });

  it("detects the Google Play free pricing phase", () => {
    expect(
      productHasFreeTrial({
        introPrice: null,
        defaultOption: { freePhase: { billingPeriod: "P1W" } },
      }),
    ).toBe(true);
  });
});

describe("productHasFreeTrial — everything uncertain reads as NO trial", () => {
  it("is false when the product has no introductory offer at all", () => {
    // The configuration this whole change exists for: a plain $49/month
    // subscription with no intro offer set up in App Store Connect.
    expect(productHasFreeTrial({ introPrice: null })).toBe(false);
    expect(productHasFreeTrial({})).toBe(false);
  });

  it("is false for a PAID introductory offer, which is not a free trial", () => {
    // "$1 for your first month" is a real offer, but the buyer IS charged
    // today — the trial wording would be a lie.
    expect(productHasFreeTrial({ introPrice: { price: 0.99 } })).toBe(false);
  });

  it("is false when the free phase is explicitly absent on Android", () => {
    expect(productHasFreeTrial({ defaultOption: { freePhase: null } })).toBe(false);
    expect(productHasFreeTrial({ defaultOption: null })).toBe(false);
  });

  it("is false for a missing product rather than throwing", () => {
    // The sheet renders before offerings resolve, and a malformed RC payload
    // can drop `product` entirely — this must not white-screen the paywall.
    expect(productHasFreeTrial(null)).toBe(false);
    expect(productHasFreeTrial(undefined)).toBe(false);
  });

  it("is false for a malformed price the RC types say cannot happen", () => {
    // The network payload behind those types is not validated; a string "0"
    // must not be coerced into a trial promise.
    const malformed = { introPrice: { price: "0" } } as unknown as Parameters<
      typeof productHasFreeTrial
    >[0];
    expect(productHasFreeTrial(malformed)).toBe(false);
  });
});

describe("resolveFreeTrial — per-BUYER eligibility, not just per-product config", () => {
  const withTrial = { introPrice: { price: 0 } };

  it("iOS: shows the trial only when this Apple ID is still eligible", () => {
    expect(resolveFreeTrial(withTrial, true, ELIGIBILITY_ELIGIBLE)).toBe(true);
  });

  it("iOS: hides it from a returning subscriber who already used theirs", () => {
    // The case that makes a product-only check dangerous — the trial IS
    // configured, so `productHasFreeTrial` says true, but this buyer would be
    // charged immediately after being told they wouldn't be.
    expect(productHasFreeTrial(withTrial)).toBe(true);
    expect(resolveFreeTrial(withTrial, true, INELIGIBLE)).toBe(false);
  });

  it("iOS: treats an unknown or failed eligibility lookup as NO trial", () => {
    // RevenueCat's own guidance: show non-intro pricing when the status is
    // unknown. Under-promising costs a little conversion; over-promising
    // charges someone who was told they wouldn't be.
    expect(resolveFreeTrial(withTrial, true, UNKNOWN)).toBe(false);
    expect(resolveFreeTrial(withTrial, true, NO_INTRO_OFFER)).toBe(false);
    expect(resolveFreeTrial(withTrial, true, null)).toBe(false);
    expect(resolveFreeTrial(withTrial, true, undefined)).toBe(false);
  });

  it("Android: does NOT require an eligible status, which never arrives there", () => {
    // checkTrialOrIntroductoryPriceEligibility always answers UNKNOWN on
    // Android; Play filters ineligible offers server-side, so the returned free
    // phase IS the eligibility signal. Requiring ELIGIBLE here would suppress
    // every genuine Android trial.
    expect(resolveFreeTrial({ defaultOption: { freePhase: {} } }, false, UNKNOWN)).toBe(true);
    expect(resolveFreeTrial(withTrial, false, null)).toBe(true);
  });

  it("never invents a trial for a product that has none, on either platform", () => {
    expect(resolveFreeTrial({ introPrice: null }, true, ELIGIBILITY_ELIGIBLE)).toBe(false);
    expect(resolveFreeTrial({ introPrice: null }, false, ELIGIBILITY_ELIGIBLE)).toBe(false);
    expect(resolveFreeTrial(null, false, ELIGIBILITY_ELIGIBLE)).toBe(false);
  });
});
