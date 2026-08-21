import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Mail, MessageCircle } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Support — AptDesigner",
  description:
    "Get help with AptDesigner. Browse the FAQ, email our team, or find answers about your account and subscription.",
};

const QUICK_LINKS = [
  {
    heading: "Getting started",
    href: "/faq#getting-started",
    desc: "How to upload photos, read your analysis, and navigate the first design.",
  },
  {
    heading: "Pricing & billing",
    href: "/pricing",
    desc: "Plans, the free tier, one-time purchases, and refund policy.",
  },
  {
    heading: "Design guides",
    href: "/guides",
    desc: "Colour palettes, material coherence, and how to read your space — practical design principles explained.",
  },
  {
    heading: "Privacy & data",
    href: "/privacy",
    desc: "What we collect, how it's stored, and how to delete your account.",
  },
  {
    heading: "Full FAQ",
    href: "/faq",
    desc: "Every question we've been asked, answered in one place.",
  },
];

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
          <div className="absolute inset-0 texture-noise pointer-events-none" />
          <div className="relative max-w-3xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-12 text-center">
            <Badge variant="warm" className="mb-4">Support</Badge>
            <h1 className="text-display mb-5">
              How can we{" "}
              <span className="text-gradient-warm">help?</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Most questions are answered in the FAQ. If you need something more specific, email us directly.
            </p>
          </div>
        </section>

        {/* Email contact */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-12">
          <div className="rounded-3xl border bg-card p-8 md:p-10 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="h-5 w-5 text-accent-warm" />
                <h2 className="font-semibold text-lg">Email support</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We respond within one business day. Include your account email and a brief description of the issue.
              </p>
              <p className="text-sm font-medium mt-3">
                <a
                  href="mailto:hello@aptdesignerai.com"
                  className="text-accent-warm hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  hello@aptdesignerai.com
                </a>
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a href="mailto:hello@aptdesignerai.com">
                Send email
                <ArrowRight className="h-4 w-4 ml-1" />
              </a>
            </Button>
          </div>
        </section>

        {/* Quick links */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-16">
          <div className="flex items-center gap-2 mb-6">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">Browse by topic</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.heading}
                href={link.href}
                className="rounded-2xl border bg-card p-5 hover:shadow-sm transition-shadow group block"
              >
                <h3 className="font-semibold mb-1 group-hover:text-accent-warm transition-colors">
                  {link.heading}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {link.desc}
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* Account deletion note */}
        <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24">
          <div className="rounded-2xl bg-secondary/40 border p-6">
            <h3 className="font-semibold mb-1.5">Deleting your account</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You can delete your account and all associated data directly from{" "}
              <Link href="/account" className="text-accent-warm hover:underline font-medium">
                Account Settings
              </Link>
              . Deletion is permanent and removes your photos, designs, and subscription data immediately.
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
