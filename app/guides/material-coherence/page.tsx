import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Material Coherence: Why Oak and Brass Work (and Chrome and Pine Don't) — AptDesigner",
  description:
    "The finish compatibility rules that professional designers follow — and how to apply them when choosing furniture and hardware for your home.",
  openGraph: {
    title: "Material Coherence: Why Oak and Brass Work (and Chrome and Pine Don't)",
    description:
      "The finish compatibility rules designers follow, explained plainly so you can apply them yourself.",
    type: "article",
  },
};

export default function MaterialCoherencePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        <article className="max-w-2xl mx-auto px-6 md:px-8 pt-14 md:pt-20 pb-24">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-8">
            <Link href="/guides" className="hover:text-foreground transition-colors">Guides</Link>
            <span>/</span>
            <span>Material coherence</span>
          </nav>

          {/* Header */}
          <div className="mb-10">
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge variant="warm">Materials</Badge>
              <Badge variant="secondary">Design Principles</Badge>
              <span className="text-xs text-muted-foreground self-center">5 min read</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
              Material Coherence: Why Oak and Brass Work (and Chrome and Pine Don&rsquo;t)
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              The finish compatibility rules that designers follow intuitively — explained so
              you can apply them to your own furniture and hardware choices.
            </p>
          </div>

          {/* Body */}
          <div className="prose-editorial space-y-8 text-[15px] leading-relaxed text-foreground/90">

            <section>
              <h2 className="text-xl font-bold mb-3">The temperature spectrum of materials</h2>
              <p>
                Every material has a temperature: it reads as warm, cool, or neutral. Warm
                materials include honey oak, walnut, rattan, linen, terracotta, brass, and
                unlacquered copper. Cool materials include pale ash, grey concrete, marble with
                blue veining, chrome, gun-metal, and high-gloss white lacquer. Neutral materials
                include raw linen in its undyed state, black steel, and natural stone with
                minimal veining.
              </p>
              <p className="mt-3">
                Coherent rooms are not rooms where everything is warm or everything is cool — they
                are rooms where the <em>dominant</em> register is clear. A room that is 80% warm
                materials with 20% cool accents reads as intentional. A room that is 50% warm and
                50% cool reads as unresolved.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">Wood species and the coherence problem</h2>
              <p>
                One of the most common material coherence errors is mixing too many wood species.
                Each species has its own grain pattern, colour, and finish behaviour. Oak, walnut,
                pine, ash, and beech are all wood — but they do not look like the same material.
              </p>
              <p className="mt-3">
                The professional rule of thumb: two wood species maximum per room. More than two
                and the eye reads the space as arbitrary rather than curated. If you have a walnut
                dining table, you can add an oak sideboard. Add a pine console and a beech shelf
                and the room starts to feel like a showroom floor rather than a designed space.
              </p>
              <p className="mt-3">
                When mixing two species, look for a shared quality: both should be in the same
                warmth register, or both should have a similar grain character. Walnut and dark oak
                are both warm and dense-grained — they coexist well. Walnut and pale ash are
                different warmths and different grains — they fight.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">Metal finishes: warm and cool families</h2>
              <p>
                Metal hardware — door handles, light fixtures, curtain rods, tap fittings — is
                one of the strongest coherence signals in a room because it appears in many places
                simultaneously.
              </p>
              <p className="mt-3">
                Warm metal finishes: brass, gold, antique bronze, unlacquered copper, satin brass,
                brushed gold. Cool metal finishes: chrome, polished nickel, stainless steel,
                gunmetal, matte black (which reads cool despite its neutrality). Mixing freely
                within a family is generally safe. Mixing across families is the issue.
              </p>
              <p className="mt-3">
                The common exception is matte black, which is neutral enough to work with both
                warm and cool rooms. A brass-dominant room can include matte black accents without
                incoherence. It cannot include chrome without immediately pulling in a conflicting
                temperature.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">Soft and hard material balance</h2>
              <p>
                Beyond temperature, rooms need a balance between soft materials (fabric, woven
                textiles, leather, velvet, cushions) and hard materials (wood, stone, metal, glass,
                ceramic). Too many hard surfaces and a room feels cold and echo-prone. Too many
                soft surfaces and it reads as cluttered and heavy.
              </p>
              <p className="mt-3">
                The right ratio depends on the room type. Living rooms benefit from a roughly
                even split — a sofa and rug anchor the soft side; a coffee table, shelving, and
                lighting anchor the hard side. Bedrooms can lean softer (50–70% soft materials)
                since the purpose is rest and the bed is the dominant element. Kitchens naturally
                lean harder — balance them with a textile runner, woven bar stools, or a fabric
                pendant shade.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">How the AI checks material coherence</h2>
              <p>
                When AptDesigner analyses your room and scores product candidates, material
                coherence is one of the primary scoring axes. The AI identifies the warm/cool
                register of your current fixed finishes, flags any wood-species conflicts among
                products already in your room, and scores incoming candidates for compatibility
                with the dominant register rather than just for style fit.
              </p>
              <p className="mt-3">
                A walnut coffee table will score higher in a room with oak floors and brass
                fixtures than the same table would in a room with pale ash floors and chrome
                handles — not because the table changed, but because the coherence context changed.
                This is the calculation that is tedious to do manually and that the AI handles
                consistently across hundreds of candidates at once.
              </p>
            </section>

          </div>

          {/* CTA */}
          <div className="mt-14 rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-8 text-center relative overflow-hidden">
            <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
            <div className="relative z-10">
              <h2 className="text-xl font-bold mb-2">Check your room&rsquo;s material balance</h2>
              <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
                Upload a photo and the AI will identify material conflicts and score every product candidate for coherence.
              </p>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-warm text-accent-warm-on-solid font-semibold text-sm hover:bg-accent-warm-solid-hover transition-colors"
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
