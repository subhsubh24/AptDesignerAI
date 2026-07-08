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
    if (!email.trim() || !password || !confirm) return;
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

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError(authError.message);
    } else if (data.session === null) {
      // Email confirmation required — show "check your email" screen.
      // If auto-confirm is on, onAuthStateChange fires SIGNED_IN automatically.
      setSuccess(true);
    }
    setLoading(false);
  }

  if (success) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={[styles.safeArea, styles.centeredContent]}>
          <View style={styles.successSection}>
            <ThemedText type="title" style={styles.successTitle}>
              Check your email
            </ThemedText>
            <ThemedText type="default" style={[styles.successBody, { color: colors.textSecondary }]}>
              We sent a confirmation link to {email.trim()}. Open it to activate your account, then sign in.
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
              <Pressable accessibilityRole="button" onPress={onLogin} hitSlop={8}>
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
