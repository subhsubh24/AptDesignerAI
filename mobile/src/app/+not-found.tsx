import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.heading}>
          This page doesn&apos;t exist.
        </ThemedText>
        <ThemedText type="default" style={styles.body}>
          The link may be broken or the page has moved.
        </ThemedText>
        <Link href="/" style={styles.link}>
          <ThemedText type="linkPrimary">Go to home screen</ThemedText>
        </Link>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  heading: {
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    textAlign: 'center',
    opacity: 0.6,
    marginBottom: 32,
  },
  link: {
    marginTop: 8,
  },
});
