"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Loader2, ExternalLink, Star, ThumbsDown, Bookmark, Search, ShoppingBag } from "lucide-react";
import { VERDICT_LABELS, VERDICT_COLORS, getScoreColor } from "@/lib/scoring/verdicts";
import type { Verdict } from "@/lib/types/scoring";

interface ProductWithEval {
  id: string;
  title: string | null;
  category: string | null;
  retailer: string | null;
  product_url: string | null;
  image_url: string | null;
  price: number | null;
  materials: string[] | null;
  colors: string[] | null;
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
    reasoning: { top_reasons: string[]; risks: string[]; suggestions: string[] };
  }>;
}

export default function ProductsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [products, setProducts] = useState<ProductWithEval[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingestUrl, setIngestUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const loadProducts = async () => {
    const res = await fetch(`/api/products?room_id=${roomId}`);
    if (res.ok) {
      const data = await res.json();
      setProducts(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProducts();
  }, [roomId]);

  const handleIngest = async () => {
    if (!ingestUrl.trim()) return;
    setIngesting(true);
    try {
      const res = await fetch("/api/products/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, url: ingestUrl.trim() }),
      });
      if (res.ok) {
        setIngestUrl("");
        loadProducts();
      }
    } finally {
      setIngesting(false);
    }
  };

  const handleEvaluate = async (productId: string) => {
    setEvaluating(productId);
    try {
      await fetch("/api/products/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, room_id: roomId }),
      });
      loadProducts();
    } finally {
      setEvaluating(null);
    }
  };

  const handleStatusChange = async (productId: string, status: string) => {
    await fetch(`/api/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadProducts();
  };

  const handleAgenticSearch = async () => {
    setSearching(true);
    try {
      await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId }),
      });
      loadProducts();
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/projects/${projectId}/rooms/${roomId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Room
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Products</h1>
        <p className="text-muted-foreground mt-1">
          Find, evaluate, and compare furniture and decor
        </p>
      </div>

      {/* Add Product */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex gap-3">
            <Input
              placeholder="Paste a product URL..."
              value={ingestUrl}
              onChange={(e) => setIngestUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleIngest()}
              className="flex-1"
            />
            <Button onClick={handleIngest} disabled={ingesting || !ingestUrl.trim()}>
              {ingesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {ingesting ? "Adding..." : "Add"}
            </Button>
          </div>
          <Button variant="outline" onClick={handleAgenticSearch} disabled={searching} className="gap-2">
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {searching ? "Searching..." : "AI Search for Products"}
          </Button>
        </CardContent>
      </Card>

      {/* Product Grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-accent-warm" />
        </div>
      ) : products.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-14 w-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <ShoppingBag className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No products yet</h3>
            <p className="text-sm text-muted-foreground">Add a URL or run AI search.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const evaluation = product.product_evaluations?.[0];
            return (
              <Card key={product.id} className="overflow-hidden group hover:shadow-lg transition-all duration-300">
                {product.image_url && (
                  <div className="aspect-square w-full overflow-hidden bg-muted">
                    <img
                      src={product.image_url}
                      alt={product.title || "Product"}
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                )}
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold text-sm line-clamp-2">
                      {product.title || "Untitled Product"}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5">
                      {product.retailer && (
                        <span className="text-xs text-muted-foreground">{product.retailer}</span>
                      )}
                      {product.price && (
                        <span className="text-xs font-semibold">${product.price}</span>
                      )}
                    </div>
                  </div>

                  {product.category && (
                    <Badge variant="outline" className="capitalize text-xs">
                      {product.category.replace(/_/g, " ")}
                    </Badge>
                  )}

                  {evaluation ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className={`text-lg font-bold ${getScoreColor(evaluation.final_item_score)}`}>
                          {evaluation.final_item_score.toFixed(1)}
                        </span>
                        <Badge className={VERDICT_COLORS[evaluation.verdict]}>
                          {VERDICT_LABELS[evaluation.verdict]}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-4 gap-1 text-xs">
                        {[
                          { label: "Style", score: evaluation.style_fit_score },
                          { label: "Palette", score: evaluation.palette_fit_score },
                          { label: "Scale", score: evaluation.scale_fit_score },
                          { label: "Cohesion", score: evaluation.cohesion_fit_score },
                        ].map((s) => (
                          <div key={s.label} className="text-center p-1.5 rounded-lg bg-muted/50">
                            <div className={`font-semibold ${getScoreColor(s.score)}`}>
                              {s.score.toFixed(0)}
                            </div>
                            <div className="text-muted-foreground text-[10px]">{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {evaluation.reasoning.top_reasons[0] && (
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {evaluation.reasoning.top_reasons[0]}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => handleEvaluate(product.id)}
                      disabled={evaluating === product.id}
                    >
                      {evaluating === product.id ? (
                        <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      ) : (
                        <Star className="h-3 w-3 mr-1.5" />
                      )}
                      Score Product
                    </Button>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1.5 pt-1 border-t">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-xs"
                      onClick={() => handleStatusChange(product.id, "shortlisted")}
                    >
                      <Bookmark className="h-3.5 w-3.5 mr-1" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-xs"
                      onClick={() => handleStatusChange(product.id, "rejected")}
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                    {product.product_url && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={product.product_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
