"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  ArrowRight,
  Bookmark,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Share2,
  Check,
  Lock,
  Globe,
} from "lucide-react";
import { PageTransition } from "@/components/ui/motion";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import {
  PRIORITY_ORDER,
  priorityBadge,
  ASSESSMENT_PANEL,
} from "@/lib/utils/assessment-colors";

interface SavedDesignFull {
  id: string;
  title: string;
  room_type: string | null;
  stage: "assessment" | "full";
  project_id: string | null;
  room_id: string | null;
  thumbnail_url: string | null;
  share_token: string | null;
  is_public: boolean;
  snapshot: {
    assessment: {
      what_it_needs: Array<{
        category: string;
        search_title?: string;
        description: string;
        priority: string;
        specs: string;
      }>;
      what_works: string[];
      what_should_go: string[];
      design_direction: string;
      room_description: string;
      mockup_url?: string | null;
    };
    products?: {
      bundles: unknown[];
      per_tier_products: Record<string, Array<{
        id: string;
        title: string;
        price: number | null;
        retailer: string;
        product_url: string | null;
        image_url: string | null;
        category: string;
      }>>;
    };
    metadata: {
      saved_at: string;
      project_name?: string;
      building_name?: string;
    };
  };
  created_at: string;
  updated_at: string;
}

export default function SavedDesignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [design, setDesign] = useState<SavedDesignFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => { setOrigin(window.location.origin); }, []);

  useEffect(() => {
    fetch(`/api/saved-designs/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data: SavedDesignFull) => {
        setDesign(data);
        setShareToken(data.share_token ?? null);
        setIsPublic(data.is_public ?? false);
      })
      .catch(() => router.push("/saved"))
      .finally(() => setLoading(false));
  }, [id, router]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/saved-designs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Surface the failure instead of silently resetting the button — the
        // design is still saved, so the user must not be left thinking it's gone.
        toast.error("Couldn't delete design", "Please try again in a moment.");
        setDeleting(false);
        return;
      }
      router.push("/saved");
    } catch {
      toast.error("Couldn't delete design", "Check your connection and try again.");
      setDeleting(false);
    }
  };

  const handleToggleShare = async (enable: boolean) => {
    setSharing(true);
    try {
      const res = await fetch(`/api/saved-designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: enable }),
      });
      if (!res.ok) {
        // The share state didn't change on the server — tell the user rather
        // than resetting the toggle as if it succeeded.
        toast.error(
          enable ? "Couldn't create share link" : "Couldn't make private",
          "Please try again in a moment.",
        );
        return;
      }
      const data = await res.json() as { share_token: string | null; is_public: boolean };
      setShareToken(data.share_token ?? null);
      setIsPublic(data.is_public);
    } catch {
      toast.error("Couldn't update sharing", "Check your connection and try again.");
    } finally {
      setSharing(false);
    }
  };

  // origin is set in a useEffect to avoid hydration mismatch (window is unavailable during SSR)
  const shareUrl = shareToken && origin ? `${origin}/shared/${shareToken}` : null;

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: design?.title ?? "My room design", url: shareUrl });
        return;
      } catch { /* user cancelled */ }
    }
    await navigator.clipboard.writeText(shareUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  if (loading || !design) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { assessment, products, metadata } = design.snapshot;
  const sortedItems = [...(assessment.what_it_needs || [])].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
  );

  return (
    <PageTransition className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/saved">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to saved designs">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Bookmark className="h-5 w-5 text-accent-warm" />
              {design.title}
            </h1>
            <div className="flex items-center gap-2 mt-0.5 text-sm text-muted-foreground">
              {design.room_type && <span className="capitalize">{design.room_type.replace(/_/g, " ")}</span>}
              {metadata.building_name && <><span>·</span><span>{metadata.building_name}</span></>}
              <span>·</span>
              <span>{new Date(design.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              <Badge variant={design.stage === "full" ? "default" : "secondary"} className="text-[10px] ml-1">
                {design.stage === "full" ? "Full Design" : "Assessment Only"}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {design.stage === "assessment" && design.project_id && design.room_id && (
            <Link href={`/projects/${design.project_id}/rooms/${design.room_id}/focus`}>
              <Button size="sm">
                Resume — find products <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          )}
          {/* Share toggle */}
          <Button
            variant={isPublic ? "warm-outline" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => handleToggleShare(!isPublic)}
            disabled={sharing}
          >
            {sharing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isPublic ? (
              <Globe className="h-3.5 w-3.5" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            {isPublic ? "Shared" : "Share"}
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={handleDelete} disabled={deleting} aria-label="Delete design">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Share panel — visible when sharing is enabled */}
      {isPublic && shareUrl && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-accent-warm/30 bg-accent-warm/5">
          <Globe className="h-4 w-4 text-accent-warm shrink-0" />
          <p className="text-xs text-muted-foreground flex-1 truncate">{shareUrl}</p>
          <Button variant="warm-ghost" size="sm" className="shrink-0 gap-1" onClick={handleCopyLink}>
            {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {linkCopied ? "Copied!" : "Copy link"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs text-muted-foreground gap-1"
            onClick={() => handleToggleShare(false)}
            disabled={sharing}
          >
            <Lock className="h-3 w-3" />
            Make private
          </Button>
        </div>
      )}

      {/* Mockup image */}
      {assessment.mockup_url && (
        <div className="overflow-hidden rounded-2xl border shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assessment.mockup_url} alt="Room vision mockup" className="w-full max-h-[400px] object-cover" />
        </div>
      )}

      {/* Design assessment */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Design Assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {assessment.room_description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{assessment.room_description}</p>
          )}

          {/* What to get */}
          <div>
            <h2 className="text-sm font-semibold mb-2">What to get</h2>
            <div className="space-y-2">
              {sortedItems.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Badge className={cn("text-[10px] shrink-0 mt-0.5", priorityBadge(item.priority))}>
                    {item.priority}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.search_title || item.category}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    {item.specs && <p className="text-xs text-muted-foreground mt-1 font-mono">{item.specs}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Keep / Remove */}
          {assessment.what_works.length > 0 && (
            <div>
              <h2 className={cn("text-sm font-semibold mb-2 flex items-center gap-1.5", ASSESSMENT_PANEL.keep.heading)}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Keep
              </h2>
              <ul className="space-y-1">
                {assessment.what_works.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className={cn("mt-1", ASSESSMENT_PANEL.keep.marker)}>·</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {assessment.what_should_go.length > 0 && (
            <div>
              <h2 className={cn("text-sm font-semibold mb-2 flex items-center gap-1.5", ASSESSMENT_PANEL.replace.heading)}>
                <XCircle className="h-3.5 w-3.5" /> Replace or remove
              </h2>
              <ul className="space-y-1">
                {assessment.what_should_go.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className={cn("mt-1", ASSESSMENT_PANEL.replace.marker)}>·</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Design direction */}
          {assessment.design_direction && (
            <div>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-accent-warm" /> Design Direction
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{assessment.design_direction}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Products (if full stage) */}
      {products && Object.values(products.per_tier_products).some((arr) => (arr as unknown[]).length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Product Selections</CardTitle>
          </CardHeader>
          <CardContent>
            {(["budget", "balanced", "high_end"] as const).map((tier) => {
              const tierProducts = (products.per_tier_products[tier] || []) as Array<{
                title: string;
                price: number | null;
                retailer: string;
                product_url: string | null;
                image_url: string | null;
                category: string;
              }>;
              if (tierProducts.length === 0) return null;

              const tierLabel = tier === "budget" ? "Budget" : tier === "balanced" ? "Mid-Range" : "Luxury";

              return (
                <div key={tier} className="mb-6 last:mb-0">
                  <h3 className="text-sm font-semibold mb-2">{tierLabel}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {tierProducts.map((p, i) => (
                      <div key={i} className="flex gap-3 p-2 rounded-lg border bg-background">
                        {p.image_url && (
                          <div className="h-16 w-16 rounded-lg overflow-hidden bg-muted shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.title}</p>
                          <p className="text-xs text-muted-foreground">{p.retailer}</p>
                          {p.price && <p className="text-xs font-medium mt-0.5">${p.price}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </PageTransition>
  );
}
