import { Platform, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Collapsible } from '@/components/ui/collapsible';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TIPS: { title: string; body: string }[] = [
  {
    title: 'Colour & natural light',
    body:
      'Natural light changes how every colour reads throughout the day. North-facing rooms stay cool and flat — warm neutrals (linen, terracotta) counteract that. South-facing rooms amplify warmth — cooler whites and greys prevent them feeling yellow. Our AI reads your room photos at face value; shoot in daylight with lamps off for the most accurate palette recommendation.',
  },
  {
    title: 'Proportion & furniture scale',
    body:
      'A sofa that fills 2/3 of the wall behind it reads as correctly scaled; smaller feels lost, larger feels cramped. Seat height should land within 25–30 cm of the coffee table surface. The AI checks these ratios against your photo — if a piece is flagged for removal, disproportionate scale is often why.',
  },
  {
    title: 'Layering materials & textures',
    body:
      'A well-designed room uses three material weights: a structural material (wood, stone, plaster), a mid-weight (woven fabric, rattan, matte metal), and a soft accent (velvet, bouclé, sheepskin). More than two of the same finish type — warm metals, shiny surfaces — creates visual noise. The materials report in your analysis highlights conflicts.',
  },
  {
    title: 'Negative space & breathing room',
    body:
      'Empty wall and floor space is not wasted — it gives the eye somewhere to rest and makes the objects you do place feel intentional. As a rule, leave at least 90 cm of clear walkway between furniture groupings, and resist filling every shelf. The AI flags overcrowding in the "What to Remove" list.',
  },
  {
    title: 'Cohesion across rooms',
    body:
      'Rooms in an apartment read as related even when you cannot see them at once — through doorways, reflections, and the mental map you form over time. Running one wood species, one metal finish, and one soft-material family across all rooms creates a thread that makes the whole apartment feel considered rather than assembled piece by piece.',
  },
];

export default function DesignTipsScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: safeAreaInsets.top,
      paddingLeft: safeAreaInsets.left,
      paddingRight: safeAreaInsets.right,
      paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    },
    web: {
      paddingTop: Spacing.six,
      paddingBottom: Spacing.four,
    },
    default: {
      paddingBottom: BottomTabInset + Spacing.three,
    },
  });

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={safeAreaInsets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}
    >
      <ThemedView style={styles.inner}>
        <ThemedView style={styles.header}>
          <ThemedText type="title">Design Principles</ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
            What the AI looks for when reading your room.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.sectionsWrapper}>
          {TIPS.map(({ title, body }) => (
            <Collapsible key={title} title={title}>
              <ThemedText type="small" style={styles.tipBody}>
                {body}
              </ThemedText>
            </Collapsible>
          ))}
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  inner: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
  },
  header: {
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  subtitle: {
    lineHeight: 22,
  },
  sectionsWrapper: {
    gap: Spacing.three,
  },
  tipBody: {
    lineHeight: 20,
  },
});
