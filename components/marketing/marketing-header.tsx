"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo-mark";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/gallery", label: "Gallery" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

export function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="relative z-20">
      <div className="flex items-center justify-between px-6 md:px-8 py-5 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark className="h-7 w-7 text-foreground" />
          <span className="text-xl font-semibold tracking-tight">
            Apt<span className="text-gradient-warm">Designer</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="warm" size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>

        {/* Mobile menu trigger */}
        <button
          className="md:hidden p-2 -mr-2 rounded-md hover:bg-muted transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      <div
        className={cn(
          "md:hidden overflow-hidden transition-all duration-300 border-b",
          mobileOpen ? "max-h-96 border-border" : "max-h-0 border-transparent",
        )}
      >
        <nav className="px-6 pt-2 pb-6 flex flex-col gap-1 bg-background">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className="py-3 px-3 rounded-lg text-base font-medium hover:bg-muted transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <div className="flex flex-col gap-2 pt-3 mt-2 border-t">
            <Button asChild variant="outline" size="lg">
              <Link href="/login" onClick={() => setMobileOpen(false)}>Sign in</Link>
            </Button>
            <Button asChild variant="warm" size="lg">
              <Link href="/signup" onClick={() => setMobileOpen(false)}>Get started</Link>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
