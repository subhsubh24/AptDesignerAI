import type { Metadata } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://aptdesignerai.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "AptDesigner - AI Interior Design Copilot",
  description:
    "A deeply personalized AI-powered interior design assistant for your apartment.",
  openGraph: {
    type: "website",
    siteName: "AptDesigner",
    url: SITE_URL,
    title: "AptDesigner - AI Interior Design Copilot",
    description:
      "A deeply personalized AI-powered interior design assistant for your apartment.",
  },
  twitter: {
    card: "summary",
    title: "AptDesigner - AI Interior Design Copilot",
    description:
      "A deeply personalized AI-powered interior design assistant for your apartment.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Inline blocking script: read persisted theme + system preference and apply
  // the `dark` class to <html> before React hydrates. Prevents the brief
  // light-mode flash on first paint and keeps hydration consistent.
  const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='dark'||((!t||t==='system')&&m);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        {mapsApiKey && (
          <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places&loading=async`}
            strategy="afterInteractive"
          />
        )}
        <ThemeProvider>
          {children}
          <ToastProvider />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
