import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@aptdesigner:saves_used';
// Mirror the server gate (FREE_SAVE_LIMIT in lib/entitlements/server.ts) and the
// web client (FREE_SAVE_LIMIT_WEB = 3). This is the client-side UX hint only —
// the server enforces the real limit; keeping them aligned means a free user is
// offered the same 3 saves everywhere, not paywalled early after 1 save on mobile.
const FREE_SAVES_LIMIT = 3;

export type FreeQuotaHook = {
  isLoading: boolean;
  canSave: boolean;
  savesUsed: number;
  markSaved: () => Promise<void>;
};

export function useFreeSaveQuota(): FreeQuotaHook {
  const [isLoading, setIsLoading] = useState(true);
  const [savesUsed, setSavesUsed] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw: string | null) => {
        const n = parseInt(raw ?? '0', 10);
        setSavesUsed(isNaN(n) ? 0 : n);
      })
      .catch((err: unknown) => {
        // Read failed (permissions, corruption) — fall back to the initial
        // savesUsed=0 state (already set) rather than leaving isLoading stuck
        // true. Not silent: logged so a real device issue is observable,
        // matching the convention in paywall-sheet.tsx / use-push-notifications.
        console.warn('[free-quota] getItem failed', err);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Read from AsyncStorage on each call to avoid stale-closure races on double-tap
  const markSaved = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const current = parseInt(raw ?? '0', 10);
    const next = (isNaN(current) ? 0 : current) + 1;
    setSavesUsed(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, String(next));
    } catch (err: unknown) {
      // In-memory state (setSavesUsed above) already reflects the increment
      // for this session, so the CTA still hides at the right count right
      // now. The failure is a persistence gap: on next app launch the count
      // reads stale from storage and under-counts. The server is the real
      // enforcement point (this hook is a client-side UX hint only, see
      // FREE_SAVES_LIMIT above), so under-counting can't grant an extra
      // server-side save — but it's still worth surfacing rather than
      // swallowing so a real device issue is observable.
      console.warn('[free-quota] setItem failed — save count may not persist across app restarts', err);
    }
  }, []);

  return {
    isLoading,
    canSave: savesUsed < FREE_SAVES_LIMIT,
    savesUsed,
    markSaved,
  };
}
