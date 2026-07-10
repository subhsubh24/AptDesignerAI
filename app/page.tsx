import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, ShoppingBag, Palette, Shield, ArrowRight, CheckCircle2, Zap } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { HeroAnimations } from "@/components/marketing/hero-animations";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      <MarketingHeader />

      {/* Hero */}
      <main className="relative">
        {/* Background treatments */}
        <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
        <div className="absolute inset-0 texture-noise pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 md:px-8 pt-12 md:pt-24 pb-16">
          <HeroAnimations>
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left: Copy */}
              <div className="max-w-xl">
                {/* Pill badge */}
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-warm/10 border border-accent-warm/20 text-xs font-medium text-accent-warm-strong mb-8">
                  Personalized interior design
                </div>

                <h1 className="text-display text-balance mb-6">
                  Furniture that actually{" "}
                  <span className="text-gradient-warm">belongs in your space</span>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground max-w-lg mb-10 leading-relaxed">
                  Snap a few photos, and we&apos;ll study your apartment &mdash; the finishes, the light, the layout &mdash; then find pieces that fit like they were chosen by your own designer.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button asChild size="2xl" variant="warm">
                    <Link href="/signup">
                      Start designing
                      <ArrowRight className="h-5 w-5 ml-1" />
                    </Link>
                  </Button>
                  <Button asChild size="xl" variant="outline" className="hidden sm:inline-flex">
                    <a href="#how-it-works">
                      See how it works
                    </a>
                  </Button>
                </div>

                {/* Trust strip — honest, verifiable product claims only.
                    No adoption metrics or ratings until we have real ones. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-10 pt-8 border-t border-border/60 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-accent-warm" />
                    <span>AI-powered room analysis</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-accent-warm" />
                    <span>Never used to train AI models</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-accent-warm" />
                    <span>Free to start</span>
                  </div>
                </div>
              </div>

              {/* Right: App mockup */}
              <div className="relative hidden lg:block">
                <div className="relative" style={{ animationDelay: "200ms" }}>
                  {/* Room photo mockup */}
                  <div className="rounded-3xl overflow-hidden shadow-2xl border border-border/50 bg-gradient-card-hero aspect-[4/3]">
                    <div className="w-full h-full bg-gradient-to-br from-secondary via-accent to-secondary relative">
                      {/* Simulated room with gradient */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />

                      {/* Floating AI annotation cards */}
                      <div className="absolute top-6 right-6 animate-fade-in-up" style={{ animationDelay: "600ms" }}>
                        <div className="glass rounded-xl px-4 py-3 shadow-warm-md border border-border/40">
                          <div className="text-caption mb-1">Style Score</div>
                          <div className="text-2xl font-bold text-gradient-warm">8.4</div>
                        </div>
                      </div>

                      <div className="absolute top-1/2 left-6 -translate-y-1/2 animate-fade-in-up" style={{ animationDelay: "800ms" }}>
                        <div className="glass rounded-xl px-4 py-3 shadow-warm-md border border-border/40 space-y-2">
                          <div className="text-caption">Palette Match</div>
                          <div className="flex gap-1.5">
                            <div className="h-5 w-5 rounded-full bg-amber-700" />
                            <div className="h-5 w-5 rounded-full bg-stone-300" />
                            <div className="h-5 w-5 rounded-full bg-emerald-800" />
                            <div className="h-5 w-5 rounded-full bg-slate-600" />
                          </div>
                        </div>
                      </div>

                      <div className="absolute bottom-6 left-6 right-6 animate-fade-in-up" style={{ animationDelay: "1000ms" }}>
                        <div className="glass rounded-xl px-4 py-3 shadow-warm-md border border-border/40 flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">West Elm Harmony Sofa</div>
                            <div className="text-xs text-muted-foreground">Perfect scale fit for your space</div>
                          </div>
                          <Badge variant="warm" className="shrink-0">9.1</Badge>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Decorative elements */}
                  <div className="absolute -top-4 -right-4 h-24 w-24 rounded-full bg-accent-warm/10 blur-2xl" />
                  <div className="absolute -bottom-6 -left-6 h-32 w-32 rounded-full bg-accent-warm/5 blur-3xl" />
                </div>
              </div>
            </div>

            {/* Feature Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mt-24 md:mt-32">
              {[
                { icon: Camera, title: "Photo Analysis", desc: "We study every angle -- finishes, lighting, proportions", num: "01" },
                { icon: Palette, title: "Design Direction", desc: "A palette and material strategy tailored to your space", num: "02" },
                { icon: ShoppingBag, title: "Curated Picks", desc: "Budget, mid-range, and investment pieces -- all scored", num: "03" },
                { icon: Shield, title: "Validated Choices", desc: "Every recommendation checked for scale, style, and fit", num: "04" },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="group flex flex-col gap-4 p-6 rounded-2xl bg-card border transition-all duration-300 hover:shadow-warm-md hover:-translate-y-1"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-secondary to-accent group-hover:from-accent-warm/10 group-hover:to-accent-warm/5 transition-colors duration-300">
                      <feature.icon className="h-6 w-6 text-foreground group-hover:text-accent-warm transition-colors duration-300" />
                    </div>
                    <span className="text-xs font-bold text-muted-foreground/30 tabular-nums">{feature.num}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm mb-1.5">{feature.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </HeroAnimations>

          {/* How it works */}
          <div id="how-it-works" className="mt-24 md:mt-36 scroll-mt-8">
            <div className="text-center mb-12">
              <Badge variant="warm" className="mb-4">How it works</Badge>
              <h2 className="text-headline text-balance">Three steps to your dream space</h2>
              <p className="text-muted-foreground mt-3 max-w-md mx-auto">
                From photos to fully furnished -- designed by AI, curated for you.
              </p>
            </div>

            <div className="max-w-3xl mx-auto">
              {[
                {
                  step: "1",
                  title: "Show us your space",
                  desc: "Take photos of each room. We also research your building for context -- floor plans, finishes, and architectural details.",
                  icon: Camera,
                  mockup: (
                    <div className="flex gap-2">
                      <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-secondary to-accent border" />
                      <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-accent to-secondary border" />
                      <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-secondary to-muted border flex items-center justify-center">
                        <Camera className="h-5 w-5 text-muted-foreground/40" />
                      </div>
                    </div>
                  ),
                },
                {
                  step: "2",
                  title: "Get a design assessment",
                  desc: "What to keep, what to replace, what to add -- with a clear design direction including palette, materials, and style notes.",
                  icon: Zap,
                  mockup: (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <div className="h-2 rounded-full bg-emerald-200 dark:bg-emerald-800 w-24" />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-amber-400" />
                        <div className="h-2 rounded-full bg-amber-200 dark:bg-amber-800 w-32" />
                      </div>
                      <div className="flex gap-1.5 mt-3">
                        {["bg-amber-700", "bg-stone-400", "bg-slate-600", "bg-emerald-800"].map((bg, i) => (
                          <div key={i} className={`h-6 w-6 rounded-full ${bg}`} />
                        ))}
                      </div>
                    </div>
                  ),
                },
                {
                  step: "3",
                  title: "Find the right pieces",
                  desc: "Curated picks at every price point, scored and validated for your space. See AI mockups of how it all comes together.",
                  icon: ShoppingBag,
                  mockup: (
                    <div className="flex gap-2">
                      {["8.4", "9.1", "7.6"].map((score, i) => (
                        <div key={i} className="flex flex-col items-center gap-1.5">
                          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-secondary to-accent border" />
                          <Badge variant="warm" className="text-[10px] px-1.5 py-0">{score}</Badge>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ].map((item, i) => (
                <div key={item.step} className="relative flex gap-6 md:gap-8 pb-12 last:pb-0 group">
                  {/* Timeline line */}
                  {i < 2 && (
                    <div className="absolute left-[22px] top-[52px] bottom-0 w-px bg-gradient-to-b from-accent-warm/40 to-border" />
                  )}

                  {/* Step number */}
                  <div className="relative z-10 shrink-0">
                    <div className="h-11 w-11 rounded-full bg-gradient-warm-button text-white flex items-center justify-center text-sm font-bold shadow-warm-sm group-hover:shadow-warm-md transition-shadow">
                      {item.step}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-8">
                    <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">{item.desc}</p>
                    {/* Mini mockup */}
                    <div className="p-4 rounded-xl bg-card border shadow-sm">
                      {item.mockup}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Before/After Showcase */}
          <div className="mt-24 md:mt-36">
            <div className="text-center mb-12">
              <Badge variant="warm" className="mb-4">The result</Badge>
              <h2 className="text-headline text-balance">See the transformation</h2>
              <p className="text-muted-foreground mt-3 max-w-md mx-auto">
                AI-scored furniture that fits your space perfectly, visualized before you buy.
              </p>
            </div>

            <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">
              <div className="rounded-3xl overflow-hidden border shadow-sm">
                <div className="aspect-[4/3] bg-gradient-to-br from-muted to-secondary relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <Camera className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                      <p className="text-sm text-muted-foreground/50 font-medium">Your room today</p>
                    </div>
                  </div>
                  <div className="absolute top-4 left-4">
                    <Badge variant="secondary">Before</Badge>
                  </div>
                </div>
              </div>
              <div className="rounded-3xl overflow-hidden border shadow-warm-md">
                <div className="aspect-[4/3] bg-gradient-to-br from-accent-warm/10 via-secondary to-accent relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <Palette className="h-8 w-8 text-accent-warm/40 mx-auto" />
                      <p className="text-sm text-accent-warm-strong font-medium">Designed for you</p>
                    </div>
                  </div>
                  <div className="absolute top-4 left-4">
                    <Badge variant="warm">After</Badge>
                  </div>
                  {/* Floating score */}
                  <div className="absolute bottom-4 right-4 glass rounded-xl px-3 py-2 shadow-warm-sm border border-accent-warm/20">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm font-semibold">Score: 8.7</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer CTA */}
          <div className="mt-24 md:mt-36 mb-12">
            <div className="max-w-3xl mx-auto rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-10 md:p-14 text-center relative overflow-hidden">
              <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
              <div className="relative z-10">
                <h2 className="text-headline text-balance mb-4">Ready to transform your space?</h2>
                <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                  Snap a few photos and see what your space could become &mdash; your first room analysis is free.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button asChild size="2xl" variant="warm">
                    <Link href="/signup">
                      Create your account
                      <ArrowRight className="h-5 w-5 ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
