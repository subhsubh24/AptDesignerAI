"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function UpgradeViewTracker({ tier }: { tier: string }) {
  useEffect(() => {
    trackEvent("upgrade_page_view", { tier });
  }, [tier]);
  return null;
}
