import Purchases, { LOG_LEVEL } from 'react-native-purchases';

// Set at EAS build time via EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY.
// Absent in local Expo Go: all RC calls are no-ops; isPro = false.
export const RC_KEY = process.env.EXPO_PUBLIC_REVENUECAT_PUBLIC_KEY ?? '';

// Single module-level guard so configure() is called exactly once
// regardless of how many components import initRC().
let _configured = false;

export function initRC(): boolean {
  if (!RC_KEY) return false;
  if (_configured) return true;
  Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: RC_KEY });
  _configured = true;
  return true;
}
