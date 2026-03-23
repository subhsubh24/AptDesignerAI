import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Camera, ShoppingBag, Palette, Shield, ChevronRight } from "lucide-react";
import { LogoMark } from "@/components/ui/logo-mark";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 md:px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-6 w-6 text-primary" />
          <span className="text-xl font-semibold tracking-tight">
            Apt<span className="text-accent-warm">Designer</span>
          </span>
        </div>
        <Button asChild>
          <Link href="/login">Sign In</Link>
        </Button>
      </header>

      <main className="max-w-4xl mx-auto px-6 md:px-8 py-16 md:py-24 text-center">
        <div className="animate-fade-in-up">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] mb-6">
            Furniture that actually
            <br />
            <span className="text-accent-warm">belongs in your space</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Snap a few photos, and we&apos;ll study your apartment — the finishes, the light, the layout — then find pieces that fit like they were chosen by your own designer.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="h-13 px-8 text-base">
              <Link href="/login">
                Start designing
                <ChevronRight className="h-5 w-5 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 mt-20 md:mt-24">
          {[
            { icon: Camera, title: "Photo Analysis", desc: "We study every angle — finishes, lighting, proportions" },
            { icon: Palette, title: "Design Direction", desc: "A palette and material strategy tailored to your space" },
            { icon: ShoppingBag, title: "Curated Picks", desc: "Budget, mid-range, and investment pieces — all scored for fit" },
            { icon: Shield, title: "Validated Choices", desc: "Every recommendation checked for scale, style, and cohesion" },
          ].map((feature, i) => (
            <div
              key={feature.title}
              className="flex flex-col items-center gap-3 animate-fade-in-up"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary transition-transform duration-300 hover:scale-110 hover:shadow-md">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">{feature.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 md:mt-24 p-8 rounded-2xl bg-secondary/50 border animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          <h2 className="text-xl font-semibold mb-4">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            {[
              { step: "1", title: "Show us your space", desc: "Take photos of each room. We also research your building for context." },
              { step: "2", title: "Get a design assessment", desc: "What to keep, what to replace, what to add — with a clear design direction." },
              { step: "3", title: "Find the right pieces", desc: "Curated picks at every price point, scored and validated for your space." },
            ].map((item) => (
              <div key={item.step} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                  {item.step}
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{item.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
