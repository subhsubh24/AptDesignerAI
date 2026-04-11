"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Loader2,
  Search,
  ExternalLink,
  CheckCircle2,
  Image as ImageIcon,
  ThumbsDown,
  DollarSign,
  TrendingUp,
  Crown,
  X,
  Eye,
  AlertTriangle,
  ShieldCheck,
  Ruler,
  LayoutGrid,
  MessageSquare,
  RefreshCw,
  ArrowRight,
  LinkIcon,
} from "lucide-react";
import { ManualSourcingForm } from "@/components/manual-sourcing/ManualSourcingForm";
import { ManualScorecardView, type EvaluateSetResult } from "@/components/manual-sourcing/ManualScorecardView";
import { getScoreColor } from "@/lib/scoring/verdicts";
import type { Verdict } from "@/lib/types/scoring";
import { cn } from "@/lib/utils/cn";

// ─── Types ───────────────────────────────────────────────────────

interface AreaAnalysis {
  summary: string;
  what_it_needs: Array<{
    category: string;
    search_title?: string;
    description: string;
    priority: "high" | "medium" | "low";
    specs: string;
  }>;
  what_works: string[];
  what_should_go: string[];
  design_direction: string;
  validation?: {
    isValid: boolean;
    confidence: number;
    issues: string[];
    suggestions: string[];
  };
}

interface ProductResult {
  id: string;
  title: string;
  category: string;
  retailer: string;
  product_url: string | null;
  image_url: string | null;
  price: number | null;
  metadata: { price_tier?: string } | null;
  product_evaluations: Array<{
    final_item_score: number;
    verdict: Verdict;
    style_fit_score: number;
    palette_fit_score: number;
    scale_fit_score: number;
    cohesion_fit_score: number;
    reasoning: { top_reasons: string[]; risks: string[] };
    area_fit_note?: string;
    apartment_fit_note?: string;
  }>;
}

type PriceTier = "budget" | "balanced" | "high_end";
type Step = "analyzing" | "analysis" | "vision" | "sourcing" | "results" | "mockup" | "manual_sourcing" | "manual_results";

const TIER_LABELS: Record<PriceTier, string> = {
  budget: "Budget",
  balanced: "Mid-Range",
  high_end: "Luxury",
};

// ─── Search phase labels for live progress ──────────────────────

const SEARCH_PHASES = [
  { key: "Generating intensive search brief", label: "Planning search strategy", weight: 5 },
  { key: "Searching across all retailers", label: "Searching retailers", weight: 25 },
  { key: "Quick-screening candidates", label: "Screening results", weight: 10 },
  { key: "Extracting product details from websites", label: "Reading product pages", weight: 25 },
  { key: "Quick-scoring all candidates", label: "Quick-scoring candidates", weight: 10 },
  { key: "Deep-scoring top candidates", label: "Evaluating finalists", weight: 20 },
  { key: "Validating all recommendations", label: "Final validation", weight: 5 },
];

// ─── Helpers ─────────────────────────────────────────────────────

function getProductTier(product: ProductResult): PriceTier {
  return (product.metadata?.price_tier as PriceTier) || "balanced";
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").filter(Boolean).slice(-1)[0] || "";
    const domain = u.hostname.replace("www.", "").split(".")[0];
    return `${domain}/${path.slice(0, 20)}${path.length > 20 ? "..." : ""}`;
  } catch {
    return url.slice(0, 30) + "...";
  }
}

// ─── Main Page ───────────────────────────────────────────────────

export default function FocusPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [step, setStep] = useState<Step>("analyzing");
  const [areaAnalysis, setAreaAnalysis] = useState<AreaAnalysis | null>(null);
  const [products, setProducts] = useState<ProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchStats, setSearchStats] = useState<Record<string, number> | null>(null);
  const [validationInfo, setValidationInfo] = useState<{ isValid: boolean; confidence: number; issues: string[] } | null>(null);
  const [roomInfo, setRoomInfo] = useState<{ name: string; room_type: string } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Live search progress (SSE)
  const [searchPhases, setSearchPhases] = useState<Array<{ step: string; status: string; data?: Record<string, unknown> }>>([]);
  const [liveStats, setLiveStats] = useState<Record<string, number>>({});
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  const [searchElapsed, setSearchElapsed] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Floor plan context
  const [floorPlan, setFloorPlan] = useState<{
    total_sqft?: string;
    room_dimensions?: Record<string, string>;
    living_dining_combined?: boolean;
    kitchen_style?: string;
    notable_spatial_features?: string[];
    room_layout?: string;
  } | null>(null);
  const [floorPlanFound, setFloorPlanFound] = useState<boolean | null>(null);

  // Feedback / refinement state
  const [feedbackText, setFeedbackText] = useState("");
  const [refining, setRefining] = useState(false);
  const [impactSummary, setImpactSummary] = useState<string | null>(null);
  const [changesMade, setChangesMade] = useState<string[]>([]);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);

  // Vision mockup state
  const [visionUrl, setVisionUrl] = useState<string | null>(null);
  const [generatingVision, setGeneratingVision] = useState(false);
  const [showVisionOverlay, setShowVisionOverlay] = useState(false);

  // Mockup state
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [generatingMockup, setGeneratingMockup] = useState(false);
  const [showMockupOverlay, setShowMockupOverlay] = useState(false);

  // Manual sourcing state
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<EvaluateSetResult | null>(null);

  // Elapsed time counter during search
  useEffect(() => {
    if (!searchStartTime || step !== "sourcing") return;
    const interval = setInterval(() => {
      setSearchElapsed(Math.floor((Date.now() - searchStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [searchStartTime, step]);

  // Run deep area analysis on mount — parallel data fetches
  useEffect(() => {
    async function analyze() {
      // Fetch room info, project, and existing analysis in parallel
      const [roomRes, projRes, existingRes] = await Promise.all([
        fetch(`/api/rooms/${roomId}`),
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/area-analysis?room_id=${roomId}`),
      ]);

      if (roomRes.ok) setRoomInfo(await roomRes.json());

      // Process floor plan from project
      try {
        if (projRes.ok) {
          const project = await projRes.json();
          const br = project?.building_research;
          if (br?.floor_plan) {
            const fp = br.floor_plan;
            const wasFound = fp.found === true;
            const hasRealData = wasFound && (fp.total_sqft || fp.room_dimensions || fp.notable_spatial_features?.length);
            setFloorPlan(fp);
            setFloorPlanFound(!!hasRealData);
          } else {
            setFloorPlanFound(false);
          }
        }
      } catch {
        setFloorPlanFound(false);
      }

      // Check existing analysis
      if (existingRes.ok) {
        const existing = await existingRes.json();
        if (existing.analysis) {
          setAreaAnalysis(existing.analysis);
          setStep("analysis");
          // Load existing products
          const prodRes = await fetch(`/api/products?room_id=${roomId}`);
          if (prodRes.ok) {
            const prods = await prodRes.json();
            if (prods.length > 0) { setProducts(prods); setStep("results"); }
          }
          return;
        }
      }

      // Run new analysis
      try {
        const res = await fetch("/api/area-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room_id: roomId, project_id: projectId }),
        });
        if (res.ok) {
          const data = await res.json();
          setAreaAnalysis(data.analysis);
          if (data.validation) setValidationInfo(data.validation);
          setStep("analysis");
        } else {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          setAnalysisError(err.error || "Analysis failed.");
          setStep("analysis");
        }
      } catch {
        setAnalysisError("Failed to connect. Please try again.");
        setStep("analysis");
      }
    }
    analyze();
  }, [roomId, projectId]);

  // Refine analysis based on user feedback
  const handleRefine = async () => {
    if (!feedbackText.trim() || !areaAnalysis) return;
    setRefining(true);
    setImpactSummary(null);
    setChangesMade([]);

    try {
      const res = await fetch("/api/area-analysis/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          project_id: projectId,
          user_feedback: feedbackText.trim(),
          previous_analysis: areaAnalysis,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAreaAnalysis(data.analysis);
        setImpactSummary(data.impact_summary || null);
        setChangesMade(data.changes_made || []);
        setFeedbackText("");
        setShowFeedbackInput(false);
        // Clear existing products and vision since the analysis changed
        setProducts([]);
        setVisionUrl(null);
        visionTriggered.current = false; // Allow auto-regeneration for new analysis
      }
    } catch (err) {
      console.error("Refinement error:", err);
    }
    setRefining(false);
  };

  // Auto-trigger vision mockup when analysis is ready (runs in background)
  const visionTriggered = useRef(false);

  const generateVisionInBackground = async (analysis: AreaAnalysis) => {
    setGeneratingVision(true);
    const items = analysis.what_it_needs.map((n) => n.search_title || n.description).join("; ") || "";
    try {
      const res = await fetch("/api/mockups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          vision_mode: true,
          design_direction: analysis.design_direction || "",
          items_description: items,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setVisionUrl(data.image_url);
      }
    } catch (err) {
      console.error("Background vision generation error:", err);
    }
    setGeneratingVision(false);
  };

  useEffect(() => {
    if (areaAnalysis && !visionTriggered.current && !visionUrl && step === "analysis") {
      visionTriggered.current = true;
      // Fire and forget — generates in background while user reviews assessment
      generateVisionInBackground(areaAnalysis);
    }
  }, [areaAnalysis, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual trigger for vision mockup (re-generate or generate from vision step)
  const handleGenerateVision = async () => {
    setGeneratingVision(true);
    if (step === "analysis") {
      // Just re-trigger background generation, don't change step
      if (areaAnalysis) {
        visionTriggered.current = true; // eslint-disable-line react-hooks/immutability
        setVisionUrl(null);
        await generateVisionInBackground(areaAnalysis);
      }
      return;
    }
    setStep("vision");

    // Build description from area analysis — use search_title for specificity
    const items = areaAnalysis?.what_it_needs.map((n) => n.search_title || n.description).join("; ") || "";

    const res = await fetch("/api/mockups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_id: roomId,
        vision_mode: true,
        design_direction: areaAnalysis?.design_direction || "",
        items_description: items,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setVisionUrl(data.image_url);
      setShowVisionOverlay(true);
    }
    setGeneratingVision(false);
  };

  // Agentic search with SSE streaming for live progress
  const handleSearch = async () => {
    setSearching(true);
    setStep("sourcing");
    setSearchPhases([]);
    setLiveStats({});
    setSearchStartTime(Date.now());
    setSearchElapsed(0);
    setSearchError(null);

    const sorted = [...(areaAnalysis?.what_it_needs || [])].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] || 1) - (order[b.priority] || 1);
    });
    const categories = sorted.map((n) => ({
      category: n.category,
      search_title: n.search_title || n.description,
      specs: n.specs,
    }));

    try {
      const res = await fetch("/api/search/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, categories }),
      });

      if (!res.ok || !res.body) {
        // Fallback to batch endpoint
        const batchRes = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room_id: roomId, categories }),
        });
        if (batchRes.ok) {
          const data = await batchRes.json();
          if (data.stats) setSearchStats(data.stats);
          if (data.validation) setValidationInfo(data.validation);
          const prodRes = await fetch(`/api/products?room_id=${roomId}`);
          if (prodRes.ok) setProducts(await prodRes.json());
        }
        setSearching(false);
        setStep("results");
        return;
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));

              if (currentEvent === "step") {
                setSearchPhases((prev) => {
                  // Update existing phase or add new one
                  const existing = prev.findIndex((p) => p.step === data.step);
                  if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = data;
                    return updated;
                  }
                  return [...prev, data];
                });
                // Update live stats from step data
                if (data.data?.stats) {
                  setLiveStats(data.data.stats);
                }
              } else if (currentEvent === "done") {
                if (data.stats) setSearchStats(data.stats);
                if (data.validation) setValidationInfo(data.validation);
                // Load final products
                const prodRes = await fetch(`/api/products?room_id=${roomId}`);
                if (prodRes.ok) setProducts(await prodRes.json());
              } else if (currentEvent === "error") {
                console.error("Search stream error:", data.error);
                setSearchError(data.error || "Search failed");
              }
            } catch {
              // Skip malformed JSON
            }
            currentEvent = "";
          }
        }
      }
    } catch (e) {
      console.error("Search error:", e);
      setSearchError(e instanceof Error ? e.message : "Search failed — please try again");
    }
    setSearching(false);
    setSearchStartTime(null);
    setStep("results");
  };

  // Post-search mockup
  const handleGenerateMockup = async (tier: PriceTier) => {
    setGeneratingMockup(true);
    const tierProducts = products
      .filter((p) => getProductTier(p) === tier)
      .sort((a, b) => (b.product_evaluations?.[0]?.final_item_score || 0) - (a.product_evaluations?.[0]?.final_item_score || 0))
      .slice(0, 5);

    const res = await fetch("/api/mockups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, product_ids: tierProducts.map((p) => p.id) }),
    });

    if (res.ok) {
      const data = await res.json();
      setMockupUrl(data.image_url);
      setShowMockupOverlay(true);
    }
    setGeneratingMockup(false);
  };

  // Manual sourcing — evaluate user-provided URLs
  const handleManualSubmit = async (items: Array<{ category: string; urls: string[] }>) => {
    setManualLoading(true);
    try {
      const res = await fetch("/api/products/evaluate-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, items }),
      });
      if (res.ok) {
        const data = await res.json();
        setManualResult(data);
        setStep("manual_results");
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to evaluate" }));
        console.error("Manual sourcing error:", err);
      }
    } catch (err) {
      console.error("Manual sourcing error:", err);
    }
    setManualLoading(false);
  };

  const handleSaveAndContinue = async () => {
    await fetch(`/api/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    router.push("/dashboard");
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 px-4">
      {/* Header */}
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> All rooms
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{roomInfo?.name || "Room"}</h1>
      </div>

      {/* ─── Step: Analyzing ─── */}
      {step === "analyzing" && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center mb-8">
              <Loader2 className="h-8 w-8 animate-spin text-accent-warm mb-4" />
              <h3 className="text-lg font-semibold">Studying this room</h3>
              <p className="text-sm text-muted-foreground mt-1">Usually 15-30 seconds</p>
            </div>
            <div className="max-w-sm mx-auto space-y-2">
              <AnalysisSubstep label="Reading room photos" delay={0} />
              <AnalysisSubstep label="Checking building finishes" delay={2000} />
              <AnalysisSubstep label="Cross-referencing other rooms" delay={5000} />
              <AnalysisSubstep label="Forming design assessment" delay={8000} />
              <AnalysisSubstep label="Validating recommendations" delay={15000} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {step === "analysis" && analysisError && !areaAnalysis && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-destructive font-medium">{analysisError}</p>
            <Button onClick={() => { setAnalysisError(null); setStep("analyzing"); window.location.reload(); }}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Step: Analysis Results ─── */}
      {step === "analysis" && areaAnalysis && (
        <>
          {/* Validation banner */}
          {areaAnalysis.validation && (
            <div className={cn(
              "flex items-center gap-3 p-3 rounded-xl text-sm",
              areaAnalysis.validation.confidence >= 7
                ? "bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                : "bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
            )}>
              {areaAnalysis.validation.confidence >= 7 ? (
                <ShieldCheck className="h-5 w-5 shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 shrink-0" />
              )}
              <div>
                <span className="font-medium">Confidence: {areaAnalysis.validation.confidence}/10</span>
                {areaAnalysis.validation.issues.length > 0 && (
                  <p className="text-xs mt-0.5 opacity-80">{areaAnalysis.validation.issues[0]}</p>
                )}
              </div>
            </div>
          )}

          {/* Floor plan context */}
          {floorPlanFound !== null && (
            <div className={cn(
              "flex items-start gap-3 p-3 rounded-xl text-sm",
              floorPlanFound
                ? "bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300"
                : "bg-muted/50 border text-muted-foreground"
            )}>
              {floorPlanFound ? (
                <Ruler className="h-5 w-5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              ) : (
                <LayoutGrid className="h-5 w-5 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                {floorPlanFound && floorPlan ? (
                  <>
                    <span className="font-medium">Floor plan found</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs">
                      {floorPlan.total_sqft && (
                        <span>{floorPlan.total_sqft} sqft</span>
                      )}
                      {floorPlan.room_dimensions && roomInfo && floorPlan.room_dimensions[roomInfo.room_type] && (
                        <span>This room: ~{floorPlan.room_dimensions[roomInfo.room_type]}</span>
                      )}
                      {floorPlan.living_dining_combined && (
                        <span>Combined living/dining</span>
                      )}
                      {floorPlan.kitchen_style && (
                        <span>Kitchen: {floorPlan.kitchen_style}</span>
                      )}
                    </div>
                    {floorPlan.notable_spatial_features && floorPlan.notable_spatial_features.length > 0 && (
                      <p className="text-xs mt-1 opacity-80">
                        Layout: {floorPlan.notable_spatial_features.join(", ")}
                      </p>
                    )}
                  </>
                ) : (
                  <span>No floor plan found — furniture sizing based on photos only</span>
                )}
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Design Assessment</CardTitle>
              <CardDescription>{areaAnalysis.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-semibold text-sm mb-3">What to get</h3>
                <div className="space-y-3">
                  {(areaAnalysis.what_it_needs || []).map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-muted/50">
                      <Badge variant={item.priority === "high" ? "default" : "secondary"} className="shrink-0 mt-0.5">{item.priority}</Badge>
                      <div>
                        <p className="font-medium text-sm">{item.search_title || item.category.replace(/_/g, " ")}</p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                        {item.specs && <p className="text-xs text-muted-foreground mt-1 italic">{item.specs}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold text-sm mb-2 text-emerald-700">Keep</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {(areaAnalysis.what_works || []).map((item, i) => (
                      <li key={i} className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-2 text-amber-700">Replace or remove</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {(areaAnalysis.what_should_go || []).map((item, i) => (
                      <li key={i} className="flex items-start gap-2"><ThumbsDown className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="p-3 rounded-xl border bg-primary/5">
                <h3 className="font-semibold text-sm mb-1">Design Direction</h3>
                <p className="text-sm text-muted-foreground">{areaAnalysis.design_direction}</p>
              </div>

              {/* Vision Preview — auto-generated, appears at bottom of assessment as the "reveal" */}
              <div className="pt-2">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Design Vision Preview
                </h3>
                {visionUrl ? (
                  <div className="space-y-3">
                    <div
                      className="relative rounded-xl overflow-hidden border cursor-pointer group"
                      onClick={() => setShowVisionOverlay(true)}
                    >
                      <img src={visionUrl} alt="Design vision preview" className="w-full h-auto" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm font-medium bg-black/60 px-3 py-1.5 rounded-full">
                          View full size
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground flex-1">AI-generated preview based on the design direction above</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={handleGenerateVision}
                        disabled={generatingVision}
                      >
                        {generatingVision ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        Regenerate
                      </Button>
                    </div>
                  </div>
                ) : generatingVision ? (
                  <div className="flex items-center gap-3 p-6 rounded-xl bg-muted/30 border border-dashed">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Generating design vision...</p>
                      <p className="text-xs text-muted-foreground">Creating a preview of your room redesigned</p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateVision}
                    className="w-full flex items-center gap-3 p-6 rounded-xl bg-muted/30 border border-dashed hover:bg-muted/50 hover:border-primary/30 transition-colors text-left"
                  >
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Generate design preview</p>
                      <p className="text-xs text-muted-foreground">See an AI visualization of this room redesigned</p>
                    </div>
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Impact summary — shown after refinement */}
          {impactSummary && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-300 animate-fade-in-up">
              <RefreshCw className="h-5 w-5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Analysis updated based on your feedback</p>
                <p className="text-sm">{impactSummary}</p>
                {changesMade.length > 0 && (
                  <ul className="text-xs space-y-0.5 mt-1">
                    {changesMade.map((change, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <ArrowRight className="h-3 w-3 shrink-0 mt-0.5 text-blue-500" />
                        <span>{change}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* User feedback input */}
          {showFeedbackInput ? (
            <Card className="border-accent-warm/30 animate-fade-in-up">
              <CardContent className="pt-5 pb-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="h-4 w-4 text-accent-warm" />
                  Refine this assessment
                </div>
                <Textarea
                  placeholder={"e.g. \"Actually I want to keep the floor lamp\" or \"I need more seating for hosting\" or \"I prefer lighter wood tones\""}
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                  disabled={refining}
                />
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleRefine}
                    disabled={!feedbackText.trim() || refining}
                    size="sm"
                  >
                    {refining ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        Refining...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                        Refine Analysis
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowFeedbackInput(false); setFeedbackText(""); }}
                    disabled={refining}
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setShowFeedbackInput(true)}
            >
              <MessageSquare className="h-4 w-4 mr-1.5" />
              Something off? Refine this assessment
            </Button>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" className="flex-1 h-14 text-base" onClick={handleSearch} disabled={refining}>
              <Search className="h-5 w-5 mr-2" />
              Find pieces for this room
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="flex-1 h-14 text-base"
              onClick={() => setStep("manual_sourcing")}
              disabled={refining}
            >
              <LinkIcon className="h-5 w-5 mr-2" />
              I&apos;ll find my own
            </Button>
          </div>
        </>
      )}

      {/* ─── Step: Vision Mockup (pre-search) ─── */}
      {step === "vision" && generatingVision && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <h3 className="text-lg font-semibold">Imagining your room redesigned...</h3>
            <p className="text-sm text-muted-foreground mt-1">Creating a vision based on the design direction</p>
          </CardContent>
        </Card>
      )}

      {/* ─── Step: Sourcing (live progress) ─── */}
      {step === "sourcing" && searching && (
        <Card>
          <CardContent className="py-10">
            {/* Header with elapsed time */}
            <div className="flex flex-col items-center mb-6">
              <Loader2 className="h-8 w-8 animate-spin text-accent-warm mb-4" />
              <h3 className="text-lg font-semibold">Sourcing pieces for your room</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md text-center">
                Searching across retailers at every price point
              </p>
              {searchElapsed > 0 && (
                <span className="text-xs text-muted-foreground mt-2 font-mono tabular-nums">
                  {Math.floor(searchElapsed / 60)}:{String(searchElapsed % 60).padStart(2, "0")} elapsed
                </span>
              )}
            </div>

            {/* Overall progress bar */}
            {(() => {
              const completedWeight = SEARCH_PHASES.reduce((sum, phase) => {
                const match = searchPhases.find((p) => p.step === phase.key);
                if (match?.status === "completed") return sum + phase.weight;
                if (match?.status === "running") {
                  // Estimate partial progress for running phases
                  const data = match.data as Record<string, number> | undefined;
                  if (data?.progress && data?.total && data.total > 0) {
                    return sum + (phase.weight * data.progress / data.total);
                  }
                  return sum + phase.weight * 0.3; // Show ~30% when running with no granular data
                }
                return sum;
              }, 0);
              const totalWeight = SEARCH_PHASES.reduce((sum, p) => sum + p.weight, 0);
              const pct = Math.min(Math.round((completedWeight / totalWeight) * 100), 99);
              return (
                <div className="max-w-md mx-auto mb-6">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span>Progress</span>
                    <span className="font-mono tabular-nums">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
              );
            })()}

            {/* Live phase progress */}
            <div className="max-w-md mx-auto space-y-1.5">
              {SEARCH_PHASES.map((phase) => {
                const match = searchPhases.find((p) => p.step === phase.key);
                const isDone = match?.status === "completed";
                const isActive = match?.status === "running";
                const data = match?.data as Record<string, number> | undefined;
                // Build a descriptive live counter
                let liveCount = "";
                if (isDone || isActive) {
                  if (data?.completed && data?.total) {
                    liveCount = `${data.completed}/${data.total}`;
                  } else if (data?.extracted != null) {
                    liveCount = `${data.extracted} found`;
                  } else if (data?.deepScored != null && data?.total) {
                    liveCount = `${data.deepScored}/${data.total}`;
                  } else if (data?.screened != null) {
                    liveCount = `${data.screened} passed`;
                  } else if (data?.quickScored != null) {
                    liveCount = `${data.quickScored} scored`;
                  } else if (data?.queries != null) {
                    liveCount = `${data.queries} queries`;
                  } else if (data?.rawUrls != null) {
                    liveCount = `${data.rawUrls} URLs`;
                  }
                }
                return (
                  <div key={phase.key} className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-xl transition-colors",
                    isActive && "bg-accent/50",
                  )}>
                    <div className="w-5 flex justify-center">
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : isActive ? (
                        <Loader2 className="h-4 w-4 animate-spin text-accent-warm" />
                      ) : (
                        <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={cn(
                        "text-sm",
                        isDone && "text-emerald-700 font-medium",
                        isActive && "text-foreground font-medium",
                        !isDone && !isActive && "text-muted-foreground/60"
                      )}>
                        {phase.label}
                      </span>
                    </div>
                    {liveCount && (
                      <span className={cn(
                        "text-xs font-mono tabular-nums",
                        isActive ? "text-accent-warm font-medium" : "text-muted-foreground"
                      )}>
                        {liveCount}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Live stats summary bar */}
            {Object.keys(liveStats).length > 0 && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {liveStats.totalSearchQueries > 0 && <span>{liveStats.totalSearchQueries} queries</span>}
                {liveStats.totalRawUrls > 0 && <><span className="text-border">·</span><span>{liveStats.totalRawUrls} URLs</span></>}
                {liveStats.totalExtracted > 0 && <><span className="text-border">·</span><span>{liveStats.totalExtracted} products</span></>}
                {liveStats.totalDeepScored > 0 && <><span className="text-border">·</span><span>{liveStats.totalDeepScored} scored</span></>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Step: Results ─── */}
      {step === "results" && (
        <>
          {/* Error banner with retry */}
          {searchError && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Something went wrong during search</p>
                <p className="text-xs mt-0.5 opacity-80">{searchError}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setSearchError(null); handleSearch(); }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          )}

          {/* Stats bar */}
          {searchStats && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/50 rounded-xl px-4 py-2">
              <span>{searchStats.totalSearchQueries} searches</span>
              <span className="text-border">|</span>
              <span>{searchStats.totalRawUrls} URLs found</span>
              <span className="text-border">|</span>
              <span>{searchStats.totalExtracted} extracted</span>
              <span className="text-border">|</span>
              <span>{searchStats.totalDeepScored} deep-scored</span>
              <span className="text-border">|</span>
              <span className="font-medium text-foreground">{searchStats.totalFinal} final picks</span>
            </div>
          )}

          {/* Validation banner */}
          {validationInfo && (
            <div className={cn(
              "flex items-center gap-3 p-3 rounded-xl text-sm",
              validationInfo.confidence >= 7
                ? "bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                : "bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
            )}>
              {validationInfo.confidence >= 7 ? <ShieldCheck className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
              <div>
                <span className="font-medium">Confidence: {validationInfo.confidence}/10</span>
                {validationInfo.issues?.length > 0 && (
                  <p className="text-xs mt-0.5 opacity-80">{validationInfo.issues.slice(0, 2).join(" • ")}</p>
                )}
              </div>
            </div>
          )}

          <h2 className="text-xl font-bold">Our picks</h2>

          {products.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><p className="text-muted-foreground">No products found yet. Try running a search.</p></CardContent></Card>
          ) : (
            <RecommendationTable
              products={products}
              onGenerateMockup={handleGenerateMockup}
              generatingMockup={generatingMockup}
            />
          )}

          {/* Actions */}
          <div className="flex gap-4 justify-center pt-4">
            <Button variant="outline" onClick={() => setStep("analysis")}>Back to assessment</Button>
            <Button onClick={handleSaveAndContinue}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Done — next room
            </Button>
          </div>
        </>
      )}

      {/* ─── Step: Manual Sourcing Form ─── */}
      {step === "manual_sourcing" && areaAnalysis && (
        <ManualSourcingForm
          categories={areaAnalysis.what_it_needs || []}
          onSubmit={handleManualSubmit}
          loading={manualLoading}
          onCancel={() => setStep("analysis")}
        />
      )}

      {/* ─── Step: Manual Results Scorecard ─── */}
      {step === "manual_results" && manualResult && (
        <ManualScorecardView
          result={manualResult}
          onBack={() => setStep("analysis")}
        />
      )}

      {/* ─── Vision Overlay ─── */}
      {showVisionOverlay && visionUrl && (
        <ImageOverlay
          imageUrl={visionUrl}
          title="Your room, reimagined"
          subtitle="A preview of the direction we&apos;re heading. Ready to find the real pieces?"
          onClose={() => { setShowVisionOverlay(false); setStep("analysis"); }}
          actions={
            <Button onClick={() => { setShowVisionOverlay(false); handleSearch(); }}>
              <Search className="h-4 w-4 mr-2" /> Find these pieces
            </Button>
          }
        />
      )}

      {/* ─── Mockup Overlay ─── */}
      {showMockupOverlay && mockupUrl && (
        <ImageOverlay
          imageUrl={mockupUrl}
          title="Room mockup"
          subtitle="Here&apos;s how these pieces would look in your space."
          onClose={() => setShowMockupOverlay(false)}
          actions={
            <>
              <Button variant="outline" onClick={() => setShowMockupOverlay(false)}>Back to picks</Button>
              <Button onClick={handleSaveAndContinue}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Done — next room
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

// ─── Image Overlay ───────────────────────────────────────────────

// ─── Analysis Substep (timed reveal) ────────────────────────────

function AnalysisSubstep({ label, delay }: { label: string; delay: number }) {
  const [state, setState] = useState<"pending" | "active" | "done">("pending");

  useEffect(() => {
    const activateTimer = setTimeout(() => setState("active"), delay);
    const doneTimer = setTimeout(() => setState("done"), delay + 3000);
    return () => { clearTimeout(activateTimer); clearTimeout(doneTimer); };
  }, [delay]);

  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-300",
      state === "active" && "bg-accent/50",
    )}>
      <div className="w-5 flex justify-center">
        {state === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : state === "active" ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent-warm" />
        ) : (
          <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20" />
        )}
      </div>
      <span className={cn(
        "text-sm transition-colors",
        state === "done" && "text-emerald-700 font-medium",
        state === "active" && "text-foreground font-medium",
        state === "pending" && "text-muted-foreground/60",
      )}>
        {label}
      </span>
    </div>
  );
}

// ─── Image Overlay ───────────────────────────────────────────────

function ImageOverlay({
  imageUrl,
  title,
  subtitle,
  onClose,
  actions,
}: {
  imageUrl: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  actions: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-up">
      <div className="max-w-4xl w-full bg-background rounded-2xl overflow-hidden shadow-2xl">
        <div className="relative">
          <img src={imageUrl} alt={title} className="w-full aspect-video object-cover" />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex gap-3 flex-wrap">{actions}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Recommendation Table ────────────────────────────────────────

function RecommendationTable({
  products,
  onGenerateMockup,
  generatingMockup,
}: {
  products: ProductResult[];
  onGenerateMockup: (tier: PriceTier) => void;
  generatingMockup: boolean;
}) {
  // Group products by category, then find best per tier
  const categories = [...new Set(products.map((p) => p.category))].sort();
  const tiers: PriceTier[] = ["budget", "balanced", "high_end"];

  function getBestForTier(category: string, tier: PriceTier): ProductResult | null {
    return products
      .filter((p) => p.category === category && getProductTier(p) === tier)
      .sort((a, b) => (b.product_evaluations?.[0]?.final_item_score || 0) - (a.product_evaluations?.[0]?.final_item_score || 0))
      [0] || null;
  }

  // Calculate tier totals
  const tierTotals: Record<PriceTier, number> = { budget: 0, balanced: 0, high_end: 0 };
  for (const cat of categories) {
    for (const tier of tiers) {
      const best = getBestForTier(cat, tier);
      if (best?.price) tierTotals[tier] += best.price;
    }
  }

  return (
    <div className="space-y-4">
      {/* Desktop: Table view */}
      <div className="hidden md:block rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 w-[200px]">Item</th>
              <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Why</th>
              <th className="text-center text-xs font-semibold px-4 py-3 w-[140px]">
                <div className="flex items-center justify-center gap-1.5 text-emerald-700">
                  <DollarSign className="h-3.5 w-3.5" /> Budget
                </div>
              </th>
              <th className="text-center text-xs font-semibold px-4 py-3 w-[140px]">
                <div className="flex items-center justify-center gap-1.5 text-blue-700">
                  <TrendingUp className="h-3.5 w-3.5" /> Mid-Range
                </div>
              </th>
              <th className="text-center text-xs font-semibold px-4 py-3 w-[140px]">
                <div className="flex items-center justify-center gap-1.5 text-purple-700">
                  <Crown className="h-3.5 w-3.5" /> Luxury
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category, idx) => {
              const budget = getBestForTier(category, "budget");
              const balanced = getBestForTier(category, "balanced");
              const highEnd = getBestForTier(category, "high_end");
              // analysisItem rationale from area analysis (reserved for future use)

              return (
                <tr key={category} className={cn("border-t", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-sm">{category.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {budget?.product_evaluations?.[0]?.reasoning?.top_reasons?.[0]
                        || balanced?.product_evaluations?.[0]?.reasoning?.top_reasons?.[0]
                        || highEnd?.product_evaluations?.[0]?.reasoning?.top_reasons?.[0]
                        || "—"}
                    </p>
                  </td>
                  <TierCell product={budget} tier="budget" />
                  <TierCell product={balanced} tier="balanced" />
                  <TierCell product={highEnd} tier="high_end" />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/50">
              <td className="px-4 py-3 font-semibold text-sm" colSpan={2}>Estimated Total</td>
              <td className="px-4 py-3 text-center text-sm font-semibold text-emerald-700">
                ${tierTotals.budget.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-center text-sm font-semibold text-blue-700">
                ${tierTotals.balanced.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-center text-sm font-semibold text-purple-700">
                ${tierTotals.high_end.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile: Card view */}
      <div className="md:hidden space-y-4">
        {categories.map((category) => (
          <Card key={category}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base capitalize">{category.replace(/_/g, " ")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tiers.map((tier) => {
                const product = getBestForTier(category, tier);
                if (!product) return null;
                const eval0 = product.product_evaluations?.[0];
                return (
                  <div key={tier} className="flex items-center gap-3 p-2 rounded-xl bg-muted/30">
                    {product.image_url && (
                      <img src={product.image_url} alt="" className="h-12 w-12 rounded object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={cn("text-[10px]",
                          tier === "budget" ? "text-emerald-700 border-emerald-200" :
                          tier === "balanced" ? "text-blue-700 border-blue-200" :
                          "text-purple-700 border-purple-200"
                        )}>
                          {TIER_LABELS[tier]}
                        </Badge>
                        {product.price && <span className="text-xs font-medium">${product.price}</span>}
                        {eval0 && (
                          <span className={cn("text-xs font-bold ml-auto", getScoreColor(eval0.final_item_score))}>
                            {eval0.final_item_score.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{product.title}</p>
                    </div>
                    {product.product_url && (
                      <a href={product.product_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </a>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Mockup buttons per tier */}
      <div className="flex flex-wrap gap-3 justify-center pt-2">
        {tiers.map((tier) => (
          <Button
            key={tier}
            variant="outline"
            size="sm"
            onClick={() => onGenerateMockup(tier)}
            disabled={generatingMockup}
            className="gap-2"
          >
            {generatingMockup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            See {TIER_LABELS[tier]} Mockup
          </Button>
        ))}
      </div>
    </div>
  );
}

// ─── Tier Cell (table) ───────────────────────────────────────────

function TierCell({ product, tier }: { product: ProductResult | null; tier: PriceTier }) {
  if (!product) {
    return <td className="px-4 py-3 text-center text-xs text-muted-foreground">—</td>;
  }

  const eval0 = product.product_evaluations?.[0];
  const tierColorClass =
    tier === "budget" ? "text-emerald-700" :
    tier === "balanced" ? "text-blue-700" :
    "text-purple-700";

  return (
    <td className="px-4 py-3">
      <div className="flex flex-col items-center gap-1 text-center">
        {product.image_url && (
          <img src={product.image_url} alt="" className="h-10 w-10 rounded object-cover" />
        )}
        <span className={cn("text-xs font-semibold", tierColorClass)}>
          {product.price ? `$${product.price}` : "—"}
        </span>
        {eval0 && (
          <span className={cn("text-[10px] font-bold", getScoreColor(eval0.final_item_score))}>
            {eval0.final_item_score.toFixed(1)}
          </span>
        )}
        {product.product_url && (
          <a
            href={product.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline flex items-center gap-0.5"
          >
            {shortenUrl(product.product_url)}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </td>
  );
}

