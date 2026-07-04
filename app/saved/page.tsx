"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageTransition, StaggerList, StaggerItem } from "@/components/ui/motion";
import { SkeletonCard } from "@/components/ui/skeleton";
import { UpgradeCtaCard } from "@/components/billing/upgrade-cta-card";
import { toast } from "@/components/ui/toast";
import { Loader2, Bookmark, Trash2, ArrowRight, ArrowLeft, Download, AlertCircle } from "lucide-react";

interface SavedDesignItem {
  id: string;
  title: string;
  room_type: string | null;
  stage: "assessment" | "full";
  thumbnail_url: string | null;
  project_id: string | null;
  room_id: string | null;
  created_at: string;
  updated_at: string;
}

interface BillingStatus {
  hasPaid: boolean;
  tier: string | null;
  savedCount: number;
  limit: number;
}

export default function SavedDesignsPage() {
  const [designs, setDesigns] = useState<SavedDesignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  // Bumping this re-triggers the fetch effect for a retry after a load failure.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    fetch("/api/saved-designs")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        // Guard against an error body (non-array) so the empty state never
        // masks a failed load.
        if (!Array.isArray(data)) throw new Error("Unexpected response");
        setDesigns(data as SavedDesignItem[]);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Plan + free-tier usage drive the in-product upgrade surface below. Failure
  // is non-blocking — the page works without it; the upsell just doesn't show.
  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BillingStatus | null) => setBilling(data))
      .catch(() => {});
  }, []);

  const handleExportCsv = () => {
    if (!designs.length) return;
    const header = ["Title", "Room Type", "Stage", "Date", "Project ID", "Room ID"];
    const rows = designs.map((d) => [
      `"${(d.title ?? "").replace(/"/g, '""')}"`,
      d.room_type ?? "",
      d.stage,
      new Date(d.updated_at).toLocaleDateString("en-US"),
      d.project_id ?? "",
      d.room_id ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-designs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this saved design? This can't be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/saved-designs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDesigns((prev) => prev.filter((d) => d.id !== id));
    } catch {
      // Surface the failure — never leave the user believing a delete that
      // failed actually succeeded.
      toast.error("Couldn't delete design", "Something went wrong. Please try again.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <PageTransition className="max-w-4xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Designs</h1>
            <p className="text-sm text-muted-foreground">Your saved room assessments and product selections</p>
          </div>
        </div>
        {designs.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </div>

      {billing && !billing.hasPaid && (
        <UpgradeCtaCard usedSaves={billing.savedCount} limit={billing.limit} className="mb-8" />
      )}

      {loading ? (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : loadError ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive/40 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">Couldn&apos;t load your designs</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Something went wrong reaching your saved designs. This is usually temporary.
            </p>
            <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : designs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Bookmark className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">No saved designs yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              When you complete a room assessment or product search, save it here for later.
            </p>
            <Link href="/dashboard">
              <Button variant="outline">Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <StaggerList className="grid gap-4 sm:grid-cols-2">
          {designs.map((design) => (
            <StaggerItem key={design.id}>
            <Card className="group hover:shadow-md transition-shadow overflow-hidden">
              {design.thumbnail_url && (
                <div className="h-36 overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={design.thumbnail_url}
                    alt={design.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              )}
              <CardContent className={design.thumbnail_url ? "pt-3" : "pt-5"}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate">{design.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {design.room_type && (
                        <span className="text-xs text-muted-foreground capitalize">{design.room_type.replace(/_/g, " ")}</span>
                      )}
                      <Badge variant={design.stage === "full" ? "default" : "secondary"} className="text-[10px]">
                        {design.stage === "full" ? "Full Design" : "Assessment"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(design.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(design.id)}
                      disabled={deleting === design.id}
                      aria-label={`Delete ${design.title}`}
                    >
                      {deleting === design.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2 sm:gap-2.5 mt-3">
                  <Link href={`/saved/${design.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs">
                      View
                    </Button>
                  </Link>
                  {design.stage === "assessment" && design.project_id && design.room_id && (
                    <Link href={`/projects/${design.project_id}/rooms/${design.room_id}/focus`} className="flex-1">
                      <Button size="sm" className="w-full text-xs">
                        Resume <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </PageTransition>
  );
}
