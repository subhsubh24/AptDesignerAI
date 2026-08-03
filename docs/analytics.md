# Analytics Event Reference

Page views are captured automatically by `<Analytics />` (Vercel Analytics) in `app/layout.tsx`. All pages are covered by the single root layout.

Custom funnel events are fired via `trackEvent()` from `lib/analytics.ts`, a typed wrapper around `@vercel/analytics/track`. Events are sent to Vercel Analytics — no third-party data exfil. All calls are no-ops in SSR context.

## Funnel events

| Event | Where fired | Properties | Notes |
|---|---|---|---|
| `signup_complete` | `app/(auth)/signup/page.tsx` → `handleSignup` | — | Fires on successful Supabase `signUp` response |
| `analysis_started` | `app/dashboard/page.tsx` → `handleAnalyze` | — | Fires just before POST to `/api/analyze-apartment` |
| `analysis_complete` | `app/dashboard/page.tsx` → `handleAnalyze` | — | Fires on successful apartment analysis response |
| `design_saved` | `app/projects/[projectId]/rooms/[roomId]/focus/page.tsx` → `handleSaveDesign` | `stage: "assessment" \| "full"` | Fires on successful POST to `/api/saved-designs` |
| `upgrade_page_view` | `app/billing/upgrade/upgrade-tracker.tsx` (client island) | `tier: string` | Fires on mount of the upgrade page |
| `checkout_started` | `app/billing/upgrade/upgrade-checkout-button.tsx` → `handleCheckout` | `tier: string` | Fires when user clicks "Continue to checkout" |
| `checkout_complete` | `app/billing/checkout-success/conversion-tracker.tsx` (client island) | `tier: string` | Fires on mount of the checkout-success page; best-effort proxy — Stripe only redirects here after successful payment |
| `save_limit_paywall_shown` | `app/projects/[projectId]/rooms/[roomId]/focus/page.tsx` → `handleSaveDesign` | `stage: "assessment" \| "full"` | Fires when a save is rejected with `403 subscription_required` (the free-save-limit paywall) |
| `mockup_limit_paywall_shown` | `app/projects/[projectId]/rooms/[roomId]/focus/page.tsx:757` | `tier: string` | Fires when a mockup generation is rejected by the free-tier mockup limit paywall |
| `share_nudge_shown` | `app/projects/[projectId]/rooms/[roomId]/focus/page.tsx` (effect keyed on `step`/`savedDesignId`) | `stage: "assessment" \| "full"` | Fires once per page view, exactly when the share nudge becomes visible (results step, after a save) — NOT from the save handler itself, to avoid over-counting the assessment-stage save where the nudge never renders |
| `share_nudge_clicked` | `app/projects/[projectId]/rooms/[roomId]/focus/page.tsx` (share nudge CTA `onClick`) | `stage: "assessment" \| "full"` | Fires when the user clicks the share nudge CTA |

Added Run 15 (GTM Auditor Run 4, artifact_freshness): three events were shipped but missing from
this table. CORRECTED again (GTM Factory, per GTM Auditor Run 5's `artifact_freshness` finding
that this note had gone stale a second time): `mockup_limit_paywall_shown` shipped 2026-07-30 —
`lib/analytics.ts`'s `FunnelEvent` union now has **11** members; this table covers all 11.

## Known limitations

- `checkout_complete` fires on page load, not on a server-verified payment signal. Direct URL access or browser back/forward can cause a duplicate event. A future improvement would gate on a Stripe `session_id` query param verified server-side.
- React 18 Strict Mode double-invokes effects in development, causing `upgrade_page_view` and `checkout_complete` to fire twice in dev. Production is not affected.

## Adding new events

1. Add the event name to the `FunnelEvent` union in `lib/analytics.ts`.
2. Call `trackEvent(name, properties?)` in the relevant client component or handler.
3. Update this table.
