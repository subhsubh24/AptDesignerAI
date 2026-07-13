import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { cn } from "@/lib/utils/cn";
import { isAnnualBillingEnabled } from "@/lib/billing/stripe";

export const metadata: Metadata = {
  title: "Pricing — AptDesigner",
  description:
    "Simple, honest pricing for AI-powered apartment design. Start free, upgrade when you're ready.",
};

type Tier = {
  name: string;
  tagline: string;
  price: string;
  period: string;
  highlight?: boolean;
  cta: string;
  href: string;
  features: string[];
  footnote?: string;
  annualHref?: string;
};

const TIERS: Tier[] = [
  {
    name: "Explore",
    tagline: "See what AptDesigner can do for one room.",
    price: "Free",
    period: "forever",
    cta: "Start free",
    href: "/signup",
    features: [
      "1 room diagnosis",
      "Full design direction + action plan",
      "Curated product picks at every price tier",
      "AI-scored recommendations",
      "Basic floor plan analysis",
    ],
    footnote: "No credit card required.",
  },
  {
    name: "Apartment",
    tagline: "For the full apartment. Every room, beautifully designed.",
    price: "$29",
    period: "one-time",
    highlight: true,
    cta: "Design my apartment",
    href: "/billing/upgrade?tier=apartment",
    features: [
      "Unlimited rooms in one apartment",
      "Cross-room style coherence",
      "Floor plan extraction with spatial reasoning",
      "AI mockups of finished rooms",
      "Manual + agentic product sourcing",
      "Bundle views & side-by-side compare",
      "Priority email support",
    ],
    footnote: "Pay once. Your designs are yours forever.",
  },
  {
    name: "Pro",
    tagline: "For designers & property managers working across many spaces.",
    price: "$49",
    period: "/month",
    cta: "Start pro monthly",
    href: "/billing/upgrade?tier=pro",
    features: [
      "Everything in Apartment",
      "Unlimited apartments & projects",
      "Client-ready share links",
      "Higher AI generation limits",
      "Early access to new features",
      "Dedicated support channel",
    ],
    annualHref: "/billing/upgrade?tier=pro_annual",
  },
];

const FAQ_TEASE = [
  { q: "Can I try before I pay?", a: "Yes. The Explore tier is free forever and designs one full room end-to-end." },
  { q: "What if I'm not happy?", a: "30-day money-back guarantee on paid plans, no questions asked." },
  { q: "Do you sell my data?", a: "Never. Your photos and designs are yours. See our privacy policy." },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
          <div className="absolute inset-0 texture-noise pointer-events-none" />

          <div className="relative max-w-4xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-12 text-center">
            <Badge variant="warm" className="mb-4">Pricing</Badge>
            <h1 className="text-display mb-5">
              Honest pricing for{" "}
              <span className="text-gradient-warm">beautiful rooms</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Start free with one room. Upgrade when you&apos;re ready to design
              the whole apartment. No subscriptions to remember, no surprises.
            </p>
          </div>
        </section>

        {/* Tiers */}
        <section className="max-w-6xl mx-auto px-6 md:px-8 pb-20">
          <div className="grid gap-4 sm:gap-5 md:grid-cols-3 md:gap-6 lg:gap-8">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={cn(
                  "relative rounded-3xl border bg-card p-8 flex flex-col",
                  tier.highlight
                    ? "border-accent-warm/30 shadow-warm-md ring-1 ring-accent-warm/20 bg-gradient-to-br from-accent-warm/5 via-card to-card"
                    : "hover:shadow-sm transition-shadow",
                )}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="warm" className="shadow-warm-sm">
                      <Sparkles className="h-3 w-3 mr-1" />
                      Most popular
                    </Badge>
                  </div>
                )}

                <div className="mb-6">
                  <h2 className="text-xl font-semibold mb-1">{tier.name}</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed min-h-[3rem]">
                    {tier.tagline}
                  </p>
                </div>

                <div className="mb-8 pb-8 border-b">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
                    <span className="text-sm text-muted-foreground">{tier.period}</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check
                        className={cn(
                          "h-4 w-4 mt-0.5 shrink-0",
                          tier.highlight ? "text-accent-warm" : "text-emerald-600 dark:text-emerald-400",
                        )}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  size="lg"
                  variant={tier.highlight ? "warm" : "outline"}
                  className="w-full"
                >
                  <Link href={tier.href}>
                    {tier.cta}
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>

                {tier.footnote && (
                  <p className="text-xs text-muted-foreground text-center mt-3">
                    {tier.footnote}
                  </p>
                )}
                {/* Annual CTA renders only when annual billing is live (migration 021
                    applied + ANNUAL_BILLING_ENABLED=true); otherwise the link would
                    lead to a checkout that charges without granting entitlement. */}
                {isAnnualBillingEnabled() && tier.annualHref && (
                  <p className="text-xs text-muted-foreground text-center mt-3">
                    Cancel anytime.{" "}
                    <Link href={tier.annualHref} className="font-medium text-accent-warm hover:underline">
                      Save 32% with annual — $399/yr
                    </Link>
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Guarantees */}
        <section className="max-w-5xl mx-auto px-6 md:px-8 pb-16">
          <div className="rounded-3xl bg-gradient-to-br from-secondary/40 to-card border p-8 md:p-10">
            <div className="grid md:grid-cols-3 gap-6 text-center">
              {[
                { title: "30-day money-back", desc: "Don't love it? Get a full refund, no questions." },
                { title: "Your data, always", desc: "We never sell or share your photos or designs." },
                { title: "No lock-in", desc: "Export your picks to CSV or share any design anytime." },
              ].map((item) => (
                <div key={item.title}>
                  <h3 className="font-semibold mb-1.5">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ teaser */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24">
          <div className="text-center mb-10">
            <h2 className="text-headline mb-2">Common questions</h2>
            <p className="text-muted-foreground">
              More on our{" "}
              <Link href="/faq" className="text-accent-warm font-medium hover:underline">
                FAQ page
              </Link>
              .
            </p>
          </div>
          <div className="space-y-4">
            {FAQ_TEASE.map((item) => (
              <div key={item.q} className="rounded-2xl bg-card border p-6">
                <h3 className="font-semibold mb-1.5">{item.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
