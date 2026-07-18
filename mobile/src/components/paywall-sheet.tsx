import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import Purchases, { PACKAGE_TYPE } from 'react-native-purchases';
import type { PurchasesOffering, PurchasesPackage, PurchasesStoreProduct } from 'react-native-purchases';

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
  /** True only when the store product carries a real free-trial intro offer. */
  hasTrial: boolean;
};

/**
 * A RevenueCat free trial surfaces as an introductory offer priced at 0. The
 * paywall may only say "free trial" when a loaded product actually has one —
 * hardcoding trial copy for a product configured without a trial is a false
 * subscription-terms disclosure (Apple Guideline 3.1.2 / Google Play / FTC).
 * Returns e.g. "7-day free trial", or null when there is no free trial.
 */
function freeTrialLabel(product: PurchasesStoreProduct): string | null {
  const intro = product.introPrice;
  if (!intro || intro.price !== 0 || intro.periodNumberOfUnits <= 0) return null;
  const unit = intro.periodUnit?.toLowerCase() ?? '';
  const noun =
    unit === 'day' ? 'day'
      : unit === 'week' ? 'week'
        : unit === 'month' ? 'month'
          : unit === 'year' ? 'year'
            : '';
  return noun ? `${intro.periodNumberOfUnits}-${noun} free trial` : 'free trial';
}

// Shown when RC offerings haven't loaded yet or RC is not configured. With no
// loaded product we cannot know whether a trial is configured, so we never
// claim one here (honest default; real trial terms appear once RC loads).
const FALLBACK_OPTIONS: DisplayOption[] = [
  {
    pkg: null,
    label: 'Annual',
    price: '$399 / year',
    subline: 'Billed annually',
    badge: 'Best value',
    hasTrial: false,
  },
  {
    pkg: null,
    label: 'Monthly',
    price: '$49 / month',
    subline: 'Billed monthly',
    badge: null,
    hasTrial: false,
  },
];

function packagesToOptions(offering: PurchasesOffering): DisplayOption[] {
  return offering.availablePackages.map((pkg) => {
    const isAnnual = pkg.packageType === PACKAGE_TYPE.ANNUAL;
    const isMonthly = pkg.packageType === PACKAGE_TYPE.MONTHLY;
    const priceStr = pkg.product.priceString;
    const trial = freeTrialLabel(pkg.product);
    const base = isAnnual ? 'Billed annually' : isMonthly ? 'Billed monthly' : pkg.product.description;
    // Append the trial only when the store product actually offers one.
    const subline = trial ? `${base} · ${trial}` : base;
    return {
      pkg,
      label: isAnnual ? 'Annual' : isMonthly ? 'Monthly' : pkg.identifier,
      price: isAnnual ? `${priceStr} / year` : isMonthly ? `${priceStr} / month` : priceStr,
      subline,
      badge: isAnnual ? 'Best value' : null,
      hasTrial: trial !== null,
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
  const [restoring, setRestoring] = useState(false);
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
          setOptions(packagesToOptions(current));
          setSelectedIndex(0);
          setOfferingLoaded(true);
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
  const selectedHasTrial = selectedOption?.hasTrial ?? false;
  // Either action in flight disables both buttons (mutual exclusion), but each
  // button's own loading LABEL/busy state must reflect only its own operation —
  // otherwise the restore button would read "Restoring…" during a normal purchase.
  const busy = purchasing || restoring;

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
    setRestoring(true);
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
      setRestoring(false);
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
          disabled={busy}
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
                opacity: pressed || busy ? 0.8 : 1,
              },
            ]}
            onPress={handleStartTrial}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={selectedHasTrial ? 'Start free trial' : 'Subscribe'}
            accessibilityState={{ disabled: busy, busy: purchasing }}
          >
            <ThemedText style={[styles.ctaText, { color: colors.accentForeground }]}>
              {purchasing ? 'Processing…' : selectedHasTrial ? 'Start Free Trial' : 'Subscribe'}
            </ThemedText>
          </Pressable>

          <Pressable
            style={styles.restoreButton}
            onPress={handleRestore}
            hitSlop={8}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
            accessibilityState={{ disabled: busy, busy: restoring }}
          >
            <ThemedText type="small" style={{ color: colors.textSecondary }}>
              {restoring ? 'Restoring…' : 'Restore Purchases'}
            </ThemedText>
          </Pressable>

          <ThemedText
            type="small"
            style={[styles.legal, { color: colors.mutedForeground }]}
          >
            {selectedHasTrial
              ? 'Payment is charged when your free trial ends. Cancel anytime before then to avoid charges. '
              : 'Your subscription starts immediately and renews automatically until you cancel. '}
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
