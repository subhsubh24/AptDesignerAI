import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Sparkles, Camera } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Gallery — AptDesigner",
  description: "Real apartments, AI-designed. See what AptDesigner creates across styles, budgets, and layouts.",
};

type Example = {
  title: string;
  style: string;
  style_gradient: string;
  room_type: string;
  sqft: number;
  budget: string;
  palette: string[];
  highlights: string[];
  score: number;
};

// Curated example projects. In future these come from a real showcase table.
const EXAMPLES: Example[] = [
  {
    title: "Brooklyn walkup living room",
    style: "Warm minimalist",
    style_gradient: "from-amber-100 via-stone-200 to-orange-200 dark:from-amber-900/40 dark:via-stone-800 dark:to-orange-900/40",
    room_type: "Living Room",
    sqft: 240,
    budget: "$3,200",
    palette: ["#b4501e", "#e8e1d9", "#7c6354", "#3d3530"],
    highlights: [
      "Boucle lounge chair to soften the concrete floors",
      "Low walnut coffee table under 32\" for narrow pathway",
      "Trailing pothos on the tall bookshelf",
    ],
    score: 9.1,
  },
  {
    title: "West Village studio",
    style: "Japandi",
    style_gradient: "from-stone-100 via-neutral-200 to-zinc-100 dark:from-stone-800 dark:via-neutral-800 dark:to-zinc-900",
    room_type: "Studio",
    sqft: 380,
    budget: "$5,400",
    palette: ["#8b7355", "#e8e1d9", "#2f3e46", "#a8a29e"],
    highlights: [
      "Platform bed doubles as lounge seating",
      "Low-profile pendant over the dining nook",
      "Single large statement art to anchor the wall",
    ],
    score: 8.7,
  },
  {
    title: "LIC one-bed bedroom",
    style: "Bohemian layered",
    style_gradient: "from-rose-100 via-orange-100 to-amber-200 dark:from-rose-900/30 dark:via-orange-900/30 dark:to-amber-900/40",
    room_type: "Bedroom",
    sqft: 180,
    budget: "$2,100",
    palette: ["#8b4513", "#d4a574", "#cc7a00", "#3a2817"],
    highlights: [
      "Rattan headboard + hand-loomed throw",
      "Layered rugs for warmth over vinyl plank",
      "Woven pendant with dimmable bulb",
    ],
    score: 8.9,
  },
  {
    title: "Upper East pre-war kitchen",
    style: "Classic contemporary",
    style_gradient: "from-blue-50 via-slate-100 to-stone-100 dark:from-blue-950/40 dark:via-slate-900 dark:to-stone-900",
    room_type: "Kitchen / Dining",
    sqft: 210,
    budget: "$4,600",
    palette: ["#1e3a5f", "#e8e1d9", "#b8860b", "#2f3e46"],
    highlights: [
      "Saarinen tulip table for the round footprint",
      "Brass pendant picks up cabinet hardware",
      "Cane-back chairs keep sightlines open",
    ],
    score: 9.3,
  },
  {
    title: "Harlem brownstone parlor",
    style: "Eclectic mid-century",
    style_gradient: "from-emerald-100 via-teal-100 to-amber-100 dark:from-emerald-900/40 dark:via-teal-900/40 dark:to-amber-900/40",
    room_type: "Living Room",
    sqft: 320,
    budget: "$6,800",
    palette: ["#2d5016", "#d4a574", "#8b4513", "#f5e6d3"],
    highlights: [
      "Velvet sofa grounds the 11-foot ceilings",
      "Mid-century credenza under the gallery wall",
      "Floor-to-ceiling sheers to soften light",
    ],
    score: 9.0,
  },
  {
    title: "Jersey City loft",
    style: "Industrial warm",
    style_gradient: "from-zinc-200 via-stone-200 to-amber-100 dark:from-zinc-800 dark:via-stone-800 dark:to-amber-900/40",
    room_type: "Living / Dining",
    sqft: 420,
    budget: "$7,200",
    palette: ["#3a3530", "#b4501e", "#a8a29e", "#e8e1d9"],
    highlights: [
      "Leather chesterfield to contrast the concrete",
      "Blackened steel dining base + oak top",
      "Edison-era floor lamp for warm evening glow",
    ],
    score: 8.8,
  },
];

const STYLE_TABS = ["All", "Minimalist", "Japandi", "Bohemian", "Contemporary", "Mid-century", "Industrial"];

export default function GalleryPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
          <div className="absolute inset-0 texture-noise pointer-events-none" />

          <div className="relative max-w-4xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-10 text-center">
            <Badge variant="warm" className="mb-4">Gallery</Badge>
            <h1 className="text-display mb-4">
              Real apartments,{" "}
              <span className="text-gradient-warm">AI-designed</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              A peek at what AptDesigner creates across styles, layouts, and
              budgets. Every room is grounded in real photos, real dimensions,
              and a real user&apos;s taste.
            </p>
          </div>
        </section>

        {/* Style filter chips (visual only for now) */}
        <section className="max-w-5xl mx-auto px-6 md:px-8 pb-8">
          <div className="flex flex-wrap gap-2 justify-center">
            {STYLE_TABS.map((tab, i) => (
              <div
                key={tab}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer",
                  i === 0
                    ? "bg-foreground text-background"
                    : "bg-card border text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {tab}
              </div>
            ))}
          </div>
        </section>

        {/* Grid */}
        <section className="max-w-7xl mx-auto px-6 md:px-8 pb-20">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {EXAMPLES.map((ex) => (
              <article
                key={ex.title}
                className="group rounded-3xl overflow-hidden border bg-card hover:shadow-warm-md transition-all duration-300 hover:-translate-y-1"
              >
                {/* Visual */}
                <div className={cn(
                  "aspect-[4/3] relative bg-gradient-to-br",
                  ex.style_gradient,
                )}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />

                  {/* Palette chips */}
                  <div className="absolute top-4 left-4 flex gap-1.5">
                    {ex.palette.map((c, i) => (
                      <div
                        key={i}
                        className="h-6 w-6 rounded-full border-2 border-white/80 shadow-sm"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  {/* Score */}
                  <div className="absolute top-4 right-4 glass rounded-full px-3 py-1.5 shadow-warm-sm flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-accent-warm" />
                    <span className="text-xs font-bold">{ex.score}</span>
                  </div>

                  {/* Style label */}
                  <div className="absolute bottom-4 left-4">
                    <Badge variant="secondary" className="backdrop-blur-sm bg-white/80 dark:bg-black/60">
                      {ex.style}
                    </Badge>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg leading-tight mb-1">{ex.title}</h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-3">
                      <span>{ex.room_type}</span>
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                      <span>{ex.sqft} sqft</span>
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                      <span className="font-medium">{ex.budget}</span>
                    </p>
                  </div>

                  <ul className="space-y-1.5">
                    {ex.highlights.map((h) => (
                      <li key={h} className="text-xs text-muted-foreground flex items-start gap-2 leading-relaxed">
                        <span className="h-1 w-1 rounded-full bg-accent-warm mt-1.5 shrink-0" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-4xl mx-auto px-6 md:px-8 pb-24">
          <div className="rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-10 md:p-14 text-center relative overflow-hidden">
            <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
            <div className="relative z-10">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-warm/10 text-accent-warm mb-4">
                <Camera className="h-6 w-6" />
              </div>
              <h2 className="text-headline mb-4">Your apartment is next</h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                Upload your first room photos and see your own designs in minutes.
                Free forever on one room.
              </p>
              <Button asChild size="2xl" variant="warm">
                <Link href="/signup">
                  Design my apartment
                  <ArrowRight className="h-5 w-5 ml-1" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
