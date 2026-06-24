import { useCallback, useEffect, useState } from 'react';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo } from 'react-native-purchases';

// Set at EAS build time via EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY env var.
// Absent in local Expo Go dev: the hook gracefully degrades (isPro = false,
// paywall shows but cannot make real purchases).
const RC_KEY = process.env.EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY ?? '';

export const ENTITLEMENT_ID = 'pro';

// Module-level flag: configure() must be called exactly once.
let rcConfigured = false;

function configureRC(): boolean {
  if (!RC_KEY) return false;
  if (!rcConfigured) {
    Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: RC_KEY });
    rcConfigured = true;
  }
  return true;
}

export type EntitlementsState = {
  isLoading: boolean;
  isPro: boolean;
  customerInfo: CustomerInfo | null;
  refresh: () => Promise<void>;
};

/**
 * Returns the current user's RevenueCat entitlement status.
 * Requires RC to be configured in _layout.tsx before this hook runs.
 * When RC_KEY is unset (local dev), always returns isPro = false.
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
    configureRC();
    setIsLoading(true);
    void refresh().finally(() => setIsLoading(false));
  }, [userId, refresh]);

  return { isLoading, isPro, customerInfo, refresh };
}
