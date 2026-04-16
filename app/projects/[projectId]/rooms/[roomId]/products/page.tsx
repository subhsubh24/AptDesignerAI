"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Loader2, ExternalLink, Star, ThumbsDown, Bookmark, Search, ShoppingBag, Sparkles, X, ArrowUpDown, CheckCircle2 } from "lucide-react";
import { VERDICT_LABELS, VERDICT_COLORS, getScoreColor } from "@/lib/scoring/verdicts";
import { cn } from "@/lib/utils/cn";
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

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 8 ? "bg-emerald-500" : score >= 6 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", getScoreColor(score))}>{score.toFixed(0)}</span>
      </div>
      <div className="score-bar">
        <div className={cn("score-bar-fill", color)} style={{ width: `${score * 10}%` }} />
      </div>
    </div>
  );
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
  const [selectedProduct, setSelectedProduct] = useState<ProductWithEval | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const categories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category).filter(Boolean));
    return Array.from(cats) as string[];
  }, [products]);

  const filteredProducts = useMemo(() => {
    let filtered = [...products];

    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => p.status === statusFilter);
    }
    if (categoryFilter !== "all") {
      filtered = filtered.filter((p) => p.category === categoryFilter);
    }

    filtered.sort((a, b) => {
      if (sortBy === "score") {
        const scoreA = a.product_evaluations?.[0]?.final_item_score ?? -1;
        const scoreB = b.product_evaluations?.[0]?.final_item_score ?? -1;
        return scoreB - scoreA;
      }
      if (sortBy === "price") {
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      }
      return 0;
    });

    return filtered;
  }, [products, statusFilter, categoryFilter, sortBy]);

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

  const detailProduct = selectedProduct;
  const detailEval = detailProduct?.product_evaluations?.[0];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/rooms/${roomId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Room
        </Link>
        <h1 className="text-headline">Products</h1>
        <p className="text-muted-foreground mt-1">
          Find, evaluate, and compare furniture and decor
        </p>
      </div>

      {/* Add Product + AI Search */}
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
          <Button variant="warm" onClick={handleAgenticSearch} disabled={searching} className="gap-2 shadow-warm-sm">
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {searching ? "Searching..." : "AI Search for Products"}
          </Button>
        </CardContent>
      </Card>

      {/* Filter/Sort Bar */}
      {products.length > 0 && (
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="ingested">Ingested</SelectItem>
              <SelectItem value="evaluated">Evaluated</SelectItem>
              <SelectItem value="shortlisted">Shortlisted</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>

          {categories.length > 1 && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat} className="capitalize">
                    {cat.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px] h-9 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Sort by Score</SelectItem>
              <SelectItem value="price">Sort by Price</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground ml-auto">
            {filteredProducts.length} of {products.length} products
          </span>
        </div>
      )}

      {/* Product Grid */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border bg-card overflow-hidden">
              <div className="aspect-square skeleton-pulse" />
              <div className="p-4 space-y-3">
                <div className="skeleton-pulse h-4 w-3/4" />
                <div className="skeleton-pulse h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-accent-warm/10 to-accent-warm/5 flex items-center justify-center mb-5 animate-float">
              <ShoppingBag className="h-8 w-8 text-accent-warm/50" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {products.length === 0 ? "Let's find your pieces" : "No matching products"}
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {products.length === 0
                ? "Run AI search to see handpicked furniture and decor that fit your space — or paste a URL to score a specific piece."
                : "Try adjusting your filters to see more options."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-stagger-children">
          {filteredProducts.map((product) => {
            const evaluation = product.product_evaluations?.[0];
            const isShortlisted = product.status === "shortlisted" || product.status === "accepted";

            return (
              <Card
                key={product.id}
                variant="interactive"
                className={cn(
                  "overflow-hidden group animate-fade-in-up",
                  isShortlisted && "ring-2 ring-accent-warm/30"
                )}
                onClick={() => setSelectedProduct(product)}
              >
                {product.image_url && (
                  <div className="aspect-square w-full overflow-hidden bg-muted relative">
                    <img
                      src={product.image_url}
                      alt={product.title || "Product"}
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    {isShortlisted && (
                      <div className="absolute top-3 right-3">
                        <div className="h-7 w-7 rounded-full bg-accent-warm flex items-center justify-center shadow-warm-sm">
                          <CheckCircle2 className="h-4 w-4 text-white" />
                        </div>
                      </div>
                    )}
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
                        <span className={cn("text-xl font-bold animate-score-pop", getScoreColor(evaluation.final_item_score))}>
                          {evaluation.final_item_score.toFixed(1)}
                        </span>
                        <Badge className={VERDICT_COLORS[evaluation.verdict]}>
                          {VERDICT_LABELS[evaluation.verdict]}
                        </Badge>
                      </div>

                      {/* Score bars */}
                      <div className="space-y-1.5">
                        <ScoreBar score={evaluation.style_fit_score} label="Style" />
                        <ScoreBar score={evaluation.palette_fit_score} label="Palette" />
                        <ScoreBar score={evaluation.scale_fit_score} label="Scale" />
                        <ScoreBar score={evaluation.cohesion_fit_score} label="Cohesion" />
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
                      variant="warm-outline"
                      className="w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEvaluate(product.id);
                      }}
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
                      variant={isShortlisted ? "warm" : "ghost"}
                      className="flex-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusChange(product.id, isShortlisted ? "evaluated" : "shortlisted");
                      }}
                    >
                      <Bookmark className={cn("h-3.5 w-3.5 mr-1", isShortlisted && "fill-white")} />
                      {isShortlisted ? "Saved" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusChange(product.id, "rejected");
                      }}
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                    {product.product_url && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => e.stopPropagation()}
                        asChild
                      >
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

      {/* Product Detail Dialog */}
      <Dialog open={!!selectedProduct} onOpenChange={() => setSelectedProduct(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {detailProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">{detailProduct.title || "Product Details"}</DialogTitle>
              </DialogHeader>

              {detailProduct.image_url && (
                <div className="aspect-square rounded-xl overflow-hidden bg-muted">
                  <img
                    src={detailProduct.image_url}
                    alt={detailProduct.title || "Product"}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}

              <div className="space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  {detailProduct.retailer && (
                    <span className="text-sm text-muted-foreground">{detailProduct.retailer}</span>
                  )}
                  {detailProduct.price && (
                    <span className="text-lg font-bold">${detailProduct.price}</span>
                  )}
                  {detailProduct.category && (
                    <Badge variant="outline" className="capitalize">
                      {detailProduct.category.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>

                {detailProduct.materials && detailProduct.materials.length > 0 && (
                  <div>
                    <p className="text-caption mb-2">Materials</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailProduct.materials.map((m) => (
                        <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {detailEval && (
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <span className={cn("text-3xl font-bold", getScoreColor(detailEval.final_item_score))}>
                        {detailEval.final_item_score.toFixed(1)}
                      </span>
                      <Badge className={VERDICT_COLORS[detailEval.verdict]}>
                        {VERDICT_LABELS[detailEval.verdict]}
                      </Badge>
                    </div>

                    {/* All 7 score bars */}
                    <div className="space-y-2">
                      {[
                        { label: "Style Fit", score: detailEval.style_fit_score },
                        { label: "Palette Fit", score: detailEval.palette_fit_score },
                        { label: "Material Fit", score: detailEval.material_fit_score },
                        { label: "Scale Fit", score: detailEval.scale_fit_score },
                        { label: "Function Fit", score: detailEval.function_fit_score },
                        { label: "Cohesion Fit", score: detailEval.cohesion_fit_score },
                        { label: "Value Fit", score: detailEval.value_fit_score },
                      ].map((s) => (
                        <ScoreBar key={s.label} score={s.score} label={s.label} />
                      ))}
                    </div>

                    {detailEval.reasoning.top_reasons.length > 0 && (
                      <div>
                        <p className="text-caption mb-2">Top Reasons</p>
                        <ul className="space-y-1.5">
                          {detailEval.reasoning.top_reasons.map((r, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {detailEval.reasoning.risks.length > 0 && (
                      <div>
                        <p className="text-caption mb-2">Risks</p>
                        <ul className="space-y-1.5">
                          {detailEval.reasoning.risks.map((r, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <X className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="warm"
                    className="flex-1"
                    onClick={() => {
                      handleStatusChange(detailProduct.id, "shortlisted");
                      setSelectedProduct(null);
                    }}
                  >
                    <Bookmark className="h-4 w-4 mr-1.5" />
                    Shortlist
                  </Button>
                  {detailProduct.product_url && (
                    <Button variant="outline" asChild>
                      <a href={detailProduct.product_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-1.5" />
                        View
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
