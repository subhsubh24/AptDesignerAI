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
      setError(
        res.status === 404
          ? "No active subscription found. Choose a plan on the pricing page to get started."
          : data.error ?? "Could not open the billing portal. Please try again.",
      );
    } catch {
      setError("Could not open the billing portal. Please try again.");
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
          anytime through Stripe&apos;s secure billing portal.
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
