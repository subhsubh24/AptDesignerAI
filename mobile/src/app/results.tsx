import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { consumePendingImageUri } from '@/state/photo-session';

export default function ResultsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  const [imageUri] = useState<string | null>(consumePendingImageUri);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedView style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <ThemedText style={{ fontSize: 16, color: colors.textSecondary }}>← Back</ThemedText>
            </Pressable>
            <ThemedText type="title">Design Analysis</ThemedText>
          </ThemedView>

          {/* Selected room photo */}
          {imageUri ? (
            <ThemedView
              style={[styles.photoCard, { borderColor: colors.border }]}
            >
              <Image
                source={{ uri: imageUri }}
                style={styles.roomPhoto}
                contentFit="cover"
                transition={300}
              />
              <ThemedView style={styles.photoLabel}>
                <ThemedText type="small" style={{ color: colors.mutedForeground }}>
                  Your room
                </ThemedText>
              </ThemedView>
            </ThemedView>
          ) : null}

          {/* Analysis cards — AI integration coming in B2 */}
          <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
            <ThemedText type="subtitle" style={styles.cardTitle}>
              Room Understanding
            </ThemedText>
            <ThemedText type="default" style={[styles.cardContent, { color: colors.mutedForeground }]}>
              AI analysis coming soon — full diagnosis, design direction, and curated products.
            </ThemedText>
          </ThemedView>

          <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
            <ThemedText type="subtitle" style={styles.cardTitle}>
              Design Direction
            </ThemedText>
            <ThemedText type="default" style={[styles.cardContent, { color: colors.mutedForeground }]}>
              Palette, materials, and style recommendations will appear here.
            </ThemedText>
          </ThemedView>

          <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
            <ThemedText type="subtitle" style={styles.cardTitle}>
              Curated Products
            </ThemedText>
            <ThemedText type="default" style={[styles.cardContent, { color: colors.mutedForeground }]}>
              Personalized picks from top retailers, matched to your space.
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.buttonContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={() => router.push('/')}
            >
              <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>
                Back to Home
              </ThemedText>
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
  photoCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    overflow: 'hidden',
  },
  roomPhoto: {
    aspectRatio: 4 / 3,
    width: '100%',
  },
  photoLabel: {
    paddingHorizontal: Spacing.three,
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
    paddingVertical: Spacing.two,
  },
  saveButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
