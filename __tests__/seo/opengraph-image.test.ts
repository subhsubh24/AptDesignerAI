import { describe, expect, it } from "vitest";
import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/brand-card";
import {
  alt as rootAlt,
  contentType as rootContentType,
  size as rootSize,
} from "@/app/opengraph-image";
import {
  alt as waitlistAlt,
  contentType as waitlistContentType,
  size as waitlistSize,
} from "@/app/waitlist/opengraph-image";
import { config as proxyConfig } from "@/proxy";

/**
 * The generated social share card (Track E — marketing reach).
 *
 * The half of this that a code review would miss is REACHABILITY. Next serves
 * the card at `/opengraph-image` and `/<segment>/opengraph-image`; neither is in
 * the middleware's PUBLIC_PATHS, so without a matcher exemption every social
 * crawler — all of which are logged out — is 307'd to /login and every link
 * preview on the site is blank. Run 117 shipped a routing fix for exactly this
 * bug class after a code-reading audit certified links that were dead at
 * runtime, so the matcher is asserted here directly.
 */

/** The live matcher, applied the way Next applies it: to a pathname. */
function middlewareRunsOn(pathname: string): boolean {
  const patterns = proxyConfig.matcher as string[];
  return patterns.some((p) => new RegExp(`^${p}$`).test(pathname));
}

describe("opengraph-image — reachable by a logged-out crawler", () => {
  it.each([
    ["site-wide card", "/opengraph-image"],
    ["waitlist card", "/waitlist/opengraph-image"],
  ])("%s is exempt from the session middleware", (_label, pathname) => {
    // Not exempt => 307 to /login for every crawler => blank preview everywhere.
    expect(middlewareRunsOn(pathname)).toBe(false);
  });

  it("still protects the app routes around it", () => {
    // The exemption must be narrow. If it widened to a prefix match, an auth
    // bypass would ride in with it.
    for (const pathname of [
      "/dashboard",
      "/saved",
      "/api/projects",
      "/opengraph-image/secret",
      "/opengraph-imageX",
      "/waitlist",
    ]) {
      expect(middlewareRunsOn(pathname)).toBe(true);
    }
  });

  it("does not exempt a REAL route whose dynamic segment happens to spell it", () => {
    // The load-bearing case, and the reason the alternation enumerates routes
    // instead of matching the suffix at any depth. `/api/projects/<id>` is a
    // real handler (app/api/projects/[projectId]); under a `.*opengraph-image$`
    // pattern it would resolve with projectId="opengraph-image" AND skip auth,
    // CORS and the site gate. Ids are unguessable today, but a middleware
    // matcher must not depend on that.
    for (const pathname of [
      "/api/projects/opengraph-image",
      "/api/saved-designs/opengraph-image",
      "/dashboard/opengraph-image",
      "/projects/x/rooms/y/opengraph-image",
      "/shared/opengraph-image",
    ]) {
      expect(middlewareRunsOn(pathname)).toBe(true);
    }
  });

  it("keeps the pre-existing sitemap/robots exemptions intact", () => {
    // Same matcher string — a regression here would silently un-publish the
    // crawler files Run 117 shipped.
    expect(middlewareRunsOn("/sitemap.xml")).toBe(false);
    expect(middlewareRunsOn("/robots.txt")).toBe(false);
    // …and those stay anchored, not prefix-matched.
    expect(middlewareRunsOn("/sitemap.xml-preview")).toBe(true);
  });
});

describe("opengraph-image — route contract Next requires", () => {
  it.each([
    ["root", rootSize, rootContentType, rootAlt],
    ["waitlist", waitlistSize, waitlistContentType, waitlistAlt],
  ])("%s exports the size/contentType/alt Next reads", (_label, size, contentType, alt) => {
    // Next builds the og:image meta tags from these exports. A wrong size here
    // publishes wrong width/height meta and crawlers letterbox the card.
    expect(size).toEqual(OG_SIZE);
    expect(contentType).toBe(OG_CONTENT_TYPE);
    expect(typeof alt).toBe("string");
    expect(alt.length).toBeGreaterThan(0);
  });

  it("uses the 1200x630 the brand kit specifies", () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it("gives the waitlist card its own copy, not a duplicate of the default", () => {
    // A per-route file that renders the identical card is pure overhead — the
    // inherited root card would already have covered it.
    expect(waitlistAlt).not.toBe(rootAlt);
  });
});
