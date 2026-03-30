import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Camera, ShoppingBag, Palette, Shield, ChevronRight, ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 md:px-8 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-7 w-7 text-foreground" />
          <span className="text-xl font-semibold tracking-tight">
            Apt<span className="text-accent-warm">Designer</span>
          </span>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign In</Link>
        </Button>
      </header>

      {/* Hero */}
      <main className="relative">
        {/* Subtle radial gradient background */}
        <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />

        <div className="relative max-w-4xl mx-auto px-6 md:px-8 pt-16 md:pt-28 pb-16 text-center">
          <div className="animate-fade-in-up">
            {/* Pill badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary border text-xs font-medium text-muted-foreground mb-8">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-warm animate-pulse-soft" />
              AI-powered interior design
            </div>

            <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
              Furniture that actually
              <br />
              <span className="text-accent-warm">belongs in your space</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Snap a few photos, and we&apos;ll study your apartment &mdash; the finishes, the light, the layout &mdash; then find pieces that fit like they were chosen by your own designer.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="xl" variant="warm">
                <Link href="/login">
                  Start designing
                  <ArrowRight className="h-5 w-5 ml-1" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mt-24 md:mt-32">
            {[
              { icon: Camera, title: "Photo Analysis", desc: "We study every angle — finishes, lighting, proportions" },
              { icon: Palette, title: "Design Direction", desc: "A palette and material strategy tailored to your space" },
              { icon: ShoppingBag, title: "Curated Picks", desc: "Budget, mid-range, and investment pieces — all scored" },
              { icon: Shield, title: "Validated Choices", desc: "Every recommendation checked for scale, style, and fit" },
            ].map((feature, i) => (
              <div
                key={feature.title}
                className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-card border transition-all duration-300 hover:shadow-md hover:-translate-y-1 animate-fade-in-up"
                style={{ animationDelay: `${200 + i * 100}ms` }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                  <feature.icon className="h-5 w-5 text-foreground" />
                </div>
                <h3 className="font-semibold text-sm">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div
            className="mt-20 md:mt-28 p-8 md:p-10 rounded-3xl bg-card border animate-fade-in-up"
            style={{ animationDelay: "600ms" }}
          >
            <h2 className="text-2xl font-semibold mb-8">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
              {[
                { step: "1", title: "Show us your space", desc: "Take photos of each room. We also research your building for context." },
                { step: "2", title: "Get a design assessment", desc: "What to keep, what to replace, what to add — with a clear design direction." },
                { step: "3", title: "Find the right pieces", desc: "Curated picks at every price point, scored and validated for your space." },
              ].map((item) => (
                <div key={item.step} className="flex gap-4">
                  <div className="h-9 w-9 rounded-full bg-accent-warm text-white flex items-center justify-center text-sm font-bold shrink-0">
                    {item.step}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer CTA */}
          <div className="mt-20 mb-12 animate-fade-in-up" style={{ animationDelay: "800ms" }}>
            <p className="text-muted-foreground mb-4">Ready to transform your space?</p>
            <Button asChild size="lg" variant="outline">
              <Link href="/signup">
                Create your account
                <ChevronRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
