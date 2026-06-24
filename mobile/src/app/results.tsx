import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function ResultsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedView style={styles.header}>
            <Pressable onPress={() => router.back()}>
              <ThemedText style={{ fontSize: 16 }}>← Back</ThemedText>
            </Pressable>
            <ThemedText type="title">Design Analysis</ThemedText>
          </ThemedView>

          <ThemedView
            style={[
              styles.analysisCard,
              {
                borderColor: colors.border,
              },
            ]}
          >
            <ThemedText type="subtitle" style={styles.cardTitle}>
              Room Understanding
            </ThemedText>
            <ThemedText type="default" style={styles.cardContent}>
              AI is analyzing your room photos... (coming in phase B2)
            </ThemedText>
          </ThemedView>

          <ThemedView
            style={[
              styles.analysisCard,
              {
                borderColor: colors.border,
              },
            ]}
          >
            <ThemedText type="subtitle" style={styles.cardTitle}>
              Design Direction
            </ThemedText>
            <ThemedText type="default" style={styles.cardContent}>
              Recommendations will appear here
            </ThemedText>
          </ThemedView>

          <ThemedView
            style={[
              styles.analysisCard,
              {
                borderColor: colors.border,
              },
            ]}
          >
            <ThemedText type="subtitle" style={styles.cardTitle}>
              Curated Products
            </ThemedText>
            <ThemedText type="default" style={styles.cardContent}>
              Personalized product picks from retailers
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.buttonContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                {
                  backgroundColor: colors.accent,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              onPress={() => router.push('/')}
            >
              <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>
                Save Design
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.shareButton,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              onPress={() => router.push('/')}
            >
              <ThemedText style={{ color: colors.text }}>Share</ThemedText>
            </Pressable>
          </ThemedView>
        </ScrollView>
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
    maxWidth: MaxContentWidth,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  analysisCard: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardTitle: {
    marginBottom: Spacing.one,
  },
  cardContent: {
    lineHeight: 22,
  },
  buttonContainer: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  saveButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
