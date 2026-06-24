import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/auth/login-screen';
import { SignupScreen } from '@/components/auth/signup-screen';
import { useSession } from '@/hooks/use-session';

const RC_KEY = process.env.EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY ?? '';

let rcConfigured = false;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();
  const [showSignup, setShowSignup] = useState(false);

  // Configure RC once on mount (no-op when RC_KEY is unset)
  useEffect(() => {
    if (!RC_KEY || rcConfigured) return;
    Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: RC_KEY });
    rcConfigured = true;
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
