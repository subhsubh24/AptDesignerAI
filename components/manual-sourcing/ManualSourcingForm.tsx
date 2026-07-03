"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Link as LinkIcon, ArrowRight } from "lucide-react";

interface CategoryItem {
  category: string;
  search_title?: string;
  description: string;
  priority: "high" | "medium" | "low";
  specs: string;
}

interface ManualSourcingFormProps {
  categories: CategoryItem[];
  onSubmit: (items: Array<{ category: string; urls: string[] }>) => void;
  loading: boolean;
  onCancel: () => void;
}

export function ManualSourcingForm({ categories, onSubmit, loading, onCancel }: ManualSourcingFormProps) {
  const [urlsByCategory, setUrlsByCategory] = useState<Record<string, string[]>>(
    Object.fromEntries(categories.map((c) => [c.category, [""]]))
  );

  const addUrl = (category: string) => {
    setUrlsByCategory((prev) => ({
      ...prev,
      [category]: [...(prev[category] || []), ""],
    }));
  };

  const removeUrl = (category: string, index: number) => {
    setUrlsByCategory((prev) => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== index),
    }));
  };

  const updateUrl = (category: string, index: number, value: string) => {
    setUrlsByCategory((prev) => ({
      ...prev,
      [category]: prev[category].map((u, i) => (i === index ? value : u)),
    }));
  };

  const handleSubmit = () => {
    const items = Object.entries(urlsByCategory)
      .map(([category, urls]) => ({
        category,
        urls: urls.filter((u) => u.trim().length > 0),
      }))
      .filter((item) => item.urls.length > 0);

    if (items.length === 0) return;
    onSubmit(items);
  };

  const totalUrls = Object.values(urlsByCategory)
    .flat()
    .filter((u) => u.trim().length > 0).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Find your own pieces
          </CardTitle>
          <CardDescription>
            Paste product URLs for each category below. We&apos;ll extract, score, and find the best combination.
            {categories.length > 1 && " Add multiple options per category to compare."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {categories.map((cat) => {
            const categoryLabel = cat.search_title || cat.category.replace(/_/g, " ");
            return (
            <div key={cat.category} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant={cat.priority === "high" ? "default" : "secondary"}
                  className="shrink-0"
                >
                  {cat.priority}
                </Badge>
                <h3 className="font-medium text-sm">
                  {categoryLabel}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">{cat.description}</p>
              {cat.specs && (
                <p className="text-xs text-muted-foreground italic">{cat.specs}</p>
              )}

              <div className="space-y-2 pl-1">
                {(urlsByCategory[cat.category] || [""]).map((url, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      placeholder="https://www.example.com/product..."
                      value={url}
                      onChange={(e) => updateUrl(cat.category, idx, e.target.value)}
                      disabled={loading}
                      className="text-sm"
                    />
                    {(urlsByCategory[cat.category]?.length || 0) > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeUrl(cat.category, idx)}
                        disabled={loading}
                        className="shrink-0 h-9 w-9"
                        aria-label={`Remove product URL for ${categoryLabel}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addUrl(cat.category)}
                  disabled={loading}
                  className="text-xs text-muted-foreground"
                >
                  <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
                  Add another option
                </Button>
              </div>
            </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSubmit}
          disabled={loading || totalUrls === 0}
          size="lg"
          className="flex-1 h-14 text-base"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Analyzing {totalUrls} product{totalUrls !== 1 ? "s" : ""}...
            </>
          ) : (
            <>
              <ArrowRight className="h-5 w-5 mr-2" />
              Evaluate {totalUrls} product{totalUrls !== 1 ? "s" : ""}
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={loading} size="lg" className="h-14">
          Cancel
        </Button>
      </div>
    </div>
  );
}
