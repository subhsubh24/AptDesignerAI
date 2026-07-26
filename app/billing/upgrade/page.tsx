import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { UpgradeCheckoutButton } from "./upgrade-checkout-button";
import { UpgradeViewTracker } from "./upgrade-tracker";
import { isAnnualBillingEnabled, isRecurringTier } from "@/lib/billing/stripe";

export const metadata: Metadata = {
  title: "Upgrade — AptDesigner",
  description: "Unlock the full apartment design experience.",
};

const TIER_COPY = {
  apartment: {
    name: "Apartment",
    price: "$29",
    period: "one-time",
    tagline: "Every room in your apartment, beautifully designed.",
    features: [
      "Unlimited rooms in one apartment",
      "Cross-room style coherence",
      "Floor plan extraction with spatial reasoning",
      "AI mockups of finished rooms",
      "Manual + agentic product sourcing",
      "Bundle views & side-by-side compare",
      "Priority email support",
      "30-day money-back guarantee",
    ],
  },
  pro: {
    name: "Pro",
    price: "$49",
    period: "/month",
    // Auto-renewal disclosure required at the point of purchase (Apple App
    // Store 3.1.2 / Google Play subscription policy). Mirrors the pricing page.
    renewalNote: "Billed monthly. Renews automatically until you cancel.",
    tagline: "For designers and property managers working across many spaces.",
    features: [
      "Everything in Apartment",
      "Unlimited apartments & projects",
      "Client-ready share links",
      "Higher AI generation limits",
      "Early access to new features",
      "Dedicated support channel",
      "30-day money-back guarantee",
    ],
  },
  pro_annual: {
    name: "Pro Annual",
    price: "$399",
    period: "/year",
    renewalNote: "Billed annually. Renews automatically until you cancel.",
    tagline: "Everything in Pro — billed annually. Save $189 vs monthly.",
    features: [
      "Everything in Pro",
      "Unlimited apartments & projects",
      "Client-ready share links",
      "Higher AI generation limits",
      "Early access to new features",
      "Dedicated support channel",
      "30-day money-back guarantee",
      "Save $189/year vs monthly billing",
    ],
  },
} as const;

interface Props {
  searchParams: Promise<{ tier?: string }>;
}

export default async function UpgradePage({ searchParams }: Props) {
  const params = await searchParams;
  const tier = params.tier;

  if (tier !== "apartment" && tier !== "pro" && tier !== "pro_annual") {
    redirect("/pricing");
  }

  // Annual is gated until migration 021 is applied (see isAnnualBillingEnabled);
  // send annual selections back to pricing rather than to a checkout that would
  // charge without granting entitlement.
  if (tier === "pro_annual" && !isAnnualBillingEnabled()) {
    redirect("/pricing");
  }

  const copy = TIER_COPY[tier];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <UpgradeViewTracker tier={tier} />
      <MarketingHeader />

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 md:px-8 py-16 md:py-24">
        <div className="rounded-3xl border bg-card p-8 md:p-10 shadow-sm">
          <div className="mb-8">
            <p className="text-sm text-muted-foreground uppercase tracking-widest font-medium mb-3">
              You selected
            </p>
            <h1 className="text-3xl font-bold tracking-tight mb-2">{copy.name}</h1>
            <p className="text-muted-foreground">{copy.tagline}</p>
          </div>

          <div className="mb-8 pb-8 border-b">
            <div className="flex items-baseline gap-1.5">
              <span className="text-5xl font-bold tracking-tight">{copy.price}</span>
              <span className="text-sm text-muted-foreground">{copy.period}</span>
            </div>
            {"renewalNote" in copy && copy.renewalNote ? (
              <p className="text-sm text-muted-foreground mt-2">{copy.renewalNote}</p>
            ) : null}
          </div>

          <ul className="space-y-3 mb-10">
            {copy.features.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-accent-warm/20 flex items-center justify-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-warm" />
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <UpgradeCheckoutButton tier={tier} />

          <p className="text-xs text-muted-foreground text-center mt-4">
            Secure checkout via Stripe. You&apos;ll be redirected to complete payment.
          </p>

          {/*
            Apple 3.1.2 wants the EULA + privacy links AT the point of purchase,
            not merely somewhere on the page (the footer links both already).
            Google Play's subscription policy is equivalent.

            Colour must stay the FULL `text-muted-foreground` token, never an
            opacity-reduced variant: at text-xs, `/70` resolves to #9a948d on the
            white card, which is 3.0:1 against WCAG 2 AA's 4.5:1 requirement. The
            full token is 5.6:1. Legally required purchase terms should not be
            the faintest text on a checkout page.
          */}
          <p className="text-xs text-muted-foreground text-center mt-3 leading-relaxed">
            {/* Reads from the same predicate that picks the Stripe charge mode,
                so the disclosure cannot drift from what the customer is billed. */}
            {isRecurringTier(tier)
              ? "By subscribing you agree to our "
              : "By purchasing you agree to our "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
