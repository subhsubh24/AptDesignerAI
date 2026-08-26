import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useEffect, useRef } from 'react';

const PUSH_TOKEN_KEY = 'expoPushToken';

// Display foreground notifications as alerts (not silently dropped).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Returns the Expo push token string, or null if permission was denied,
// the device is a simulator, or token registration fails.
// On success the token is persisted to AsyncStorage so a future API route
// can read it without re-prompting (see PENDING_OPS.md for the server step).
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Push tokens are only available on physical devices.
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#b4501e',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // EAS project ID is required for standalone builds; optional in Expo Go.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    // Persist locally so a future server-side sender can read it without re-prompting.
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch {
    // Token registration may fail without EAS project config in development.
    return null;
  }
}

// POSTs a registered Expo push token to the server-side receiver
// (app/api/mobile/push-tokens/route.ts) so it is persisted for a future
// sender, instead of only ever living in on-device AsyncStorage. Best-effort:
// a failure here is silently swallowed by the caller and simply retries the
// next time the effect below re-runs (app relaunch or session change).
export async function sendPushTokenToServer(pushToken: string, accessToken: string): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return;

  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : undefined;

  await fetch(`${apiUrl}/api/mobile/push-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token: pushToken, platform }),
  });
}

// Wire this hook in the root layout after the user session is established.
// Requests permission, registers the device push token (stored in AsyncStorage
// and sent to the server receiver), and attaches a listener so notification
// taps bring the app to the foreground.
export function usePushNotifications(userId: string | undefined, accessToken: string | undefined): void {
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!userId || !accessToken) return;
    let cancelled = false;

    // requestPermissionsAsync is idempotent: if the permission sheet is already
    // showing (e.g. React Strict Mode double-invoke), the second call returns the
    // current status without displaying a second dialog.
    (async () => {
      const pushToken = await registerForPushNotificationsAsync();
      if (cancelled || !pushToken) return;
      // Best-effort — a transmit failure (offline, transient 5xx) must not
      // surface to the user; the next session-change/relaunch retries it.
      await sendPushTokenToServer(pushToken, accessToken).catch(() => {});
    })().catch(() => {});

    // Handle notification taps while the app is open or backgrounded.
    responseListenerRef.current =
      Notifications.addNotificationResponseReceivedListener(() => {
        // Notification tap brings the app to the foreground automatically.
        // Future: read response.notification.request.content.data.url and
        // call router.navigate(url) — MUST validate url against a known
        // route prefix allowlist (e.g. '/saved', '/results') before navigating
        // to prevent unauthorised deep-link injection via notification payloads.
      });

    return () => {
      cancelled = true;
      responseListenerRef.current?.remove();
    };
  }, [userId, accessToken]);
}
