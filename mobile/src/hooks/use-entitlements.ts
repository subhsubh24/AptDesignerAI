import { useCallback, useEffect, useRef, useState } from 'react';
import Purchases from 'react-native-purchases';
import type { CustomerInfo } from 'react-native-purchases';

import { initRC, RC_KEY } from '@/lib/rc-init';
import { hasActiveEntitlement } from '@/lib/purchase-outcome';

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

  // A refresh carries a bounded retry (up to ~1.5s of backoff), so it can outlive
  // its own relevance: the component may unmount, or `userId` may change and a
  // newer refresh supersede it. These refs let every state write below bail out
  // in that case, so a slow stale refresh can neither update an unmounted
  // component nor clobber a fresh user's entitlement state (a resolved-out-of-
  // order getCustomerInfo() for the previous user).
  const mountedRef = useRef(true);
  const activeUserRef = useRef(userId);
  useEffect(() => {
    activeUserRef.current = userId;
  }, [userId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!RC_KEY || !userId) return false;
    for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt++) {
      try {
        // Bound the RC call. Without a timeout a hung getCustomerInfo() (network
        // stall / SDK bug) never resolves OR rejects, so this await blocks
        // forever on the FIRST attempt — the retry loop never advances and, on
        // the post-purchase path, a paying user is stranded on a locked screen
        // with isLoading stuck true and no unlock. Time out into the catch below
        // so a hang is treated like any transient failure (back off, retry, then
        // return false so the caller can surface "couldn't confirm"). Mirrors the
        // bounded getCustomerInfo() in settings.tsx.
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const info = await Promise.race([
          Purchases.getCustomerInfo(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('getCustomerInfo timed out')), 8000);
          }),
        ]).finally(() => {
          if (timeoutId) clearTimeout(timeoutId);
        });
        // Drop the result if this refresh was superseded while it was in flight
        // (component unmounted, or the active user changed under it).
        if (!mountedRef.current || activeUserRef.current !== userId) return false;
        setCustomerInfo(info);
        // Via the shared guarded read rather than an inline
        // `info.entitlements.active[…]`. The RC types promise `entitlements` is
        // present, but nothing validates the native bridge payload at runtime —
        // and this line sits INSIDE the `try`, so a missing `entitlements` would
        // be swallowed as a "transient error", burn all three retry attempts, and
        // strand a paying user at isPro=false with no error anyone could see.
        setIsPro(hasActiveEntitlement(info, ENTITLEMENT_ID));
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
    void refresh().finally(() => {
      // Same guard as refresh's own writes: don't flip loading on an unmounted
      // component or after userId moved on to a newer refresh.
      if (mountedRef.current && activeUserRef.current === userId) setIsLoading(false);
    });
  }, [userId, refresh]);

  return { isLoading, isPro, customerInfo, refresh };
}
