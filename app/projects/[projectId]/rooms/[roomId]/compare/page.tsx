"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, GitCompare, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VERDICT_LABELS, VERDICT_COLORS, getScoreColor, getScoreBgColor } from "@/lib/scoring/verdicts";
import { PageTransition } from "@/components/ui/motion";
import { SkeletonCompareRow } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import type { Verdict } from "@/lib/types/scoring";

interface ProductWithEval {
  id: string;
  title: string | null;
  category: string | null;
  retailer: string | null;
  image_url: string | null;
  price: number | null;
  materials: string[] | null;
  status: string;
  product_evaluations: Array<{
    final_item_score: number;
    verdict: Verdict;
    confidence_score: number;
    style_fit_score: number;
    palette_fit_score: number;
    material_fit_score: number;
    scale_fit_score: number;
    function_fit_score: number;
    cohesion_fit_score: number;
    value_fit_score: number;
    reasoning: { top_reasons: string[]; risks: string[] };
  }>;
}

const SCORE_LABELS = [
  { key: "style_fit_score", label: "Style Fit" },
  { key: "palette_fit_score", label: "Palette Fit" },
  { key: "material_fit_score", label: "Material Fit" },
  { key: "scale_fit_score", label: "Scale Fit" },
  { key: "function_fit_score", label: "Function Fit" },
  { key: "cohesion_fit_score", label: "Cohesion Fit" },
  { key: "value_fit_score", label: "Value Fit" },
  { key: "confidence_score", label: "Confidence" },
] as const;

type SortKey = typeof SCORE_LABELS[number]["key"] | "final_item_score" | null;

function SortIcon({ k, sortKey, sortDir }: { k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc" }) {
  if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  return sortDir === "desc" ? <ArrowDown className="h-3 w-3 text-accent-warm" /> : <ArrowUp className="h-3 w-3 text-accent-warm" />;
}

export default function ComparePage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [products, setProducts] = useState<ProductWithEval[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/products?room_id=${roomId}`);
        if (!res.ok) throw new Error(`products request failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        // Clear any prior error — a later room whose fetch succeeds must not keep
        // showing the error card from an earlier failed room (roomId is a dep).
        setLoadError(false);
        setProducts(
          (Array.isArray(data) ? data : []).filter(
            (p: ProductWithEval) =>
              p.product_evaluations?.length > 0 &&
              (p.status === "evaluated" || p.status === "shortlisted")
          )
        );
      } catch {
        // Surface a retryable error instead of falling through to the "No
        // products to compare" empty state, which would hide the real failure.
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [roomId, reloadKey]);

  const handleRetry = () => {
    setLoading(true);
    setLoadError(false);
    setReloadKey((k) => k + 1);
  };

  const sortedProducts = useMemo(() => {
    if (!sortKey) return products;
    return [...products].sort((a, b) => {
      const evalA = a.product_evaluations[0];
      const evalB = b.product_evaluations[0];
      const valA = sortKey === "final_item_score" ? evalA.final_item_score : evalA[sortKey];
      const valB = sortKey === "final_item_score" ? evalB.final_item_score : evalB[sortKey];
      return sortDir === "desc" ? valB - valA : valA - valB;
    });
  }, [products, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Announce the sort control's action + current state to assistive tech.
  const sortLabel = (label: string, key: SortKey) => {
    if (sortKey !== key) return `Sort by ${label}`;
    return `Sorted by ${label}, ${sortDir === "desc" ? "highest first" : "lowest first"}. Activate to reverse.`;
  };

  // Get min/max for each score dimension to highlight best/worst
  const scoreExtremes = useMemo(() => {
    const extremes: Record<string, { min: number; max: number }> = {};
    if (products.length < 2) return extremes;

    for (const { key } of SCORE_LABELS) {
      const scores = products.map((p) => p.product_evaluations[0]?.[key] ?? 0);
      extremes[key] = { min: Math.min(...scores), max: Math.max(...scores) };
    }
    return extremes;
  }, [products]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 py-8 px-4">
        <div className="space-y-3">
          <div className="skeleton-pulse h-8 w-48 rounded-lg" />
          <div className="skeleton-pulse h-4 w-64 rounded-lg" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <SkeletonCompareRow key={i} />
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
        <h1 className="text-headline">Compare Products</h1>
        <p className="text-muted-foreground mt-1">
          Side-by-side comparison of scored products
        </p>
      </div>

      {loadError ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-20 text-center">
            <div className="h-16 w-16 rounded-3xl bg-destructive/10 flex items-center justify-center mb-5 mx-auto">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load products</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Something went wrong fetching the scored products. Please try again.
            </p>
            <Button onClick={handleRetry} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : sortedProducts.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-20 text-center">
            <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-accent-warm/10 to-accent-warm/5 flex items-center justify-center mb-5 mx-auto animate-float">
              <GitCompare className="h-8 w-8 text-accent-warm/50" />
            </div>
            <h2 className="text-lg font-semibold mb-2">No products to compare</h2>
            <p className="text-sm text-muted-foreground">
              Score some products first, then come back to compare.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop Table */}
          <Card className="overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-4 border-b font-medium text-sm text-muted-foreground w-40 bg-muted/30">
                      Dimension
                    </th>
                    {sortedProducts.map((product) => (
                      <th key={product.id} className="p-4 border-b text-center min-w-[180px] bg-muted/30">
                        <div className="space-y-2.5">
                          {product.image_url && (
                            <div className="mx-auto w-20 h-20 rounded-xl overflow-hidden bg-background shadow-sm">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={product.image_url}
                                alt={product.title || ""}
                                className="h-full w-full object-contain"
                              />
                            </div>
                          )}
                          <p className="text-sm font-medium line-clamp-2">
                            {product.title || "Untitled"}
                          </p>
                          {product.price && (
                            <p className="text-xs text-muted-foreground font-medium">${product.price}</p>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-muted/20 hover:bg-muted/30 transition-colors">
                    <td className="p-4 border-b font-semibold text-sm">
                      <button
                        type="button"
                        onClick={() => handleSort("final_item_score")}
                        aria-label={sortLabel("Overall Score", "final_item_score")}
                        className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Overall Score <SortIcon k="final_item_score" sortKey={sortKey} sortDir={sortDir} />
                      </button>
                    </td>
                    {sortedProducts.map((product) => {
                      const e = product.product_evaluations[0];
                      return (
                        <td key={product.id} className="p-4 border-b text-center">
                          <span className={cn("text-2xl font-bold", getScoreColor(e.final_item_score))}>
                            {e.final_item_score.toFixed(1)}
                          </span>
                          <div className="mt-1.5">
                            <Badge className={VERDICT_COLORS[e.verdict]}>
                              {VERDICT_LABELS[e.verdict]}
                            </Badge>
                          </div>
                        </td>
                      );
                    })}
                  </tr>

                  {SCORE_LABELS.map(({ key, label }) => (
                    <tr
                      key={key}
                      className="hover:bg-muted/10 transition-colors"
                    >
                      <td className="p-4 border-b text-sm text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => handleSort(key)}
                          aria-label={sortLabel(label, key)}
                          className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {label} <SortIcon k={key} sortKey={sortKey} sortDir={sortDir} />
                        </button>
                      </td>
                      {sortedProducts.map((product) => {
                        const score = product.product_evaluations[0]?.[key] ?? 0;
                        const extreme = scoreExtremes[key];
                        const isBest = extreme && products.length > 1 && score === extreme.max && extreme.max !== extreme.min;
                        const isWorst = extreme && products.length > 1 && score === extreme.min && extreme.max !== extreme.min;
                        return (
                          <td
                            key={product.id}
                            className={cn(
                              "p-4 border-b text-center",
                              // Emphasis, not hue-coding. Best gets the single
                              // warm accent the rest of the system uses for
                              // "look here"; lowest gets no surface at all,
                              // because de-emphasis IS the other end of that
                              // ladder. The pair this replaces (emerald for
                              // best, amber for lowest) was two competing
                              // accents encoding ordinal data — the same
                              // anti-pattern already converted out of
                              // tier-colors.ts and ManualScorecardView.
                              isBest && "bg-accent-warm/10"
                            )}
                          >
                            <div className="space-y-1">
                              <span className={cn("font-semibold", getScoreColor(score))}>
                                {score.toFixed(1)}
                              </span>
                              <div className="score-bar mx-auto w-16">
                                <div
                                  className={cn(
                                    "score-bar-fill",
                                    getScoreBgColor(score)
                                  )}
                                  style={{ width: `${score * 10}%` }}
                                />
                              </div>
                              {/* A tinted cell was the ONLY thing marking best
                                  and lowest, so the ranking simply did not
                                  exist for anyone who cannot separate the two
                                  tints — WCAG 1.4.1. A visible word carries it
                                  for everyone, and reaches assistive tech
                                  without a parallel sr-only copy to drift. */}
                              {isBest && (
                                <span className="block text-[10px] font-medium uppercase tracking-wide text-accent-warm">
                                  Best
                                </span>
                              )}
                              {isWorst && (
                                <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Lowest
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  <tr className="hover:bg-muted/10 transition-colors">
                    <td className="p-4 border-b text-sm text-muted-foreground">Top Reason</td>
                    {sortedProducts.map((product) => {
                      const e = product.product_evaluations[0];
                      return (
                        <td key={product.id} className="p-4 border-b text-center">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {e?.reasoning?.top_reasons?.[0] || "-"}
                          </p>
                        </td>
                      );
                    })}
                  </tr>

                  <tr className="hover:bg-muted/10 transition-colors">
                    <td className="p-4 border-b text-sm text-muted-foreground">Top Risk</td>
                    {sortedProducts.map((product) => {
                      const e = product.product_evaluations[0];
                      return (
                        <td key={product.id} className="p-4 border-b text-center">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {e?.reasoning?.risks?.[0] || "-"}
                          </p>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {sortedProducts.map((product) => {
              const e = product.product_evaluations[0];
              return (
                <Card key={product.id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      {product.image_url && (
                        <div className="w-16 h-16 rounded-xl overflow-hidden bg-muted shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={product.image_url}
                            alt={product.title || ""}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm line-clamp-2">{product.title || "Untitled"}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          {product.price && <span className="text-xs font-semibold">${product.price}</span>}
                          <Badge className={cn(VERDICT_COLORS[e.verdict], "text-[10px]")}>
                            {VERDICT_LABELS[e.verdict]}
                          </Badge>
                        </div>
                      </div>
                      <span className={cn("text-2xl font-bold", getScoreColor(e.final_item_score))}>
                        {e.final_item_score.toFixed(1)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {SCORE_LABELS.slice(0, 7).map(({ key, label }) => {
                      const score = e[key];
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
                          <div className="score-bar flex-1">
                            <div
                              className={cn(
                                "score-bar-fill",
                                getScoreBgColor(score)
                              )}
                              style={{ width: `${score * 10}%` }}
                            />
                          </div>
                          <span className={cn("text-xs font-semibold w-6 text-right tabular-nums", getScoreColor(score))}>
                            {score.toFixed(0)}
                          </span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </PageTransition>
  );
}
