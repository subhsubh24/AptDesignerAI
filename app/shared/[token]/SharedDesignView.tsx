"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogoMark } from "@/components/ui/logo-mark";
import { PageTransition, StaggerList, StaggerItem } from "@/components/ui/motion";
import { CheckCircle2, XCircle, ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { canOptimizeImageHost } from "@/lib/utils/image-url";
import type { SharedDesign } from "./page";

import {
  PRIORITY_ORDER,
  priorityBadge,
  ASSESSMENT_PANEL,
} from "@/lib/utils/assessment-colors";

export function SharedDesignView({ design }: { design: SharedDesign }) {
  const { assessment, products, metadata } = design.snapshot;
  if (!assessment) return null;
  const sortedItems = [...(assessment.what_it_needs ?? [])].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
  );
  const hasProducts = products && Object.values(products.per_tier_products).some((arr) => arr.length > 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal public header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-secondary flex items-center justify-center">
              <LogoMark className="h-4 w-4 text-foreground" />
            </div>
            <span className="font-semibold text-sm">AptDesigner</span>
          </Link>
          <Link href="/signup">
            <Button variant="warm" size="sm">
              Try it free <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </header>

      <main>
      <PageTransition className="max-w-4xl mx-auto px-4 py-10 space-y-8">

        {/* Title block */}
        <StaggerList className="space-y-3">
          <StaggerItem>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-warm/10 border border-accent-warm/20 text-xs font-medium text-accent-warm-strong">
                <Sparkles className="h-3 w-3" />
                AI-designed room
              </span>
              {design.room_type && (
                <span className="text-xs text-muted-foreground capitalize">
                  {design.room_type.replace(/_/g, " ")}
                </span>
              )}
              {metadata?.building_name && (
                <span className="text-xs text-muted-foreground">· {metadata.building_name}</span>
              )}
            </div>
          </StaggerItem>
          <StaggerItem>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{design.title}</h1>
          </StaggerItem>
          {assessment.room_description && (
            <StaggerItem>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                {assessment.room_description}
              </p>
            </StaggerItem>
          )}
        </StaggerList>

        {/* Mockup image */}
        {(assessment.mockup_url || design.thumbnail_url) && (
          <div className="relative w-full h-[480px] overflow-hidden rounded-2xl border shadow-sm">
            {(() => {
              const mockupSrc = assessment.mockup_url ?? design.thumbnail_url!;
              const alt = `AI-designed ${design.room_type?.replace(/_/g, " ") ?? "room"}`;
              return canOptimizeImageHost(mockupSrc) ? (
                <Image
                  src={mockupSrc}
                  alt={alt}
                  fill
                  sizes="(min-width: 896px) 864px, 100vw"
                  className="object-cover"
                  priority
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mockupSrc} alt={alt} className="w-full h-full object-cover" />
              );
            })()}
          </div>
        )}

        {/* Design direction pull-quote */}
        {assessment.design_direction && (
          <div className="relative pl-5">
            <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full bg-accent-warm" />
            <p className="text-base md:text-lg font-medium leading-relaxed text-foreground/90 italic">
              &ldquo;{assessment.design_direction}&rdquo;
            </p>
          </div>
        )}

        {/* What to get */}
        {sortedItems.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">What to get</h2>
            <StaggerList className="space-y-2.5">
              {sortedItems.map((item, i) => (
                <StaggerItem
                  key={i}
                  className="flex items-start gap-3 p-3.5 rounded-xl bg-card border hover:shadow-sm transition-shadow"
                >
                  <Badge
                    className={cn(
                      "text-[10px] shrink-0 mt-0.5 font-semibold",
                      priorityBadge(item.priority)
                    )}
                  >
                    {item.priority}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{item.search_title || item.category}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                    {item.specs && (
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">{item.specs}</p>
                    )}
                  </div>
                </StaggerItem>
              ))}
            </StaggerList>
          </div>
        )}

        {/* Keep / Remove */}
        <div className="grid sm:grid-cols-2 gap-4">
          {assessment.what_works?.length > 0 && (
            <div className={cn("p-4 rounded-xl border", ASSESSMENT_PANEL.keep.surface)}>
              <h3 className={cn("text-sm font-semibold mb-2.5 flex items-center gap-1.5", ASSESSMENT_PANEL.keep.heading)}>
                <CheckCircle2 className="h-4 w-4" /> Keep
              </h3>
              <ul className="space-y-1.5">
                {assessment.what_works.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className={cn("mt-1 shrink-0", ASSESSMENT_PANEL.keep.marker)}>·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {assessment.what_should_go?.length > 0 && (
            <div className={cn("p-4 rounded-xl border", ASSESSMENT_PANEL.replace.surface)}>
              <h3 className={cn("text-sm font-semibold mb-2.5 flex items-center gap-1.5", ASSESSMENT_PANEL.replace.heading)}>
                <XCircle className="h-4 w-4" /> Replace or remove
              </h3>
              <ul className="space-y-1.5">
                {assessment.what_should_go.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className={cn("mt-1 shrink-0", ASSESSMENT_PANEL.replace.marker)}>·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Product picks (if full stage) */}
        {hasProducts && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Product picks</h2>
            {(["budget", "balanced", "high_end"] as const).map((tier) => {
              const tierProducts = products!.per_tier_products[tier] ?? [];
              if (!tierProducts.length) return null;
              const label = tier === "budget" ? "Budget" : tier === "balanced" ? "Mid-Range" : "Luxury";
              return (
                <div key={tier} className="mb-6 last:mb-0">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{label}</h3>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {tierProducts.map((p, i) => {
                      const base = "flex gap-3 p-3 rounded-xl border bg-card transition-shadow";
                      const inner = (
                        <>
                          {p.image_url && (
                            <div className="relative h-16 w-16 rounded-lg overflow-hidden bg-muted shrink-0">
                              {canOptimizeImageHost(p.image_url) ? (
                                <Image src={p.image_url} alt={p.title} fill sizes="64px" className="object-cover" />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" />
                              )}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{p.title}</p>
                            <p className="text-xs text-muted-foreground">{p.retailer}</p>
                            {p.price != null && (
                              <p className="text-xs font-semibold mt-0.5 text-accent-warm">${p.price}</p>
                            )}
                          </div>
                        </>
                      );
                      // Only render an anchor when there's a real destination. A
                      // product with no URL becomes a plain card, never a dead
                      // link to "#" — a nowhere-link is a keyboard-focusable dead
                      // end on this public share page. Mirrors picks/page.tsx.
                      return p.product_url ? (
                        <a
                          key={i}
                          href={p.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(base, "hover:shadow-md hover:border-accent-warm/30 cursor-pointer")}
                        >
                          {inner}
                        </a>
                      ) : (
                        <div key={i} className={base}>
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CTA */}
        <div className="rounded-2xl bg-gradient-to-br from-accent-warm/10 to-secondary/60 border border-accent-warm/20 p-8 text-center space-y-4">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-warm/15 mx-auto">
            <Sparkles className="h-6 w-6 text-accent-warm" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Design your space like this</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
              Photo your room and get an AI design direction, curated product picks, and a vision mockup — all in minutes.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/signup">
              <Button variant="warm" size="lg">
                Start designing free
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" size="lg">
                Learn more
              </Button>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">Free on one room. No credit card required.</p>
        </div>
      </PageTransition>
      </main>
    </div>
  );
}
