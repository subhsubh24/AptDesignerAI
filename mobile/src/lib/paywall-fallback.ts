/**
 * What the paywall shows before RevenueCat's real offering has loaded (or
 * when RC is unconfigured, e.g. a dev build with no API key) — the ONLY
 * display a buyer sees in either of those cases.
 *
 * Previously this listed a single "$49/month" option. That silently dropped
 * the Apartment tier — a one-time $29 purchase that the business case
 * (docs/BUSINESS_CASE.md) credits with the majority of modeled conversions,
 * priced as the low-commitment entry point precisely so a first-time buyer
 * doesn't have to commit to a subscription. A buyer who opens the paywall
 * before the network round-trip resolves saw only the subscription, never
 * the cheaper option the pricing model is actually built around.
 *
 * Unlike Pro Annual — which is deliberately excluded from FALLBACK_OPTIONS,
 * see paywall-annual-gate.ts — the Apartment tier carries no equivalent
 * backend gate: `STRIPE_PRICE_IDS.apartment` (lib/billing/stripe.ts) is live
 * unconditionally, so there is no "not yet enabled" state to protect against
 * here — only a display gap to close.
 *
 * Extracted as a pure module (rather than inlined in paywall-sheet.tsx) for
 * the same reason as the sibling paywall-*.ts modules: there is no React
 * Native test runner in this repo, so anything left inside the component can
 * only be guarded by reading the source, not by an assertion that fails when
 * a future edit silently drops a tier again.
 *
 * Deliberately does NOT import `PurchasesPackage` from 'react-native-purchases'
 * (unlike the component, which does) — the sibling paywall-*.ts modules avoid
 * that package entirely for the same reason: __tests__/billing/*.test.ts import
 * these files under the root vitest config, which has no mobile/node_modules on
 * its resolution path. `pkg: null` here is a structural subtype of the
 * component's `PurchasesPackage | null`, so this stays assignable to
 * paywall-sheet.tsx's `DisplayOption[]` without needing the real type.
 */

type FallbackOption = {
  pkg: null;
  label: string;
  price: string;
  subline: string;
  badge: string | null;
  hasFreeTrial: boolean;
  isRecurring: boolean;
  isRestorable: boolean;
};

// Mirrors app/pricing/page.tsx's real, live prices — $29 one-time Apartment,
// $49/month Pro. Apartment listed first, matching the pricing page's order
// and the business case's low-commitment-entry-point framing; Pro Monthly
// second. Pro Annual stays out of this list entirely (see module doc above).
// Neither carries a real `pkg`, so the purchase CTA on this fallback display
// warns instead of charging — see paywall-sheet.tsx's handlePurchase.
export const FALLBACK_OPTIONS: FallbackOption[] = [
  {
    pkg: null,
    label: 'Apartment',
    price: '$29 one-time',
    subline: 'One-time purchase · every room in one apartment',
    badge: null,
    hasFreeTrial: false,
    isRecurring: false,
    // A persistent unlock (every room in the apartment, kept), not a spent
    // credit — the same NON_CONSUMABLE shape classifyProductShape() assumes
    // by default for a real Apartment product. Inert here regardless: this
    // only feeds purchaseDisclosure's copy, since `pkg: null` means the
    // Restore Purchases button's own behavior is unaffected by this field.
    isRestorable: true,
  },
  {
    pkg: null,
    label: 'Monthly',
    price: '$49 / month',
    subline: 'Billed monthly · cancel anytime',
    badge: null,
    hasFreeTrial: false,
    isRecurring: true,
    isRestorable: true,
  },
];
