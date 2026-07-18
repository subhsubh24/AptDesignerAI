import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Camera } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { GalleryShowcase } from "./gallery-showcase";

export const metadata: Metadata = {
  title: "Gallery — AptDesigner",
  description: "Real apartments, AI-designed. See what AptDesigner creates across styles, budgets, and layouts.",
};

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

        {/* Interactive style filters + design grid */}
        <GalleryShowcase />

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
