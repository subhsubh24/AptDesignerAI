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
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';

interface LoginScreenProps {
  onSignup: () => void;
}

export function LoginScreen({ onSignup }: LoginScreenProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'unspecified' ? 'light' : colorScheme];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError(authError.message);
    }
    setLoading(false);
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
                <View style={[styles.errorBox, { backgroundColor: colors.destructive + '18', borderColor: colors.destructive + '40' }]}>
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
                  autoComplete="current-password"
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="••••••••"
                />
              </View>

              <Pressable
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
                Don't have an account?{' '}
              </ThemedText>
              <Pressable onPress={onSignup} hitSlop={8}>
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
