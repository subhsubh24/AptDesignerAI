import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { ConversionTracker } from "./conversion-tracker";

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
      <ConversionTracker tier={tier} />
      <MarketingHeader />

      <main className="flex-1 flex items-center justify-center px-6 py-24">
        <div className="max-w-lg w-full text-center">
          <div className="flex justify-center mb-8">
            <CheckCircle className="h-16 w-16 text-accent-warm" strokeWidth={1.25} />
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
            <a href="mailto:hello@aptdesignerai.com" className="hover:text-foreground transition-colors">
              hello@aptdesignerai.com
            </a>
            .
          </p>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
