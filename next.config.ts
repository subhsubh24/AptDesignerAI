import type { NextConfig } from "next";

// CSP directives — kept as a map so each source list is readable and diffable.
// 'unsafe-inline' on script-src is required for Next.js hydration inline scripts;
// remove it (and add nonces via middleware) once the app ships stable.
const cspDirectives: Record<string, string> = {
  "default-src":  "'self'",
  "script-src":   "'self' 'unsafe-inline' https://js.stripe.com https://maps.googleapis.com https://va.vercel-scripts.com",
  "style-src":    "'self' 'unsafe-inline'",
  "img-src":      "'self' data: blob: https://*.supabase.co https://*.supabase.in https://*.googleusercontent.com https://places.googleapis.com https://maps.googleapis.com https://maps.gstatic.com",
  "font-src":     "'self' data:",
  "connect-src":  "'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://generativelanguage.googleapis.com https://places.googleapis.com https://maps.googleapis.com https://api.stripe.com https://api.revenuecat.com https://va.vercel-scripts.com",
  "frame-src":    "https://js.stripe.com https://hooks.stripe.com https://www.google.com",
  "worker-src":   "'self'",
  "object-src":   "'none'",
  "base-uri":     "'self'",
  "form-action":  "'self'",
};

const csp = Object.entries(cspDirectives)
  .map(([k, v]) => `${k} ${v}`)
  .join("; ");

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh4.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "places.googleapis.com" },
      { protocol: "https", hostname: "generativelanguage.googleapis.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
