import { useCallback, useEffect, useState } from 'react';
import Purchases from 'react-native-purchases';
import type { CustomerInfo } from 'react-native-purchases';

import { initRC, RC_KEY } from '@/lib/rc-init';

export const ENTITLEMENT_ID = 'pro';

export type EntitlementsState = {
  isLoading: boolean;
  isPro: boolean;
  customerInfo: CustomerInfo | null;
  refresh: () => Promise<void>;
};

/**
 * Returns the current user's RevenueCat entitlement status.
 * RC is configured via the shared initRC() singleton in lib/rc-init.ts.
 * When RC_KEY is unset (local dev / Expo Go), always returns isPro = false.
 */
export function useEntitlements(userId: string | undefined): EntitlementsState {
  const [isLoading, setIsLoading] = useState(!!RC_KEY && !!userId);
  const [isPro, setIsPro] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  const refresh = useCallback(async () => {
    if (!RC_KEY || !userId) return;
    try {
      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
      setIsPro(info.entitlements.active[ENTITLEMENT_ID]?.isActive === true);
    } catch {
      // Transient error — keep previous state
    }
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
