// analysis/business-case-model.mjs
// Shared revenue-model core behind docs/BUSINESS_CASE.md's "The revenue model" section.
// Committed inputs only (no live network/secrets) -- deterministic, reproducible (FACTORY_STANDARD S22).
// Each scenario script (business_case_scenario_*.mjs) imports computeScenario() and prints one figure.

export const APARTMENT_PRICE = 29;
export const PRO_MONTHLY_PRICE = 49;
export const PRO_ANNUAL_PRICE = 399;
export const STORE_NET = 0.70; // 1 - 30% App/Play commission
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
 */
export function computeScenario(
  installsPerMonth,
  conversionRate,
  annualShareOfPro = ANNUAL_SHARE_OF_PRO,
  monthlyChurn = MONTHLY_CHURN,
  annualEffectiveMonthlyChurn = ANNUAL_EFFECTIVE_MONTHLY_CHURN,
) {
  const activeAtPaywall = installsPerMonth * DAY30_RETENTION;
  const paidConversions = activeAtPaywall * conversionRate;

  const apartmentBuyers = paidConversions * APARTMENT_MIX;
  const apartmentMRR = apartmentBuyers * APARTMENT_PRICE * STORE_NET;

  const newPro = paidConversions * PRO_MIX;
  const newMonthlyPro = newPro * (1 - annualShareOfPro);
  const newAnnualPro = newPro * annualShareOfPro;

  const steadyMonthlySubs = newMonthlyPro / monthlyChurn;
  const steadyAnnualSubs = annualShareOfPro > 0 ? newAnnualPro / annualEffectiveMonthlyChurn : 0;

  const monthlyProMRR = steadyMonthlySubs * PRO_MONTHLY_PRICE * STORE_NET;
  const annualProMRR = steadyAnnualSubs * (PRO_ANNUAL_PRICE / 12) * STORE_NET;

  const totalMRR = apartmentMRR + monthlyProMRR + annualProMRR;
  const arr = totalMRR * 12;

  return {
    activeAtPaywall, paidConversions, apartmentBuyers, apartmentMRR,
    newPro, steadyMonthlySubs, steadyAnnualSubs, monthlyProMRR, annualProMRR,
    totalMRR, arr,
  };
}
