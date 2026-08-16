import { render, screen, fireEvent } from '@testing-library/react-native';

import { ErrorBoundary } from '@/app/results';

/**
 * Regression guard for APT-37: `results.tsx` (the revenue-critical core
 * photo→analysis journey) had NO screen-level error boundary — an uncaught
 * render error mid-analysis fell all the way through to `_layout.tsx`'s
 * generic app-wide "Something went wrong" screen, which has no idea which
 * photo/room the user was even analyzing.
 *
 * This renders the ACTUAL `ErrorBoundary` export from results.tsx (the same
 * expo-router per-route convention `_layout.tsx` already uses for the
 * app-wide boundary — exporting a component named `ErrorBoundary` from a
 * route file makes expo-router wrap just that route), forces it into the
 * "caught an error" state the way expo-router itself would (passing
 * `{error, retry}` props), and asserts:
 *   1. it is NOT the generic app-level boundary (different copy, scoped to
 *      the photo/room the user was on)
 *   2. it recovers to a retryable state that calls `retry()` on press
 *   3. it reflects which image/room the user was mid-analysis on, read from
 *      the same non-consuming `photo-session` module store the real screen
 *      uses (component state is gone once React unmounts the crashed tree,
 *      so this is the only place that context can still come from)
 */

const mockRouterBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockRouterBack, push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

jest.mock('@/hooks/use-session', () => ({ useSession: () => ({ session: null }) }));
jest.mock('@/hooks/use-entitlements', () => ({
  useEntitlements: () => ({ isPro: false, refresh: jest.fn() }),
}));
jest.mock('@/hooks/use-free-quota', () => ({
  useFreeSaveQuota: () => ({ isLoading: false, canSave: true, markSaved: jest.fn() }),
}));

// results.tsx statically imports PaywallSheet, which pulls in react-native-purchases
// (RevenueCat) — irrelevant to the ErrorBoundary under test and not something a
// jsdom-less RN test environment needs to render, so stub it out like the existing
// login-signup-render-guard.test.tsx does for expo-web-browser.
jest.mock('@/components/paywall-sheet', () => ({ PaywallSheet: () => null }));

let mockImageUri: string | null = 'file:///pending/room-photo.jpg';
let mockRoomType: string | null = 'living_room';
jest.mock('@/state/photo-session', () => ({
  peekPendingImageUri: () => mockImageUri,
  peekPendingRoomType: () => mockRoomType,
}));

describe('results.tsx ErrorBoundary — scoped recovery for the core journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImageUri = 'file:///pending/room-photo.jpg';
    mockRoomType = 'living_room';
  });

  it('shows a scoped, retryable error state (not the generic app-level copy), naming the room the user was on', async () => {
    const retry = jest.fn();

    await render(<ErrorBoundary error={new Error('boom: malformed analysis payload')} retry={retry} />);

    // Scoped copy, not `_layout.tsx`'s "Something went wrong" boundary.
    expect(screen.getByText(/couldn.?t show your results/i)).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();

    // Preserves which room/photo the user was on, via the module store —
    // NOT via component state, which is gone by the time this renders.
    expect(screen.getByText(/living room/i)).toBeTruthy();

    const retryButton = screen.getByLabelText('Try again');
    await fireEvent.press(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('offers Go back instead of Try again when there is no pending photo to retry', async () => {
    mockImageUri = null;
    const retry = jest.fn();

    await render(<ErrorBoundary error={new Error('boom')} retry={retry} />);

    expect(screen.queryByLabelText('Try again')).toBeNull();
    const backButton = screen.getByLabelText('Go back');
    await fireEvent.press(backButton);
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
