import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, BookOpen } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Interior Design Guides — AptDesigner",
  description:
    "Practical interior design guides from AptDesigner. Learn how to choose a colour palette, mix materials, and use AI to design your apartment.",
};

const GUIDES = [
  {
    slug: "color-palette-guide",
    title: "How to Choose a Colour Palette for Your Room",
    description:
      "Understand how light, existing finishes, and the size of your space interact — and how to pick colours that actually work together.",
    readTime: "5 min read",
    tags: ["Colour", "Design Basics"],
  },
  {
    slug: "ai-vs-professional-design",
    title: "AI Interior Design: When It Works and When You Still Need a Pro",
    description:
      "An honest take on what AI tools do well (and where human designers still have the edge), so you can decide what's right for your project.",
    readTime: "4 min read",
    tags: ["AI", "Design Process"],
  },
  {
    slug: "material-coherence",
    title: "Material Coherence: Why Oak and Brass Work (and Chrome and Pine Don't)",
    description:
      "The finish compatibility rules that designers follow intuitively — and how to apply them to your own furniture choices.",
    readTime: "5 min read",
    tags: ["Materials", "Design Principles"],
  },
];

export default function GuidesPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
          <div className="absolute inset-0 texture-noise pointer-events-none" />
          <div className="relative max-w-3xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-12 text-center">
            <Badge variant="warm" className="mb-4">Guides</Badge>
            <h1 className="text-display mb-4">
              Design, <span className="text-gradient-warm">explained</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Practical design principles — the same ones our AI uses to analyse your rooms — written plainly.
            </p>
          </div>
        </section>

        {/* Guide cards */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24 space-y-4">
          {GUIDES.map((guide) => (
            <Link
              key={guide.slug}
              href={`/guides/${guide.slug}`}
              className="group block rounded-3xl border bg-card p-7 md:p-8 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {guide.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs font-normal">
                        {tag}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground self-center">{guide.readTime}</span>
                  </div>
                  <h2 className="text-xl font-bold mb-2 group-hover:text-accent-warm transition-colors leading-snug">
                    {guide.title}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {guide.description}
                  </p>
                </div>
                <div className="shrink-0 h-10 w-10 rounded-full bg-secondary flex items-center justify-center group-hover:bg-accent-warm/10 transition-colors">
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-accent-warm transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </section>

        {/* CTA */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24">
          <div className="rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
            <div className="relative z-10">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-warm/10 text-accent-warm mb-4">
                <BookOpen className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Ready to apply it?</h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Upload a photo of your room and let the AI apply these principles to your actual space.
              </p>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-warm text-accent-warm-on-solid font-semibold text-sm hover:bg-accent-warm-solid-hover transition-colors"
              >
                Try it free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
