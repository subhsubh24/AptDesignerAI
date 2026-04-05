"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DollarSign, TrendingUp, AlertTriangle } from "lucide-react";

interface BudgetSummaryProps {
  budgetDollars: number | null;
  products: Array<{
    title: string;
    price: number | null;
    category?: string;
    metadata?: { price_tier?: string } | null;
  }>;
  selectedTier?: string;
}

interface CategoryTotal {
  category: string;
  price: number;
  title: string;
}

export function BudgetSummary({ budgetDollars, products, selectedTier }: BudgetSummaryProps) {
  // Group best product per category for the selected tier
  const tierProducts = selectedTier
    ? products.filter((p) => (p.metadata?.price_tier || "balanced") === selectedTier)
    : products;

  // Get best product per category (highest scored, but we only have price here)
  const categoryMap = new Map<string, CategoryTotal>();
  for (const p of tierProducts) {
    if (!p.price || !p.category) continue;
    const existing = categoryMap.get(p.category);
    if (!existing || p.price < existing.price) {
      categoryMap.set(p.category, { category: p.category, price: p.price, title: p.title });
    }
  }

  const items = Array.from(categoryMap.values());
  const totalCost = items.reduce((sum, item) => sum + item.price, 0);
  const budgetUsed = budgetDollars ? Math.round((totalCost / budgetDollars) * 100) : null;
  const isOverBudget = budgetDollars ? totalCost > budgetDollars : false;

  if (items.length === 0) return null;

  return (
    <Card className={isOverBudget ? "border-amber-300 dark:border-amber-700" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          Budget Summary
          {selectedTier && (
            <Badge variant="outline" className="capitalize text-xs ml-1">
              {selectedTier.replace(/_/g, " ")}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Estimated total</span>
          <span className="text-lg font-semibold">
            ${totalCost.toLocaleString()}
          </span>
        </div>

        {/* Budget bar */}
        {budgetDollars && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {isOverBudget ? (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    ${(totalCost - budgetDollars).toLocaleString()} over budget
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <TrendingUp className="h-3 w-3" />
                    ${(budgetDollars - totalCost).toLocaleString()} remaining
                  </span>
                )}
              </span>
              <span>${budgetDollars.toLocaleString()} budget</span>
            </div>
            <Progress
              value={Math.min(budgetUsed || 0, 100)}
              className={isOverBudget ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}
            />
          </div>
        )}

        {/* Per-category breakdown */}
        <div className="space-y-1.5 pt-1 border-t">
          {items.map((item) => (
            <div key={item.category} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground capitalize truncate max-w-[60%]">
                {item.category.replace(/_/g, " ")}
              </span>
              <span className="font-medium">${item.price.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
