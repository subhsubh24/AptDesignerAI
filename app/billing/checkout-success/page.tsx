import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Payment confirmed — AptDesigner",
};

const TIER_COPY: Record<string, { headline: string; sub: string }> = {
  apartment: {
    headline: "Your apartment plan is unlocked.",
    sub: "You can now design every room with the full AI suite — floor plans, mockups, product sourcing, and more.",
  },
  pro: {
    headline: "Welcome to Pro.",
    sub: "All apartments, all rooms, client-ready exports — yours to use on any project.",
  },
};

interface Props {
  searchParams: Promise<{ tier?: string }>;
}

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const params = await searchParams;
  const tier = params.tier ?? "";
  const copy = TIER_COPY[tier] ?? {
    headline: "Payment confirmed.",
    sub: "Your account has been upgraded. Head to your dashboard to get started.",
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1 flex items-center justify-center px-6 py-24">
        <div className="max-w-lg w-full text-center">
          <div className="w-16 h-16 rounded-full bg-accent-warm/15 flex items-center justify-center mx-auto mb-8">
            <div className="w-6 h-6 rounded-full bg-accent-warm/60" />
          </div>

          <h1 className="text-3xl font-bold tracking-tight mb-4">{copy.headline}</h1>
          <p className="text-muted-foreground leading-relaxed mb-10">{copy.sub}</p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" variant="warm">
              <Link href="/dashboard">
                Go to dashboard
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">View all features</Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-8">
            A receipt is on its way to your email from Stripe. If you have any
            questions, contact us at{" "}
            <a href="mailto:hello@aptdesigner.app" className="hover:text-foreground transition-colors">
              hello@aptdesigner.app
            </a>
            .
          </p>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
