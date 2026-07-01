import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setPendingRoomType } from '@/state/photo-session';

const ROOM_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'living_room', label: 'Living Room', hint: 'Sofas, coffee tables, entertainment' },
  { value: 'bedroom', label: 'Bedroom', hint: 'Beds, dressers, nightstands' },
  { value: 'kitchen', label: 'Kitchen', hint: 'Cabinets, countertops, appliances' },
  { value: 'bathroom', label: 'Bathroom', hint: 'Vanity, fixtures, storage' },
  { value: 'dining_room', label: 'Dining Room', hint: 'Table, chairs, lighting' },
  { value: 'home_office', label: 'Home Office', hint: 'Desk, seating, shelving' },
];

export default function RoomTypeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  const handleSelect = useCallback(
    (value: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPendingRoomType(value);
      router.push('/results');
    },
    [router],
  );

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
            <ThemedText type="title">What type of room?</ThemedText>
            <ThemedText type="default" style={{ color: colors.textSecondary }}>
              This helps our AI tailor the analysis and recommendations.
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.optionsList}>
            {ROOM_OPTIONS.map(({ value, label, hint }) => (
              <Pressable
                key={value}
                style={({ pressed }) => [
                  styles.optionRow,
                  { borderColor: colors.border, backgroundColor: pressed ? colors.backgroundSelected : colors.card },
                ]}
                onPress={() => handleSelect(value)}
              >
                <ThemedView style={[styles.optionText, { backgroundColor: 'transparent' }]}>
                  <ThemedText type="defaultSemiBold">{label}</ThemedText>
                  <ThemedText type="small" style={{ color: colors.mutedForeground }}>
                    {hint}
                  </ThemedText>
                </ThemedView>
                <View style={[styles.chevron, { borderColor: colors.mutedForeground }]} />
              </Pressable>
            ))}
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
  optionsList: {
    gap: Spacing.two,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  optionText: {
    gap: Spacing.half,
    flex: 1,
  },
  chevron: {
    width: 7,
    height: 7,
    borderTopWidth: 1.5,
    borderRightWidth: 1.5,
    transform: [{ rotate: '45deg' }],
  },
});
