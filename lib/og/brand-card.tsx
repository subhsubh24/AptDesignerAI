import { ImageResponse } from "next/og";

/**
 * The shared social share card (Track E — marketing reach).
 *
 * Until this existed, no route in the app declared an `openGraph.images`, so
 * every link to the site — the waitlist page the pre-launch funnel depends on,
 * the SEO guides, a shared pricing link — rendered on X / LinkedIn / iMessage /
 * Slack as a bare text card. `docs/brand-kit.md` has specified this asset since
 * it was written ("OG image (web) | 1200 × 630 px | wordmark + tagline on
 * #faf9f7 bg"); it was simply never built.
 *
 * Rendered server-side by Next's `ImageResponse`, so there is no external
 * service and no asset to keep in sync — the card is generated from the same
 * brand tokens the site uses.
 *
 * TWO INVARIANTS for anything editing this file:
 *  - It must render from STATIC INPUT ONLY. A social crawler is unauthenticated
 *    and the route is deliberately exempt from auth and from the pre-launch site
 *    gate (see the matcher note in `proxy.ts`), so anything user-specific
 *    rendered here would be published to anyone who could guess the URL.
 *  - No external fonts or remote images. `ImageResponse` would have to fetch
 *    them at request time, turning a static card into a network dependency on
 *    the critical path of every link preview. The brand's own type is the system
 *    stack (`docs/brand-kit.md`), which a server renderer cannot use anyway, so
 *    the bundled default face is the correct choice here rather than a
 *    compromise.
 */

/** Canonical OG dimensions — the size `docs/brand-kit.md` specifies. */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/** Light-theme brand tokens, mirroring `docs/brand-kit.md`. */
const BRAND = {
  background: "#faf9f7",
  text: "#141211",
  textSecondary: "#6b6560",
  accent: "#b4501e",
  border: "#e8e5e1",
} as const;

export type BrandCardOptions = {
  /** The page-specific line. Keep it short — it is set very large. */
  headline: string;
  /** Optional supporting line under the headline. */
  subhead?: string;
};

/**
 * Renders the share card. Callers are the `opengraph-image` route files, which
 * exist per route segment so each surface can carry its own headline while the
 * layout, palette and wordmark stay identical across all of them.
 */
export function renderBrandCard({ headline, subhead }: BrandCardOptions): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BRAND.background,
          padding: "72px 80px",
          // The warm editorial look is carried by one accent rule and generous
          // space rather than a gradient wash — a busy card competes with the
          // headline at the ~500px width most feeds actually render.
          borderTop: `12px solid ${BRAND.accent}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: BRAND.accent,
            }}
          >
            AptDesigner
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 940 }}>
          <div
            style={{
              display: "flex",
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: BRAND.text,
            }}
          >
            {headline}
          </div>
          {subhead ? (
            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 30,
                lineHeight: 1.35,
                color: BRAND.textSecondary,
              }}
            >
              {subhead}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingTop: 28,
            borderTop: `2px solid ${BRAND.border}`,
            fontSize: 26,
            color: BRAND.textSecondary,
          }}
        >
          AI-powered interior design
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
