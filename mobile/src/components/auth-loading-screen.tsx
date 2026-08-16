import { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
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

  // iOS/VoiceOver: `accessibilityLiveRegion` (below) is Android/TalkBack-only
  // — results.tsx hit the same gap (#397) and its fix is the precedent this
  // mirrors: announce explicitly on iOS so VoiceOver users aren't left with
  // total silence during the wait, matching the visible "Loading…" text.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility('Loading.');
  }, []);

  return (
    <View
      testID="auth-loading-screen"
      style={[styles.container, { backgroundColor: theme.background }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      accessibilityLabel="Loading"
    >
      <ActivityIndicator color={theme.accent} />
      <ThemedText type="default" themeColor="textSecondary" style={styles.label}>
        Loading…
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: {
    textAlign: 'center',
  },
});
