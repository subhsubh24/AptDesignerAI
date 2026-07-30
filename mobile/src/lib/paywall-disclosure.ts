/**
 * What the paywall must SAY at the point of purchase, per the plan actually
 * selected.
 *
 * Apple App Store 3.1.2 and Google Play's subscription policy both require the
 * terms shown before consent to describe what the store will really do: the
 * amount, the billing period, whether it renews, and how to cancel. The sheet
 * had one hard-coded answer to all of that — the SUBSCRIPTION answer.
 *
 * `packagesToOptions` renders whatever RevenueCat returns in the offering, and
 * an offering may contain a NON-SUBSCRIPTION package (a lifetime unlock, a
 * credit pack). For one of those, the sheet said:
 *
 *     "You'll be charged $99.99, renewing automatically until you cancel.
 *      Manage or cancel anytime in your App Store or Google Play subscription
 *      settings. By subscribing you agree to…"
 *
 * Every clause of that is false for a one-time purchase — it does not renew,
 * there is nothing to cancel, and the buyer is not subscribing. That is a
 * misrepresentation at the moment of consent: a review rejection under 3.1.2,
 * and a chargeback argument from any buyer who read it.
 *
 * The decision lives here rather than in the component for the reason the
 * sibling modules (`paywall-trial.ts`, `purchase-outcome.ts`) already record:
 * there is no React Native test runner in this repo, so anything left inside
 * the component can only be guarded by a source-text assertion — and four of
 * those have been defeated on this same screen. As a pure module the copy is
 * asserted directly.
 *
 * Written BEFORE the owner adds a non-subscription product to the RevenueCat
 * offering, deliberately: the wrong copy would otherwise ship the moment they
 * do, with no code change to trigger a review.
 */

export interface PurchaseTerms {
  /** True for a subscription (renews); false for a one-time purchase. */
  isRecurring: boolean;
  /**
   * Whether the store can actually give this purchase back on another device.
   * NOT the same question as `isRecurring`: a CONSUMABLE (a credit pack) is a
   * one-time purchase that is NOT restorable, because StoreKit keeps no
   * persistent record of a consumed transaction. Telling that buyer to "Use
   * Restore Purchases" is a promise the store cannot keep — the first draft of
   * this module made exactly that substitution, replacing one false statement
   * with another, on the very product type the module was written for.
   */
  isRestorable: boolean;
  /** A free trial this buyer can actually still take. See `paywall-trial`. */
  hasFreeTrial: boolean;
  /** Display price as rendered, e.g. "$49 / month" — null when unknown. */
  price: string | null;
}

/**
 * Decide the two shape questions from what RevenueCat actually reports about
 * the PRODUCT.
 *
 * The first draft read `pkg.packageType`, which is wrong: `packageType` only
 * says which OFFERING SLOT the product was placed in, not what the product is.
 * A CUSTOM-slot package wrapping an auto-renewable subscription is an ordinary
 * RevenueCat configuration (a promo tier outside the six predefined periods),
 * and reading the slot classified it as a one-time purchase — omitting the
 * renewal amount, period and cancellation method for a charge that really does
 * auto-renew. `productCategory` / `productType` / `subscriptionPeriod` are the
 * fields that describe the product itself.
 *
 * WHEN IN DOUBT, ASSUME IT RENEWS. Both errors are misrepresentations, but they
 * are not symmetric: an undisclosed auto-renewal is the negative-option billing
 * that Apple 3.1.2 and the FTC actively enforce, while over-disclosing a
 * commitment on a one-off is corrected by the store's own purchase sheet
 * seconds later. So UNKNOWN and absent both fall to recurring.
 *
 * Restorability defaults the other way, for the same reason in mirror image:
 * an unproven restore path is a promise we should not make.
 */
export function classifyProductShape(product: {
  productCategory?: string | null;
  productType?: string | null;
  subscriptionPeriod?: string | null;
} | null | undefined): Pick<PurchaseTerms, 'isRecurring' | 'isRestorable'> {
  const category = product?.productCategory ?? null;
  const type = product?.productType ?? null;

  const isRecurring =
    category === 'SUBSCRIPTION' ||
    type === 'AUTO_RENEWABLE_SUBSCRIPTION' ||
    type === 'PREPAID_SUBSCRIPTION' ||
    (product?.subscriptionPeriod ?? null) !== null ||
    // Nothing conclusive said "one-time", so assume the commitment.
    (category !== 'NON_SUBSCRIPTION' && type !== 'CONSUMABLE' && type !== 'NON_CONSUMABLE' &&
      type !== 'NON_RENEWABLE_SUBSCRIPTION');

  // Only a CONSUMABLE is definitively non-restorable; UNKNOWN is treated as
  // non-restorable too, so the copy never promises a restore we cannot prove.
  // Everything else — including both SUBSCRIPTION types, which Apple requires a
  // working restore path for — is restorable. The first draft listed the two
  // one-time types explicitly and so reported an ACTIVE subscription as
  // non-restorable, contradicting the sentence directly above it. Inert today
  // (the copy only reads this on the non-recurring branch) but the field lied
  // about what it computes, and DisplayOption carries it unqualified.
  const isRestorable =
    type !== null && type !== 'CONSUMABLE' && type !== 'UNKNOWN';

  return { isRecurring, isRestorable };
}

/**
 * The legal sentence(s) shown directly above the Terms/Privacy links.
 *
 * Recurring copy is unchanged from what shipped; the one-time branches are the
 * new, true statements. A one-time purchase gets no "cancel" instruction —
 * there is nothing to cancel. It gets the restore path only when the store can
 * actually honour it (see `isRestorable`): that is the genuine equivalent
 * affordance for a NON-CONSUMABLE, and an App Review requirement for one, but a
 * consumable cannot be restored and must not be told otherwise.
 */
export function purchaseDisclosure({
  isRecurring,
  isRestorable,
  hasFreeTrial,
  price,
}: PurchaseTerms): string {
  const manage = isRecurring
    ? 'Manage or cancel anytime in your App Store or Google Play subscription settings. '
    : isRestorable
      ? 'This is a one-time purchase, not a subscription — there is nothing to cancel. ' +
        'Use Restore Purchases to get it back on another device. '
      // A consumable cannot be restored, so the sentence stops at the truth.
      : 'This is a one-time purchase, not a subscription — there is nothing to cancel. ';

  if (!isRecurring) {
    // A trial is a subscription concept; if a non-subscription product somehow
    // reports one, say nothing about it rather than promising a free phase the
    // store will not honour.
    const lead = price ? `You'll be charged ${price} once. ` : '';
    return lead + manage;
  }

  if (hasFreeTrial) {
    const lead = price
      ? `Your free trial then renews at ${price} unless you cancel before it ends. `
      : 'Payment is charged when your free trial ends. ';
    return lead + manage;
  }

  const lead = price
    ? `You'll be charged ${price}, renewing automatically until you cancel. `
    : 'Your subscription renews automatically until you cancel. ';
  return lead + manage;
}

/** Lead-in to the Terms/Privacy links — "By subscribing" is false for a one-off. */
export function purchaseAgreementLead(isRecurring: boolean): string {
  return isRecurring ? 'By subscribing you agree to our' : 'By purchasing you agree to our';
}

/** The primary button's text, and its accessibility label (same words). */
export function purchaseCtaLabel({
  isRecurring,
  hasFreeTrial,
}: Pick<PurchaseTerms, 'isRecurring' | 'hasFreeTrial'>): string {
  if (!isRecurring) return 'Purchase';
  return hasFreeTrial ? 'Start Free Trial' : 'Subscribe';
}

/**
 * A human-readable plan name.
 *
 * The non-subscription fallback used to be `pkg.identifier` — a raw store
 * product id such as `com.aptdesignerai.lifetime`, shown to the buyer as the
 * name of the thing they are about to pay for. RevenueCat carries a
 * store-localised `product.title`; use that, and keep the identifier only as a
 * last resort so the option is never nameless.
 */
export function planLabel(productTitle: string | null | undefined, identifier: string): string {
  const title = productTitle?.trim();
  return title && title.length > 0 ? title : identifier;
}
