import { describe, it, expect, afterEach } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import {
  CRAWLER_DISALLOWED_PREFIXES,
  PUBLIC_GUIDE_SLUGS,
  SITEMAP_ROUTES,
} from "@/lib/seo/public-routes";
import { config as proxyConfig } from "@/proxy";

// The sitemap and robots.txt are the whole of the organic-reach lever: Track E3
// shipped three SEO articles that no crawler could discover, because neither
// file existed. These tests guard the ways that lever silently breaks again —
// a new guide that nobody lists, a private prefix that leaks into the crawl, a
// sitemap URL that robots.txt forbids, or the session middleware swallowing
// both files before a crawler ever sees them.

const APP_DIR = path.join(process.cwd(), "app");

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

describe("public-routes — the crawlable surface", () => {
  const prevGate = process.env.SITE_GATE_PASSWORD;
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;

  afterEach(() => {
    if (prevGate === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = prevGate;
    if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
  });

  it("lists exactly the guide articles that exist on disk", () => {
    const onDisk = readdirSync(path.join(APP_DIR, "guides"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    // Adding an SEO article without listing it here ships an uncrawlable page —
    // the exact failure this whole change exists to fix.
    expect([...PUBLIC_GUIDE_SLUGS].sort()).toEqual(onDisk);
  });

  it("only lists routes that actually have a page", () => {
    for (const route of SITEMAP_ROUTES) {
      const dir = path.join(APP_DIR, route.path.replace(/^\//, ""));
      expect(
        existsSync(path.join(dir, "page.tsx")) || existsSync(path.join(dir, "page.ts")),
        `${route.path} has no page component`,
      ).toBe(true);
    }
  });

  it("never advertises a URL that robots.txt disallows", () => {
    withEnv("SITE_GATE_PASSWORD", undefined, () => {
      withEnv("NEXT_PUBLIC_SITE_URL", "https://example.test", () => {
        const disallowed = CRAWLER_DISALLOWED_PREFIXES;
        for (const entry of sitemap()) {
          const pathname = new URL(entry.url).pathname;
          const clash = disallowed.find((p) => pathname.startsWith(p));
          expect(clash, `${pathname} is listed but disallowed by ${clash}`).toBeUndefined();
        }
      });
    });
  });

  it("keeps unlisted /shared/<token> design links out of search results", () => {
    withEnv("SITE_GATE_PASSWORD", undefined, () => {
      const rules = robots().rules;
      const rule = Array.isArray(rules) ? rules[0] : rules;
      // "Anyone with the link" must not become "anyone with a search engine".
      expect(rule.disallow).toContain("/shared/");
    });
  });

  it("disallows the whole site while the pre-launch gate is up", () => {
    withEnv("SITE_GATE_PASSWORD", "curtain", () => {
      const result = robots();
      const rules = result.rules;
      const rule = Array.isArray(rules) ? rules[0] : rules;
      expect(rule.disallow).toBe("/");
      expect(rule.allow).toBeUndefined();
      // No sitemap either: nothing behind the curtain is worth crawling yet.
      expect(result.sitemap).toBeUndefined();
    });
  });

  it("points at the sitemap once the gate is down", () => {
    withEnv("SITE_GATE_PASSWORD", undefined, () => {
      withEnv("NEXT_PUBLIC_SITE_URL", "https://example.test/", () => {
        const result = robots();
        // Trailing slash stripped, so the URL is not "example.test//sitemap.xml".
        expect(result.sitemap).toBe("https://example.test/sitemap.xml");
      });
    });
  });

  it("builds absolute sitemap URLs from the configured site origin", () => {
    withEnv("NEXT_PUBLIC_SITE_URL", "https://example.test", () => {
      const urls = sitemap().map((e) => e.url);
      expect(urls).toContain("https://example.test/waitlist");
      expect(urls).toContain("https://example.test/guides/color-palette-guide");
      for (const url of urls) expect(url.startsWith("https://example.test/")).toBe(true);
    });
  });

  it("excludes sitemap.xml and robots.txt from the session middleware matcher", () => {
    // Both are requested by logged-out crawlers; if the matcher catches them the
    // middleware redirects to /login and the crawler never sees either file.
    const [matcher] = proxyConfig.matcher;
    const re = new RegExp(`^${matcher}$`);
    expect(re.test("/sitemap.xml")).toBe(false);
    expect(re.test("/robots.txt")).toBe(false);
    // ...while ordinary app routes are still matched.
    expect(re.test("/dashboard")).toBe(true);
    // The exclusion must be EXACT. An unanchored literal only has to prefix-match,
    // so a future route merely starting with these strings would silently skip
    // auth, CORS and the site gate. The unescaped dot has the same effect.
    expect(re.test("/sitemap.xml-preview")).toBe(true);
    expect(re.test("/robots.txtdump")).toBe(true);
    expect(re.test("/robotsXtxt")).toBe(true);
  });
});
