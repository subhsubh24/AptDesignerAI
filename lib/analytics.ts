// Typed event tracking for the main conversion funnel.
// Page views are tracked automatically by <Analytics /> in app/layout.tsx.
// Use trackEvent() at key conversion moments so launch spend is measurable.
//
// In development, events are logged to console. In production (Vercel), events
// are sent to Vercel Analytics — no third-party data leaving the platform.
//
// Server-side note: track() only works in browser contexts (useEffect / event
// handlers). For server components, instrument via client sub-components.

import { track } from '@vercel/analytics';

// Funnel events — keep the list narrow and meaningful.
type FunnelEvent =
  | 'signup_complete'
  | 'analysis_started'
  | 'analysis_complete'
  | 'design_saved'
  | 'upgrade_page_view'
  | 'checkout_started'
  | 'checkout_complete';

export function trackEvent(
  name: FunnelEvent,
  properties?: Record<string, string | number | boolean>,
): void {
  if (typeof window === 'undefined') return; // no-op in SSR context
  track(name, properties);
}
