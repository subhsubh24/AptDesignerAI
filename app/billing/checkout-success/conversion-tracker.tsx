"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function ConversionTracker({ tier }: { tier: string }) {
  useEffect(() => {
    trackEvent("checkout_complete", { tier });
  }, [tier]);
  return null;
}
