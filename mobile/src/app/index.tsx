import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function DashboardScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          <ThemedView style={styles.headerRow}>
            <ThemedText type="title" style={styles.title}>
              AptDesignerAI
            </ThemedText>
            <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8}>
              <ThemedText type="small" style={{ color: colors.mutedForeground }}>
                Sign out
              </ThemedText>
            </Pressable>
          </ThemedView>
          <ThemedText type="subtitle" style={styles.subtitle}>
            Design your dream space
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.actionsContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.accent,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={() => router.push('/photo')}
          >
            <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>
              Start New Design
            </ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              styles.secondaryButton,
              {
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            onPress={() => router.push('/saved')}
          >
            <ThemedText style={[styles.buttonText, { color: colors.text }]}>
              View Saved Designs
            </ThemedText>
          </Pressable>
        </ThemedView>

        <ThemedView style={styles.infoSection}>
          <ThemedText type="subtitle" style={styles.infoTitle}>
            How it works
          </ThemedText>
          <ThemedText type="default" style={styles.infoText}>
            1. Take photos of your room
          </ThemedText>
          <ThemedText type="default" style={styles.infoText}>
            2. AI analyzes your space
          </ThemedText>
          <ThemedText type="default" style={styles.infoText}>
            3. Get design recommendations
          </ThemedText>
          <ThemedText type="default" style={styles.infoText}>
            4. Browse curated products
          </ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  header: {
    paddingVertical: Spacing.four,
    gap: Spacing.one,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    textAlign: 'left',
  },
  subtitle: {
    textAlign: 'left',
  },
  actionsContainer: {
    gap: Spacing.three,
    marginVertical: Spacing.three,
  },
  actionButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  infoSection: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  infoTitle: {
    marginTop: Spacing.two,
  },
  infoText: {
    lineHeight: 24,
  },
});
