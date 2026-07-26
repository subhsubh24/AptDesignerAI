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
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  isAlreadyRegisteredError,
  signUpErrorMessage,
  type AuthErrorLike,
} from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

// Apple 5.1.1(v) / Google Play require Terms & Privacy to be reachable in-app
// BEFORE account creation — mirror the paywall/settings link pattern.
const TERMS_URL = 'https://aptdesignerai.com/terms';
const PRIVACY_URL = 'https://aptdesignerai.com/privacy';

function openLegal(url: string) {
  void openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
}

interface SignupScreenProps {
  onLogin: () => void;
}

// Bound the auth network call. Without a timeout, a hung Supabase request
// leaves the promise unsettled forever — the button stays disabled on
// "Creating account…" with no error and no escape but a force-quit. The
// timeout converts a hang into the same recoverable error path as any failure.
const AUTH_TIMEOUT_MS = 15000;

export function SignupScreen({ onLogin }: SignupScreenProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSignUp() {
    if (!email.trim() || !password || !confirm) {
      // Explicit feedback instead of a silent no-op — the button is only
      // disabled while loading, so an empty-field tap would otherwise do nothing.
      setError('Fill in every field to create your account.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    setError(null);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const { data, error: authError } = await Promise.race([
        supabase.auth.signUp({ email: email.trim(), password }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Sign-up timed out. Check your connection and try again.')),
            AUTH_TIMEOUT_MS,
          );
        }),
      ]);
      if (authError && isAlreadyRegisteredError(authError as AuthErrorLike)) {
        // ENUMERATION-SAFE: an address that already has an account gets the
        // EXACT screen a brand-new signup gets. Rendering "User already
        // registered" here would confirm the address is taken — the same leak
        // the web signup route masks (app/api/auth/signup/route.ts, though by a
        // different mechanism: web creates-or-noops then attempts sign-in).
        //
        // NOTE for whoever edits that screen next: its copy is deliberately
        // conditional because NO email is sent on this path. Do not "improve" it
        // into a flat "we sent you a link" — that claim is false here.
        // The user is not stranded: its button goes to sign-in, which is where an
        // existing account needs to go anyway.
        setSuccess(true);
      } else if (authError) {
        // Never render provider text — internal phrasing at best, an existence
        // oracle at worst.
        setError(signUpErrorMessage(authError as AuthErrorLike));
      } else if (data.session === null) {
        // Email confirmation required — show "check your email" screen.
        // If auto-confirm is on, onAuthStateChange fires SIGNED_IN automatically.
        setSuccess(true);
      }
    } catch (err) {
      // A thrown fetch/network error or the timeout above — same neutral
      // mapping, so the button never stays stuck on "Creating account…" and no
      // provider phrasing reaches the screen.
      setError(signUpErrorMessage(err as AuthErrorLike));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  if (success) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={[styles.safeArea, styles.centeredContent]}>
          <View style={styles.successSection}>
            {/*
              This screen is reached by TWO paths that must stay indistinguishable
              (see handleSignUp): a genuinely new account awaiting confirmation,
              and an address that ALREADY has an account. So the copy must be true
              of both — and in the already-registered case NO email was sent, because
              signUp returned an error and never attempted one. Asserting "we sent a
              confirmation link" there would be a success message with no operation
              behind it, which is precisely the side-effect-integrity failure this
              repo treats as release-blocking. The conditional wording below claims
              nothing that did not happen, while still telling both users exactly
              what to do next.
            */}
            <ThemedText type="title" style={styles.successTitle}>
              Almost there
            </ThemedText>
            <ThemedText type="default" style={[styles.successBody, { color: colors.textSecondary }]}>
              If {email.trim()} needs confirming, we&apos;ve emailed you a link — open it, then sign
              in. If you already have an account with this address, just sign in.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={onLogin}
            >
              <ThemedText style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                Go to sign in
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
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
                Create your account
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
                  autoComplete="new-password"
                  returnKeyType="next"
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="At least 8 characters"
                  accessibilityLabel="Password"
                />
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="small" style={[styles.label, { color: colors.textSecondary }]}>
                  Confirm password
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
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  autoComplete="new-password"
                  returnKeyType="done"
                  onSubmitEditing={handleSignUp}
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="••••••••"
                  accessibilityLabel="Confirm password"
                />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: loading, busy: loading }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.accent, opacity: pressed || loading ? 0.8 : 1 },
                ]}
                onPress={handleSignUp}
                disabled={loading}
              >
                <ThemedText style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                  {loading ? 'Creating account…' : 'Create account'}
                </ThemedText>
              </Pressable>

              <ThemedText type="small" style={[styles.consent, { color: colors.mutedForeground }]}>
                By creating an account, you agree to our{' '}
                <ThemedText
                  type="small"
                  onPress={() => openLegal(TERMS_URL)}
                  accessibilityRole="link"
                  style={[styles.consentLink, { color: colors.accent }]}
                >
                  Terms of Service
                </ThemedText>{' '}
                and{' '}
                <ThemedText
                  type="small"
                  onPress={() => openLegal(PRIVACY_URL)}
                  accessibilityRole="link"
                  style={[styles.consentLink, { color: colors.accent }]}
                >
                  Privacy Policy
                </ThemedText>
                .
              </ThemedText>
            </View>

            <View style={styles.footerSection}>
              <ThemedText type="small" style={{ color: colors.textSecondary }}>
                Already have an account?{' '}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in to your account"
                onPress={onLogin}
                hitSlop={8}
              >
                <ThemedText type="small" style={{ color: colors.accent, fontWeight: '600' }}>
                  Sign in
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
  centeredContent: {
    justifyContent: 'center',
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
  consent: {
    textAlign: 'center',
    lineHeight: 18,
  },
  consentLink: {
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  successSection: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    alignItems: 'center',
  },
  successTitle: {
    textAlign: 'center',
  },
  successBody: {
    textAlign: 'center',
    lineHeight: 22,
  },
  footerSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
