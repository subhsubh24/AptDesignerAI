import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function PhotoCaptureScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <ThemedText style={{ fontSize: 16 }}>← Back</ThemedText>
          </Pressable>
          <ThemedText type="title">Capture Your Room</ThemedText>
        </ThemedView>

        <ThemedView style={styles.previewContainer}>
          <ThemedView
            style={[
              styles.preview,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
              },
            ]}
          >
            <ThemedText type="default" style={styles.previewText}>
              Camera Preview
            </ThemedText>
            <ThemedText type="small" style={styles.previewHint}>
              (Camera integration coming in phase B2)
            </ThemedText>
          </ThemedView>
        </ThemedView>

        <ThemedView style={styles.instructionsContainer}>
          <ThemedText type="subtitle" style={styles.instructionsTitle}>
            Tips for best results
          </ThemedText>
          <ThemedText type="default" style={styles.instructionItem}>
            • Capture the full room with good lighting
          </ThemedText>
          <ThemedText type="default" style={styles.instructionItem}>
            • Take photos from multiple angles
          </ThemedText>
          <ThemedText type="default" style={styles.instructionItem}>
            • Include furniture and existing décor
          </ThemedText>
          <ThemedText type="default" style={styles.instructionItem}>
            • Avoid shadows and backlighting
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.buttonContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.captureButton,
              {
                backgroundColor: colors.accent,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={() => router.push('/results')}
          >
            <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>
              Take Photo
            </ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.skipButton,
              {
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            onPress={() => router.push('/')}
          >
            <ThemedText style={{ color: colors.text }}>Skip for now</ThemedText>
          </Pressable>
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
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  previewContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  preview: {
    aspectRatio: 1,
    borderRadius: Spacing.three,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one,
  },
  previewText: {
    fontSize: 16,
  },
  previewHint: {
    opacity: 0.6,
  },
  instructionsContainer: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  instructionsTitle: {
    marginBottom: Spacing.one,
  },
  instructionItem: {
    lineHeight: 22,
  },
  buttonContainer: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  captureButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButton: {
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
