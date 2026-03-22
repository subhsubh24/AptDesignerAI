import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles, Camera, ShoppingBag, Palette, LayoutGrid, ChevronRight, Shield } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 md:px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <span className="text-xl font-semibold tracking-tight">AptDesigner</span>
        </div>
        <Button asChild>
          <Link href="/login">Sign In</Link>
        </Button>
      </header>

      <main className="max-w-4xl mx-auto px-6 md:px-8 py-16 md:py-24 text-center">
        <div className="animate-fade-in-up">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-6">
            Your apartment deserves
            <br />
            <span className="text-primary/80">an AI design copilot</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Snap photos from your phone, and our AI analyzes your space, finds furniture that actually fits your aesthetic, and validates every recommendation down to the last detail.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="h-13 px-8 text-base">
              <Link href="/login">
                Get Started
                <ChevronRight className="h-5 w-5 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 mt-20 md:mt-24">
          {[
            { icon: Camera, title: "Snap & Analyze", desc: "AI understands your entire apartment from photos" },
            { icon: Palette, title: "Design Direction", desc: "Personalized palette, materials, and style strategy" },
            { icon: ShoppingBag, title: "Smart Search", desc: "Budget, mid-range, and luxury options found for you" },
            { icon: Shield, title: "AI Validated", desc: "Every recommendation verified for holistic fit" },
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
              <p className="text-xs text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 md:mt-24 p-8 rounded-2xl bg-secondary/50 border animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          <h2 className="text-xl font-semibold mb-3">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            {[
              { step: "1", title: "Upload photos", desc: "Take photos of each room from your phone. The AI researches your building too." },
              { step: "2", title: "Get recommendations", desc: "AI analyzes what stays, what goes, and what to add — validated for consistency." },
              { step: "3", title: "Find the pieces", desc: "Budget, mid-range, and luxury options for every item, scored for fit." },
            ].map((item) => (
              <div key={item.step} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                  {item.step}
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{item.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
