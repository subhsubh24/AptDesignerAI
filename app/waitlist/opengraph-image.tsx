import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderBrandCard,
} from "@/lib/og/brand-card";

/**
 * The waitlist page gets its own card because it is the one surface whose whole
 * job is conversion from a shared link, and pre-launch it is the only page most
 * visitors will ever see — the site gate redirects everything else here. A
 * preview that says "coming to iOS and Android" converts a scroll-past; the
 * generic site card does not.
 */
export const alt = "AptDesigner is coming to iOS and Android — join the waitlist";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function WaitlistOpengraphImage() {
  return renderBrandCard({
    headline: "Coming to iOS and Android",
    subhead:
      "Photograph your room on the spot and get a full design direction before you leave it. Join the waitlist.",
  });
}
