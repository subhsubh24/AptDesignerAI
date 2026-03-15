"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2 } from "lucide-react";
import { VERDICT_LABELS, VERDICT_COLORS, getScoreColor } from "@/lib/scoring/verdicts";
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

export default function ComparePage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [products, setProducts] = useState<ProductWithEval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/products?room_id=${roomId}`);
      if (res.ok) {
        const data = await res.json();
        // Only show evaluated and shortlisted products
        setProducts(
          data.filter(
            (p: ProductWithEval) =>
              p.product_evaluations?.length > 0 &&
              (p.status === "evaluated" || p.status === "shortlisted")
          )
        );
      }
      setLoading(false);
    }
    load();
  }, [roomId]);

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
        <h1 className="text-3xl font-bold tracking-tight">Compare Products</h1>
        <p className="text-muted-foreground mt-1">
          Side-by-side comparison of scored products
        </p>
      </div>

      {products.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">
              No scored products to compare. Score some products first.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left p-3 border-b font-medium text-sm text-muted-foreground w-40">
                  Dimension
                </th>
                {products.map((product) => (
                  <th key={product.id} className="p-3 border-b text-center min-w-[200px]">
                    <div className="space-y-2">
                      {product.image_url && (
                        <img
                          src={product.image_url}
                          alt={product.title || ""}
                          className="h-24 w-full object-contain rounded"
                        />
                      )}
                      <p className="text-sm font-medium line-clamp-2">
                        {product.title || "Untitled"}
                      </p>
                      {product.price && (
                        <p className="text-xs text-muted-foreground">${product.price}</p>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Overall Score */}
              <tr className="bg-muted/30">
                <td className="p-3 border-b font-semibold text-sm">Overall Score</td>
                {products.map((product) => {
                  const e = product.product_evaluations[0];
                  return (
                    <td key={product.id} className="p-3 border-b text-center">
                      <span className={`text-2xl font-bold ${getScoreColor(e.final_item_score)}`}>
                        {e.final_item_score.toFixed(1)}
                      </span>
                      <div className="mt-1">
                        <Badge className={VERDICT_COLORS[e.verdict]}>
                          {VERDICT_LABELS[e.verdict]}
                        </Badge>
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* Individual Scores */}
              {SCORE_LABELS.map(({ key, label }) => (
                <tr key={key}>
                  <td className="p-3 border-b text-sm text-muted-foreground">{label}</td>
                  {products.map((product) => {
                    const score = product.product_evaluations[0]?.[key] ?? 0;
                    return (
                      <td key={product.id} className="p-3 border-b text-center">
                        <span className={`font-medium ${getScoreColor(score)}`}>
                          {score.toFixed(1)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Top Reason */}
              <tr>
                <td className="p-3 border-b text-sm text-muted-foreground">Top Reason</td>
                {products.map((product) => {
                  const e = product.product_evaluations[0];
                  return (
                    <td key={product.id} className="p-3 border-b text-center">
                      <p className="text-xs text-muted-foreground">
                        {e?.reasoning?.top_reasons?.[0] || "-"}
                      </p>
                    </td>
                  );
                })}
              </tr>

              {/* Top Risk */}
              <tr>
                <td className="p-3 border-b text-sm text-muted-foreground">Top Risk</td>
                {products.map((product) => {
                  const e = product.product_evaluations[0];
                  return (
                    <td key={product.id} className="p-3 border-b text-center">
                      <p className="text-xs text-muted-foreground">
                        {e?.reasoning?.risks?.[0] || "-"}
                      </p>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
