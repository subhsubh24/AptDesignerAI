import type { MetadataRoute } from "next";
import { PUBLIC_GUIDE_SLUGS, SITEMAP_ROUTES, siteUrl } from "@/lib/seo/public-routes";

/**
 * /sitemap.xml — the crawlable index of the marketing surface (ROADMAP Track E).
 *
 * Track E3 shipped a /guides hub with three SEO articles, but nothing ever told
 * a crawler they existed: there was no sitemap and no robots.txt anywhere in the
 * repo, so the organic-reach lever the articles were written for was inert.
 *
 * Only routes that are genuinely public are listed. Auth pages, the app itself,
 * and /shared/<token> design links are deliberately absent — see app/robots.ts
 * for why the share links must also be explicitly disallowed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const guides: MetadataRoute.Sitemap = PUBLIC_GUIDE_SLUGS.map((slug) => ({
    url: `${base}/guides/${slug}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [
    ...SITEMAP_ROUTES.map((route) => ({
      url: `${base}${route.path}`,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...guides,
  ];
}
