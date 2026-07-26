/**
 * The single source of truth for which routes are crawlable.
 *
 * Both app/sitemap.ts and app/robots.ts read from here so the two can't drift
 * apart — a sitemap that lists a URL robots.txt disallows is worse than having
 * neither, because it tells a crawler we don't know our own site.
 */

export type SitemapRoute = {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

/**
 * Public marketing + legal routes, in descending priority.
 *
 * Deliberately NOT listed:
 *   - "/" — the middleware redirects it to /dashboard unconditionally
 *     (lib/supabase/middleware.ts), so submitting it would advertise a 307.
 *   - /login, /signup, /forgot-password, /reset-password — auth plumbing with
 *     no search value; /reset-password in particular is only ever reached with
 *     a one-time token in the query string.
 */
export const SITEMAP_ROUTES: readonly SitemapRoute[] = [
  // The pre-launch conversion surface: the one page organic traffic should land
  // on while the app itself is still behind the site gate.
  { path: "/waitlist", changeFrequency: "weekly", priority: 1.0 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
  { path: "/guides", changeFrequency: "weekly", priority: 0.8 },
  { path: "/gallery", changeFrequency: "weekly", priority: 0.8 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/support", changeFrequency: "monthly", priority: 0.5 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
] as const;

/**
 * The SEO articles under /guides (Track E3). Kept as an explicit list rather
 * than a filesystem read so the sitemap stays deterministic across build
 * targets; __tests__/seo/public-routes.test.ts asserts it matches the
 * directories that actually exist, so adding a guide without listing it here
 * fails the suite instead of silently shipping an uncrawlable article.
 */
export const PUBLIC_GUIDE_SLUGS: readonly string[] = [
  "ai-vs-professional-design",
  "color-palette-guide",
  "material-coherence",
] as const;

/**
 * Path prefixes a crawler must never index.
 *
 * /shared/ is the subtle one: those design links are public by token, but they
 * are UNLISTED, and a user who shares one in a public forum has not agreed to
 * have their room photos turned into a search result. Disallowing the prefix
 * keeps "anyone with the link" from becoming "anyone with a search engine".
 */
export const CRAWLER_DISALLOWED_PREFIXES: readonly string[] = [
  "/api/",
  "/dashboard",
  "/account",
  "/saved",
  "/picks",
  "/projects",
  "/billing",
  "/shared/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
] as const;

/** Absolute site origin, trailing slash stripped. Mirrors app/layout.tsx. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  return configured || "https://aptdesignerai.com";
}
