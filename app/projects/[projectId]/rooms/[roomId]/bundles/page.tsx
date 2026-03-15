"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Plus, Sparkles } from "lucide-react";
import { getScoreColor } from "@/lib/scoring/verdicts";

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
  }, [roomId]);

  const handleCreateFromShortlisted = async () => {
    setCreating(true);
    try {
      // Get shortlisted products
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
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/projects/${projectId}/rooms/${roomId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Room
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Bundles</h1>
            <p className="text-muted-foreground mt-1">
              Room concepts with holistic scoring
            </p>
          </div>
          <Button onClick={handleCreateFromShortlisted} disabled={creating}>
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
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">
              No bundles yet. Shortlist some products, then create a bundle.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {bundles.map((bundle) => {
            const evaluation = bundle.bundle_evaluations?.[0];
            const products = bundle.product_bundle_items?.map(
              (item) => item.candidate_products
            ) || [];

            return (
              <Card key={bundle.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{bundle.name || "Untitled Bundle"}</CardTitle>
                    {evaluation ? (
                      <span className={`text-2xl font-bold ${getScoreColor(evaluation.final_bundle_score)}`}>
                        {evaluation.final_bundle_score.toFixed(1)}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleEvaluate(bundle.id)}
                        disabled={evaluating === bundle.id}
                      >
                        {evaluating === bundle.id ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        Score Bundle
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Products in bundle */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {products.map((product) => (
                      <div key={product.id} className="space-y-2">
                        {product.image_url && (
                          <div className="aspect-square rounded-lg overflow-hidden bg-muted">
                            <img
                              src={product.image_url}
                              alt={product.title}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        )}
                        <p className="text-xs font-medium line-clamp-2">{product.title}</p>
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {product.category?.replace(/_/g, " ")}
                          </Badge>
                          {product.price && (
                            <span className="text-xs text-muted-foreground">${product.price}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Bundle evaluation */}
                  {evaluation && (
                    <div className="space-y-4 border-t pt-4">
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                        {[
                          { label: "Palette Harmony", score: evaluation.palette_harmony_score },
                          { label: "Material Balance", score: evaluation.material_balance_score },
                          { label: "Scale Balance", score: evaluation.scale_balance_score },
                          { label: "Style Consistency", score: evaluation.style_consistency_score },
                          { label: "Room Completion", score: evaluation.room_completion_score },
                          { label: "Practicality", score: evaluation.practicality_score },
                        ].map((s) => (
                          <div key={s.label} className="text-center">
                            <div className={`text-lg font-bold ${getScoreColor(s.score)}`}>
                              {s.score.toFixed(1)}
                            </div>
                            <div className="text-xs text-muted-foreground">{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {evaluation.analysis && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="text-sm">
                            <span className="font-medium text-emerald-600">Strongest: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.strongest_aspect}</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-medium text-amber-600">Weakest: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.weakest_aspect}</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">Missing: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.what_feels_missing}</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">Swap First: </span>
                            <span className="text-muted-foreground">{evaluation.analysis.what_should_be_swapped_first}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
