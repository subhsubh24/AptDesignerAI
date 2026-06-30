import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PaywallSheet } from '@/components/paywall-sheet';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEntitlements } from '@/hooks/use-entitlements';
import { useFreeSaveQuota } from '@/hooks/use-free-quota';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { peekPendingImageUri, peekPendingRoomType } from '@/state/photo-session';

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
type SaveState = 'idle' | 'saving' | 'saved' | 'save_error';

function mimeTypeForExt(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

// Upload should complete quickly even on a slow connection; the analysis
// pipeline is server-capped at 300s (maxDuration), so we wait a little past
// that for a real response. Either way the request must never hang forever and
// leave the screen stuck on a spinner the user can't escape without force-quit.
const UPLOAD_TIMEOUT_MS = 90_000;
const ANALYZE_TIMEOUT_MS = 330_000;
const SAVE_TIMEOUT_MS = 30_000;

/** fetch() that aborts after `timeoutMs`, surfacing a friendly timeout error. */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadImage(imageUri: string, token: string, userId: string): Promise<string> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl) throw new Error('App configuration error: Supabase URL not set.');

  const ext = imageUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const filename = `${userId}/${Date.now()}.${ext}`;
  const mimeType = mimeTypeForExt(ext);

  const formData = new FormData();
  formData.append('file', {
    uri: imageUri,
    name: filename.split('/').pop(),
    type: mimeType,
  } as unknown as Blob);

  const uploadResp = await fetchWithTimeout(
    `${supabaseUrl}/storage/v1/object/room-photos/${filename}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: formData,
    },
    UPLOAD_TIMEOUT_MS,
    'Upload timed out. Check your connection and try again.',
  );

  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => '');
    throw new Error(`Upload failed (${uploadResp.status}): ${text}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/room-photos/${filename}`;
}

async function analyzeRoom(publicUrl: string, roomType: string, token: string): Promise<AnalysisResult> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!apiUrl) throw new Error('App configuration error: API URL not set.');

  const analyzeResp = await fetchWithTimeout(
    `${apiUrl}/api/mobile/analyze`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image_url: publicUrl, room_type: roomType }),
    },
    ANALYZE_TIMEOUT_MS,
    'Analysis timed out. Please try again.',
  );

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

  // peek (non-consuming) so back → room-type → results remounts correctly
  const [imageUri] = useState<string | null>(peekPendingImageUri);
  const [roomType] = useState<string>(() => peekPendingRoomType() ?? 'living_room');
  const [stage, setStage] = useState<Stage>('uploading');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [showPaywall, setShowPaywall] = useState(false);
  const { session } = useSession();
  const { isPro, refresh: refreshEntitlements } = useEntitlements(session?.user.id);
  const { isLoading: quotaLoading, canSave: freeQuotaOk, markSaved } = useFreeSaveQuota();
  // Pro users have unlimited saves; free users are limited by the AsyncStorage quota.
  const canSave = isPro || freeQuotaOk;

  const run = useCallback(async (uri: string, rt: string) => {
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) throw new Error('Not authenticated');
      const token = sessionData.session.access_token;
      const userId = sessionData.session.user.id;

      setStage('uploading');
      const uploadedUrl = await uploadImage(uri, token, userId);
      setPublicUrl(uploadedUrl);

      setStage('analyzing');
      const result = await analyzeRoom(uploadedUrl, rt, token);

      setAnalysis(result);
      setStage('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      setStage('error');
    }
  }, []);

  const saveDesign = useCallback(async () => {
    if (!analysis) return;
    if (!canSave) {
      setShowPaywall(true);
      return;
    }
    setSaveState('saving');
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) throw new Error('Not authenticated');
      const token = sessionData.session.access_token;
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
      if (!apiUrl) throw new Error('App configuration error: API URL not set.');

      const resp = await fetchWithTimeout(
        `${apiUrl}/api/mobile/saved-designs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ room_type: roomType, analysis, thumbnail_url: publicUrl }),
        },
        SAVE_TIMEOUT_MS,
        'Saving timed out. Please check your connection and try again.',
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Save failed (${resp.status})`);
      }
      await markSaved();
      setSaveState('saved');
    } catch {
      setSaveState('save_error');
    }
  }, [analysis, canSave, markSaved, publicUrl, roomType]);

  useEffect(() => {
    if (imageUri) {
      run(imageUri, roomType);
    } else {
      setErrorMsg('No image found — please go back and select a photo.');
      setStage('error');
    }
    // imageUri and roomType are stable (set once from module store on mount)
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
            <ThemedText type="small" style={{ color: colors.mutedForeground }}>
              {roomLabel}
            </ThemedText>
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
                {stage === 'uploading' ? 'Uploading your photo…' : 'Analysing your room with AI…'}
              </ThemedText>
              {stage === 'analyzing' ? (
                <ThemedText type="small" style={{ color: colors.mutedForeground, opacity: 0.7 }}>
                  This usually takes 15–30 seconds.
                </ThemedText>
              ) : null}
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
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.retryButton,
                    { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() => router.push('/photo')}
                >
                  <ThemedText style={{ color: colors.accentForeground, fontWeight: '600' }}>
                    Pick a Photo
                  </ThemedText>
                </Pressable>
              )}
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
                    <ThemedView key={item} style={styles.listRow}>
                      <View style={[styles.listDot, { backgroundColor: colors.accent }]} />
                      <ThemedText type="default" style={[styles.listItemText, { color: colors.mutedForeground }]}>
                        {item}
                      </ThemedText>
                    </ThemedView>
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
                    <ThemedView key={item} style={styles.listRow}>
                      <View style={[styles.listDot, { backgroundColor: colors.destructive }]} />
                      <ThemedText type="default" style={[styles.listItemText, { color: colors.mutedForeground }]}>
                        {item}
                      </ThemedText>
                    </ThemedView>
                  ))}
                </ThemedView>
              )}
            </>
          ) : null}

          <ThemedView style={styles.buttonContainer}>
            {stage === 'done' && analysis ? (
              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  {
                    backgroundColor:
                      saveState === 'saved' ? colors.backgroundSelected : colors.accent,
                    opacity: pressed || saveState === 'saving' || saveState === 'saved' ? 0.8 : 1,
                  },
                ]}
                onPress={saveState === 'idle' || saveState === 'save_error' ? saveDesign : undefined}
                disabled={quotaLoading || saveState === 'saving' || saveState === 'saved'}
              >
                <ThemedText style={[styles.buttonText, { color: saveState === 'saved' ? colors.text : colors.accentForeground }]}>
                  {saveState === 'idle' ? 'Save Design' :
                   saveState === 'saving' ? 'Saving…' :
                   saveState === 'saved' ? 'Saved' : 'Retry Save'}
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => router.push('/')}
            >
              <ThemedText style={[styles.buttonText, { color: colors.text }]}>
                Back to Home
              </ThemedText>
            </Pressable>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>

      <PaywallSheet
        visible={showPaywall}
        onDismiss={() => setShowPaywall(false)}
        onPurchaseSuccess={() => { void refreshEntitlements(); }}
      />
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
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  listDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    flexShrink: 0,
  },
  listItemText: {
    flex: 1,
    lineHeight: 22,
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
  backButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
