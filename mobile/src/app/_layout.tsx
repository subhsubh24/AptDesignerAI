import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useState } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/auth/login-screen';
import { SignupScreen } from '@/components/auth/signup-screen';
import { useSession } from '@/hooks/use-session';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();
  const [showSignup, setShowSignup] = useState(false);

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
