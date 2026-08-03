/**
 * Whether a specific RevenueCat package should be offered to the buyer, given
 * whether annual billing is currently live.
 *
 * Pro Annual is a real store product, but per the web app's
 * `isAnnualBillingEnabled()` (lib/billing/stripe.ts) it ships GATED OFF until
 * the owner applies migration 021 (the `stripe_customers.tier` CHECK
 * constraint that accepts `'pro_annual'`) — see docs/BUSINESS_CASE.md. If the
 * store's live RevenueCat offering already contains an annual package (e.g.
 * configured in App Store Connect / Play Console ahead of that migration),
 * the mobile paywall must not let a buyer purchase a tier the backend cannot
 * yet record an entitlement for — a charge with no unlock.
 *
 * Extracted as a pure predicate (rather than inlined in the filter chain in
 * paywall-sheet.tsx) because there is no React Native test runner in this
 * repo — see the sibling modules paywall-trial.ts / paywall-disclosure.ts /
 * purchase-outcome.ts, which extract pure logic from the same component for
 * the same reason, so a future edit that drops or inverts this gate fails a
 * vitest assertion instead of failing silently in the app.
 */
export function shouldOfferPackage(isAnnualPackage: boolean, annualBillingEnabled: boolean): boolean {
  return annualBillingEnabled || !isAnnualPackage;
}
