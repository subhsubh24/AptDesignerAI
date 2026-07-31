import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, TapSlop } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signInErrorMessage } from '@/lib/auth/auth-errors';
import { supabase } from '@/lib/supabase';

interface LoginScreenProps {
  onSignup: () => void;
}

// Bound the auth network call. Without a timeout, a hung Supabase request
// (dropped connection, captive portal, provider outage) leaves the promise
// unsettled forever — the button stays disabled on "Signing in…" with no error
// and no escape but a force-quit. The timeout converts a hang into the same
// recoverable error path as any other failure.
const AUTH_TIMEOUT_MS = 15000;

export function LoginScreen({ onSignup }: LoginScreenProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      // Give explicit feedback instead of a silent no-op — the button is only
      // disabled while loading, so an empty-field tap would otherwise do nothing.
      setError('Enter your email and password to sign in.');
      return;
    }
    setLoading(true);
    setError(null);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const { error: authError } = await Promise.race([
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Sign-in timed out. Check your connection and try again.')),
            AUTH_TIMEOUT_MS,
          );
        }),
      ]);
      if (authError) {
        // Never render the provider's text: GoTrue's "Email not confirmed" /
        // banned / SSO-managed responses only fire for an address that ALREADY
        // has an account, so showing them verbatim tells an attacker which
        // emails are registered. signInErrorMessage collapses every such outcome
        // into one neutral message. See mobile/src/lib/auth/auth-errors.ts.
        setError(signInErrorMessage(authError));
      }
    } catch (err) {
      // A thrown fetch/network error or the timeout above. Surface a recoverable
      // message rather than leaving the button stuck on "Signing in…" forever.
      // Routed through the same classifier so the timeout/offline case reads
      // consistently and a provider-shaped throw can't leak either.
      setError(signInErrorMessage(err instanceof Error ? err : undefined));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.headerSection}>
              <ThemedText type="title" style={styles.wordmark}>
                AptDesignerAI
              </ThemedText>
              <ThemedText type="subtitle" style={[styles.tagline, { color: colors.textSecondary }]}>
                AI-powered interior design
              </ThemedText>
            </View>

            <View style={styles.formSection}>
              <ThemedText type="subtitle" style={styles.formTitle}>
                Welcome back
              </ThemedText>

              {error ? (
                <View
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={[styles.errorBox, { backgroundColor: colors.destructive + '18', borderColor: colors.destructive + '40' }]}
                >
                  <ThemedText type="small" style={{ color: colors.destructive }}>
                    {error}
                  </ThemedText>
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <ThemedText type="small" style={[styles.label, { color: colors.textSecondary }]}>
                  Email
                </ThemedText>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.backgroundElement,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  returnKeyType="next"
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="you@example.com"
                  accessibilityLabel="Email address"
                />
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="small" style={[styles.label, { color: colors.textSecondary }]}>
                  Password
                </ThemedText>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.backgroundElement,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="••••••••"
                  accessibilityLabel="Password"
                />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: loading, busy: loading }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.accent, opacity: pressed || loading ? 0.8 : 1 },
                ]}
                onPress={handleSignIn}
                disabled={loading}
              >
                <ThemedText style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.footerSection}>
              <ThemedText type="small" style={{ color: colors.textSecondary }}>
                Don&apos;t have an account?{' '}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create an account"
                onPress={onSignup}
                hitSlop={TapSlop.smallLabel}
              >
                <ThemedText type="small" style={{ color: colors.accent, fontWeight: '600' }}>
                  Create one
                </ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
    gap: Spacing.five,
  },
  headerSection: {
    gap: Spacing.one,
  },
  wordmark: {
    letterSpacing: -0.5,
  },
  tagline: {
    fontWeight: '400',
  },
  formSection: {
    gap: Spacing.three,
  },
  formTitle: {
    marginBottom: Spacing.one,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  fieldGroup: {
    gap: Spacing.one,
  },
  label: {
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
  },
  primaryButton: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  footerSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
