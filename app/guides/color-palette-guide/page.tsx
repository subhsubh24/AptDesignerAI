import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "How to Choose a Colour Palette for Your Room — AptDesignerAI",
  description:
    "Learn how light direction, existing finishes, and room scale interact to determine which colours will actually work in your space.",
  openGraph: {
    title: "How to Choose a Colour Palette for Your Room",
    description:
      "Light direction, existing finishes, and room scale all shape which colours work. Here is how to read your space before you commit.",
    type: "article",
  },
};

export default function ColourPaletteGuidePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        <article className="max-w-2xl mx-auto px-6 md:px-8 pt-14 md:pt-20 pb-24">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-8">
            <Link href="/guides" className="hover:text-foreground transition-colors">Guides</Link>
            <span>/</span>
            <span>Colour palettes</span>
          </nav>

          {/* Header */}
          <div className="mb-10">
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge variant="warm">Colour</Badge>
              <Badge variant="secondary">Design Basics</Badge>
              <span className="text-xs text-muted-foreground/70 self-center">5 min read</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
              How to Choose a Colour Palette for Your Room
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Light direction, existing finishes, and room scale all shape which colours will
              actually work. Here is how to read your space before you commit.
            </p>
          </div>

          {/* Body */}
          <div className="prose-editorial space-y-8 text-[15px] leading-relaxed text-foreground/90">

            <section>
              <h2 className="text-xl font-bold mb-3">Start with the light, not the paint chart</h2>
              <p>
                The single biggest mistake people make when choosing paint or fabric colours is picking
                them under artificial light in a showroom. Natural light has a colour temperature that
                changes dramatically by the time of day and the direction your windows face.
              </p>
              <p className="mt-3">
                North-facing rooms receive indirect, cooler light year-round. Warm tones — terracotta,
                amber, deep camel — absorb that coolness and read as neutral. Greige and off-whites that
                look elegant in a north-facing studio will often appear flat and slightly green in a
                south-facing room flooded with warm afternoon light.
              </p>
              <p className="mt-3">
                Before choosing anything, photograph your room at three times of day: morning, midday,
                and late afternoon. The photo reveals what your eye adapts to and stops noticing.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">Read your fixed finishes first</h2>
              <p>
                Unless you are doing a full renovation, you have fixed finishes you cannot change: floor
                colour and material, window frame colour, radiator or heating unit colour, kitchen
                countertop, bathroom tile. These are the palette anchors.
              </p>
              <p className="mt-3">
                Identify whether those anchors lean warm (honey oak, brass hardware, cream tile, natural
                linen) or cool (grey concrete, chrome, white gloss, blue-grey slate). Your accent colours
                should sit on the same side of the temperature spectrum as your anchors, or they will
                fight each other.
              </p>
              <p className="mt-3">
                A common error: warm oak floors with cool grey walls and chrome fixtures. Each element
                is individually attractive. Together, they produce a room that feels unresolved.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">The 60–30–10 rule (and when to break it)</h2>
              <p>
                The classic interior design rule allocates 60% of the visual space to a dominant neutral,
                30% to a secondary tone, and 10% to an accent. This is sound guidance because it gives
                rooms a clear hierarchy: your eye knows where to rest and where to be surprised.
              </p>
              <p className="mt-3">
                In practice, the 10% accent is the only number that matters for most rooms. The dominant
                neutral is usually your wall colour and floor — already decided. The secondary tone is
                your sofa, bed frame, or large rug. The 10% accent is where you communicate personality:
                throw cushions, artwork, a lamp base, a vase.
              </p>
              <p className="mt-3">
                You can break the rule productively by running two accents at 5% each — useful when you
                have both warm and cool metal hardware and want to acknowledge both. What breaks it badly:
                three accents at equal weight. No hierarchy, no rest, no personality.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">Scale affects perceived colour intensity</h2>
              <p>
                A colour chip on a card looks nothing like the same colour applied to an entire wall.
                Colour intensifies at scale. A warm terracotta that reads as earthy and calm on a chip
                will read as vivid and potentially overwhelming on four walls of a small bedroom.
              </p>
              <p className="mt-3">
                Two practical adjustments: first, use a colour one shade lighter and less saturated than
                your chip when applying to large surfaces. Second, in small rooms, limit saturated colour
                to one wall or to objects — not the entire envelope.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">How the AI reads your palette</h2>
              <p>
                When AptDesigner analyses your room photos, it extracts the dominant colour temperature
                from your fixed finishes, identifies whether your current palette has internal coherence
                (warm-warm or cool-cool combinations) or tension (warm-cool mixes), and generates a
                recommended palette that extends what is already working rather than overriding it.
              </p>
              <p className="mt-3">
                The palette recommendation includes a primary tone (largest surface application),
                secondary tone (upholstery, large textiles), and up to two accent colours with suggested
                application areas. Each is scored for compatibility with your existing floor and wall
                colours using colour-distance calculations, so the recommendations are grounded in your
                actual space — not a generic mood board.
              </p>
            </section>

          </div>

          {/* CTA */}
          <div className="mt-14 rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-8 text-center relative overflow-hidden">
            <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
            <div className="relative z-10">
              <h2 className="text-xl font-bold mb-2">See the palette your room already wants</h2>
              <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
                Upload a photo and the AI will identify your fixed finishes and recommend a palette built around them.
              </p>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-warm text-accent-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Try it free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Back link */}
          <div className="mt-10">
            <Link
              href="/guides"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              ← Back to guides
            </Link>
          </div>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
