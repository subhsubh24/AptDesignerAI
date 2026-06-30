import Link from "next/link";
import { Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

const PRO_BENEFITS = [
  "Unlimited saved designs",
  "Every room in your apartment, coherent",
  "AI mockups + client-ready share links",
];

export interface UpgradeCtaCardProps {
  /** Saved designs used so far (for the usage line). */
  usedSaves?: number;
  /** Free-tier save limit (for the usage line). */
  limit?: number;
  /** Entry tier the CTA routes to. */
  tier?: "apartment" | "pro" | "pro_annual";
  /** Compact variant drops the benefit list (e.g. inline in a dense surface). */
  compact?: boolean;
  className?: string;
}

/**
 * Reusable in-product upgrade surface. Communicates Pro value and routes to the
 * real Stripe checkout (/billing/upgrade). Presentational — entitlement is
 * decided server-side; this only renders when the caller knows the user is on
 * the free tier.
 */
export function UpgradeCtaCard({
  usedSaves,
  limit,
  tier = "apartment",
  compact = false,
  className,
}: UpgradeCtaCardProps) {
  const showUsage = typeof usedSaves === "number" && typeof limit === "number";
  const atLimit = showUsage && usedSaves! >= limit!;

  return (
    <Card
      className={cn(
        "overflow-hidden border-accent-warm/30 bg-accent-warm/5",
        className,
      )}
    >
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-warm/15">
            <Sparkles className="h-5 w-5 text-accent-warm" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {atLimit ? "You've reached your free save limit" : "Unlock unlimited designs"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {atLimit
                ? "Upgrade to keep saving every room you design — your existing designs stay right here."
                : "Go further with the full apartment design experience."}
            </p>

            {showUsage && (
              <div className="mt-4 max-w-xs">
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Free saves used</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {Math.min(usedSaves!, limit!)} of {limit}
                  </span>
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-accent-warm/15"
                  role="progressbar"
                  aria-valuenow={Math.min(usedSaves!, limit!)}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-label="Free saves used"
                >
                  <div
                    className="h-full rounded-full bg-accent-warm transition-all"
                    style={{ width: `${Math.min(100, (usedSaves! / limit!) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {!compact && (
              <ul className="mt-5 space-y-2">
                {PRO_BENEFITS.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href={`/billing/upgrade?tier=${tier}`}>Upgrade</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/pricing">See all plans</Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
