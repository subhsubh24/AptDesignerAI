import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Linking, Pressable, StyleSheet } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import Purchases from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/hooks/use-session';
import { RC_KEY } from '@/lib/rc-init';
import { supabase } from '@/lib/supabase';
import { clearPendingSession } from '@/state/photo-session';

const PRIVACY_URL = 'https://aptdesignerai.com/privacy';
const TERMS_URL = 'https://aptdesignerai.com/terms';
const SUPPORT_URL = 'https://aptdesignerai.com/support';

// Account deletion must never leave the button stuck disabled on a hung
// request — abort after this and surface a retry alert.
const DELETE_TIMEOUT_MS = 15_000;

function Row({
  label,
  onPress,
  colors,
  destructive,
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  colors: (typeof Colors)[keyof typeof Colors];
  destructive?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <ThemedText style={{ color: destructive ? colors.destructive : colors.text, fontWeight: '500' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { session } = useSession();
  const [deleting, setDeleting] = useState(false);

  const openLink = useCallback((url: string) => {
    // In-app browser keeps users inside the app (matches ExternalLink elsewhere).
    void openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
  }, []);

  // Apple guideline 3.1.2 (Subscriptions) / Google Play expect an in-app path to
  // manage (change / cancel) a store subscription. RevenueCat surfaces the platform-native
  // management page via CustomerInfo.managementURL — App Store subscriptions on
  // iOS, Play subscriptions on Android. Null when there's no store-managed
  // subscription (or RC isn't configured), in which case we point the user at
  // their store account settings rather than a dead end.
  const handleManageSubscription = useCallback(async () => {
    const storeSettingsHint =
      'Manage your subscription in your device’s App Store (Settings → your name → Subscriptions) or Google Play (Play Store → Payments & subscriptions) account settings.';
    if (!RC_KEY) {
      Alert.alert('Manage subscription', storeSettingsHint);
      return;
    }
    try {
      // Bound the RC call: without a timeout, a hung getCustomerInfo() (network
      // stall / SDK bug) leaves "Manage subscription" with no response and no
      // escape hatch. Time out and fall through to the store-settings hint —
      // the same fallback the catch below already provides on any RC error.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const info = await Promise.race([
        Purchases.getCustomerInfo(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('getCustomerInfo timed out')), 8000);
        }),
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      if (info.managementURL) {
        await Linking.openURL(info.managementURL);
        return;
      }
      Alert.alert('No active subscription', `We couldn’t find an active subscription on this account. ${storeSettingsHint}`);
    } catch {
      Alert.alert('Manage subscription', storeSettingsHint);
    }
  }, []);

  const performDelete = useCallback(async () => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
    const token = session?.access_token;
    if (!apiUrl || !token) {
      Alert.alert(
        'Unable to delete account',
        'You appear to be offline. Please check your connection and try again.',
      );
      return;
    }
    setDeleting(true);
    // Abort a hung delete so the user isn't left staring at a disabled "Delete
    // account" button forever, unsure whether their account was removed. On
    // timeout the fetch rejects → the catch below surfaces a retry alert.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
    try {
      const resp = await fetch(`${apiUrl}/api/mobile/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (resp.ok) {
        // Account is gone — sign out clears the local session and returns to login.
        await supabase.auth.signOut();
        // Also wipe the in-memory pending photo/room-type so it can't leak to
        // the next user on a shared device.
        clearPendingSession();
      } else {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        Alert.alert(
          'Unable to delete account',
          body.error ?? 'Something went wrong. Please try again or contact support.',
        );
      }
    } catch {
      Alert.alert(
        'Unable to delete account',
        'A network error occurred. Please try again or contact support.',
      );
    } finally {
      clearTimeout(timer);
      setDeleting(false);
    }
  }, [session]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and all your saved designs. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void performDelete() },
      ],
    );
  }, [performDelete]);

  const handleSignOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      // Wipe the in-memory pending photo/room-type on sign-out so the next user
      // on a shared device can't see the previous user's pending room photo.
      clearPendingSession();
    } catch {
      // supabase-js returns the error in-band (and can also throw on a network
      // failure). A silently-failed sign-out leaves the session live — the user
      // believes they are signed out but isn't, which can expose their account
      // on a shared device. Surface it so they can retry instead of walking away.
      Alert.alert(
        'Unable to sign out',
        "We couldn't sign you out. Please check your connection and try again.",
      );
    }
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ThemedText type="small" style={{ color: colors.accent }}>
              ‹ Back
            </ThemedText>
          </Pressable>
          <ThemedText type="title" style={styles.title}>
            Account
          </ThemedText>
          {session?.user?.email ? (
            <ThemedText type="small" style={{ color: colors.mutedForeground }}>
              {session.user.email}
            </ThemedText>
          ) : null}
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="small" style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Legal
          </ThemedText>
          <Row label="Privacy Policy" onPress={() => openLink(PRIVACY_URL)} colors={colors} accessibilityHint="Opens the privacy policy in your browser" />
          <Row label="Terms of Service" onPress={() => openLink(TERMS_URL)} colors={colors} accessibilityHint="Opens the terms of service in your browser" />
          <Row label="Support" onPress={() => openLink(SUPPORT_URL)} colors={colors} accessibilityHint="Opens the support page in your browser" />
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="small" style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Subscription
          </ThemedText>
          <Row
            label="Manage subscription"
            onPress={() => void handleManageSubscription()}
            colors={colors}
            accessibilityHint="Opens your App Store or Google Play subscription settings to change or cancel your plan"
          />
        </ThemedView>

        <ThemedView style={styles.section}>
          <ThemedText type="small" style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Account
          </ThemedText>
          <Row label="Sign out" onPress={() => void handleSignOut()} colors={colors} />
          <Row
            label={deleting ? 'Deleting…' : 'Delete account'}
            onPress={confirmDelete}
            colors={colors}
            destructive
            disabled={deleting}
            accessibilityHint="Permanently deletes your account and saved designs"
          />
        </ThemedView>

        <ThemedText type="small" style={[styles.footnote, { color: colors.mutedForeground }]}>
          Deleting your account removes your saved designs and personal data permanently, in line
          with the App Store and Google Play requirements.
        </ThemedText>
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
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  header: {
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  title: {
    textAlign: 'left',
    marginTop: Spacing.two,
  },
  section: {
    gap: Spacing.one,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: Spacing.one,
  },
  row: {
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footnote: {
    lineHeight: 18,
    opacity: 0.8,
  },
});
