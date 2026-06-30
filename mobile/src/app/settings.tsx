import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

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
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];
  const { session } = useSession();
  const [deleting, setDeleting] = useState(false);

  const openLink = useCallback((url: string) => {
    // In-app browser keeps users inside the app (matches ExternalLink elsewhere).
    void openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
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
            Account
          </ThemedText>
          <Row label="Sign out" onPress={() => void supabase.auth.signOut()} colors={colors} />
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
