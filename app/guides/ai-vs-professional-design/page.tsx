import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "AI Interior Design: When It Works and When You Still Need a Pro — AptDesignerAI",
  description:
    "An honest take on what AI design tools do well — and where human designers still have the edge. Use this to decide what's right for your project.",
  openGraph: {
    title: "AI Interior Design: When It Works and When You Still Need a Pro",
    description:
      "What AI tools do well, where human designers win, and how to decide which is right for your project.",
    type: "article",
  },
};

export default function AIVsProfessionalPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        <article className="max-w-2xl mx-auto px-6 md:px-8 pt-14 md:pt-20 pb-24">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-8">
            <Link href="/guides" className="hover:text-foreground transition-colors">Guides</Link>
            <span>/</span>
            <span>AI vs professional design</span>
          </nav>

          {/* Header */}
          <div className="mb-10">
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge variant="warm">AI</Badge>
              <Badge variant="secondary">Design Process</Badge>
              <span className="text-xs text-muted-foreground/70 self-center">4 min read</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
              AI Interior Design: When It Works and When You Still Need a Pro
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              An honest look at where AI design tools deliver real value — and where human designers
              still have the edge.
            </p>
          </div>

          {/* Body */}
          <div className="prose-editorial space-y-8 text-[15px] leading-relaxed text-foreground/90">

            <section>
              <h2 className="text-xl font-bold mb-3">What AI is actually good at</h2>
              <p>
                AI design tools are particularly strong at pattern matching across large product
                catalogues. Given a room with a warm oak floor, existing brass hardware, and a
                request for a calm, earthy palette, an AI can quickly filter thousands of sofas,
                rugs, and side tables to the subset that fits — checking scale, material
                compatibility, and price simultaneously.
              </p>
              <p className="mt-3">
                This is genuinely useful work that would take a human designer several hours to
                replicate manually. For renters and apartment owners who are buying furniture rather
                than commissioning custom pieces, the AI&rsquo;s ability to search and score mass-market
                products at scale is the core value.
              </p>
              <p className="mt-3">
                AI tools are also good at making design rules explicit. Principles like
                &ldquo;your warm and cool metal finishes should not both be prominent&rdquo; or
                &ldquo;your sofa depth should not exceed 60% of the wall it sits against&rdquo;
                are easy to encode and consistently apply. Designers follow these rules
                intuitively; AI follows them explicitly, which means it catches violations a
                rushed human might miss.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">What AI is less good at</h2>
              <p>
                AI tools struggle with problems that require understanding context that was not in
                the training data or the prompt. A designer visiting your apartment will notice
                that the room smells damp in the corner — pointing to a structural issue that no
                amount of rug layering will fix. They will see that the &ldquo;south-facing
                window&rdquo; you mentioned is actually partially blocked by a building across the
                street for most of the day. They will recognise that the proportions in your
                photos look off because your ceilings are unusually high.
              </p>
              <p className="mt-3">
                Structural changes — removing a wall, relocating a radiator, rewiring for floor
                lamps, redesigning kitchen cabinetry — are outside the scope of any current AI
                design tool. The AI can tell you what furniture should go where. It cannot tell a
                contractor how to reconfigure the room to make that furniture arrangement possible.
              </p>
              <p className="mt-3">
                Bespoke and custom work also favours humans. If you want a sofa in a specific
                fabric that does not appear in any retailer&rsquo;s current catalogue, or a
                built-in bookshelf designed around your exact wall dimensions and existing art
                collection, a designer with trade relationships is the right tool for that job.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">The cost and speed difference</h2>
              <p>
                A residential interior designer in a major city typically charges between £75 and
                £200 per hour (or equivalent). A single-room consultation and product sourcing
                engagement commonly runs from £800 to £3,000, depending on depth and location.
                That fee is often appropriate for renovations, primary residences, or spaces where
                the design quality has long-term financial implications (rental income, resale value).
              </p>
              <p className="mt-3">
                For a renter designing a bedroom or living room they will occupy for one to three
                years, the calculus is different. An AI tool that produces a design direction and
                shortlist in under ten minutes — at a fraction of the cost — is often the right
                level of investment.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold mb-3">When to use each</h2>
              <p>
                <strong>Use an AI design tool when:</strong> you are buying furniture rather than
                commissioning it; you have a fixed floor plan and no structural changes in scope;
                your budget is moderate; you want speed and a starting point rather than
                a finished specification; or you are iterating on a space before committing to a
                designer.
              </p>
              <p className="mt-3">
                <strong>Use a professional designer when:</strong> you are renovating a kitchen or
                bathroom; you are commissioning custom furniture or built-ins; you are staging a
                property for sale and the ROI on design quality is measurable; or the space has
                structural, acoustic, or lighting issues that require physical diagnosis.
              </p>
              <p className="mt-3">
                The two are not mutually exclusive. Some users run an AI pass first to get a
                clear brief, then bring a designer in to refine and specify. The AI output serves
                as a concrete starting point that saves the designer — and the client — time.
              </p>
            </section>

          </div>

          {/* CTA */}
          <div className="mt-14 rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-8 text-center relative overflow-hidden">
            <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
            <div className="relative z-10">
              <h2 className="text-xl font-bold mb-2">Start with the AI pass</h2>
              <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
                Upload a room photo and get a design direction, palette, and product shortlist in under ten minutes.
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
