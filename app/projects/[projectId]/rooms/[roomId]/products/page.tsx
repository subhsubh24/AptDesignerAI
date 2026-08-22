"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
import { ArrowLeft, Plus, Loader2, ExternalLink, Star, ThumbsDown, Bookmark, ShoppingBag, Sparkles, X, ArrowUpDown, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { VERDICT_LABELS, VERDICT_COLORS, getScoreColor } from "@/lib/scoring/verdicts";
import { ScoreBarCompact } from "@/components/ui/score-display";
import { PageTransition, StaggerList, StaggerItem, CardHover } from "@/components/ui/motion";
import { SkeletonCard } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { canOptimizeImageHost } from "@/lib/utils/image-url";
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductWithEval | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");

  const loadProducts = async () => {
    try {
      const res = await fetch(`/api/products?room_id=${roomId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
      setLoadError(false);
    } catch {
      // Surface the failure instead of silently rendering the "no products yet"
      // empty state — an error the user believes is an empty room, not a load
      // failure, has no path to recovery. Existing products stay on screen; the
      // error card only takes over when there is nothing to show.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error("Couldn't add product", body?.error || `Could not add this product (HTTP ${res.status}).`);
        return;
      }
      setIngestUrl("");
      loadProducts();
    } catch {
      toast.error("Couldn't add product", "Network error — could not reach the product service.");
    } finally {
      setIngesting(false);
    }
  };

  const handleEvaluate = async (productId: string) => {
    setEvaluating(productId);
    try {
      const res = await fetch("/api/products/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, room_id: roomId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error("Evaluation failed", body?.error || `Could not evaluate this product (HTTP ${res.status}).`);
        return;
      }
      await loadProducts();
    } catch {
      toast.error("Evaluation failed", "Network error — could not reach the evaluation service.");
    } finally {
      setEvaluating(null);
    }
  };

  const handleStatusChange = async (productId: string, status: string) => {
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error("Update failed", body?.error || `Could not update the product status (HTTP ${res.status}).`);
        return;
      }
      await loadProducts();
    } catch {
      toast.error("Update failed", "Network error — could not update the product status.");
    }
  };

  const handleAgenticSearch = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Search failed" }));
        const message = body?.error || `Search failed (HTTP ${res.status})`;
        setSearchError(message);
        toast.error("Search failed", message);
        return;
      }
      const result = await res.json().catch(() => null);
      await loadProducts();
      // Surface the case where the search succeeded at the HTTP level but
      // returned no products — silently loading an empty list leaves the
      // user wondering if anything happened.
      if (Array.isArray(result?.products) && result.products.length === 0) {
        setSearchError("The search finished but returned no products for this room. Try adjusting keep/replace items or the budget tier, then retry.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error — could not reach the search service.";
      setSearchError(message);
      toast.error("Search failed", message);
    } finally {
      setSearching(false);
    }
  };

  const detailProduct = selectedProduct;
  const detailEval = detailProduct?.product_evaluations?.[0];

  return (
    <PageTransition className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/rooms/${roomId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Room
        </Link>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-headline">Products</h1>
            <p className="text-muted-foreground mt-1">
              Find, evaluate, and compare furniture and decor
            </p>
          </div>
          <Link href={`/projects/${projectId}/rooms/${roomId}/focus`}>
            <Button variant="warm" size="sm" className="gap-1.5 shadow-warm-sm">
              <Sparkles className="h-3.5 w-3.5" /> Open Design Studio
            </Button>
          </Link>
        </div>
      </div>

      {/* Add Product + AI Search */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex gap-3">
            <Input
              aria-label="Paste a product URL"
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
          {searchError && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">Search failed</p>
                <p className="text-xs mt-0.5 opacity-80">{searchError}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 h-7 text-xs"
                onClick={() => { setSearchError(null); handleAgenticSearch(); }}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filter/Sort Bar */}
      {products.length > 0 && (
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9 text-xs" aria-label="Filter by status">
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
              <SelectTrigger className="w-[160px] h-9 text-xs" aria-label="Filter by category">
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
            <SelectTrigger className="w-[140px] h-9 text-xs" aria-label="Sort products">
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
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : loadError && products.length === 0 ? (
        <Card className="border-dashed border-2 border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-16 w-16 rounded-3xl bg-destructive/10 flex items-center justify-center mb-5">
              <AlertTriangle className="h-8 w-8 text-destructive/70" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load products</h2>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-5">
              Something went wrong loading this room&apos;s products. Check your connection and try again.
            </p>
            <Button
              variant="outline"
              onClick={() => { setLoadError(false); setLoading(true); loadProducts(); }}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : filteredProducts.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-accent-warm/10 to-accent-warm/5 flex items-center justify-center mb-5 animate-float">
              <ShoppingBag className="h-8 w-8 text-accent-warm/50" />
            </div>
            <h2 className="text-lg font-semibold mb-2">
              {products.length === 0 ? "Let's find your pieces" : "No matching products"}
            </h2>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {products.length === 0
                ? "Run AI search to see handpicked furniture and decor that fit your space — or paste a URL to score a specific piece."
                : "Try adjusting your filters to see more options."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <StaggerList className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProducts.map((product) => {
            const evaluation = product.product_evaluations?.[0];
            const isShortlisted = product.status === "shortlisted" || product.status === "accepted";

            return (
              <StaggerItem key={product.id}>
              <CardHover>
              <Card
                variant="interactive"
                role="button"
                tabIndex={0}
                aria-label={`View details for ${product.title || "product"}`}
                className={cn(
                  "overflow-hidden group focus-visible:ring-2 focus-visible:ring-ring",
                  isShortlisted && "ring-2 ring-accent-warm"
                )}
                onClick={() => setSelectedProduct(product)}
                onKeyDown={(e) => {
                  // Only act on keys that originate on the card itself — never
                  // on ones bubbling up from the nested Score/Save/Reject/View
                  // controls, or we'd preventDefault their own Enter/Space and
                  // hijack them into opening this dialog.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedProduct(product);
                  }
                }}
              >
                {product.image_url && (
                  <div className="aspect-square w-full overflow-hidden bg-muted relative">
                    {canOptimizeImageHost(product.image_url) ? (
                      <Image
                        src={product.image_url}
                        alt={product.title || "Product"}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.title || "Product"}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    )}
                    {isShortlisted && (
                      <div className="absolute top-3 right-3">
                        <div className="h-7 w-7 rounded-full bg-accent-warm flex items-center justify-center shadow-warm-sm">
                          <CheckCircle2 className="h-4 w-4 text-accent-warm-on-solid" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <CardContent className="p-3 sm:p-4 space-y-3">
                  <div>
                    <h2 className="font-semibold text-sm line-clamp-2">
                      {product.title || "Untitled Product"}
                    </h2>
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
                        <ScoreBarCompact score={evaluation.style_fit_score} label="Style" />
                        <ScoreBarCompact score={evaluation.palette_fit_score} label="Palette" />
                        <ScoreBarCompact score={evaluation.scale_fit_score} label="Scale" />
                        <ScoreBarCompact score={evaluation.cohesion_fit_score} label="Cohesion" />
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
                        <a
                          href={product.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`View ${product.title || "product"} at the retailer (opens in a new tab)`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
              </CardHover>
              </StaggerItem>
            );
          })}
        </StaggerList>
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
                <div className="relative aspect-square rounded-xl overflow-hidden bg-muted">
                  {canOptimizeImageHost(detailProduct.image_url) ? (
                    <Image
                      src={detailProduct.image_url}
                      alt={detailProduct.title || "Product"}
                      fill
                      sizes="(min-width: 512px) 464px, 100vw"
                      className="object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={detailProduct.image_url}
                      alt={detailProduct.title || "Product"}
                      className="h-full w-full object-cover"
                    />
                  )}
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
                        <ScoreBarCompact key={s.label} score={s.score} label={s.label} />
                      ))}
                    </div>

                    {detailEval.reasoning.top_reasons.length > 0 && (
                      <div>
                        <p className="text-caption mb-2">Top Reasons</p>
                        <ul className="space-y-1.5">
                          {detailEval.reasoning.top_reasons.map((r, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 text-foreground mt-0.5 shrink-0" />
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
                              <X className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
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
    </PageTransition>
  );
}
