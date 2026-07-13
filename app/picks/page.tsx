"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, Download, Star } from "lucide-react";
import { getScoreColor } from "@/lib/scoring/verdicts";
import { PageTransition, StaggerList, StaggerItem } from "@/components/ui/motion";
import { SkeletonCard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

interface PickProduct {
  id: string;
  title: string;
  category: string | null;
  price: number | null;
  image_url: string | null;
  product_url: string | null;
  status: string;
  room_id: string;
  room_name: string;
  room_type: string | null;
  product_evaluations?: Array<{ final_item_score: number }>;
}

export default function PicksPage() {
  const [picks, setPicks] = useState<PickProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [roomFilter, setRoomFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/picks")
      .then(async (r) => {
        if (!r.ok) throw new Error(`picks fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data: PickProduct[]) => {
        if (cancelled) return;
        // Guard against a non-array payload (e.g. an error object) reaching the
        // downstream .forEach/.filter — surface it as an error, not an empty state.
        if (!Array.isArray(data)) throw new Error("picks response was not a list");
        setPicks(data);
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

  // Reset load state in the handler (not synchronously in the effect) before
  // re-triggering the fetch, so the effect stays side-effect-free on entry.
  const handleRetry = () => {
    setLoading(true);
    setLoadError(false);
    setReloadKey((k) => k + 1);
  };

  const rooms = useMemo(() => {
    const seen = new Map<string, string>();
    picks.forEach((p) => seen.set(p.room_id, p.room_name));
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [picks]);

  const filtered = useMemo(
    () => roomFilter === "all" ? picks : picks.filter((p) => p.room_id === roomFilter),
    [picks, roomFilter]
  );

  const handleExportCsv = () => {
    if (!filtered.length) return;
    const header = ["Title", "Category", "Price", "Score", "Room", "Status", "URL"];
    const rows = filtered.map((p) => [
      `"${(p.title ?? "").replace(/"/g, '""')}"`,
      p.category ?? "",
      p.price != null ? `$${p.price}` : "",
      p.product_evaluations?.[0]?.final_item_score?.toFixed(1) ?? "",
      `"${p.room_name.replace(/"/g, '""')}"`,
      p.status,
      p.product_url ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-picks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageTransition>
      <main className="max-w-5xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Picks</h1>
            <p className="text-sm text-muted-foreground">Shortlisted products across all your rooms</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {/* Room filter */}
          {rooms.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setRoomFilter("all")}
                aria-pressed={roomFilter === "all"}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all duration-200 active:scale-95",
                  roomFilter === "all"
                    ? "border-accent-warm bg-accent-warm text-white shadow-sm"
                    : "border-border hover:border-accent-warm/50 hover:bg-secondary"
                )}
              >
                All rooms
              </button>
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRoomFilter(r.id)}
                  aria-pressed={roomFilter === r.id}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all duration-200 active:scale-95",
                    roomFilter === r.id
                      ? "border-accent-warm bg-accent-warm text-white shadow-sm"
                      : "border-border hover:border-accent-warm/50 hover:bg-secondary"
                  )}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
          {filtered.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5 shrink-0">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : loadError ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Star className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">Couldn&apos;t load your picks</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Something went wrong fetching your shortlisted products. Please try again.
            </p>
            <Button variant="outline" onClick={handleRetry}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Star className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">No picks yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Shortlist products from your room searches — they&apos;ll all appear here.
            </p>
            <Link href="/dashboard">
              <Button variant="outline">Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <StaggerList className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const score = p.product_evaluations?.[0]?.final_item_score;
            return (
              <StaggerItem key={p.id}>
              <Card className="overflow-hidden group hover:shadow-md transition-shadow">
                {p.image_url && (
                  <div className="h-40 overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.image_url}
                      alt={p.title || "Product"}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <CardContent className={p.image_url ? "pt-3" : "pt-5"}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm leading-tight line-clamp-2">{p.title}</p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {p.category && (
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {p.category.replace(/_/g, " ")}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{p.room_name}</span>
                      </div>
                    </div>
                    {score != null && (
                      <span className={cn("text-sm font-bold tabular-nums shrink-0", getScoreColor(score))}>
                        {score.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    {p.price != null ? (
                      <span className="text-sm font-semibold">${p.price.toLocaleString()}</span>
                    ) : (
                      <span />
                    )}
                    {p.product_url && (
                      <a
                        href={p.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View ${p.title} on retailer site`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
              </StaggerItem>
            );
          })}
        </StaggerList>
      )}
      </main>
    </PageTransition>
  );
}
