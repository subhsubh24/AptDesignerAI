import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import Purchases, { PACKAGE_TYPE } from 'react-native-purchases';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { RC_KEY } from '@/lib/rc-init';
import { ENTITLEMENT_ID } from '@/hooks/use-entitlements';

const TERMS_URL = 'https://aptdesignerai.com/terms';
const PRIVACY_URL = 'https://aptdesignerai.com/privacy';

// Open in an in-app browser so the user stays inside the purchase flow
// (matches the ExternalLink pattern used elsewhere in the app).
function openLegal(url: string) {
  void openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
}

type DisplayOption = {
  pkg: PurchasesPackage | null;
  label: string;
  price: string;
  subline: string;
  badge: string | null;
};

// Shown when RC offerings haven't loaded yet or RC is not configured
const FALLBACK_OPTIONS: DisplayOption[] = [
  {
    pkg: null,
    label: 'Annual',
    price: '$399 / year',
    subline: '$33.25 per month · free trial included',
    badge: 'Best value',
  },
  {
    pkg: null,
    label: 'Monthly',
    price: '$49 / month',
    subline: 'Free trial included',
    badge: null,
  },
];

function packagesToOptions(offering: PurchasesOffering): DisplayOption[] {
  return offering.availablePackages
    // A malformed offering can carry a package with no `product` (no
    // purchasable price behind it). The RC types say `product` is always
    // present, but the network payload is not type-checked — a null slips
    // through and dereferencing pkg.product below would throw and
    // white-screen the paywall (this app has no error boundary). Drop the
    // unpurchasable package instead of crashing on it.
    .filter((pkg) => pkg.product != null)
    .map((pkg) => {
      const isAnnual = pkg.packageType === PACKAGE_TYPE.ANNUAL;
      const isMonthly = pkg.packageType === PACKAGE_TYPE.MONTHLY;
      const priceStr = pkg.product.priceString;
      return {
        pkg,
        label: isAnnual ? 'Annual' : isMonthly ? 'Monthly' : pkg.identifier,
        price: isAnnual ? `${priceStr} / year` : isMonthly ? `${priceStr} / month` : priceStr,
        subline: isAnnual
          ? 'Free trial included · best value'
          : isMonthly
            ? 'Free trial included'
            : pkg.product.description,
        badge: isAnnual ? 'Best value' : null,
      };
    });
}

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onPurchaseSuccess?: () => void;
};

export function PaywallSheet({ visible, onDismiss, onPurchaseSuccess }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  const [options, setOptions] = useState<DisplayOption[]>(FALLBACK_OPTIONS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [purchasing, setPurchasing] = useState(false);
  const [offeringLoaded, setOfferingLoaded] = useState(false);

  // Fetch RC offerings each time the sheet opens
  useEffect(() => {
    if (!visible || !RC_KEY || offeringLoaded) return;
    // getOfferings is a network call; the sheet can be dismissed (or the screen
    // unmounted) before it resolves. Guard against a setState-after-unmount on
    // this revenue surface — without it the resolve/reject fires state updates
    // on a gone component (React warning + wasted work).
    let cancelled = false;
    Purchases.getOfferings()
      .then((offerings) => {
        if (cancelled) return;
        const current = offerings.current;
        if (current && current.availablePackages.length > 0) {
          const opts = packagesToOptions(current);
          // If every package was unpurchasable (no product), keep the static
          // fallback display + leave offeringLoaded false so the CTA's
          // no-package path warns rather than showing an empty, priceless sheet.
          if (opts.length > 0) {
            setOptions(opts);
            setSelectedIndex(0);
            setOfferingLoaded(true);
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Offerings failed to load (network / SDK error). Keep the fallback
        // display, but surface the failure instead of swallowing it so it's
        // observable — and so the CTA can warn rather than silently dismiss
        // (the fallback options carry no purchasable package).
        console.warn('[paywall] getOfferings failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, offeringLoaded]);

  const selectedOption = options[selectedIndex] ?? null;

  const handleStartTrial = useCallback(async () => {
    const pkg = selectedOption?.pkg;
    if (!RC_KEY) {
      // RC not configured (dev mode) — dismiss gracefully
      onDismiss();
      return;
    }
    if (!pkg) {
      // RC is configured but real offerings never loaded (network / SDK error),
      // so the visible prices are placeholders with no purchasable package
      // behind them. Don't silently dismiss the sheet (a dead CTA) — tell the
      // user and leave the paywall open so they can retry.
      Alert.alert(
        'Pricing unavailable',
        'We couldn’t load subscription options. Please check your connection and try again.',
      );
      return;
    }
    setPurchasing(true);
    try {
      await Purchases.purchasePackage(pkg);
      onPurchaseSuccess?.();
      onDismiss();
    } catch (err: unknown) {
      // RC throws { userCancelled: true } when the user taps Cancel in the OS dialog
      const userCancelled =
        typeof err === 'object' && err !== null && (err as Record<string, unknown>).userCancelled === true;
      if (!userCancelled) {
        Alert.alert('Purchase failed', 'Please try again or restore your purchases below.');
      }
    } finally {
      setPurchasing(false);
    }
  }, [onDismiss, onPurchaseSuccess, selectedOption]);

  const handleRestore = useCallback(async () => {
    if (!RC_KEY) return;
    setPurchasing(true);
    try {
      const info = await Purchases.restorePurchases();
      const restoredPro = info.entitlements.active[ENTITLEMENT_ID]?.isActive === true;
      if (restoredPro) {
        onPurchaseSuccess?.();
        onDismiss();
      } else {
        // Restore succeeded but this account holds no active subscription. Tell
        // the truth and keep the sheet open — dismissing + firing onPurchaseSuccess
        // here would look like a successful unlock the user never actually got.
        Alert.alert('Restore purchases', 'No active subscription was found for this account.');
      }
    } catch (err: unknown) {
      // RC throws { userCancelled: true } when the user backs out of the OS dialog.
      const userCancelled =
        typeof err === 'object' && err !== null && (err as Record<string, unknown>).userCancelled === true;
      if (!userCancelled) {
        // A genuine failure (network / store error) — don't claim "no purchases
        // found", which would stop the user retrying a transient error.
        Alert.alert(
          'Restore failed',
          'Something went wrong restoring your purchases. Please check your connection and try again.',
        );
      }
    } finally {
      setPurchasing(false);
    }
  }, [onDismiss, onPurchaseSuccess]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <ThemedView style={[styles.sheet, { backgroundColor: colors.background }]}>
        <Pressable
          style={styles.closeButton}
          onPress={onDismiss}
          hitSlop={12}
          disabled={purchasing}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
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
            {options.map((option, index) => (
              <Pressable
                key={option.label}
                onPress={() => setSelectedIndex(index)}
                accessibilityRole="radio"
                accessibilityLabel={`${option.label}, ${option.price}${option.subline ? `, ${option.subline}` : ''}${option.badge ? `, ${option.badge}` : ''}`}
                accessibilityState={{ selected: index === selectedIndex }}
              >
                <ThemedView
                  style={[
                    styles.pricingCard,
                    {
                      borderColor:
                        index === selectedIndex
                          ? colors.accent
                          : option.badge
                            ? colors.accent
                            : colors.border,
                      backgroundColor: colors.card,
                      borderWidth: index === selectedIndex ? 2 : 1.5,
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
              </Pressable>
            ))}
          </ThemedView>

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              {
                backgroundColor: colors.accent,
                opacity: pressed || purchasing ? 0.8 : 1,
              },
            ]}
            onPress={handleStartTrial}
            disabled={purchasing}
            accessibilityRole="button"
            accessibilityLabel="Start free trial"
            accessibilityState={{ disabled: purchasing, busy: purchasing }}
          >
            <ThemedText style={[styles.ctaText, { color: colors.accentForeground }]}>
              {purchasing ? 'Processing…' : 'Start Free Trial'}
            </ThemedText>
          </Pressable>

          <Pressable
            style={styles.restoreButton}
            onPress={handleRestore}
            hitSlop={8}
            disabled={purchasing}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
          >
            <ThemedText type="small" style={{ color: colors.textSecondary }}>
              Restore Purchases
            </ThemedText>
          </Pressable>

          <ThemedText
            type="small"
            style={[styles.legal, { color: colors.mutedForeground }]}
          >
            {/* Disclose the recurring price + period AND the cancellation
                method at the point of purchase (Apple App Store 3.1.2(v) /
                Google Play subscription policy — both require telling the user
                HOW to cancel, not just that they can). selectedOption.price
                already reads e.g. "$49 / month"; the store-native path mirrors
                the guidance shown in Settings (settings.tsx). */}
            {selectedOption?.price
              ? `Your free trial then renews at ${selectedOption.price} unless you cancel before it ends. Manage or cancel anytime in your App Store or Google Play subscription settings. `
              : 'Payment is charged when your free trial ends. Manage or cancel anytime in your App Store or Google Play subscription settings. '}
            By subscribing you agree to our{' '}
            <ThemedText
              type="small"
              style={[styles.legalLink, { color: colors.textSecondary }]}
              onPress={() => openLegal(TERMS_URL)}
              accessibilityRole="link"
              accessibilityLabel="Terms of Service"
            >
              Terms of Service
            </ThemedText>{' '}
            and{' '}
            <ThemedText
              type="small"
              style={[styles.legalLink, { color: colors.textSecondary }]}
              onPress={() => openLegal(PRIVACY_URL)}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
            >
              Privacy Policy
            </ThemedText>
            .
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
  legalLink: {
    textDecorationLine: 'underline',
    opacity: 0.7,
  },
});
