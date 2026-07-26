import type { MetadataRoute } from "next";
import { isSiteGateEnabled } from "@/lib/security/site-gate";
import { CRAWLER_DISALLOWED_PREFIXES, siteUrl } from "@/lib/seo/public-routes";

/**
 * /robots.txt (ROADMAP Track E).
 *
 * Two jobs. First, point crawlers at the sitemap so the Track E3 guides can
 * actually earn organic traffic. Second, keep them out of the app itself and
 * — importantly — out of /shared/<token>, where an unlisted design link would
 * otherwise be fair game for indexing.
 *
 * While the pre-launch SITE GATE is up (Track E8), every non-exempt route
 * answers with the coming-soon curtain, so inviting a crawl would only get the
 * curtain indexed and leave that ranking to fight later. We disallow everything
 * until the owner unsets SITE_GATE_PASSWORD at launch, which is the same switch
 * that opens the app.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  if (isSiteGateEnabled()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...CRAWLER_DISALLOWED_PREFIXES],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
