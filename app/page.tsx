import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles, Camera, ShoppingBag, Palette, LayoutGrid } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <span className="text-xl font-semibold tracking-tight">AptDesigner</span>
        </div>
        <Button asChild>
          <Link href="/login">Sign In</Link>
        </Button>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight leading-tight mb-6">
          Your apartment deserves
          <br />
          <span className="text-primary/80">an AI design copilot</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-12">
          Upload your room photos, get a deeply tailored diagnosis, discover
          furniture that actually fits your space, and build a cohesive design
          with AI-powered scoring and recommendations.
        </p>
        <Button asChild size="lg" className="h-12 px-8 text-base">
          <Link href="/login">Get Started</Link>
        </Button>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-24">
          {[
            { icon: Camera, title: "Room Analysis", desc: "AI diagnoses your space" },
            { icon: Palette, title: "Design Direction", desc: "Palette and material strategy" },
            { icon: ShoppingBag, title: "Smart Sourcing", desc: "AI-scored product discovery" },
            { icon: LayoutGrid, title: "Bundle Scoring", desc: "Holistic combination scoring" },
          ].map((feature) => (
            <div key={feature.title} className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">{feature.title}</h3>
              <p className="text-xs text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
