import { render, screen } from '@testing-library/react-native';

import { AuthLoadingScreen } from '@/components/auth-loading-screen';

// Regression guard: while the initial Supabase auth check is in flight,
// RootLayout previously rendered `null` for the whole `loading` window. The
// splash overlay above it only plays a fixed 600ms animation and unmounts on
// its own timer regardless of auth state, so on a slow network or cold start
// `loading` can outlast it — leaving a blank screen with no feedback the app
// was still working. AuthLoadingScreen replaces that `null` with a real,
// accessible progress indicator.

describe('AuthLoadingScreen', () => {
  it('renders a visible, accessible progress indicator (not a blank screen)', async () => {
    await render(<AuthLoadingScreen />);

    expect(screen.getByTestId('auth-loading-screen')).toBeTruthy();
    expect(screen.getByTestId('auth-loading-screen').props.accessibilityRole).toBe('progressbar');
  });
});
