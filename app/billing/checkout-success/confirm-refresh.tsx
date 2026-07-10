"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Drives the "finalizing your upgrade" state on the checkout-success page.
 *
 * After Stripe redirects here, the entitlement is granted asynchronously by the
 * webhook (typically a few seconds later). While the server render shows the
 * pending state (entitlement not yet active), this bumps the server component a
 * handful of times so the page flips to the confirmed state automatically once
 * the webhook lands — no manual refresh. Bounded so it can never spin forever
 * for a visitor who never actually paid (the page just stays "finalizing").
 */
const MAX_REFRESHES = 10;
const INTERVAL_MS = 3000;

export function ConfirmRefresh() {
  const router = useRouter();
  const count = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      count.current += 1;
      if (count.current > MAX_REFRESHES) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
