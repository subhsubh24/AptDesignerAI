"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Plus, Sparkles, LayoutGrid } from "lucide-react";
import { getScoreColor } from "@/lib/scoring/verdicts";
import { PageTransition, ScrollReveal } from "@/components/ui/motion";
import { SkeletonBundleCard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

// Pure SVG radar chart component
function RadarChart({ scores }: { scores: { label: string; value: number }[] }) {
  const size = 140;
  const center = size / 2;
  const radius = 50;
  const angleStep = (2 * Math.PI) / scores.length;

  const getPoint = (index: number, value: number) => {
    const angle = angleStep * index - Math.PI / 2;
    const r = (value / 10) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const dataPoints = scores.map((s, i) => getPoint(i, s.value));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[140px] mx-auto">
      {/* Grid */}
      {gridLevels.map((level) => {
        const points = scores.map((_, i) => getPoint(i, level * 10));
        const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
        return (
          <path key={level} d={path} fill="none" stroke="var(--border)" strokeWidth="0.5" opacity={0.5} />
        );
      })}

      {/* Axis lines */}
      {scores.map((_, i) => {
        const p = getPoint(i, 10);
        return (
          <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth="0.5" opacity={0.3} />
        );
      })}

      {/* Data polygon */}
      <path d={dataPath} fill="var(--accent-warm)" fillOpacity={0.15} stroke="var(--accent-warm)" strokeWidth="1.5" />

      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--accent-warm)" />
      ))}

      {/* Labels */}
      {scores.map((s, i) => {
        const labelPoint = getPoint(i, 12.5);
        return (
          <text
            key={i}
            x={labelPoint.x}
            y={labelPoint.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-[8px] fill-muted-foreground font-medium"
          >
            {s.label}
          </text>
        );
      })}
    </svg>
  );
}

export default function BundlesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [bundles, setBundles] = useState<Array<{
    id: string;
    name: string;
    status: string;
    product_bundle_items: Array<{
      candidate_products: {
        id: string;
        title: string;
        category: string;
        image_url: string;
        price: number;
        retailer: string;
      };
    }>;
    bundle_evaluations: Array<{
      final_bundle_score: number;
      verdict: string;
      palette_harmony_score: number;
      material_balance_score: number;
      scale_balance_score: number;
      style_consistency_score: number;
      room_completion_score: number;
      practicality_score: number;
      analysis: {
        strongest_aspect: string;
        weakest_aspect: string;
        what_feels_missing: string;
        what_should_be_swapped_first: string;
      };
      room_vibe?: {
        vibe_summary: string;
        style_keywords: string[];
        color_story: string;
        mood: string;
      } | null;
    }>;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [evaluating, setEvaluating] = useState<string | null>(null);

  const loadBundles = async () => {
    const res = await fetch(`/api/bundles?room_id=${roomId}`);
    if (res.ok) setBundles(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    loadBundles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const handleCreateFromShortlisted = async () => {
    setCreating(true);
    try {
      const productsRes = await fetch(`/api/products?room_id=${roomId}`);
      if (!productsRes.ok) return;
      const products = await productsRes.json();
      const shortlisted = products.filter(
        (p: { status: string }) => p.status === "shortlisted" || p.status === "accepted"
      );

      if (shortlisted.length === 0) return;

      await fetch("/api/bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          name: `Bundle ${bundles.length + 1}`,
          product_ids: shortlisted.map((p: { id: string }) => p.id),
        }),
      });
      loadBundles();
    } finally {
      setCreating(false);
    }
  };

  const handleEvaluate = async (bundleId: string) => {
    setEvaluating(bundleId);
    try {
      await fetch("/api/bundles/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle_id: bundleId }),
      });
      loadBundles();
    } finally {
      setEvaluating(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 py-8 px-4">
        <div className="space-y-3">
          <div className="skeleton-pulse h-8 w-32 rounded-lg" />
          <div className="skeleton-pulse h-4 w-56 rounded-lg" />
        </div>
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <SkeletonBundleCard key={i} />
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
            <h1 className="text-headline">Bundles</h1>
            <p className="text-muted-foreground mt-1">
              Room concepts with holistic scoring
            </p>
          </div>
          <Button onClick={handleCreateFromShortlisted} disabled={creating} variant="warm">
            {creating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Bundle from Shortlisted
          </Button>
        </div>
      </div>

      {bundles.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-20 text-center">
            <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-accent-warm/10 to-accent-warm/5 flex items-center justify-center mb-5 mx-auto animate-float">
              <LayoutGrid className="h-8 w-8 text-accent-warm/50" />
            </div>
            <h3 className="text-lg font-semibold mb-2">See the room come together</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Shortlist a few products, then create a bundle to see how they harmonize — palette, proportion, style cohesion, all scored.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {bundles.map((bundle, idx) => {
            const evaluation = bundle.bundle_evaluations?.[0];
            const products = bundle.product_bundle_items?.map(
              (item) => item.candidate_products
            ) || [];

            return (
              <ScrollReveal key={bundle.id} delay={idx * 0.08}>
              <Card variant="elevated" className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{bundle.name || "Untitled Bundle"}</CardTitle>
                    {evaluation ? (
                      <div className="flex items-center gap-2">
                        <span className={cn("text-3xl font-bold animate-score-pop", getScoreColor(evaluation.final_bundle_score))}>
                          {evaluation.final_bundle_score.toFixed(1)}
                        </span>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="warm"
                        onClick={() => handleEvaluate(bundle.id)}
                        disabled={evaluating === bundle.id}
                      >
                        {evaluating === bundle.id ? (
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1.5" />
                        )}
                        Score Bundle
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Product carousel */}
                  <div className="relative">
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 snap-x scrollbar-hide">
                    {products.map((product) => (
                      <div key={product.id} className="shrink-0 w-28 snap-start space-y-2">
                        {product.image_url && (
                          <div className="aspect-square rounded-xl overflow-hidden bg-muted shadow-sm">
                            <img
                              src={product.image_url}
                              alt={product.title}
                              className="h-full w-full object-cover hover:scale-105 transition-transform duration-300"
                            />
                          </div>
                        )}
                        <p className="text-xs font-medium line-clamp-2">{product.title}</p>
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {product.category?.replace(/_/g, " ")}
                          </Badge>
                          {product.price && (
                            <span className="text-xs text-muted-foreground font-medium">${product.price}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {products.length > 3 && (
                    <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-card to-transparent pointer-events-none" />
                  )}
                  </div>

                  {evaluation && (
                    <div className="space-y-5 border-t pt-5">
                      {/* Radar chart + score metrics side by side */}
                      <div className="grid md:grid-cols-[auto_1fr] gap-6 items-center">
                        <RadarChart
                          scores={[
                            { label: "Palette", value: evaluation.palette_harmony_score },
                            { label: "Material", value: evaluation.material_balance_score },
                            { label: "Scale", value: evaluation.scale_balance_score },
                            { label: "Style", value: evaluation.style_consistency_score },
                            { label: "Complete", value: evaluation.room_completion_score },
                            { label: "Practical", value: evaluation.practicality_score },
                          ]}
                        />
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: "Palette", score: evaluation.palette_harmony_score },
                            { label: "Material", score: evaluation.material_balance_score },
                            { label: "Scale", score: evaluation.scale_balance_score },
                            { label: "Style", score: evaluation.style_consistency_score },
                            { label: "Completion", score: evaluation.room_completion_score },
                            { label: "Practical", score: evaluation.practicality_score },
                          ].map((s) => (
                            <div key={s.label} className="text-center p-3 rounded-xl bg-muted/50">
                              <div className={cn("text-lg font-bold", getScoreColor(s.score))}>
                                {s.score.toFixed(1)}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {evaluation.analysis && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="text-sm rounded-xl bg-emerald-50 dark:bg-emerald-950/50 p-4 border border-emerald-200/50 dark:border-emerald-800/50">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-300">Strongest: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.strongest_aspect}</span>
                          </div>
                          <div className="text-sm rounded-xl bg-amber-50 dark:bg-amber-950/50 p-4 border border-amber-200/50 dark:border-amber-800/50">
                            <span className="font-semibold text-amber-700 dark:text-amber-300">Weakest: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.weakest_aspect}</span>
                          </div>
                          <div className="text-sm rounded-xl bg-muted/50 p-4">
                            <span className="font-medium">Missing: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.what_feels_missing}</span>
                          </div>
                          <div className="text-sm rounded-xl bg-muted/50 p-4">
                            <span className="font-medium">Swap First: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.what_should_be_swapped_first}</span>
                          </div>
                        </div>
                      )}

                      {evaluation.room_vibe && (
                        <div className="space-y-3 border-t pt-5">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-accent-warm" />
                            <h4 className="text-sm font-semibold">Room Vibe</h4>
                            {evaluation.room_vibe.mood && (
                              <Badge variant="warm" className="text-xs">
                                {evaluation.room_vibe.mood}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {evaluation.room_vibe.vibe_summary}
                          </p>
                          {evaluation.room_vibe.style_keywords?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {evaluation.room_vibe.style_keywords.map((kw) => (
                                <Badge key={kw} variant="outline" className="text-xs bg-accent-warm/5">
                                  {kw}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {evaluation.room_vibe.color_story && (
                            <p className="text-sm text-muted-foreground italic border-l-2 border-accent-warm/30 pl-3">
                              {evaluation.room_vibe.color_story}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              </ScrollReveal>
            );
          })}
        </div>
      )}
    </PageTransition>
  );
}
