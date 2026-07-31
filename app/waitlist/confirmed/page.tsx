import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Waitlist confirmed — AptDesigner",
  description: "Your spot on the AptDesigner mobile waitlist is confirmed.",
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ status?: string }>;
}

export default async function WaitlistConfirmedPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const invalid = status === "invalid";
  const unsubscribed = status === "unsubscribed";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketingHeader />

      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
        <div className="relative w-full max-w-md text-center animate-fade-in-up">
          <div className="flex justify-center mb-6">
            {invalid ? (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-warm/10">
                <AlertCircle className="h-8 w-8 text-accent-warm" />
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
            )}
          </div>

          {invalid ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight mb-3">
                This link has expired
              </h1>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Either your email is already confirmed, or the confirmation link
                is no longer valid. If you&apos;re not sure, just join the
                waitlist again and we&apos;ll send a fresh link.
              </p>
              <Link
                href="/waitlist"
                className="inline-flex items-center justify-center rounded-xl bg-accent-warm text-accent-warm-on-solid font-semibold px-7 py-3 text-sm hover:bg-accent-warm-solid-hover transition-colors"
              >
                Back to the waitlist
              </Link>
            </>
          ) : unsubscribed ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight mb-3">
                You&apos;re unsubscribed
              </h1>
              <p className="text-muted-foreground leading-relaxed mb-8">
                You won&apos;t get any more emails from the AptDesignerAI
                waitlist. If that was a mistake, you&apos;re welcome to join
                again any time.
              </p>
              <Link
                href="/waitlist"
                className="inline-flex items-center justify-center rounded-xl bg-accent-warm text-accent-warm-on-solid font-semibold px-7 py-3 text-sm hover:bg-accent-warm-solid-hover transition-colors"
              >
                Back to the waitlist
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight mb-3">
                You&apos;re officially on the list
              </h1>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Your email is confirmed. We&apos;ll send you one email the moment
                the iOS and Android apps go live — with your early-access
                pricing details. Nothing else in between.
              </p>
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-xl bg-accent-warm text-accent-warm-on-solid font-semibold px-7 py-3 text-sm hover:bg-accent-warm-solid-hover transition-colors"
              >
                Start designing on web today
              </Link>
            </>
          )}
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
