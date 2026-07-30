import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import Purchases, { PACKAGE_TYPE } from 'react-native-purchases';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { RC_KEY } from '@/lib/rc-init';
import { resolveFreeTrial } from '@/lib/paywall-trial';
import {
  planLabel,
  purchaseAgreementLead,
  purchaseCtaLabel,
  purchaseDisclosure,
} from '@/lib/paywall-disclosure';
import {
  alertHandler,
  classifyPurchaseError,
  hasActiveEntitlement,
  performPurchaseAction,
  purchaseErrorAction,
  purchaseResultAction,
  unlockHandler,
  type PurchaseAction,
} from '@/lib/purchase-outcome';
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
  /**
   * Whether this plan includes a free trial THIS buyer can still take —
   * configured on the store product AND (on iOS) confirmed eligible for the
   * signed-in Apple ID. See lib/paywall-trial. Every piece of trial copy on the
   * sheet — subline, CTA, and the renewal disclosure — keys off this rather
   * than assuming one, so the terms shown at the point of purchase describe
   * what the store will actually do (Apple 3.1.2).
   */
  hasFreeTrial: boolean;
  /**
   * True for a subscription, false for a one-time purchase. Drives every piece
   * of recurrence copy on the sheet (CTA, legal sentence, agreement lead) via
   * lib/paywall-disclosure — the sheet used to assume `true` for everything,
   * which told a one-time buyer their purchase renews automatically.
   */
  isRecurring: boolean;
};

// Shown when RC offerings haven't loaded yet or RC is not configured. These
// carry no purchasable package, so they must not promise a trial either: with
// no product to read, we cannot know whether one exists.
const FALLBACK_OPTIONS: DisplayOption[] = [
  {
    pkg: null,
    label: 'Annual',
    price: '$399 / year',
    subline: '$33.25 per month · billed yearly',
    badge: 'Best value',
    hasFreeTrial: false,
    isRecurring: true,
  },
  {
    pkg: null,
    label: 'Monthly',
    price: '$49 / month',
    subline: 'Billed monthly · cancel anytime',
    badge: null,
    hasFreeTrial: false,
    isRecurring: true,
  },
];

function packagesToOptions(
  offering: PurchasesOffering,
  eligibility: Record<string, number> | null,
): DisplayOption[] {
  const isIOS = Platform.OS === 'ios';
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
      // Configured on the product AND still available to THIS buyer. On iOS a
      // returning subscriber has already spent their trial; without the
      // eligibility check the sheet would promise one and the store would
      // charge them on the spot.
      const hasFreeTrial = resolveFreeTrial(
        pkg.product,
        isIOS,
        eligibility?.[pkg.product.identifier],
      );
      // Anything that is not a recognised renewing period is treated as a
      // ONE-TIME purchase. Erring this way is the safe direction: describing a
      // subscription as one-off understates the commitment, whereas the reverse
      // tells a one-time buyer they are on a recurring charge (Apple 3.1.2).
      const isRecurring =
        isAnnual ||
        isMonthly ||
        pkg.packageType === PACKAGE_TYPE.WEEKLY ||
        pkg.packageType === PACKAGE_TYPE.TWO_MONTH ||
        pkg.packageType === PACKAGE_TYPE.THREE_MONTH ||
        pkg.packageType === PACKAGE_TYPE.SIX_MONTH;
      const trialNote = hasFreeTrial
        ? 'Free trial included'
        : isRecurring
          ? 'Cancel anytime'
          : 'One-time purchase';
      return {
        pkg,
        label: isAnnual
          ? 'Annual'
          : isMonthly
            ? 'Monthly'
            : planLabel(pkg.product.title, pkg.identifier),
        price: isAnnual ? `${priceStr} / year` : isMonthly ? `${priceStr} / month` : priceStr,
        subline: isAnnual
          ? `${trialNote} · best value`
          : isMonthly
            ? trialNote
            : pkg.product.description || trialNote,
        badge: isAnnual ? 'Best value' : null,
        hasFreeTrial,
        isRecurring,
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
      .then(async (offerings) => {
        if (cancelled) return;
        const current = offerings.current;
        if (current && current.availablePackages.length > 0) {
          // Ask whether THIS user can still take an intro offer before we
          // describe one. Only meaningful on iOS (Android always answers
          // UNKNOWN and filters ineligible offers server-side), and a failure
          // resolves to "no trial" rather than blocking the sheet — the
          // conservative direction, since over-promising is the harm.
          let eligibility: Record<string, number> | null = null;
          if (Platform.OS === 'ios') {
            try {
              const ids = current.availablePackages
                .filter((pkg) => pkg.product != null)
                .map((pkg) => pkg.product.identifier);
              const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(ids);
              eligibility = Object.fromEntries(
                Object.entries(result).map(([id, e]) => [id, e.status]),
              );
            } catch (err) {
              console.warn('[paywall] intro-eligibility lookup failed', err);
            }
          }
          if (cancelled) return;

          const opts = packagesToOptions(current, eligibility);
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
  const trialAvailable = selectedOption?.hasFreeTrial ?? false;
  // Default TRUE when no option is selected: the fallback display is the two
  // subscription plans, so "subscription" is the honest assumption there. Once a
  // real package is selected this reflects that package.
  const recurring = selectedOption?.isRecurring ?? true;
  const ctaLabel = purchaseCtaLabel({ isRecurring: recurring, hasFreeTrial: trialAvailable });

  // The ONE place an unlock can happen. Every purchase outcome — resolved or
  // thrown — is turned into a PurchaseAction by lib/purchase-outcome and then
  // performed here, so there is no second path to onPurchaseSuccess to keep in
  // sync and no branch for a new outcome to fall through.
  const applyPurchaseAction = useCallback(
    (action: PurchaseAction) => {
      // Wiring only. WHICH handler fires for which action lives in
      // lib/purchase-outcome's performPurchaseAction, where it is tested —
      // including the negative, that an alert never reaches the unlock.
      performPurchaseAction(action, {
        // The two roles are NOMINAL (see purchase-outcome's UnlockHandler /
        // AlertHandler). A bare closure is not assignable to either slot, so
        // swapping which one grants access is a compile error rather than a
        // silent inversion that unlocks Pro on a declined card.
        unlock: unlockHandler(() => {
          onPurchaseSuccess?.();
          onDismiss();
        }),
        alert: alertHandler((title, body) => Alert.alert(title, body)),
      });
    },
    [onDismiss, onPurchaseSuccess],
  );

  const handlePurchase = useCallback(async () => {
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
      // A resolved purchase is NOT an entitlement, and a thrown error is not
      // necessarily a failure — lib/purchase-outcome decides which, and carries
      // the copy, so the ONLY unlock path in this component runs through
      // `action.kind === 'unlock'`, which that module can only return for a
      // genuinely active entitlement.
      const result = await Purchases.purchasePackage(pkg);
      applyPurchaseAction(purchaseResultAction(result, ENTITLEMENT_ID));
    } catch (err: unknown) {
      applyPurchaseAction(purchaseErrorAction(err));
    } finally {
      setPurchasing(false);
    }
  }, [applyPurchaseAction, onDismiss, selectedOption]);

  const handleRestore = useCallback(async () => {
    if (!RC_KEY) return;
    setPurchasing(true);
    try {
      const info = await Purchases.restorePurchases();
      // Same guarded read as the purchase path, so the two cannot drift and
      // neither throws on a payload missing `entitlements` (the RC types promise
      // it; the network response is not runtime-checked).
      const restoredPro = hasActiveEntitlement(info, ENTITLEMENT_ID);
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
      // Cancellation is read from the error CODE, not the deprecated (and
      // nullable) `userCancelled` flag — a null there would surface a "Restore
      // failed" alert over a dialog the user closed deliberately.
      if (classifyPurchaseError(err) !== 'cancelled') {
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
            onPress={handlePurchase}
            disabled={purchasing}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: purchasing, busy: purchasing }}
          >
            <ThemedText style={[styles.ctaText, { color: colors.accentForeground }]}>
              {purchasing ? 'Processing…' : ctaLabel}
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
            {/* The terms shown before consent (Apple App Store 3.1.2(v) /
                Google Play subscription policy). Which sentence is true depends
                on the SELECTED plan — a subscription renews and can be
                cancelled, a one-time purchase does neither — so the copy lives
                in lib/paywall-disclosure where it is asserted, rather than as a
                nested ternary here that assumed every package renews. */}
            {purchaseDisclosure({
              isRecurring: recurring,
              hasFreeTrial: trialAvailable,
              price: selectedOption?.price ?? null,
            })}
            {purchaseAgreementLead(recurring)}{' '}
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
