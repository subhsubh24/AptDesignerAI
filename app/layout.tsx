import type { Metadata } from "next";
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
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
