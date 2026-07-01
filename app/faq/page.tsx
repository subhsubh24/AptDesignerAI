import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MessageCircle } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "FAQ — AptDesigner",
  description:
    "Everything you want to know about AptDesigner: how the AI works, what you get, pricing, privacy, and more.",
};

type Section = {
  heading: string;
  items: Array<{ q: string; a: string }>;
};

const SECTIONS: Section[] = [
  {
    heading: "Getting started",
    items: [
      {
        q: "What does AptDesigner actually do?",
        a: "You take a few photos of your rooms. We analyze the light, finishes, proportions, and existing pieces, then produce a design direction (palette, materials, style notes) and a shortlist of furniture and decor that fits — scored for style, scale, palette, and cohesion. You can also upload your floor plan for spatial accuracy, and generate AI mockups of how the finished room will look.",
      },
      {
        q: "How long does it take to design a room?",
        a: "Most rooms go from photo upload to a fully-scored product list in under 10 minutes. Diagnosis takes about a minute, product sourcing adds a few minutes depending on depth.",
      },
      {
        q: "Do I need to be good at interior design?",
        a: "Not at all. If you can take a photo with your phone, you can use AptDesigner. The AI handles style direction — you pick from the options it recommends.",
      },
      {
        q: "What kind of apartments does this work for?",
        a: "Studios, 1-beds, multi-bedroom units, pre-war walkups, new construction, lofts — anything residential. The more photos and context you provide, the better the results.",
      },
    ],
  },
  {
    heading: "How the AI works",
    items: [
      {
        q: "How accurate is the room analysis?",
        a: "Our diagnosis is grounded in what the AI sees in your photos and — if you provide one — your floor plan. It reasons about scale, light, traffic, and finish compatibility. It's not perfect, but it's consistently better than a generic mood board because it's looking at your actual space.",
      },
      {
        q: "Where do product recommendations come from?",
        a: "We search across major retailers (West Elm, CB2, Crate & Barrel, Article, IKEA, Wayfair and more) and score each candidate against your room's design direction. You see why each piece was chosen — palette match, scale fit, cohesion, style alignment.",
      },
      {
        q: "Can I override the AI's recommendations?",
        a: "Yes, always. Every recommendation is a suggestion. You can tell us what to keep, what to replace, what you already love, and what you hate. The AI adapts across rooms — if you reject a style in one room, it won't push it in the next.",
      },
      {
        q: "Does the AI learn from what I like?",
        a: "Yes, within your project. As you mark items as kept or replace, or as you design more rooms in the same apartment, the AI infers your style preferences and reuses them. Between projects, you're always in control.",
      },
    ],
  },
  {
    heading: "Pricing & plans",
    items: [
      {
        q: "Is there really a free tier?",
        a: "Yes. Explore is free forever and designs one full room end-to-end — no credit card, no trial clock.",
      },
      {
        q: "What happens when I pay for Apartment?",
        a: "You unlock unlimited rooms in that apartment, floor plan extraction, AI mockups, bundle comparisons, and priority support. It's a one-time payment — no subscriptions, no renewals.",
      },
      {
        q: "Can I get a refund?",
        a: "Yes — we offer a 30-day money-back guarantee on all paid plans. Email us within 30 days and we'll refund you in full.",
      },
      {
        q: "Do I need Pro?",
        a: "Pro is for professionals managing many spaces (designers, property managers, landlords). If you're designing your own apartment, Apartment is the right tier.",
      },
      {
        q: "Can I use this for commercial properties?",
        a: "The app is optimised for residential apartments and houses — it understands domestic room types, residential furniture scale, and typical apartment floor plans. Commercial spaces (offices, retail, hospitality) have different constraints and aren't well served by the current pipeline. We may add commercial support in future.",
      },
      {
        q: "What's the difference between the Apartment and Pro plans?",
        a: "Apartment is a one-time purchase that unlocks one apartment (unlimited rooms within it): floor plan extraction, AI mockups, bundle comparisons. Pro is a monthly subscription for professionals who manage multiple properties — it unlocks unlimited apartments, priority support, and future pro-only features. Most individual users need Apartment.",
      },
    ],
  },
  {
    heading: "Privacy & data",
    items: [
      {
        q: "Who sees my photos?",
        a: "Only you and the AI models that generate your designs. We do not sell, share, or use your photos for training. You can delete your account and all data at any time.",
      },
      {
        q: "Are my rooms private?",
        a: "Yes. Your projects are private by default. If you want to share a mockup with a partner or friend, you can create a share link — but it's off unless you turn it on.",
      },
      {
        q: "Where is my data stored?",
        a: "Supabase (Postgres + object storage) in US-hosted regions. All connections are encrypted in transit.",
      },
    ],
  },
  {
    heading: "Troubleshooting",
    items: [
      {
        q: "The AI misidentified my furniture. What do I do?",
        a: "Use the 'Furniture to keep' and 'Furniture to replace' fields in Room Setup to correct it explicitly. You can also re-run diagnosis with better photos — wider angles and good natural light help a lot.",
      },
      {
        q: "A product link is broken or out of stock.",
        a: "Retailer inventory changes frequently. Mark the product as rejected and the AI will find an alternative in the same style & price tier.",
      },
      {
        q: "I don't like the design direction it picked.",
        a: "Use the feedback box on the focus page — tell the AI what's off (too rustic, too cold, too busy) and it will recalibrate. You can also set strong priorities up front in Room Setup.",
      },
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
          <div className="absolute inset-0 texture-noise pointer-events-none" />

          <div className="relative max-w-3xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-12 text-center">
            <Badge variant="warm" className="mb-4">FAQ</Badge>
            <h1 className="text-display mb-4">
              Questions, <span className="text-gradient-warm">answered</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Everything you need to know about designing your apartment with AI.
              Still stuck? We&apos;re a message away.
            </p>
          </div>
        </section>

        {/* Sections */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-16 space-y-14">
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <h2 className="text-xl font-bold mb-6 pb-3 border-b flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-warm" />
                {section.heading}
              </h2>
              <div className="space-y-4">
                {section.items.map((item) => (
                  <details
                    key={item.q}
                    className="group rounded-2xl border bg-card hover:shadow-sm transition-shadow"
                  >
                    <summary className="cursor-pointer list-none px-6 py-5 flex items-center justify-between gap-3 font-semibold text-[15px]">
                      <span>{item.q}</span>
                      <span className="text-muted-foreground group-open:rotate-45 transition-transform duration-200 shrink-0">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </span>
                    </summary>
                    <div className="px-6 pb-5 text-sm text-muted-foreground leading-relaxed">
                      {item.a}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Contact CTA */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24">
          <div className="rounded-3xl bg-gradient-to-br from-accent-warm/10 via-card to-secondary border p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 texture-noise pointer-events-none opacity-50" />
            <div className="relative z-10">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-warm/10 text-accent-warm mb-4">
                <MessageCircle className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Still have questions?</h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                We read every message. Email us and we&apos;ll help you get set up.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button asChild size="lg" variant="warm">
                  <a href="mailto:hello@aptdesignerai.com">
                    Email support
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/signup">Try it free</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
