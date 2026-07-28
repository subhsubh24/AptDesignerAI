// analysis/business-case-model.mjs
// Shared revenue-model core behind docs/BUSINESS_CASE.md's "The revenue model" section.
// Committed inputs only (no live network/secrets) -- deterministic, reproducible (FACTORY_STANDARD S22).
// Each scenario script (business_case_scenario_*.mjs) imports computeScenario() and prints one figure.

export const APARTMENT_PRICE = 29;
export const PRO_MONTHLY_PRICE = 49;
export const PRO_ANNUAL_PRICE = 399;

/**
 * TAKE RATES — the fee actually charged on a sale, by CHANNEL.
 *
 * This model previously applied a single `STORE_NET = 0.70` (a flat 30%
 * commission) to every line of revenue in every scenario. That was wrong twice
 * over, and the independent quality audit named the first half of it:
 *
 *  (1) CHANNEL. The "shippable today" figure is derived from a WEB/Stripe-only
 *      gate — it zeroes the annual tier because Pro Annual is gated off in
 *      `lib/billing/stripe.ts` / migration 021, which are Stripe concerns that
 *      do not exist on the store channel at all. So the one figure under the
 *      closest scrutiny applied an APP-STORE commission to revenue it had just
 *      finished arguing could only be collected over STRIPE.
 *
 *  (2) RATE. 30% is not the rate this business pays on EITHER channel at this
 *      revenue scale. Apple's App Store Small Business Program is 15% (see the
 *      ENROLMENT CAVEAT below); Google Play's 2026 structure is a 10%
 *      service fee on the first $1M for auto-renewing subscriptions plus a 5%
 *      billing fee, i.e. ~15% effective. 30% is the rate ABOVE $1M in annual
 *      proceeds — roughly 3x the top of this model's own optimistic scenario.
 *
 * The correction moves the headline UP, which is exactly the direction that
 * deserves the most suspicion, so: every rate below is a published, primary-
 * sourced list price; NOT ONE behavioural input (installs, conversion,
 * retention, churn, tier mix) is touched by this change; and the default
 * channel is the LESS favourable of the two.
 *
 * Sources:
 *  - developer.apple.com/app-store/small-business-program/ — 15% commission,
 *    eligibility up to $1M proceeds.
 *
 * ENROLMENT CAVEAT — the 15% store rate is NOT automatic, and this model does
 * not get to assume it. Apple's page separates the two: ELIGIBILITY is automatic
 * under $1M, but ENROLMENT is a deliberate act — the Account Holder must accept
 * the Paid Apps agreement (Schedule 2) in App Store Connect and list any
 * Associated Developer Accounts, and the reduced rate applies only 15 days after
 * the end of the fiscal month in which enrolment is approved. Un-enrolled, the
 * rate is 30% and the store column of this model is simply wrong.
 *
 * An earlier version of this comment said new developers "qualify
 * automatically". That conflated eligibility with enrolment, and it was
 * load-bearing: it let the model bank a discount nobody had claimed. Recorded as
 * an owner step in PENDING_OPS.md (`enroll-apple-small-business-program`), the
 * same way every other conditional owner action in this repo is tracked.
 *  - support.google.com/googleplay/android-developer/answer/112622 — 2026
 *    structure: 10% service fee on the first $1M for auto-renewing
 *    subscriptions, plus a 5% billing fee (US/UK/EEA) = ~15% effective.
 *  - stripe.com/pricing — 2.9% + $0.30 per successful domestic card charge;
 *    Stripe Billing pay-as-you-go 0.7% of billing volume on recurring.
 *
 * THRESHOLD CAVEAT, deliberately load-bearing: the 15% store rate holds only
 * while proceeds stay under $1M/yr. Every scenario in this model is far below
 * that, so it applies throughout — but if the business crosses $1M, the store
 * rate reverts to 30% and this constant MUST be revisited rather than
 * inherited. Crossing $1M is a good problem; silently modelling it at 15% is
 * not.
 */
export const STORE_COMMISSION = 0.15;
export const STRIPE_PCT = 0.029;
export const STRIPE_FIXED = 0.3;
export const STRIPE_BILLING_PCT = 0.007;

/** @typedef {"store" | "web"} Channel */

/**
 * Net revenue retained from one gross CHARGE on a given channel.
 *
 * Charge-level, not month-level, on purpose: Stripe's $0.30 is a per-TRANSACTION
 * fee, so it is materially heavier on a $29 one-off (≈3.9% all-in) than on a
 * $399 annual charge (≈3.7% all-in incl. Billing). Applying a single blended
 * percentage would quietly flatter the small-ticket tier, which happens to be
 * the tier carrying 60% of conversions.
 *
 * @param {number} gross      the amount charged to the customer
 * @param {Channel} channel
 * @param {boolean} recurring whether Stripe Billing's 0.7% applies
 */
export function netRevenue(gross, channel, recurring) {
  if (channel === "store") return gross * (1 - STORE_COMMISSION);
  const fees = gross * STRIPE_PCT + STRIPE_FIXED + (recurring ? gross * STRIPE_BILLING_PCT : 0);
  return Math.max(0, gross - fees);
}

/**
 * The channel a scenario is priced on when the caller does not say.
 *
 * "store" — the LOWER of the two nets at every price point. The conservative
 * default is the point: an unqualified figure out of this model should be the
 * one that is harder to beat, not the one that reads best.
 */
export const DEFAULT_CHANNEL = "store";
export const DAY30_RETENTION = 0.25;
export const APARTMENT_MIX = 0.60;
export const PRO_MIX = 0.40;
export const MONTHLY_SHARE_OF_PRO = 0.75;
export const ANNUAL_SHARE_OF_PRO = 0.25;
export const MONTHLY_CHURN = 0.07;
// BUSINESS_CASE.md's formula section: "1 - 0.75^(1/12) ~= 2.4%/month", and every worked example
// in the doc (Scenario A/B/C annual-pool division) uses the rounded 0.024, not the unrounded
// 0.023693 -- so 0.024 is the doc's own canonical constant, reproduced here verbatim.
export const ANNUAL_EFFECTIVE_MONTHLY_CHURN = 0.024;

/**
 * Steady-state MRR/ARR for one scenario, matching docs/BUSINESS_CASE.md "The revenue model".
 * Subscriber pools are left as continuous (unrounded) steady-state expected values -- the
 * doc's prose rounds them to whole numbers only for readability ("~171 subs"); the published
 * MRR/ARR figures themselves are computed from the continuous pool, which this reproduces.
 *
 * @param {number} installsPerMonth
 * @param {number} conversionRate    free -> paid conversion (of Day-30-retained active users)
 * @param {number} annualShareOfPro  share of NEW Pro subscribers who choose annual (0 = annual tier gated off)
 * @param {number} monthlyChurn      monthly Pro churn rate (default MONTHLY_CHURN) -- overridable for sensitivity scripts
 * @param {number} annualEffectiveMonthlyChurn  annual Pro's effective monthly churn (default ANNUAL_EFFECTIVE_MONTHLY_CHURN) -- overridable for sensitivity scripts
 * @param {"store"|"web"} channel  which channel's take rate to price on (default DEFAULT_CHANNEL = the more conservative "store")
 */
export function computeScenario(
  installsPerMonth,
  conversionRate,
  annualShareOfPro = ANNUAL_SHARE_OF_PRO,
  monthlyChurn = MONTHLY_CHURN,
  annualEffectiveMonthlyChurn = ANNUAL_EFFECTIVE_MONTHLY_CHURN,
  channel = DEFAULT_CHANNEL,
) {
  const activeAtPaywall = installsPerMonth * DAY30_RETENTION;
  const paidConversions = activeAtPaywall * conversionRate;

  const apartmentBuyers = paidConversions * APARTMENT_MIX;
  const apartmentMRR = apartmentBuyers * netRevenue(APARTMENT_PRICE, channel, false);

  const newPro = paidConversions * PRO_MIX;
  const newMonthlyPro = newPro * (1 - annualShareOfPro);
  const newAnnualPro = newPro * annualShareOfPro;

  const steadyMonthlySubs = newMonthlyPro / monthlyChurn;
  const steadyAnnualSubs = annualShareOfPro > 0 ? newAnnualPro / annualEffectiveMonthlyChurn : 0;

  const monthlyProMRR = steadyMonthlySubs * netRevenue(PRO_MONTHLY_PRICE, channel, true);
  // Net of the ANNUAL charge, then amortised — the per-transaction fee is paid
  // once a year, not twelve times.
  const annualProMRR = steadyAnnualSubs * (netRevenue(PRO_ANNUAL_PRICE, channel, true) / 12);

  const totalMRR = apartmentMRR + monthlyProMRR + annualProMRR;
  const arr = totalMRR * 12;

  return {
    activeAtPaywall, paidConversions, apartmentBuyers, apartmentMRR,
    newPro, steadyMonthlySubs, steadyAnnualSubs, monthlyProMRR, annualProMRR,
    totalMRR, arr, channel,
  };
}
