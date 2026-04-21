import type { NextConfig } from "next";

/**
 * Image origin allowlist.
 *
 * The wildcard `hostname: "**"` we used previously exposes the
 * `/_next/image?url=…` optimizer as a generic SSRF proxy. The app doesn't
 * actually import `next/image`, so the config surface is optimizer-only —
 * scoping it to known-good CDNs closes the vector without affecting product
 * rendering (which uses plain <img> tags with arbitrary retailer URLs).
 */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase storage (user uploads, floor plans, etc.)
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      // Google Places photo CDN
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh4.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "places.googleapis.com" },
      // Gemini image generation / file service
      { protocol: "https", hostname: "generativelanguage.googleapis.com" },
    ],
  },
};

export default nextConfig;
