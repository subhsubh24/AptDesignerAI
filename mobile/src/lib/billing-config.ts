/**
 * Whether Pro Annual billing is actually live, mirroring the web app's
 * `isAnnualBillingEnabled()` gate (lib/billing/stripe.ts). Annual is a real
 * store product but ships GATED OFF until the owner applies migration 021
 * (the `stripe_customers.tier` CHECK constraint that accepts `'pro_annual'`)
 * — see docs/BUSINESS_CASE.md. The mobile paywall (paywall-sheet.tsx) has no
 * server env access of its own, so it asks the one route that reads the same
 * flag the web pricing page already gates on, instead of guessing.
 *
 * Fails CLOSED: a missing API URL, a network error, a timeout, or a non-200
 * response all resolve to `false`. An unreachable config check must never
 * accidentally let a not-yet-enabled tier through — the same "when in doubt,
 * assume the conservative answer" rule paywall-disclosure.ts already uses for
 * trial eligibility and restorability.
 */
export async function fetchAnnualBillingEnabled(): Promise<boolean> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!apiUrl) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${apiUrl}/api/mobile/billing-config`, {
      signal: controller.signal,
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { annualBillingEnabled?: unknown };
    return data.annualBillingEnabled === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
