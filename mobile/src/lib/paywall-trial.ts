// Does the store product the user is about to buy actually include a free
// trial?
//
// The paywall used to assert "Free trial included" / "Start Free Trial" /
// "Your free trial then renews at …" unconditionally, as static copy. Whether a
// trial exists is NOT a property of our code — it is an introductory offer
// configured per product in App Store Connect / Google Play and surfaced
// through RevenueCat. If one isn't configured (or is configured on only one of
// the two plans, or the user has already used theirs), that copy tells the
// buyer they won't be charged today and then charges them today. That is a
// misstatement of the subscription terms at the point of purchase — Apple App
// Store Review 3.1.2 requires the price, period and terms shown there to be
// accurate — quite apart from being unfair to the buyer.
//
// So the claim is DERIVED from the product instead of asserted. Deliberately
// conservative: anything we cannot positively confirm as a free phase reads as
// NO trial, because over-promising is the harmful direction and under-promising
// merely costs a little conversion.
//
// Typed structurally rather than against RevenueCat's `PurchasesStoreProduct`
// so this stays a pure module with no native import — which is what lets
// `__tests__/billing/paywall-trial.test.ts` exercise it from the web test
// runner (the Expo app has none of its own).

/** The two fields across iOS and Android that can carry a free phase. */
export interface TrialProbeProduct {
  /**
   * StoreKit introductory offer (also populated on Android for the default
   * option). A free trial is an intro price of exactly 0.
   */
  readonly introPrice?: { readonly price: number } | null;
  /** Google Play billing: the free phase of the default subscription option. */
  readonly defaultOption?: { readonly freePhase?: unknown | null } | null;
}

/**
 * True only when the product positively carries a free introductory phase.
 *
 * Returns false for a missing product, a missing/absent intro offer, a PAID
 * intro offer (e.g. "$1 for the first month" — real, but not a free trial), and
 * any malformed payload. RevenueCat's types promise these fields, but the
 * network payload behind them is not type-checked, so each access is guarded.
 *
 * NOTE: this answers "is a trial CONFIGURED on this product", which is not the
 * same question as "will THIS buyer get it" — see resolveFreeTrial.
 */
export function productHasFreeTrial(product: TrialProbeProduct | null | undefined): boolean {
  if (!product) return false;

  const introPrice = product.introPrice;
  if (introPrice && typeof introPrice.price === "number" && introPrice.price === 0) {
    return true;
  }

  // Google Play exposes the trial as a distinct pricing phase rather than an
  // intro price; its presence alone means a free phase exists.
  if (product.defaultOption?.freePhase != null) return true;

  return false;
}

/** RevenueCat's INTRO_ELIGIBILITY_STATUS_ELIGIBLE. Mirrored to keep this module native-free. */
export const ELIGIBILITY_ELIGIBLE = 2;

/**
 * Will THIS buyer actually get the free trial?
 *
 * `introPrice` is static PRODUCT metadata — it says a trial is configured, not
 * that the person tapping the button is still entitled to one. Apple and Google
 * grant an introductory offer once per subscription group per account, so a
 * returning subscriber (lapsed, resubscribing, or sharing a family account that
 * already redeemed it) sees the trial configured and is charged immediately.
 * That is the SAME "told you won't be charged today, charged today" harm this
 * module exists to prevent, just reached by the more common route.
 *
 * The two stores need different treatment:
 *  - iOS: eligibility is per-Apple-ID and the app must ask
 *    (`Purchases.checkTrialOrIntroductoryPriceEligibility`). Anything that is
 *    not a positive ELIGIBLE — INELIGIBLE, UNKNOWN, a failed lookup — reads as
 *    no trial, per RevenueCat's own guidance to show non-intro pricing when the
 *    status is unknown.
 *  - Android: Play filters ineligible offers out server-side before RevenueCat
 *    ever sees them, and the eligibility API always answers UNKNOWN there. So
 *    requiring ELIGIBLE on Android would suppress every genuine trial; the
 *    presence of the free phase in the returned offer IS the eligibility signal.
 *
 * @param isIOS pass `Platform.OS === 'ios'` — injected so this stays testable
 *              without pulling react-native into the web test runner.
 * @param eligibilityStatus INTRO_ELIGIBILITY_STATUS for this product, or
 *              null/undefined when the lookup was not run or failed.
 */
export function resolveFreeTrial(
  product: TrialProbeProduct | null | undefined,
  isIOS: boolean,
  eligibilityStatus: number | null | undefined,
): boolean {
  if (!productHasFreeTrial(product)) return false;
  if (isIOS) return eligibilityStatus === ELIGIBILITY_ELIGIBLE;
  return true;
}
