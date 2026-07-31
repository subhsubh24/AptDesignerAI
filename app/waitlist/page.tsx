import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Star, Zap, Map } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = {
  title: "Coming to iOS & Android — AptDesigner",
  description:
    "AptDesigner is coming to mobile. Join the waitlist to be first to know when the iOS and Android apps launch.",
};

const PERKS = [
  {
    icon: Smartphone,
    title: "Design from anywhere",
    body: "Photograph your apartment on the spot, get a full design direction before you leave the room.",
  },
  {
    icon: Map,
    title: "Floor plan in your pocket",
    body: "Use your phone's camera to scan a floor plan or sketch — the app extracts measurements automatically.",
  },
  {
    icon: Zap,
    title: "Instant product sync",
    body: "Save products to your picks, get price-drop alerts, and share room mockups straight from your phone.",
  },
  {
    icon: Star,
    title: "Early-access pricing",
    body: "Waitlist members get early-access pricing on their first paid plan — details land in your inbox at launch.",
  },
];

export default function WaitlistPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
          <div className="absolute inset-0 texture-noise pointer-events-none" />

          <div className="relative max-w-3xl mx-auto px-6 md:px-8 pt-20 md:pt-28 pb-16 text-center">
            <Badge variant="warm" className="mb-5">Coming soon</Badge>

            <h1 className="text-display mb-5">
              AptDesigner is coming{" "}
              <span className="text-gradient-warm">to your phone</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed mb-10">
              iOS and Android apps are in development. Be first in line — join
              the waitlist and we&apos;ll email you the moment we launch.
            </p>

            <WaitlistForm />

            <p className="mt-4 text-xs text-muted-foreground">
              We&apos;ll send one link to confirm, then one email at launch. No spam.
            </p>
          </div>
        </section>

        {/* Platform badges */}
        <section className="max-w-lg mx-auto px-6 md:px-8 pb-16 flex justify-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full border bg-card text-sm font-medium shadow-sm">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-foreground" aria-hidden="true">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            iOS (App Store)
          </div>
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full border bg-card text-sm font-medium shadow-sm">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-foreground" aria-hidden="true">
              <path d="M17.523 15.341 5.825 2.604A1.063 1.063 0 0 0 4.053 3.46l6.79 11.762-3.32 3.319 9.999 5.776a1.062 1.062 0 0 0 1.593-.918V16.26a1.06 1.06 0 0 0-.592-.919zm-12.56 6.095L2.6 19.79a1.063 1.063 0 0 1 0-1.504l2.365-2.365V21.436zM2.6 4.214l2.365 2.365v5.842L2.6 5.718a1.063 1.063 0 0 1 0-1.504z"/>
            </svg>
            Android (Play Store)
          </div>
        </section>

        {/* Perks grid */}
        <section className="max-w-5xl mx-auto px-6 md:px-8 pb-24">
          <h2 className="text-center text-2xl font-bold mb-10">
            What you get with the mobile app
          </h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {PERKS.map((perk) => (
              <div
                key={perk.title}
                className="rounded-2xl border bg-card p-7 flex gap-5 hover:shadow-md transition-shadow"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-warm/10 text-accent-warm mt-0.5">
                  <perk.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1.5">{perk.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{perk.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24">
          <div className="rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
            <div className="relative z-10">
              <p className="text-sm font-medium text-accent-warm mb-3 uppercase tracking-wide">
                Already on the web?
              </p>
              <h2 className="text-2xl font-bold mb-3">Start designing right now</h2>
              <p className="text-muted-foreground mb-7 max-w-md mx-auto">
                The full AptDesigner experience is available today on web — photos in, designed
                rooms out in under 10 minutes.
              </p>
              <a
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-warm text-accent-warm-on-solid font-semibold px-7 py-3 text-sm hover:bg-accent-warm-solid-hover transition-colors"
              >
                Try it free — no credit card
              </a>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
