import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { AuthLoadingScreen } from '@/components/auth-loading-screen';

// Regression guard: while the initial Supabase auth check is in flight,
// RootLayout previously rendered `null` for the whole `loading` window. The
// splash overlay above it only plays a fixed 600ms animation and unmounts on
// its own timer regardless of auth state, so on a slow network or cold start
// `loading` can outlast it — leaving a blank screen with no feedback the app
// was still working. AuthLoadingScreen replaces that `null` with a real,
// visible, accessible progress indicator.
//
// Also guards the iOS/VoiceOver gap results.tsx already hit once (#397):
// `accessibilityLiveRegion` is Android/TalkBack-only, so iOS needs an
// explicit `AccessibilityInfo.announceForAccessibility` call or a VoiceOver
// user gets total silence during the wait.

describe('AuthLoadingScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders a visible, accessible progress indicator with a real label (not a blank screen)', async () => {
    await render(<AuthLoadingScreen />);

    const region = screen.getByTestId('auth-loading-screen');
    expect(region).toBeTruthy();
    expect(region.props.accessibilityRole).toBe('progressbar');
    expect(region.props.accessibilityLabel).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('announces the loading state explicitly on iOS (VoiceOver has no live-region support)', async () => {
    Platform.OS = 'ios';
    const announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});

    await render(<AuthLoadingScreen />);

    expect(announceSpy).toHaveBeenCalledWith(expect.stringContaining('Loading'));
  });
});
