"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

/**
 * Self-serve subscription management. Opens the Stripe Billing Portal for the
 * current web subscriber (manage payment method, invoices, plan change, cancel).
 * App Store / Play subscriptions are managed natively by those stores — noted
 * inline so mobile subscribers aren't sent to the wrong place.
 */
// Shown when the portal itself can't be opened (Stripe 502 or a network failure)
// — not for auth/rate-limit/no-subscription cases, which need their own message.
const PORTAL_DOWN_MESSAGE =
  "The billing portal is temporarily unavailable. Email hello@aptdesignerai.com and we'll cancel or update your subscription for you.";

export function SubscriptionCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const openPortal = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) {
        // Navigate to the Stripe-hosted portal; keep the button in its loading
        // state since the page is being replaced.
        window.location.href = data.url;
        return;
      }
      // Keep status-specific messaging: 404 = no subscription, 502 = the portal
      // is down (offer the email fallback), everything else (401 re-auth, 429
      // throttled, 500) surfaces the route's own already-hygienized message.
      if (res.status === 404) {
        setError("No active subscription found. Choose a plan on the pricing page to get started.");
      } else if (res.status === 502) {
        setError(PORTAL_DOWN_MESSAGE);
      } else {
        setError(data.error ?? "Could not open the billing portal. Please try again.");
      }
    } catch {
      // Network failure → the portal is unreachable; offer the email fallback.
      setError(PORTAL_DOWN_MESSAGE);
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          Subscription &amp; billing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Update your payment method, download invoices, switch plans, or cancel
          your subscription anytime. Use Stripe&apos;s secure billing portal below,
          or email{" "}
          <a
            href="mailto:hello@aptdesignerai.com"
            className="font-medium text-accent-warm hover:underline"
          >
            hello@aptdesignerai.com
          </a>{" "}
          and we&apos;ll take care of it.
        </p>
        <Button variant="warm-outline" size="sm" onClick={openPortal} disabled={loading}>
          {loading ? "Opening…" : "Manage subscription"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Subscriptions purchased inside the iOS or Android app are managed in
          your App Store or Google Play account settings.
        </p>
      </CardContent>
    </Card>
  );
}
