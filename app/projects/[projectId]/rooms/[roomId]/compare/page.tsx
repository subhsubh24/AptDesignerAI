"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, GitCompare } from "lucide-react";
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
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-accent-warm" />
      </div>
    );
  }

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
        <h1 className="text-3xl font-bold tracking-tight">Compare Products</h1>
        <p className="text-muted-foreground mt-1">
          Side-by-side comparison of scored products
        </p>
      </div>

      {products.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-20 text-center">
            <div className="h-14 w-14 rounded-2xl bg-secondary flex items-center justify-center mb-4 mx-auto">
              <GitCompare className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No products to compare</h3>
            <p className="text-sm text-muted-foreground">
              Score some products first.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-4 border-b font-medium text-sm text-muted-foreground w-40 bg-muted/30">
                    Dimension
                  </th>
                  {products.map((product) => (
                    <th key={product.id} className="p-4 border-b text-center min-w-[200px] bg-muted/30">
                      <div className="space-y-2.5">
                        {product.image_url && (
                          <div className="mx-auto w-24 h-24 rounded-xl overflow-hidden bg-background">
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
                <tr className="bg-muted/20">
                  <td className="p-4 border-b font-semibold text-sm">Overall Score</td>
                  {products.map((product) => {
                    const e = product.product_evaluations[0];
                    return (
                      <td key={product.id} className="p-4 border-b text-center">
                        <span className={`text-2xl font-bold ${getScoreColor(e.final_item_score)}`}>
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
                  <tr key={key} className="hover:bg-muted/10 transition-colors">
                    <td className="p-4 border-b text-sm text-muted-foreground">{label}</td>
                    {products.map((product) => {
                      const score = product.product_evaluations[0]?.[key] ?? 0;
                      return (
                        <td key={product.id} className="p-4 border-b text-center">
                          <span className={`font-semibold ${getScoreColor(score)}`}>
                            {score.toFixed(1)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}

                <tr className="hover:bg-muted/10 transition-colors">
                  <td className="p-4 border-b text-sm text-muted-foreground">Top Reason</td>
                  {products.map((product) => {
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
                  {products.map((product) => {
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
      )}
    </div>
  );
}
