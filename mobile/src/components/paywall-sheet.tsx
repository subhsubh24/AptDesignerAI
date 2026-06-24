import { useCallback } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type PricingOption = {
  id: string;
  label: string;
  price: string;
  subline: string;
  badge: string | null;
};

const PRICING: PricingOption[] = [
  {
    id: 'annual',
    label: 'Annual',
    price: '$79.99 / year',
    subline: '$6.67 per month · 7-day free trial',
    badge: 'Best value',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    price: '$9.99 / month',
    subline: '7-day free trial',
    badge: null,
  },
];

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

export function PaywallSheet({ visible, onDismiss }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  // RevenueCat purchase: wire up in Track C Phase 2
  const handleStartTrial = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  // RevenueCat restore: wire up in Track C Phase 2
  const handleRestore = useCallback(() => {}, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <ThemedView style={[styles.sheet, { backgroundColor: colors.background }]}>
        <Pressable style={styles.closeButton} onPress={onDismiss} hitSlop={12}>
          <ThemedText style={{ color: colors.textSecondary, fontSize: 16, fontWeight: '500' }}>
            Close
          </ThemedText>
        </Pressable>

        <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
          <ThemedView style={styles.hero}>
            <ThemedText type="title" style={styles.centeredText}>
              Unlock AptDesigner Pro
            </ThemedText>
            <ThemedText type="default" style={[styles.tagline, { color: colors.textSecondary }]}>
              Save unlimited designs, revisit your analyses anytime, and access priority support.
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.pricingList}>
            {PRICING.map((option) => (
              <ThemedView
                key={option.id}
                style={[
                  styles.pricingCard,
                  {
                    borderColor: option.badge ? colors.accent : colors.border,
                    backgroundColor: colors.card,
                  },
                ]}
              >
                <ThemedView style={[styles.pricingCardTop, { backgroundColor: 'transparent' }]}>
                  <ThemedText type="defaultSemiBold" style={{ color: colors.text }}>
                    {option.label}
                  </ThemedText>
                  {option.badge ? (
                    <ThemedView style={[styles.badge, { backgroundColor: colors.accent }]}>
                      <ThemedText type="small" style={{ color: colors.accentForeground, fontWeight: '600' }}>
                        {option.badge}
                      </ThemedText>
                    </ThemedView>
                  ) : null}
                </ThemedView>
                <ThemedText style={[styles.price, { color: colors.text }]}>{option.price}</ThemedText>
                <ThemedText type="small" style={{ color: colors.mutedForeground }}>
                  {option.subline}
                </ThemedText>
              </ThemedView>
            ))}
          </ThemedView>

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={handleStartTrial}
          >
            <ThemedText style={[styles.ctaText, { color: colors.accentForeground }]}>
              Start Free Trial
            </ThemedText>
          </Pressable>

          <Pressable style={styles.restoreButton} onPress={handleRestore} hitSlop={8}>
            <ThemedText type="small" style={{ color: colors.textSecondary }}>
              Restore Purchases
            </ThemedText>
          </Pressable>

          <ThemedText
            type="small"
            style={[styles.legal, { color: colors.mutedForeground }]}
          >
            Payment charged at confirmation. Cancel anytime. By subscribing you agree to our Terms of Service and Privacy Policy.
          </ThemedText>
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.four,
    zIndex: 10,
    padding: Spacing.one,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.six,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  hero: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  centeredText: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    lineHeight: 22,
  },
  pricingList: {
    gap: Spacing.two,
    marginVertical: Spacing.two,
  },
  pricingCard: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  pricingCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 6,
  },
  price: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 26,
  },
  ctaButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  restoreButton: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  legal: {
    textAlign: 'center',
    lineHeight: 18,
    opacity: 0.7,
  },
});
