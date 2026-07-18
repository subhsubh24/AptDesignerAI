import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearPendingSession } from '@/state/photo-session';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Wipe the module-scope pending photo/room-type on EVERY sign-out, not
      // just the two explicit Settings buttons — this also catches forced
      // sign-outs (token expiry, session revoked elsewhere) that never pass
      // through the UI handlers, closing the shared-device cross-user leak at
      // the root auth boundary.
      if (event === 'SIGNED_OUT') {
        clearPendingSession();
      }
      setSession(newSession);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
