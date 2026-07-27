import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderBrandCard,
} from "@/lib/og/brand-card";

/**
 * The site-wide default share card.
 *
 * Next inherits an `opengraph-image` down the route tree, so this one file gives
 * EVERY route that does not declare its own a real link preview — the guides,
 * pricing, FAQ, support and legal pages included. Routes with a distinct pitch
 * (see `app/waitlist/opengraph-image.tsx`) override it by adding their own.
 */
export const alt =
  "AptDesigner — AI interior design that reads your actual room";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderBrandCard({
    headline: "AI interior design that reads your actual room",
    subhead:
      "Snap a few photos. Get furniture and layout ideas fitted to your real light, finishes and dimensions.",
  });
}
