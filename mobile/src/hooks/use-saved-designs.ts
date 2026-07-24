import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type SavedDesign = {
  id: string;
  title: string;
  room_type: string | null;
  stage: 'assessment' | 'full';
  thumbnail_url: string | null;
  updated_at: string;
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; designs: SavedDesign[] };

export function useSavedDesigns() {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Incrementing tick triggers a re-fetch; reload() bumps it.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState({ status: 'loading' });

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;

        if (!session) {
          setState({ status: 'error', message: 'Sign in to view your saved designs.' });
          return;
        }

        const { data, error } = await supabase
          .from('saved_designs')
          .select('id, title, room_type, stage, thumbnail_url, updated_at')
          .order('updated_at', { ascending: false })
          .limit(50);

        if (cancelled) return;

        if (error) {
          setState({ status: 'error', message: error.message });
          return;
        }
        setState({ status: 'done', designs: (data ?? []) as SavedDesign[] });
      } catch {
        // getSession()/the query can THROW (rather than return {error}) on a
        // network failure. Without this catch the rejection is unhandled and the
        // hook stays stuck on 'loading' forever — a permanent spinner with no
        // retry path. Surface a recoverable error instead.
        if (cancelled) return;
        setState({
          status: 'error',
          message: "Couldn't load your saved designs. Pull to refresh or try again.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { state, reload: () => setTick((t) => t + 1) };
}
