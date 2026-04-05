import type { Metadata } from "next";
import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AptDesigner - AI Interior Design Copilot",
  description:
    "A deeply personalized AI-powered interior design assistant for your apartment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {mapsApiKey && (
          <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places&loading=async`}
            strategy="afterInteractive"
          />
        )}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
