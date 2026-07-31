import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Alert, Linking, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, MaxContentWidth, Spacing, TapSlop } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setPendingImageUri } from '@/state/photo-session';

export default function PhotoCaptureScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);

  // Android: recover the picker result if the OS killed the app mid-pick.
  // A rejection here (permission revoked, file-system error) must not become an
  // unhandled promise rejection — recovery is best-effort, so swallow it and let
  // the user simply re-pick a photo from the normal UI.
  useEffect(() => {
    ImagePicker.getPendingResultAsync()
      .then((result) => {
        if (result && 'canceled' in result && !result.canceled && result.assets.length > 0) {
          setSelectedImageUri(result.assets[0].uri);
        }
      })
      .catch((err) => {
        console.warn('Failed to recover pending image-picker result', err);
      });
  }, []);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      if (!permission.canAskAgain) {
        Alert.alert(
          'Permission denied',
          'AptDesignerAI needs photo library access. Please enable it in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        Alert.alert(
          'Permission needed',
          'AptDesignerAI needs access to your photo library to select a room photo.',
          [{ text: 'OK' }]
        );
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets.length > 0) {
      setSelectedImageUri(result.assets[0].uri);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      if (!permission.canAskAgain) {
        Alert.alert(
          'Permission denied',
          'AptDesignerAI needs camera access. Please enable it in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        Alert.alert(
          'Permission needed',
          'AptDesignerAI needs camera access to photograph your room.',
          [{ text: 'OK' }]
        );
      }
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets.length > 0) {
      setSelectedImageUri(result.assets[0].uri);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  const handleAnalyze = useCallback(() => {
    if (!selectedImageUri) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingImageUri(selectedImageUri);
    router.push('/room-type');
  }, [router, selectedImageUri]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
          <ThemedView style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ThemedText style={{ fontSize: 16, color: colors.textSecondary }}>← Back</ThemedText>
            </Pressable>
            <ThemedText type="title">Capture Your Room</ThemedText>
          </ThemedView>

          {/* Photo preview / placeholder */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={selectedImageUri ? 'Change photo' : 'Choose a photo from your library'}
            style={[
              styles.preview,
              { backgroundColor: colors.muted, borderColor: colors.border },
              selectedImageUri ? styles.previewFilled : null,
            ]}
            onPress={pickFromGallery}
          >
            {selectedImageUri ? (
              <Image
                source={{ uri: selectedImageUri }}
                style={styles.previewImage}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <ThemedView style={styles.previewPlaceholder}>
                <ThemedView
                  style={[
                    styles.cameraIconBox,
                    { borderColor: colors.mutedForeground },
                  ]}
                />
                <ThemedText type="default" style={{ color: colors.mutedForeground, textAlign: 'center' }}>
                  Tap to choose a photo
                </ThemedText>
                <ThemedText type="small" style={{ color: colors.mutedForeground, textAlign: 'center', opacity: 0.7 }}>
                  or use the buttons below
                </ThemedText>
              </ThemedView>
            )}
          </Pressable>

          {/* Tips (shown before image is selected) */}
          {!selectedImageUri && (
            <ThemedView style={styles.tipsContainer}>
              <ThemedText type="subtitle" style={styles.tipsTitle}>
                Tips for best results
              </ThemedText>
              {[
                'Capture the full room with good lighting',
                'Include walls, floor, and key furniture',
                'Take photos from multiple angles',
                'Avoid strong shadows or backlighting',
              ].map((tip) => (
                <ThemedText key={tip} type="default" style={styles.tip}>
                  · {tip}
                </ThemedText>
              ))}
            </ThemedView>
          )}

          {/* Action buttons */}
          <ThemedView style={styles.buttonContainer}>
            {selectedImageUri ? (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
                  ]}
                  accessibilityRole="button"
                  onPress={handleAnalyze}
                >
                  <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>
                    Analyze This Room
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                  accessibilityRole="button"
                  onPress={() => setSelectedImageUri(null)}
                >
                  <ThemedText style={{ color: colors.text }}>Choose a different photo</ThemedText>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
                  ]}
                  accessibilityRole="button"
                  onPress={pickFromGallery}
                >
                  <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>
                    Choose from Library
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                  accessibilityRole="button"
                  onPress={takePhoto}
                >
                  <ThemedText style={{ color: colors.text }}>Take a Photo</ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.skipButton, { opacity: pressed ? 0.6 : 1 }]}
                  hitSlop={TapSlop.defaultLabelPadded}
                  accessibilityRole="button"
                  onPress={() => router.push('/')}
                >
                  <ThemedText style={{ color: colors.textSecondary, fontSize: 14 }}>
                    Skip for now
                  </ThemedText>
                </Pressable>
              </>
            )}
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
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  preview: {
    aspectRatio: 4 / 3,
    borderRadius: Spacing.three,
    borderWidth: 1,
    overflow: 'hidden',
  },
  previewFilled: {
    borderWidth: 0,
  },
  previewImage: {
    flex: 1,
  },
  previewPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cameraIconBox: {
    width: 48,
    height: 36,
    borderRadius: 6,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  tipsContainer: {
    gap: Spacing.two,
  },
  tipsTitle: {
    marginBottom: Spacing.one,
  },
  tip: {
    lineHeight: 22,
  },
  buttonContainer: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  primaryButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: 'transparent',
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
