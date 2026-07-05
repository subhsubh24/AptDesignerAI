"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ExternalLink,
  Trophy,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Star,
  Palette,
  Ruler,
  Layers,
  Zap,
  Puzzle,
  DollarSign,
  Shield,
} from "lucide-react";
import { VERDICT_LABELS, VERDICT_COLORS, getScoreColor } from "@/lib/scoring/verdicts";
import type { Verdict } from "@/lib/types/scoring";
import { cn } from "@/lib/utils/cn";

// ─── Types matching the API response ────────────────────────────

interface IndividualScore {
  product_id: string;
  title: string | null;
  category: string;
  price: number | null;
  retailer: string | null;
  image_url: string | null;
  product_url: string | null;
  scores: {
    style_fit_score: number;
    palette_fit_score: number;
    material_fit_score: number;
    scale_fit_score: number;
    function_fit_score: number;
    cohesion_fit_score: number;
    value_fit_score: number;
    confidence_score: number;
  } | null;
  final_item_score: number | null;
  verdict: Verdict | null;
  reasoning: {
    top_reasons: string[];
    risks: string[];
    suggestions: string[];
  } | null;
  area_fit_note?: string;
  apartment_fit_note?: string;
  error?: string;
}

interface BundleResult {
  products: Array<{ id: string; title: string | null; category: string }>;
  scores: {
    palette_harmony_score: number;
    material_balance_score: number;
    scale_balance_score: number;
    style_consistency_score: number;
    room_completion_score: number;
    spatial_arrangement_score?: number;
    practicality_score: number;
  } | null;
  final_bundle_score: number | null;
  verdict: string | null;
  analysis: {
    strongest_aspect: string;
    weakest_aspect: string;
    what_feels_missing: string;
    what_should_be_swapped_first: string;
  } | null;
  error?: string;
}

export interface EvaluateSetResult {
  individual_scores: IndividualScore[];
  bundles: BundleResult[];
  best_combination: BundleResult | null;
  overall_score: number;
  gaps: string[];
  failed_extractions: Array<{ url: string; category: string; error: string }>;
}

interface ManualScorecardViewProps {
  result: EvaluateSetResult;
  onBack: () => void;
}

// ─── Score dimension configs ────────────────────────────────────

const ITEM_DIMENSIONS = [
  { key: "style_fit_score", label: "Style Fit", icon: Star, weight: "18%" },
  { key: "palette_fit_score", label: "Palette Fit", icon: Palette, weight: "16%" },
  { key: "material_fit_score", label: "Material Fit", icon: Layers, weight: "12%" },
  { key: "scale_fit_score", label: "Scale Fit", icon: Ruler, weight: "18%" },
  { key: "function_fit_score", label: "Function Fit", icon: Zap, weight: "12%" },
  { key: "cohesion_fit_score", label: "Cohesion Fit", icon: Puzzle, weight: "16%" },
  { key: "value_fit_score", label: "Value", icon: DollarSign, weight: "8%" },
  { key: "confidence_score", label: "Confidence", icon: Shield, weight: "" },
] as const;

const BUNDLE_DIMENSIONS = [
  { key: "palette_harmony_score", label: "Palette Harmony", weight: "18%" },
  { key: "material_balance_score", label: "Material Balance", weight: "14%" },
  { key: "scale_balance_score", label: "Scale Balance", weight: "14%" },
  { key: "style_consistency_score", label: "Style Consistency", weight: "16%" },
  { key: "room_completion_score", label: "Room Completion", weight: "12%" },
  { key: "spatial_arrangement_score", label: "Spatial Arrangement", weight: "16%" },
  { key: "practicality_score", label: "Practicality", weight: "10%" },
] as const;

// ─── Component ──────────────────────────────────────────────────

export function ManualScorecardView({ result, onBack }: ManualScorecardViewProps) {
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [showAllBundles, setShowAllBundles] = useState(false);

  const toggleProduct = (id: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const categories = [...new Set(result.individual_scores.map((s) => s.category))].sort();

  return (
    <div className="space-y-6">
      {/* ── Overall Score ─── */}
      <Card className={cn(
        "border-2",
        result.overall_score >= 8 ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30" :
        result.overall_score >= 6 ? "border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30" :
        "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30"
      )}>
        <CardContent className="pt-6 pb-5">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className={cn(
                "text-5xl font-bold",
                getScoreColor(result.overall_score)
              )}>
                {result.overall_score.toFixed(1)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">out of 10</div>
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-lg">
                {result.overall_score >= 8
                  ? "Excellent selections!"
                  : result.overall_score >= 6
                    ? "Good selections with room to improve"
                    : "Some concerns to address"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {result.individual_scores.filter((s) => s.scores).length} product{result.individual_scores.filter((s) => s.scores).length !== 1 ? "s" : ""} scored
                {result.bundles.filter((b) => b.scores).length > 0 && (
                  <> across {result.bundles.filter((b) => b.scores).length} combination{result.bundles.filter((b) => b.scores).length !== 1 ? "s" : ""}</>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Gaps ─── */}
      {result.gaps.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              Gaps to close for a perfect 10
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {result.gaps.map((gap, i) => (
                <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                  <span className="text-amber-400 mt-1 shrink-0">-</span>
                  {gap}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Failed Extractions ─── */}
      {result.failed_extractions.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
          <p className="text-sm font-medium text-red-700">
            {result.failed_extractions.length} URL{result.failed_extractions.length !== 1 ? "s" : ""} could not be extracted
          </p>
          {result.failed_extractions.map((f, i) => (
            <p key={i} className="text-xs text-red-600 break-all">
              {f.url}: {f.error}
            </p>
          ))}
        </div>
      )}

      {/* ── Best Combination ─── */}
      {result.best_combination && (
        <Card className="border-emerald-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Best Combination
              {result.best_combination.final_bundle_score && (
                <Badge className={cn("ml-auto", getScoreColor(result.best_combination.final_bundle_score))}>
                  Bundle: {result.best_combination.final_bundle_score.toFixed(1)}/10
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {result.best_combination.products.map((p) => (
                <Badge key={p.id} variant="outline" className="text-xs">
                  {p.category.replace(/_/g, " ")}: {p.title || "Unknown"}
                </Badge>
              ))}
            </div>

            {result.best_combination.scores && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
                {BUNDLE_DIMENSIONS.map((dim) => {
                  const value = (result.best_combination!.scores as Record<string, number>)?.[dim.key] ?? 0;
                  return (
                    <div key={dim.key} className="text-center p-2 rounded-lg bg-muted/50">
                      <div className={cn("text-lg font-bold", getScoreColor(value))}>
                        {value.toFixed(1)}
                      </div>
                      <div className="text-xs text-muted-foreground">{dim.label}</div>
                      {dim.weight && <div className="text-[10px] text-muted-foreground/60">{dim.weight}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {result.best_combination.analysis && (
              <div className="grid sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/40">
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">Strongest: </span>
                  {result.best_combination.analysis.strongest_aspect}
                </div>
                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40">
                  <span className="font-medium text-amber-700 dark:text-amber-300">Weakest: </span>
                  {result.best_combination.analysis.weakest_aspect}
                </div>
                {result.best_combination.analysis.what_feels_missing !== "Nothing" && (
                  <div className="p-2 rounded bg-blue-50 dark:bg-blue-950/40">
                    <span className="font-medium text-blue-700 dark:text-blue-300">Missing: </span>
                    {result.best_combination.analysis.what_feels_missing}
                  </div>
                )}
                {result.best_combination.analysis.what_should_be_swapped_first !== "Nothing" && (
                  <div className="p-2 rounded bg-slate-100 dark:bg-slate-900/50">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Swap first: </span>
                    {result.best_combination.analysis.what_should_be_swapped_first}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Individual Product Scorecards ─── */}
      <div>
        <h3 className="font-semibold text-base mb-3">Individual Product Scores</h3>
        <div className="space-y-3">
          {categories.map((category) => {
            const catProducts = result.individual_scores.filter((s) => s.category === category);
            return (
              <div key={category}>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 capitalize">
                  {category.replace(/_/g, " ")}
                </h4>
                <div className="space-y-2">
                  {catProducts.map((product) => (
                    <ProductScorecard
                      key={product.product_id}
                      product={product}
                      expanded={expandedProducts.has(product.product_id)}
                      onToggle={() => toggleProduct(product.product_id)}
                      isBestPick={result.best_combination?.products.some((p) => p.id === product.product_id) || false}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── All Bundle Combinations ─── */}
      {result.bundles.length > 1 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAllBundles(!showAllBundles)}
            className="text-muted-foreground"
          >
            {showAllBundles ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showAllBundles ? "Hide" : "Show"} all {result.bundles.length} combination{result.bundles.length !== 1 ? "s" : ""}
          </Button>

          {showAllBundles && (
            <div className="space-y-2 mt-2">
              {result.bundles
                .filter((b) => b.final_bundle_score !== null)
                .sort((a, b) => (b.final_bundle_score || 0) - (a.final_bundle_score || 0))
                .map((bundle, idx) => {
                  const isBest = result.best_combination?.products.every(
                    (p, i) => p.id === bundle.products[i]?.id
                  );
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-lg border p-3 flex items-center gap-3",
                        isBest && "border-emerald-300 bg-emerald-50/30"
                      )}
                    >
                      {isBest && <Trophy className="h-4 w-4 text-amber-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1">
                          {bundle.products.map((p) => (
                            <span key={p.id} className="text-xs text-muted-foreground">
                              {(p.title || "").slice(0, 25)}
                              {(p.title || "").length > 25 ? "..." : ""}
                              {" + "}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className={cn("text-sm font-bold shrink-0", getScoreColor(bundle.final_bundle_score || 0))}>
                        {bundle.final_bundle_score?.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 justify-center pt-2">
        <Button variant="outline" onClick={onBack}>
          Back to assessment
        </Button>
      </div>
    </div>
  );
}

// ─── Product Scorecard ──────────────────────────────────────────

function ProductScorecard({
  product,
  expanded,
  onToggle,
  isBestPick,
}: {
  product: IndividualScore;
  expanded: boolean;
  onToggle: () => void;
  isBestPick: boolean;
}) {
  if (product.error && !product.scores) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
        <p className="text-sm font-medium">{product.title || "Unknown product"}</p>
        <p className="text-xs text-red-600">Scoring failed: {product.error}</p>
      </div>
    );
  }

  return (
    <Card className={cn(
      "transition-all",
      isBestPick && "border-emerald-300 ring-1 ring-emerald-200"
    )}>
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        {product.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.title || "Product image"}
            className="h-12 w-12 rounded-lg object-cover shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm truncate">{product.title || "Unknown"}</p>
            {isBestPick && (
              <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] shrink-0">
                Best Pick
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {product.retailer && <span>{product.retailer}</span>}
            {product.price && <span>${product.price}</span>}
            {product.verdict && (
              <Badge variant="outline" className={cn("text-[10px]", VERDICT_COLORS[product.verdict])}>
                {VERDICT_LABELS[product.verdict]}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {product.final_item_score !== null && (
            <span className={cn("text-lg font-bold", getScoreColor(product.final_item_score))}>
              {product.final_item_score.toFixed(1)}
            </span>
          )}
          {product.product_url && (
            <a
              href={product.product_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${product.title || "product"} scorecard`}
            className="rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && product.scores && (
        <CardContent className="pt-0 pb-4 space-y-4">
          {/* Score dimensions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ITEM_DIMENSIONS.map((dim) => {
              const value = product.scores![dim.key as keyof typeof product.scores] as number;
              const Icon = dim.icon;
              return (
                <div key={dim.key} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{dim.label}</span>
                    {dim.weight && (
                      <span className="text-[10px] text-muted-foreground/60 ml-auto">{dim.weight}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={value * 10} className="h-1.5 flex-1" />
                    <span className={cn("text-xs font-bold w-6 text-right", getScoreColor(value))}>
                      {value.toFixed(1)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reasoning */}
          {product.reasoning && (
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              {product.reasoning.top_reasons?.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-emerald-700 dark:text-emerald-400">Strengths</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {product.reasoning.top_reasons.map((r, i) => (
                      <li key={i}>+ {r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {product.reasoning.risks?.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-amber-700 dark:text-amber-400">Risks</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {product.reasoning.risks.map((r, i) => (
                      <li key={i}>- {r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {product.reasoning.suggestions?.length > 0 && (
                <div className="space-y-1 sm:col-span-2">
                  <p className="font-medium text-blue-700 dark:text-blue-400">Suggestions</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {product.reasoning.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Fit notes */}
          {(product.area_fit_note || product.apartment_fit_note) && (
            <div className="space-y-1 text-xs">
              {product.area_fit_note && (
                <p className="text-muted-foreground">
                  <span className="font-medium">Area fit:</span> {product.area_fit_note}
                </p>
              )}
              {product.apartment_fit_note && (
                <p className="text-muted-foreground">
                  <span className="font-medium">Apartment fit:</span> {product.apartment_fit_note}
                </p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
