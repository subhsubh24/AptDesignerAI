import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import Purchases from 'react-native-purchases';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/auth/login-screen';
import { SignupScreen } from '@/components/auth/signup-screen';
import { useSession } from '@/hooks/use-session';
import { initRC, RC_KEY } from '@/lib/rc-init';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();
  const [showSignup, setShowSignup] = useState(false);

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
