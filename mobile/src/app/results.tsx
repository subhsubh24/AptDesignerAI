import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { consumePendingImageUri, consumePendingRoomType } from '@/state/photo-session';

interface AnalysisResult {
  summary: string;
  style_name: string;
  design_direction: string;
  recommended_palette: string[];
  recommended_materials: string[];
  recommended_textures: string[];
  what_works: string[];
  what_should_go: string[];
}

type Stage = 'uploading' | 'analyzing' | 'done' | 'error';

async function uploadAndAnalyze(
  imageUri: string,
  roomType: string,
): Promise<AnalysisResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new Error('Not authenticated');
  }
  const token = sessionData.session.access_token;
  const userId = sessionData.session.user.id;

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

  // Upload image to Supabase Storage via REST — FormData is the most reliable
  // approach on React Native for file:// / content:// URIs
  const ext = imageUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const filename = `${userId}/${Date.now()}.${ext}`;

  const formData = new FormData();
  formData.append('file', {
    uri: imageUri,
    name: filename.split('/').pop(),
    type: 'image/jpeg',
  } as unknown as Blob);

  const uploadResp = await fetch(
    `${supabaseUrl}/storage/v1/object/room-photos/${filename}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: formData,
    },
  );

  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => '');
    throw new Error(`Upload failed (${uploadResp.status}): ${text}`);
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/room-photos/${filename}`;

  // Call the mobile analyze endpoint
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const analyzeResp = await fetch(`${apiUrl}/api/mobile/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ image_url: publicUrl, room_type: roomType }),
  });

  if (!analyzeResp.ok) {
    const body = await analyzeResp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Analysis failed (${analyzeResp.status})`);
  }

  const json = await analyzeResp.json() as { analysis: AnalysisResult };
  return json.analysis;
}

export default function ResultsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  const [imageUri] = useState<string | null>(consumePendingImageUri);
  const [roomType] = useState<string>(() => consumePendingRoomType() ?? 'living_room');
  const [stage, setStage] = useState<Stage>('uploading');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const run = useCallback(async (uri: string, rt: string) => {
    try {
      setStage('uploading');
      // Brief pause so the UI renders the uploading label before the heavy work
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      setStage('analyzing');
      const result = await uploadAndAnalyze(uri, rt);
      setAnalysis(result);
      setStage('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      setStage('error');
    }
  }, []);

  useEffect(() => {
    if (imageUri) {
      run(imageUri, roomType);
    } else {
      setErrorMsg('No image found. Please go back and select a photo.');
      setStage('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roomLabel = roomType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedView style={styles.header}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <ThemedText style={{ fontSize: 16, color: colors.textSecondary }}>← Back</ThemedText>
            </Pressable>
            <ThemedText type="title">Design Analysis</ThemedText>
            {roomType ? (
              <ThemedText type="small" style={{ color: colors.mutedForeground }}>
                {roomLabel}
              </ThemedText>
            ) : null}
          </ThemedView>

          {/* Room photo */}
          {imageUri ? (
            <ThemedView style={[styles.photoCard, { borderColor: colors.border }]}>
              <Image
                source={{ uri: imageUri }}
                style={styles.roomPhoto}
                contentFit="cover"
                transition={300}
              />
              <ThemedView style={styles.photoLabel}>
                <ThemedText type="small" style={{ color: colors.mutedForeground }}>
                  Your {roomLabel.toLowerCase()}
                </ThemedText>
              </ThemedView>
            </ThemedView>
          ) : null}

          {/* Loading */}
          {(stage === 'uploading' || stage === 'analyzing') && (
            <ThemedView style={[styles.loadingCard, { borderColor: colors.border }]}>
              <ActivityIndicator color={colors.accent} />
              <ThemedText type="default" style={{ color: colors.mutedForeground }}>
                {stage === 'uploading' ? 'Uploading your photo…' : 'Analyzing your room with AI…'}
              </ThemedText>
              <ThemedText type="small" style={{ color: colors.mutedForeground, opacity: 0.7 }}>
                {stage === 'analyzing' ? 'This usually takes 15–30 seconds.' : ''}
              </ThemedText>
            </ThemedView>
          )}

          {/* Error */}
          {stage === 'error' && (
            <ThemedView style={[styles.analysisCard, { borderColor: colors.destructive }]}>
              <ThemedText type="subtitle" style={{ color: colors.destructive }}>
                Analysis failed
              </ThemedText>
              <ThemedText type="default" style={{ color: colors.mutedForeground }}>
                {errorMsg}
              </ThemedText>
              {imageUri ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.retryButton,
                    { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() => run(imageUri, roomType)}
                >
                  <ThemedText style={{ color: colors.accentForeground, fontWeight: '600' }}>
                    Try Again
                  </ThemedText>
                </Pressable>
              ) : null}
            </ThemedView>
          )}

          {/* Results */}
          {stage === 'done' && analysis ? (
            <>
              {/* Style + Summary */}
              <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
                <ThemedText type="subtitle" style={styles.cardTitle}>
                  {analysis.style_name}
                </ThemedText>
                <ThemedText type="default" style={[styles.cardContent, { color: colors.mutedForeground }]}>
                  {analysis.summary}
                </ThemedText>
              </ThemedView>

              {/* Design Direction */}
              <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
                <ThemedText type="subtitle" style={styles.cardTitle}>
                  Design Direction
                </ThemedText>
                <ThemedText type="default" style={[styles.cardContent, { color: colors.mutedForeground }]}>
                  {analysis.design_direction}
                </ThemedText>
              </ThemedView>

              {/* Palette */}
              <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
                <ThemedText type="subtitle" style={styles.cardTitle}>
                  Colour Palette
                </ThemedText>
                <ThemedView style={styles.chipRow}>
                  {analysis.recommended_palette.map((color) => (
                    <ThemedView
                      key={color}
                      style={[styles.chip, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}
                    >
                      <ThemedText type="small">{color}</ThemedText>
                    </ThemedView>
                  ))}
                </ThemedView>
              </ThemedView>

              {/* Materials + Textures */}
              <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
                <ThemedText type="subtitle" style={styles.cardTitle}>
                  Materials &amp; Textures
                </ThemedText>
                <ThemedView style={styles.chipRow}>
                  {[...analysis.recommended_materials, ...analysis.recommended_textures].map((item) => (
                    <ThemedView
                      key={item}
                      style={[styles.chip, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}
                    >
                      <ThemedText type="small">{item}</ThemedText>
                    </ThemedView>
                  ))}
                </ThemedView>
              </ThemedView>

              {/* What Works */}
              {analysis.what_works.length > 0 && (
                <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
                  <ThemedText type="subtitle" style={styles.cardTitle}>
                    What to Keep
                  </ThemedText>
                  {analysis.what_works.map((item) => (
                    <ThemedText key={item} type="default" style={styles.listItem}>
                      ✓ {item}
                    </ThemedText>
                  ))}
                </ThemedView>
              )}

              {/* What Should Go */}
              {analysis.what_should_go.length > 0 && (
                <ThemedView style={[styles.analysisCard, { borderColor: colors.border }]}>
                  <ThemedText type="subtitle" style={styles.cardTitle}>
                    What to Remove
                  </ThemedText>
                  {analysis.what_should_go.map((item) => (
                    <ThemedText key={item} type="default" style={styles.listItem}>
                      ✕ {item}
                    </ThemedText>
                  ))}
                </ThemedView>
              )}
            </>
          ) : null}

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
  loadingCard: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
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
  listItem: {
    lineHeight: 22,
    paddingVertical: Spacing.half,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  retryButton: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
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
