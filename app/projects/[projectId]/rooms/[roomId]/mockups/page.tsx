"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Image as ImageIcon, Sparkles, X, Maximize2, Download, AlertTriangle, RefreshCw } from "lucide-react";
import { ShareButton } from "@/components/ui/share-button";
import { PageTransition, StaggerList, StaggerItem } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradeCtaCard } from "@/components/billing/upgrade-cta-card";
import { cn } from "@/lib/utils/cn";

interface Mockup {
  id: string;
  result_image_url: string | null;
  prompt: string | null;
  status: string;
  created_at: string;
  generation_provider: string | null;
}

// Honest status labels that cycle while generation runs. The /api/mockups
// endpoint is a single POST with no progress stream, so timed "done" ticks
// lie to users when phases take longer than expected. We rotate descriptors
// without claiming completion until the response arrives.
const GENERATION_ROTATION_LABELS = [
  "Composing scene…",
  "Rendering design…",
  "Enhancing details…",
];

export default function MockupsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [rotationIndex, setRotationIndex] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Set when the server refuses a render because the free-tier mockup cap is
  // spent (403 + subscription_required). Distinct from generateError so the
  // paywall renders as an upgrade path, not as a failure.
  const [atMockupLimit, setAtMockupLimit] = useState(false);
  const [mockupLimit, setMockupLimit] = useState<number | null>(null);

  // Cycle the rotating generation status label while generating.
  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => {
      setRotationIndex((i) => (i + 1) % GENERATION_ROTATION_LABELS.length);
    }, 3500);
    return () => clearInterval(id);
  }, [generating]);

  const loadMockups = useCallback(async () => {
    try {
      const res = await fetch(`/api/mockups?room_id=${roomId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMockups(Array.isArray(data) ? data : []);
      setLoadError(false);
    } catch {
      // Surface the failure instead of silently rendering the "no mockups yet"
      // empty state — a load error the user reads as an empty room has no path
      // to recovery. Existing mockups stay on screen if a later refresh fails.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    loadMockups();
  }, [loadMockups]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setAtMockupLimit(false);
    setRotationIndex(0);

    try {
      const productsRes = await fetch(`/api/products?room_id=${roomId}`);
      if (!productsRes.ok) throw new Error("We couldn't load this room's products. Please try again.");
      // Guard the parse: a malformed/non-JSON body would otherwise throw a raw
      // SyntaxError whose .message reaches the banner. Fall back to the curated
      // message (mirrors products/page.tsx #445's .json().catch()).
      const products = await productsRes.json().catch(() => null);
      if (!Array.isArray(products)) {
        throw new Error("We couldn't load this room's products. Please try again.");
      }
      const selected = products.filter(
        (p: { status: string }) => p.status === "shortlisted" || p.status === "accepted"
      );

      if (selected.length === 0) {
        throw new Error("Shortlist or accept a few products first, then generate a mockup.");
      }

      const res = await fetch("/api/mockups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          product_ids: selected.map((p: { id: string }) => p.id),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          subscription_required?: boolean;
          limit?: number;
        };
        // The free-mockup cap is a paywall, not a transient failure. Routing it
        // through the error banner would tell the user to "try again in a
        // moment" for something that can only ever succeed after an upgrade.
        if (res.status === 403 && body.subscription_required) {
          setMockupLimit(typeof body.limit === "number" ? body.limit : null);
          setAtMockupLimit(true);
          return;
        }
        throw new Error("Mockup generation failed. Please try again in a moment.");
      }
      const data = await res.json().catch(() => null);
      if (!data) throw new Error("Mockup generation failed. Please try again in a moment.");
      setMockups((prev) => [data, ...prev]);
    } catch (err) {
      // The generate button is the core money moment — a silent no-op (spinner
      // stops, nothing appears) reads as a broken product. Surface why.
      setGenerateError(err instanceof Error ? err.message : "Mockup generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 py-8 px-4">
        <div className="space-y-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <PageTransition className="space-y-6 sm:space-y-8">
      <div>
        <Link
          href={`/projects/${projectId}/rooms/${roomId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Room
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-headline">Mockups</h1>
            <p className="text-muted-foreground mt-1">
              AI-generated room visualizations
            </p>
          </div>
          <Button onClick={handleGenerate} disabled={generating} variant="warm">
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Mockup
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Free-tier mockup cap. Server-enforced — this only renders after the
          server's 403, and routes to the real Stripe checkout. */}
      {atMockupLimit && !generating && (
        <UpgradeCtaCard
          reason="mockup"
          usedSaves={mockupLimit ?? undefined}
          limit={mockupLimit ?? undefined}
        />
      )}

      {/* Generation error banner */}
      {generateError && !generating && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive/70 mt-0.5" />
          <p className="text-sm text-foreground">{generateError}</p>
        </div>
      )}

      {/* Generation progress */}
      {generating && (
        <Card variant="elevated" className="animate-fade-in-up">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-accent-warm/20 to-accent-warm/5 flex items-center justify-center animate-float">
                <Sparkles className="h-8 w-8 text-accent-warm" />
              </div>
              <div className="space-y-2 text-center">
                <div className="text-sm font-medium text-accent-warm">
                  {GENERATION_ROTATION_LABELS[rotationIndex]}
                </div>
                <div className="text-xs text-muted-foreground">
                  Image generation usually takes 30–60 seconds.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loadError && mockups.length === 0 && !generating ? (
        <Card className="border-dashed border-2 border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-16 w-16 rounded-3xl bg-destructive/10 flex items-center justify-center mb-5">
              <AlertTriangle className="h-8 w-8 text-destructive/70" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Couldn&apos;t load mockups</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-5">
              Something went wrong loading this room&apos;s mockups. Check your connection and try again.
            </p>
            <Button
              variant="outline"
              onClick={() => { setLoadError(false); setLoading(true); loadMockups(); }}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : mockups.length === 0 && !generating ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-accent-warm/10 to-accent-warm/5 flex items-center justify-center mb-6 animate-float">
              <ImageIcon className="h-10 w-10 text-accent-warm/50" />
            </div>
            <h3 className="text-lg font-semibold mb-2">See it before you buy it</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
              We&apos;ll render your shortlisted pieces right into your actual room — so you know it&apos;s right before spending a dollar.
            </p>
            <Button onClick={handleGenerate} variant="warm" size="lg" className="animate-gentle-glow">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate my first mockup
            </Button>
          </CardContent>
        </Card>
      ) : (
        <StaggerList className="grid gap-6 md:grid-cols-2">
          {mockups.map((mockup) => (
            <StaggerItem key={mockup.id}>
            <Card variant="interactive" className="overflow-hidden">
              {mockup.result_image_url ? (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="View mockup full screen"
                  className="aspect-video w-full overflow-hidden bg-muted relative cursor-pointer group rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setLightboxUrl(mockup.result_image_url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLightboxUrl(mockup.result_image_url);
                    }
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mockup.result_image_url}
                    alt="Room mockup"
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <Maximize2 className="h-5 w-5 text-foreground" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-video w-full flex items-center justify-center bg-muted">
                  {mockup.status === "generating" ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-accent-warm" />
                      <span className="text-xs text-muted-foreground">Generating...</span>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Badge variant={mockup.status === "failed" ? "destructive" : "secondary"}>
                        {mockup.status === "failed" ? "Failed" : "Pending"}
                      </Badge>
                    </div>
                  )}
                </div>
              )}
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    <span>{new Date(mockup.created_at).toLocaleDateString()}</span>
                    <span className="mx-2">·</span>
                    <span className="capitalize font-medium">{mockup.status}</span>
                  </div>
                  <div className="flex gap-1">
                    {mockup.result_image_url && (
                      <>
                        <ShareButton
                          title="Check out my AI room mockup"
                          text="Made with AptDesigner"
                          url={mockup.result_image_url}
                        />
                        <Button size="sm" variant="ghost" asChild aria-label={`Download mockup from ${new Date(mockup.created_at).toLocaleDateString()}`}>
                          <a href={mockup.result_image_url} download target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {mockup.prompt && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
                    {mockup.prompt}
                  </p>
                )}
              </CardContent>
            </Card>
            </StaggerItem>
          ))}
        </StaggerList>
      )}

      {/* Fullscreen Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-5xl p-0 bg-black/95 border-none">
          {lightboxUrl && (
            <LightboxImage url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
          )}
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}

// Click-to-zoom lightbox. Defaults to fit-in-viewport; clicking the image
// toggles a 2x zoom anchored at the click point so users can inspect
// renderings at detail. Esc (handled by Dialog) or the close button exits.
function LightboxImage({ url, onClose }: { url: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number }>({ x: 50, y: 50 });

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (zoomed) {
      setZoomed(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setOrigin({ x, y });
    setZoomed(true);
  };

  return (
    <div className="relative overflow-hidden max-h-[90vh]">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 z-10 text-white hover:bg-white/20"
        onClick={onClose}
        aria-label="Close fullscreen view"
      >
        <X className="h-5 w-5" />
      </Button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Room mockup (click to zoom)"
        className={cn(
          "w-full h-auto max-h-[90vh] object-contain transition-transform duration-300",
          zoomed ? "cursor-zoom-out scale-[2]" : "cursor-zoom-in"
        )}
        style={zoomed ? { transformOrigin: `${origin.x}% ${origin.y}%` } : undefined}
        onClick={handleClick}
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-white/60 bg-black/50 px-3 py-1 rounded-full pointer-events-none">
        {zoomed ? "Click to zoom out" : "Click to zoom in"}
      </div>
    </div>
  );
}
