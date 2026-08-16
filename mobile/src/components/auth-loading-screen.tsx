import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Shown while the initial Supabase auth check (`useSession`'s `loading`) is
 * still in flight. The root layout's splash overlay only plays a fixed 600ms
 * animation and unmounts on its own timer regardless of auth state — on a
 * slow network or cold start, `loading` can outlast it, and rendering `null`
 * for that window left users staring at a blank screen with no feedback the
 * app was still working.
 */
export function AuthLoadingScreen() {
  const theme = useTheme();
  return (
    <View
      testID="auth-loading-screen"
      style={[styles.container, { backgroundColor: theme.background }]}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
