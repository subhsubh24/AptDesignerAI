import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@aptdesigner:saves_used';
const FREE_SAVES_LIMIT = 1;

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
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Read from AsyncStorage on each call to avoid stale-closure races on double-tap
  const markSaved = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const current = parseInt(raw ?? '0', 10);
    const next = (isNaN(current) ? 0 : current) + 1;
    setSavesUsed(next);
    await AsyncStorage.setItem(STORAGE_KEY, String(next));
  }, []);

  return {
    isLoading,
    canSave: savesUsed < FREE_SAVES_LIMIT,
    savesUsed,
    markSaved,
  };
}
