/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1a1614',
    background: '#faf9f7',
    backgroundElement: '#f2ede8',
    backgroundSelected: '#ebe4dc',
    textSecondary: '#7c7268',
    accent: '#b4501e',
    accentForeground: '#faf9f7',
    card: '#ffffff',
    cardForeground: '#1a1614',
    muted: '#f5f2ee',
    mutedForeground: '#7c7268',
    border: '#e8e1d9',
    destructive: '#dc2626',
  },
  dark: {
    text: '#ede9e3',
    background: '#141211',
    backgroundElement: '#252220',
    backgroundSelected: '#2e2a26',
    textSecondary: '#8a8077',
    accent: '#d4733e',
    accentForeground: '#141211',
    card: '#1c1a17',
    cardForeground: '#ede9e3',
    muted: '#1f1d1a',
    mutedForeground: '#8a8077',
    border: '#2e2a26',
    destructive: '#ef4444',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
