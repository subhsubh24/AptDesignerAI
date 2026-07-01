import { useCallback, useEffect, useState } from 'react';
import Purchases from 'react-native-purchases';
import type { CustomerInfo } from 'react-native-purchases';

import { initRC, RC_KEY } from '@/lib/rc-init';

export const ENTITLEMENT_ID = 'pro';

export type EntitlementsState = {
  isLoading: boolean;
  isPro: boolean;
  customerInfo: CustomerInfo | null;
  /**
   * Re-reads entitlement state from RevenueCat. Resolves `true` when RC was
   * reached and `isPro`/`customerInfo` were updated, or `false` when the state
   * could NOT be confirmed (RC unset, or every attempt failed transiently).
   * Callers on the post-purchase path use the boolean to avoid silently
   * leaving a paying user on a locked screen after a flaky refresh.
   */
  refresh: () => Promise<boolean>;
};

/** Bounded retry so a transient getCustomerInfo() blip right after a purchase
 *  self-heals instead of stranding a paying user at isPro=false. */
const REFRESH_ATTEMPTS = 3;

/**
 * Returns the current user's RevenueCat entitlement status.
 * RC is configured via the shared initRC() singleton in lib/rc-init.ts.
 * When RC_KEY is unset (local dev / Expo Go), always returns isPro = false.
 */
export function useEntitlements(userId: string | undefined): EntitlementsState {
  const [isLoading, setIsLoading] = useState(!!RC_KEY && !!userId);
  const [isPro, setIsPro] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!RC_KEY || !userId) return false;
    for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt++) {
      try {
        const info = await Purchases.getCustomerInfo();
        setCustomerInfo(info);
        setIsPro(info.entitlements.active[ENTITLEMENT_ID]?.isActive === true);
        return true;
      } catch {
        // Transient error — back off briefly and retry before giving up.
        if (attempt < REFRESH_ATTEMPTS) {
          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), attempt * 500);
          });
        }
      }
    }
    // Every attempt failed — keep previous state and let the caller decide how
    // to surface the fact that entitlement status could not be confirmed.
    return false;
  }, [userId]);

  useEffect(() => {
    if (!RC_KEY || !userId) {
      setIsLoading(false);
      return;
    }
    initRC();
    setIsLoading(true);
    void refresh().finally(() => setIsLoading(false));
  }, [userId, refresh]);

  return { isLoading, isPro, customerInfo, refresh };
}
