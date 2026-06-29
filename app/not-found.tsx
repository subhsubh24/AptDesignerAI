import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Compass, Home, LayoutDashboard } from "lucide-react";

export const metadata: Metadata = {
  title: "Page not found — AptDesigner",
  description: "The page you're looking for doesn't exist or has moved.",
};

/**
 * Design-system 404. Without this, an unknown route falls back to Next.js's
 * unstyled default template — an off-brand boundary that breaks the warm-
 * editorial design bar. Server component; reachable both logged-out and
 * logged-in, so it offers a route home and to the dashboard.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
          <div className="h-14 w-14 rounded-2xl bg-accent-warm/10 flex items-center justify-center">
            <Compass className="h-7 w-7 text-accent-warm" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium tracking-wide text-accent-warm">404</p>
            <h1 className="text-2xl font-semibold tracking-tight">This room doesn&apos;t exist</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The page you&apos;re looking for may have moved or never existed.
              Let&apos;s get you back to designing.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-1 w-full sm:w-auto">
            <Button asChild>
              <Link href="/dashboard">
                <LayoutDashboard className="h-4 w-4 mr-2" aria-hidden="true" />
                Go to dashboard
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">
                <Home className="h-4 w-4 mr-2" aria-hidden="true" />
                Back home
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
