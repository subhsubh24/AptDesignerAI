"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface Props {
  tier: "apartment" | "pro";
}

export function UpgradeCheckoutButton({ tier }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Checkout failed. Please try again.");
      }

      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        size="lg"
        variant="warm"
        className="w-full"
        onClick={handleCheckout}
        disabled={loading}
      >
        {loading ? "Redirecting to checkout…" : "Continue to checkout"}
        {!loading && <ArrowRight className="h-4 w-4 ml-1" />}
      </Button>
      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}
    </div>
  );
}
