import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Checkout cancelled — AptDesigner",
};

export default function CheckoutCancelPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1 flex items-center justify-center px-6 py-24">
        <div className="max-w-lg w-full text-center">
          <h1 className="text-3xl font-bold tracking-tight mb-4">No charge was made.</h1>
          <p className="text-muted-foreground leading-relaxed mb-10">
            Your checkout was cancelled and you have not been billed. You can
            revisit pricing whenever you&apos;re ready.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" variant="warm">
              <Link href="/pricing">
                Back to pricing
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-8">
            Questions? Email us at{" "}
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
