"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Loader2, Image as ImageIcon, Sparkles } from "lucide-react";

interface Mockup {
  id: string;
  result_image_url: string | null;
  prompt: string | null;
  status: string;
  created_at: string;
  generation_provider: string | null;
}

export default function MockupsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/mockups?room_id=${roomId}`);
      if (res.ok) setMockups(await res.json());
      setLoading(false);
    }
    load();
  }, [roomId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const productsRes = await fetch(`/api/products?room_id=${roomId}`);
      if (!productsRes.ok) return;
      const products = await productsRes.json();
      const selected = products.filter(
        (p: { status: string }) => p.status === "shortlisted" || p.status === "accepted"
      );

      const res = await fetch("/api/mockups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          product_ids: selected.map((p: { id: string }) => p.id),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMockups((prev) => [data, ...prev]);
      }
    } finally {
      setGenerating(false);
    }
  };

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Mockups</h1>
            <p className="text-muted-foreground mt-1">
              AI-generated room visualizations
            </p>
          </div>
          <Button onClick={handleGenerate} disabled={generating} variant="warm">
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Mockup
              </>
            )}
          </Button>
        </div>
      </div>

      {mockups.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center mb-5">
              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No mockups yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Shortlist products and click &quot;Generate Mockup&quot; to create a room visualization.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {mockups.map((mockup) => (
            <Card key={mockup.id} className="overflow-hidden group hover:shadow-lg transition-all duration-300">
              {mockup.result_image_url ? (
                <div className="aspect-video w-full overflow-hidden bg-muted">
                  <img
                    src={mockup.result_image_url}
                    alt="Room mockup"
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
              ) : (
                <div className="aspect-video w-full flex items-center justify-center bg-muted">
                  {mockup.status === "generating" ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-accent-warm" />
                      <span className="text-xs text-muted-foreground">Generating...</span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {mockup.status === "failed" ? "Generation failed" : "Pending"}
                    </p>
                  )}
                </div>
              )}
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(mockup.created_at).toLocaleDateString()}</span>
                  <span className="capitalize font-medium">{mockup.status}</span>
                </div>
                {mockup.prompt && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-3 leading-relaxed">
                    {mockup.prompt}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
