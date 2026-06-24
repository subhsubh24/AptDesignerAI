import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/hooks/use-session';
import { useSavedDesigns, type SavedDesign } from '@/hooks/use-saved-designs';

const ROOM_LABELS: Record<string, string> = {
  living_room: 'Living Room',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  dining_room: 'Dining Room',
  home_office: 'Home Office',
};

function roomLabel(room_type: string | null | undefined): string {
  if (!room_type) return 'Room';
  return ROOM_LABELS[room_type] ?? room_type.replace(/_/g, ' ');
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return diffMin <= 1 ? 'Just now' : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr === 1 ? '1 hour ago' : `${diffHr} hours ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return diffDay === 1 ? 'Yesterday' : `${diffDay} days ago`;
  const diffMo = Math.floor(diffDay / 30);
  return diffMo === 1 ? '1 month ago' : `${diffMo} months ago`;
}

function SkeletonCard({ colors }: { colors: (typeof Colors)[keyof typeof Colors] }) {
  return (
    <ThemedView style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[styles.cardThumb, { backgroundColor: colors.backgroundElement }]} />
      <ThemedView style={[styles.cardBody, { backgroundColor: 'transparent' }]}>
        <View style={[styles.skeletonLine, { width: '60%', backgroundColor: colors.backgroundElement }]} />
        <View style={[styles.skeletonLine, { width: '35%', marginTop: 6, backgroundColor: colors.backgroundElement }]} />
      </ThemedView>
    </ThemedView>
  );
}

function DesignCard({
  design,
  colors,
  onShare,
}: {
  design: SavedDesign;
  colors: (typeof Colors)[keyof typeof Colors];
  onShare: (id: string, title: string) => void;
}) {
  return (
    <ThemedView style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {design.thumbnail_url ? (
        <Image source={{ uri: design.thumbnail_url }} style={styles.cardThumb} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.cardThumb, { backgroundColor: colors.backgroundElement }]} />
      )}
      <ThemedView style={[styles.cardBody, { backgroundColor: 'transparent' }]}>
        <ThemedText style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
          {design.title}
        </ThemedText>
        <ThemedView style={[styles.cardMeta, { backgroundColor: 'transparent' }]}>
          <ThemedView style={[styles.badge, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText type="small" style={{ color: colors.textSecondary }}>
              {roomLabel(design.room_type)}
            </ThemedText>
          </ThemedView>
          <ThemedText type="small" style={{ color: colors.mutedForeground }}>
            {relativeTime(design.updated_at)}
          </ThemedText>
        </ThemedView>
        <Pressable
          style={({ pressed }) => [styles.shareButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => onShare(design.id, design.title)}
          accessibilityRole="button"
          accessibilityLabel={`Share ${design.title}`}
        >
          <ThemedText type="small" style={{ color: colors.accent }}>
            Share design
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

export default function SavedDesignsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];
  const { state, reload } = useSavedDesigns();
  const { session } = useSession();

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Clear the pull-to-refresh spinner once the data settles
  useEffect(() => {
    if (state.status !== 'loading') {
      setIsRefreshing(false);
    }
  }, [state.status]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    reload();
  }, [reload]);

  const handleRetry = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    reload();
  }, [reload]);

  const handleShare = useCallback(async (id: string, title: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
    const token = session?.access_token;
    const fallbackMsg = `Check out "${title}" — my room design from AptDesignerAI!\nhttps://aptdesignerai.com`;
    if (!apiUrl || !token) {
      // Fallback: share the app homepage when no session or URL configured
      await Share.share({ message: fallbackMsg });
      return;
    }

    try {
      const resp = await fetch(`${apiUrl}/api/mobile/saved-designs/${id}/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const json = await resp.json() as { share_url?: string };
        const shareUrl = json.share_url ?? `https://aptdesignerai.com`;
        await Share.share({ message: `Check out "${title}" — my room design from AptDesignerAI!\n${shareUrl}` });
      } else {
        await Share.share({ message: fallbackMsg });
      }
    } catch {
      // Network error — still open share sheet with app URL so the action never silently fails
      await Share.share({ message: fallbackMsg });
    }
  }, [session]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={[styles.header, { borderColor: colors.border }]}>
          <ThemedText type="title">Saved Designs</ThemedText>
          {state.status === 'done' && state.designs.length > 0 && (
            <ThemedText type="small" style={{ color: colors.mutedForeground }}>
              {state.designs.length} {state.designs.length === 1 ? 'design' : 'designs'}
            </ThemedText>
          )}
        </ThemedView>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {state.status === 'loading' && (
            <>
              <SkeletonCard colors={colors} />
              <SkeletonCard colors={colors} />
              <SkeletonCard colors={colors} />
            </>
          )}

          {state.status === 'error' && (
            <ThemedView style={[styles.feedbackBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <ThemedText type="subtitle" style={styles.centeredText}>
                Couldn&apos;t load designs
              </ThemedText>
              <ThemedText style={[styles.centeredText, { color: colors.textSecondary }]}>{state.message}</ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={handleRetry}
              >
                <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>Try again</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {state.status === 'done' && state.designs.length === 0 && (
            <ThemedView style={[styles.feedbackBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <ThemedText type="subtitle" style={styles.centeredText}>
                No designs yet
              </ThemedText>
              <ThemedText style={[styles.centeredText, { color: colors.textSecondary }]}>
                Start a new design to see your saved work here
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => router.push('/photo')}
              >
                <ThemedText style={[styles.buttonText, { color: colors.accentForeground }]}>Create Design</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {state.status === 'done' &&
            state.designs.length > 0 &&
            state.designs.map((design) => (
              <DesignCard key={design.id} design={design} colors={colors} onShare={handleShare} />
            ))}
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
  header: {
    paddingHorizontal: Spacing.four,
    gap: 4,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    flexGrow: 1,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardThumb: {
    width: '100%',
    height: 180,
  },
  cardBody: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 6,
  },
  shareButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  feedbackBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    flex: 1,
    minHeight: 300,
    justifyContent: 'center',
  },
  centeredText: {
    textAlign: 'center',
    lineHeight: 22,
  },
  actionButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    marginTop: Spacing.two,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
