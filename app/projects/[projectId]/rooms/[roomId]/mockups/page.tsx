"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Image as ImageIcon, Sparkles, X, Maximize2, Download } from "lucide-react";
import { ShareButton } from "@/components/ui/share-button";
import { cn } from "@/lib/utils/cn";

interface Mockup {
  id: string;
  result_image_url: string | null;
  prompt: string | null;
  status: string;
  created_at: string;
  generation_provider: string | null;
}

const GENERATION_STEPS = [
  { label: "Composing scene...", delay: 0 },
  { label: "Rendering design...", delay: 3000 },
  { label: "Enhancing details...", delay: 6000 },
];

export default function MockupsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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
    setGenerationStep(0);

    // Simulate generation steps
    const stepTimers = GENERATION_STEPS.map((_, i) =>
      setTimeout(() => setGenerationStep(i), GENERATION_STEPS[i].delay)
    );

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
      stepTimers.forEach(clearTimeout);
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
            <h1 className="text-headline">Mockups</h1>
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

      {/* Generation progress */}
      {generating && (
        <Card variant="elevated" className="animate-fade-in-up">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-accent-warm/20 to-accent-warm/5 flex items-center justify-center animate-float">
                <Sparkles className="h-8 w-8 text-accent-warm" />
              </div>
              <div className="space-y-2 text-center">
                {GENERATION_STEPS.map((step, i) => (
                  <div
                    key={i}
                    className={cn(
                      "text-sm transition-all duration-300",
                      i <= generationStep ? "text-foreground font-medium" : "text-muted-foreground/40",
                      i === generationStep && "text-accent-warm"
                    )}
                  >
                    {i < generationStep ? "✓ " : i === generationStep ? "⟳ " : ""}
                    {step.label}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mockups.length === 0 && !generating ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-accent-warm/10 to-accent-warm/5 flex items-center justify-center mb-6 animate-float">
              <ImageIcon className="h-10 w-10 text-accent-warm/50" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No mockups yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
              Shortlist products and click &quot;Generate Mockup&quot; to see how your room could look.
            </p>
            <Button onClick={handleGenerate} variant="warm" size="lg" className="animate-gentle-glow">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Your First Mockup
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 animate-stagger-children">
          {mockups.map((mockup) => (
            <Card key={mockup.id} variant="interactive" className="overflow-hidden animate-fade-in-up">
              {mockup.result_image_url ? (
                <div
                  className="aspect-video w-full overflow-hidden bg-muted relative cursor-pointer group"
                  onClick={() => setLightboxUrl(mockup.result_image_url)}
                >
                  <img
                    src={mockup.result_image_url}
                    alt="Room mockup"
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <Maximize2 className="h-5 w-5 text-foreground" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-video w-full flex items-center justify-center bg-muted">
                  {mockup.status === "generating" ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-accent-warm" />
                      <span className="text-xs text-muted-foreground">Generating...</span>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Badge variant={mockup.status === "failed" ? "destructive" : "secondary"}>
                        {mockup.status === "failed" ? "Failed" : "Pending"}
                      </Badge>
                    </div>
                  )}
                </div>
              )}
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    <span>{new Date(mockup.created_at).toLocaleDateString()}</span>
                    <span className="mx-2">·</span>
                    <span className="capitalize font-medium">{mockup.status}</span>
                  </div>
                  <div className="flex gap-1">
                    {mockup.result_image_url && (
                      <>
                        <ShareButton
                          title="Check out my AI room mockup"
                          text="Made with AptDesigner"
                          url={mockup.result_image_url}
                        />
                        <Button size="sm" variant="ghost" asChild>
                          <a href={mockup.result_image_url} download target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {mockup.prompt && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
                    {mockup.prompt}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Fullscreen Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-5xl p-0 bg-black/95 border-none">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-10 text-white hover:bg-white/20"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="h-5 w-5" />
          </Button>
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt="Room mockup"
              className="w-full h-auto max-h-[90vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
