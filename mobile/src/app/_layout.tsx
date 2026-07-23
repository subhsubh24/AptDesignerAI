import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import Purchases from 'react-native-purchases';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/auth/login-screen';
import { SignupScreen } from '@/components/auth/signup-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { initRC, RC_KEY } from '@/lib/rc-init';

/**
 * App-wide error boundary. Exporting a component named `ErrorBoundary` from the
 * root route makes expo-router wrap the whole app (`<Try catch={ErrorBoundary}>`),
 * so an uncaught render error in ANY screen shows this recoverable fallback
 * instead of a dead white screen with no way out. `retry()` clears the error
 * state and re-renders the app. Standalone by design — it renders outside the
 * ThemeProvider tree when it catches, and `useTheme()` reads the OS color scheme
 * directly (not React context) so the fallback is still theme-correct.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();

  // Surface the crash to logs/crash reporting; users see the friendly copy
  // below. In an effect (not the render body) so it fires once per distinct
  // error rather than on every re-render / React's dev double-invoke — and so a
  // future crash-analytics side effect here stays safe.
  useEffect(() => {
    console.error('[app] uncaught render error:', error);
  }, [error]);

  return (
    <View style={[styles.errorContainer, { backgroundColor: theme.background }]}>
      <ThemedText type="title" style={styles.errorTitle}>
        Something went wrong
      </ThemedText>
      <ThemedText type="default" themeColor="textSecondary" style={styles.errorBody}>
        The app hit an unexpected error. Your saved designs are safe — try again
        to get back to where you were.
      </ThemedText>
      {__DEV__ ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.errorDetail}>
          {error.message}
        </ThemedText>
      ) : null}
      <Pressable
        onPress={() => {
          void retry();
        }}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={({ pressed }) => [
          styles.errorButton,
          { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <ThemedText type="defaultSemiBold" style={{ color: theme.accentForeground }}>
          Try again
        </ThemedText>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();
  const [showSignup, setShowSignup] = useState(false);

  // Register for push notifications once the user is authenticated.
  usePushNotifications(session?.user.id);

  // Configure RC once on mount — shared singleton guard in rc-init.ts prevents double-configure
  useEffect(() => {
    initRC();
  }, []);

  // Keep RC identity in sync with Supabase auth state
  useEffect(() => {
    if (!RC_KEY || loading) return;
    if (session?.user.id) {
      Purchases.logIn(session.user.id).catch(() => {});
    } else {
      Purchases.logOut().catch(() => {});
    }
  }, [session?.user.id, loading]);

  const content = loading
    ? null
    : session
      ? <AppTabs />
      : showSignup
        ? <SignupScreen onLogin={() => setShowSignup(false)} />
        : <LoginScreen onSignup={() => setShowSignup(true)} />;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {content}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    gap: Spacing.three,
  },
  errorTitle: {
    textAlign: 'center',
  },
  errorBody: {
    textAlign: 'center',
  },
  errorDetail: {
    textAlign: 'center',
    fontStyle: 'italic',
  },
  errorButton: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
