"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageTransition, StaggerList, StaggerItem } from "@/components/ui/motion";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Loader2, Bookmark, Trash2, ArrowRight, ArrowLeft, Download } from "lucide-react";

interface SavedDesignItem {
  id: string;
  title: string;
  room_type: string | null;
  stage: "assessment" | "full";
  thumbnail_url: string | null;
  project_id: string | null;
  room_id: string | null;
  created_at: string;
  updated_at: string;
}

export default function SavedDesignsPage() {
  const [designs, setDesigns] = useState<SavedDesignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/saved-designs")
      .then((r) => r.json())
      .then((data: SavedDesignItem[]) => setDesigns(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleExportCsv = () => {
    if (!designs.length) return;
    const header = ["Title", "Room Type", "Stage", "Date", "Project ID", "Room ID"];
    const rows = designs.map((d) => [
      `"${(d.title ?? "").replace(/"/g, '""')}"`,
      d.room_type ?? "",
      d.stage,
      new Date(d.updated_at).toLocaleDateString("en-US"),
      d.project_id ?? "",
      d.room_id ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-designs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this saved design? This can't be undone.")) return;
    setDeleting(id);
    const res = await fetch(`/api/saved-designs/${id}`, { method: "DELETE" });
    if (res.ok) {
      setDesigns((prev) => prev.filter((d) => d.id !== id));
    }
    setDeleting(null);
  };

  return (
    <PageTransition className="max-w-4xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Designs</h1>
            <p className="text-sm text-muted-foreground">Your saved room assessments and product selections</p>
          </div>
        </div>
        {designs.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : designs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Bookmark className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">No saved designs yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              When you complete a room assessment or product search, save it here for later.
            </p>
            <Link href="/dashboard">
              <Button variant="outline">Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <StaggerList className="grid gap-4 sm:grid-cols-2">
          {designs.map((design) => (
            <StaggerItem key={design.id}>
            <Card className="group hover:shadow-md transition-shadow overflow-hidden">
              {design.thumbnail_url && (
                <div className="h-36 overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={design.thumbnail_url}
                    alt={design.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              )}
              <CardContent className={design.thumbnail_url ? "pt-3" : "pt-5"}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate">{design.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {design.room_type && (
                        <span className="text-xs text-muted-foreground capitalize">{design.room_type.replace(/_/g, " ")}</span>
                      )}
                      <Badge variant={design.stage === "full" ? "default" : "secondary"} className="text-[10px]">
                        {design.stage === "full" ? "Full Design" : "Assessment"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(design.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(design.id)}
                      disabled={deleting === design.id}
                    >
                      {deleting === design.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2 sm:gap-2.5 mt-3">
                  <Link href={`/saved/${design.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs">
                      View
                    </Button>
                  </Link>
                  {design.stage === "assessment" && design.project_id && design.room_id && (
                    <Link href={`/projects/${design.project_id}/rooms/${design.room_id}/focus`} className="flex-1">
                      <Button size="sm" className="w-full text-xs">
                        Resume <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </PageTransition>
  );
}
