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

// Wire this hook in the root layout after the user session is established.
// Requests permission, registers the device push token (stored in AsyncStorage),
// and attaches a listener so notification taps bring the app to the foreground.
export function usePushNotifications(userId: string | undefined): void {
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!userId) return;

    // requestPermissionsAsync is idempotent: if the permission sheet is already
    // showing (e.g. React Strict Mode double-invoke), the second call returns the
    // current status without displaying a second dialog.
    registerForPushNotificationsAsync().catch(() => {});

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
      responseListenerRef.current?.remove();
    };
  }, [userId]);
}
