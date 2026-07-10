"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
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
  RefreshCw,
  LinkIcon,
  Bookmark,
  BookmarkCheck,
} from "lucide-react";
import { ManualSourcingForm } from "@/components/manual-sourcing/ManualSourcingForm";
import { ManualScorecardView, type EvaluateSetResult } from "@/components/manual-sourcing/ManualScorecardView";
import { RefineChat } from "@/components/refine/RefineChat";
import { getScoreColor } from "@/lib/scoring/verdicts";
import { TIER_COLORS, TIER_LABELS, type PriceTier } from "@/lib/utils/tier-colors";
import { PageTransition, StaggerList, StaggerItem, ScrollReveal } from "@/components/ui/motion";
import type { Verdict } from "@/lib/types/scoring";
import { cn } from "@/lib/utils/cn";
import { trackEvent } from "@/lib/analytics";
import { toast } from "@/components/ui/toast";

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
  style_name?: string;
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
  metadata: { price_tier?: string; fill_source?: string; fill_origin_tier?: string } | null;
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

type Step = "analyzing" | "analysis" | "vision" | "sourcing" | "results" | "mockup" | "manual_sourcing" | "manual_results";

// ─── Search phase labels for live progress ──────────────────────

const SEARCH_PHASES = [
  { key: "Generating intensive search brief", label: "Planning search strategy", weight: 4 },
  { key: "Searching across all retailers", label: "Searching retailers", weight: 20 },
  { key: "Quick-screening candidates", label: "Screening results", weight: 8 },
  { key: "Extracting product details from websites", label: "Reading product pages", weight: 20 },
  { key: "Quick-scoring all candidates", label: "Quick-scoring candidates", weight: 8 },
  { key: "Deep-scoring top candidates", label: "Evaluating finalists", weight: 18 },
  { key: "Validating all recommendations", label: "Final validation", weight: 6 },
  { key: "Generating bundles", label: "Composing bundles", weight: 12 },
  { key: "Re-evaluating bundles after backfill", label: "Refining bundles", weight: 4 },
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
  const [fillAllTiers, setFillAllTiers] = useState<boolean>(false);

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

  // Refinement is now handled by the <RefineChat /> chat panel.
  // No local state needed — it owns its messages, input, and loading flags.

  // Vision mockup state
  const [visionUrl, setVisionUrl] = useState<string | null>(null);
  const [generatingVision, setGeneratingVision] = useState(false);
  const [showVisionOverlay, setShowVisionOverlay] = useState(false);

  // Per-recommendation mockup state — keyed by category
  const [itemMockups, setItemMockups] = useState<Record<string, string>>({});
  const [itemMockupsLoading, setItemMockupsLoading] = useState<Record<string, boolean>>({});
  const [expandedMockup, setExpandedMockup] = useState<string | null>(null);

  // Mockup state
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [generatingMockup, setGeneratingMockup] = useState(false);
  const [showMockupOverlay, setShowMockupOverlay] = useState(false);

  // Manual sourcing state
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<EvaluateSetResult | null>(null);

  // Save design state
  const [saving, setSaving] = useState(false);
  const [savedStage, setSavedStage] = useState<"assessment" | "full" | null>(null);

  // Elapsed time counter during search
  useEffect(() => {
    if (!searchStartTime || step !== "sourcing") return;
    const interval = setInterval(() => {
      setSearchElapsed(Math.floor((Date.now() - searchStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [searchStartTime, step]);

  // React 18 StrictMode fires useEffect twice on mount in dev. Without a
  // ref-guard, both invocations race past the GET (no existing analysis
  // saved yet) and both fire the expensive POST in parallel. The backend
  // in-flight lock will coalesce them, but skipping the second call here
  // avoids the wasted fetch + wasted render cycles.
  const analysisStartedRef = useRef(false);

  // Run deep area analysis on mount — parallel data fetches
  useEffect(() => {
    if (analysisStartedRef.current) return;
    analysisStartedRef.current = true;

    async function analyze() {
      // Fetch room info, project, and existing analysis in parallel. These
      // initial loads + the existing-analysis handling are guarded so a network
      // failure surfaces a retryable error instead of hanging on the "analyzing"
      // spinner forever — a real "builds but breaks" boundary on first paint.
      let roomRes: Response, projRes: Response, existingRes: Response;
      try {
        [roomRes, projRes, existingRes] = await Promise.all([
          fetch(`/api/rooms/${roomId}`),
          fetch(`/api/projects/${projectId}`),
          fetch(`/api/area-analysis?room_id=${roomId}`),
        ]);
      } catch {
        setAnalysisError("Couldn't load this room. Please check your connection and try again.");
        setStep("analysis");
        return;
      }

      if (roomRes.ok) setRoomInfo(await roomRes.json().catch(() => null));

      // Process floor plan from project
      try {
        if (projRes.ok) {
          const project = await projRes.json();
          const br = project?.building_research;
          if (br?.floor_plan_image_url || br?.extracted_floor_plan) {
            // Uploaded floor plan (new path) — normalize ExtractedFloorPlan to display shape
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const efp = br.extracted_floor_plan as any;
            if (efp) {
              // Build room_dimensions map from rooms array
              const roomDimensions: Record<string, string> = {};
              if (Array.isArray(efp.rooms)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const r of efp.rooms as any[]) {
                  if (r.room_type && (r.dimensions_text || r.sqft)) {
                    roomDimensions[r.room_type] = r.dimensions_text ?? `${r.sqft} sqft`;
                  }
                }
              }
              // Build notable_spatial_features from overall_notes + per-room traffic_notes
              const spatialFeatures: string[] = [];
              if (efp.building_orientation) spatialFeatures.push(efp.building_orientation);
              if (efp.overall_notes) spatialFeatures.push(efp.overall_notes);
              setFloorPlan({
                total_sqft: efp.total_sqft ? String(efp.total_sqft) : undefined,
                room_dimensions: roomDimensions,
                notable_spatial_features: spatialFeatures.length ? spatialFeatures : undefined,
              });
            }
            setFloorPlanFound(true);
          } else if (br?.floor_plan) {
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

      // Check existing analysis. Guarded: a parse/network hiccup while
      // DETERMINING whether an analysis exists should fall through to running a
      // fresh one, never throw out of analyze() and strand the user on the
      // spinner.
      try {
        if (existingRes.ok) {
          const existing = await existingRes.json();
          if (existing.analysis) {
            setAreaAnalysis(existing.analysis);
            setStep("analysis");
            // Load existing products in a SEPARATE guard: once we've found an
            // existing analysis we're done, so a failure HERE must NOT escape to
            // the outer fallthrough and trigger an unintended fresh analysis —
            // we keep the analysis we already have and just skip preloading.
            try {
              const prodRes = await fetch(`/api/products?room_id=${roomId}`);
              if (prodRes.ok) {
                const prods = await prodRes.json();
                if (Array.isArray(prods) && prods.length > 0) { setProducts(prods); setStep("results"); }
              }
            } catch {
              // Keep the existing analysis; products just won't preload.
            }
            return;
          }
        }
      } catch {
        // Only a failure to determine whether an existing analysis exists falls
        // through to a fresh analysis below.
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

  // Auto-trigger vision mockup when analysis is ready (runs in background)
  const visionTriggered = useRef(false);
  const visionAbortRef = useRef<AbortController | null>(null);

  const generateVisionInBackground = async (analysis: AreaAnalysis) => {
    visionAbortRef.current?.abort();
    const controller = new AbortController();
    visionAbortRef.current = controller;
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
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setVisionUrl(data.image_url);
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.error("Background vision generation error:", err);
      }
    }
    if (visionAbortRef.current === controller) {
      visionAbortRef.current = null;
      setGeneratingVision(false);
    }
  };

  useEffect(() => {
    if (areaAnalysis && !visionTriggered.current && !visionUrl && step === "analysis") {
      visionTriggered.current = true;
      // Fire and forget — generates in background while user reviews assessment
      generateVisionInBackground(areaAnalysis);
    }
    return () => {
      visionAbortRef.current?.abort();
    };
  }, [areaAnalysis, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual trigger for vision mockup (re-generate or generate from vision step)
  const handleGenerateVision = async () => {
    setGeneratingVision(true);
    if (step === "analysis") {
      // Just re-trigger background generation, don't change step
      if (areaAnalysis) {
        visionTriggered.current = true;
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

  // Per-recommendation mockup generation — generates a focused mockup for
  // a single recommended item placed in the room with all existing items.
  const itemMockupsTriggered = useRef(false);
  const itemMockupAbortRef = useRef<AbortController | null>(null);

  const generateItemMockup = async (
    item: AreaAnalysis["what_it_needs"][number],
    designDir: string,
    signal: AbortSignal,
  ) => {
    const key = item.category;
    setItemMockupsLoading((prev) => ({ ...prev, [key]: true }));

    const MAX_RETRIES = 3;
    const payload = JSON.stringify({
      room_id: roomId,
      recommendation_mockup: {
        category: item.category,
        search_title: item.search_title,
        description: item.description,
        specs: item.specs,
      },
      design_direction: designDir,
      aspect_ratio: "1:1",
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) break;
      try {
        const res = await fetch("/api/mockups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal,
        });
        if (res.ok) {
          const data = await res.json();
          setItemMockups((prev) => ({ ...prev, [key]: data.image_url }));
          break;
        }
        if (res.status === 429 && attempt < MAX_RETRIES) {
          const backoff = Math.min(2000 * 2 ** attempt, 16000);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        break;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") break;
        if (attempt === MAX_RETRIES) {
          console.error(`Item mockup generation failed for ${key}:`, err);
        }
      }
    }
    setItemMockupsLoading((prev) => ({ ...prev, [key]: false }));
  };

  const generateAllItemMockups = async (analysis: AreaAnalysis) => {
    itemMockupAbortRef.current?.abort();
    const controller = new AbortController();
    itemMockupAbortRef.current = controller;

    const items = analysis.what_it_needs || [];
    const designDir = analysis.design_direction || "";

    // Client-side concurrency limiter — cap at 3 concurrent requests so
    // we don't overwhelm the server even with the higher rate limit.
    let active = 0;
    const queue: Array<() => void> = [];
    const CONCURRENCY = 3;
    function enqueue<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const run = () => {
          active++;
          fn().then(resolve, reject).finally(() => { active--; const next = queue.shift(); if (next) next(); });
        };
        if (active < CONCURRENCY) run();
        else queue.push(run);
      });
    }

    await Promise.allSettled(
      items.map((item) => enqueue(() => generateItemMockup(item, designDir, controller.signal))),
    );
  };

  // Auto-trigger item mockups after the vision mockup starts generating
  useEffect(() => {
    if (areaAnalysis && !itemMockupsTriggered.current && step === "analysis") {
      itemMockupsTriggered.current = true;
      generateAllItemMockups(areaAnalysis);
    }
    return () => {
      itemMockupAbortRef.current?.abort();
    };
  }, [areaAnalysis, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveDesign = async (stage: "assessment" | "full") => {
    setSaving(true);
    try {
      const res = await fetch("/api/saved-designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, project_id: projectId, stage }),
      });
      if (res.ok) {
        trackEvent("design_saved", { stage });
        setSavedStage(stage);
      } else {
        toast.error("Couldn't save design", "Please try again in a moment.");
      }
    } catch {
      toast.error("Couldn't save design", "Check your connection and try again.");
    }
    setSaving(false);
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
        body: JSON.stringify({ room_id: roomId, categories, fillAllTiers }),
      });

      if (!res.ok || !res.body) {
        // Fallback to batch endpoint
        const batchRes = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room_id: roomId, categories, fillAllTiers }),
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

    try {
      const res = await fetch("/api/mockups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, product_ids: tierProducts.map((p) => p.id) }),
      });

      if (res.ok) {
        const data = await res.json();
        setMockupUrl(data.image_url);
        setShowMockupOverlay(true);
      } else {
        toast.error("Couldn't generate the mockup", "Please try again in a moment.");
      }
    } catch {
      toast.error("Couldn't generate the mockup", "Check your connection and try again.");
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
        toast.error(
          "Couldn't evaluate those products",
          typeof err?.error === "string" ? err.error : "Please check the links and try again.",
        );
      }
    } catch {
      toast.error("Couldn't evaluate those products", "Check your connection and try again.");
    }
    setManualLoading(false);
  };

  const handleSaveAndContinue = async () => {
    // Mark this room complete FIRST — if this fails, do not navigate away, or the
    // user would leave believing the room is done while the server still has it open.
    try {
      const patchRes = await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!patchRes.ok) {
        toast.error("Couldn't mark this room complete", "Please try again in a moment.");
        return;
      }
    } catch {
      toast.error("Couldn't mark this room complete", "Check your connection and try again.");
      return;
    }

    // Find the next incomplete room in this project
    try {
      const res = await fetch(`/api/rooms?project_id=${projectId}`);
      if (res.ok) {
        const rooms = await res.json();
        const next = rooms.find(
          (r: { id: string; status: string }) => r.id !== roomId && r.status !== "completed",
        );
        if (next) {
          router.push(`/projects/${projectId}/rooms/${next.id}/focus`);
          return;
        }
      }
    } catch { /* fall through to dashboard */ }

    router.push("/dashboard");
  };

  return (
    <PageTransition className="max-w-5xl mx-auto space-y-8 pb-12 px-4">
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
            <div className="flex flex-col items-center mb-6">
              <Loader2 className="h-8 w-8 animate-spin text-accent-warm mb-4" />
              <h3 className="text-lg font-semibold">Studying this room</h3>
              <p className="text-sm text-muted-foreground mt-1">Usually 2–3 minutes</p>
            </div>
            <div className="max-w-md mx-auto">
              <AnalysisRotatingStatus />
            </div>
            <AnalysisElapsedTimer />
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
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm",
              floorPlanFound
                ? "bg-muted/40 border text-foreground"
                : "bg-muted/30 border border-dashed text-muted-foreground"
            )}>
              {floorPlanFound ? (
                <Ruler className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <LayoutGrid className="h-4 w-4 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                {floorPlanFound && floorPlan ? (
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="font-medium text-sm">Floor plan</span>
                    <span className="text-muted-foreground">·</span>
                    {floorPlan.total_sqft && (
                      <span className="text-muted-foreground text-xs">{floorPlan.total_sqft} sqft</span>
                    )}
                    {floorPlan.room_dimensions && roomInfo && floorPlan.room_dimensions[roomInfo.room_type] && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground text-xs">This room: ~{floorPlan.room_dimensions[roomInfo.room_type]}</span>
                      </>
                    )}
                    {floorPlan.living_dining_combined && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground text-xs">Combined living/dining</span>
                      </>
                    )}
                    {floorPlan.kitchen_style && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground text-xs">Kitchen: {floorPlan.kitchen_style}</span>
                      </>
                    )}
                    {floorPlan.notable_spatial_features && floorPlan.notable_spatial_features.length > 0 && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground text-xs">{floorPlan.notable_spatial_features.join(", ")}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-xs">No floor plan — sizing estimated from photos.{" "}
                    <Link
                      href={`/projects/${projectId}/rooms/${roomId}/setup`}
                      className="underline font-medium hover:opacity-80"
                    >
                      Upload one
                    </Link>{" "}
                    for better recommendations.
                  </span>
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
                <StaggerList className="space-y-3">
                  {(areaAnalysis.what_it_needs || []).map((item, i) => {
                    const mockupUrl = itemMockups[item.category];
                    const loading = itemMockupsLoading[item.category];
                    const isExpanded = expandedMockup === item.category;
                    return (
                      <StaggerItem key={i} className="rounded-xl bg-muted/50 overflow-hidden">
                        <div className="flex items-start gap-3 p-3">
                          <Badge variant={item.priority === "high" ? "default" : "secondary"} className="shrink-0 mt-0.5">{item.priority}</Badge>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{item.search_title || item.category.replace(/_/g, " ")}</p>
                            <p className="text-sm text-muted-foreground">{item.description}</p>
                            {item.specs && <p className="text-xs text-muted-foreground mt-1 italic">{item.specs}</p>}
                          </div>
                          {/* Mockup thumbnail */}
                          <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-muted border">
                            {mockupUrl ? (
                              <button
                                className="w-full h-full relative group"
                                onClick={() => setExpandedMockup(isExpanded ? null : item.category)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={mockupUrl} alt={`Preview: ${item.category}`} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                  <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                                </div>
                              </button>
                            ) : loading ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Expanded mockup view */}
                        {isExpanded && mockupUrl && (
                          <div className="px-3 pb-3">
                            <div className="relative rounded-lg overflow-hidden border">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={mockupUrl} alt={`${item.search_title || item.category} in your room`} className="w-full h-auto" />
                              <button
                                type="button"
                                aria-label="Close expanded image"
                                className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white"
                                onClick={() => setExpandedMockup(null)}
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5">AI-generated visualization of the recommended product</p>
                          </div>
                        )}
                      </StaggerItem>
                    );
                  })}
                </StaggerList>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold text-sm mb-2 text-emerald-700 dark:text-emerald-400">Keep</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {(areaAnalysis.what_works || []).map((item, i) => (
                      <li key={i} className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-2 text-amber-700 dark:text-amber-400">Replace or remove</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {(areaAnalysis.what_should_go || []).map((item, i) => (
                      <li key={i} className="flex items-start gap-2"><ThumbsDown className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="p-3 rounded-xl border bg-primary/5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-sm">Design Direction</h3>
                  {areaAnalysis.style_name && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-warm/15 text-accent-warm-strong border border-accent-warm/20">
                      {areaAnalysis.style_name}
                    </span>
                  )}
                </div>
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
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

          {/* Chat-style refinement */}
          <RefineChat
            roomId={roomId}
            onAnalysisUpdate={(updatedAnalysis, changedFields) => {
              const updated = updatedAnalysis as unknown as AreaAnalysis;
              setAreaAnalysis(updated);
              const needsChanged =
                changedFields.includes("what_it_needs") ||
                changedFields.some((f) => f.startsWith("what_it_needs."));
              if (needsChanged) {
                // Categories shifted — drop products so new ones get fetched.
                setProducts([]);
                // Generate mockups only for items that don't already have one
                // (token-efficient: skip items whose mockup we already cached).
                const designDir = updated.design_direction || "";
                const newItems = (updated.what_it_needs || []).filter(
                  (item) => !itemMockups[item.category],
                );
                if (newItems.length > 0) {
                  itemMockupAbortRef.current?.abort();
                  const controller = new AbortController();
                  itemMockupAbortRef.current = controller;
                  for (const item of newItems) {
                    generateItemMockup(item, designDir, controller.signal);
                  }
                }
              }
            }}
            onVisionShouldRegen={() => {
              setVisionUrl(null);
              visionTriggered.current = false;
            }}
          />

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" className="flex-1 h-14 text-base" onClick={handleSearch}>
              <Search className="h-5 w-5 mr-2" />
              Find pieces for this room
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="flex-1 h-14 text-base"
              onClick={() => setStep("manual_sourcing")}
                         >
              <LinkIcon className="h-5 w-5 mr-2" />
              I&apos;ll find my own
            </Button>
          </div>

          {/* Fill-all-tiers toggle */}
          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fillAllTiers}
              onChange={(e) => setFillAllTiers(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-border"
            />
            <span>
              Fill every tier — borrow the best adjacent-tier pick when a category has no in-tier match.
              Off: only show products that strictly matched the tier budget.
            </span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => handleSaveDesign("assessment")}
            disabled={saving || savedStage === "assessment" || savedStage === "full"}
          >
            {savedStage ? (
              <><BookmarkCheck className="h-4 w-4 mr-1.5 text-emerald-600" /> Design saved</>
            ) : saving ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving...</>
            ) : (
              <><Bookmark className="h-4 w-4 mr-1.5" /> Save this design</>
            )}
          </Button>
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
                        isDone && "text-emerald-700 dark:text-emerald-400 font-medium",
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
            <ScrollReveal>
              <RecommendationTable
                products={products}
                onGenerateMockup={handleGenerateMockup}
                generatingMockup={generatingMockup}
              />
            </ScrollReveal>
          )}

          {/* Actions — primary CTA first, secondary inline, tertiary as link */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center pt-4">
            {/* Primary */}
            <Button variant="warm" size="lg" onClick={handleSaveAndContinue} className="w-full sm:w-auto shadow-warm-sm">
              <CheckCircle2 className="h-4 w-4 mr-2" /> Done — next room
            </Button>
            {/* Secondary */}
            <Button
              variant={savedStage === "full" ? "outline" : "outline"}
              size="lg"
              onClick={() => handleSaveDesign("full")}
              disabled={saving || savedStage === "full"}
              className="w-full sm:w-auto"
            >
              {savedStage === "full" ? (
                <><BookmarkCheck className="h-4 w-4 mr-2 text-emerald-600" /> Saved</>
              ) : saving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                <><Bookmark className="h-4 w-4 mr-2" /> {savedStage === "assessment" ? "Save with products" : "Save full design"}</>
              )}
            </Button>
            {/* Tertiary */}
            <button
              type="button"
              onClick={() => setStep("analysis")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
            >
              Back to assessment
            </button>
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
    </PageTransition>
  );
}

// ─── Image Overlay ───────────────────────────────────────────────

// ─── Analysis rotating status ───────────────────────────────────
// The /api/area-analysis endpoint is a single POST, not SSE — so we cannot
// render real per-step progress here. Instead of faking timed "done" ticks
// (which misleads users when phases take longer than the hardcoded delays),
// we rotate an honest set of descriptors that explain what's generally
// happening. No claim of completion is made until the response arrives.
const ANALYSIS_ROTATION_LABELS = [
  "Reading room photos",
  "Checking building finishes",
  "Cross-referencing other rooms",
  "Forming design assessment",
  "Scoring spatial fit & clearances",
  "Optimizing harmony across items",
];

function AnalysisRotatingStatus() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % ANALYSIS_ROTATION_LABELS.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-3 justify-center px-3 py-2 rounded-xl bg-accent/30">
      <Loader2 className="h-4 w-4 animate-spin text-accent-warm shrink-0" />
      <span className="text-sm font-medium text-foreground">
        {ANALYSIS_ROTATION_LABELS[index]}…
      </span>
    </div>
  );
}

function AnalysisElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <p className="text-xs text-muted-foreground text-center mt-6">
      {min > 0 ? `${min}m ${sec}s` : `${sec}s`} elapsed
    </p>
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={title} className="w-full aspect-video object-cover" />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
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

  // Calculate tier totals. Borrowed picks (fill_source: "adjacent_tier")
  // are shown as "Same as X" stubs in the table — don't double-count their
  // price into this tier's total since they're really the other tier's pick.
  const tierTotals: Record<PriceTier, number> = { budget: 0, balanced: 0, high_end: 0 };
  for (const cat of categories) {
    for (const tier of tiers) {
      const best = getBestForTier(cat, tier);
      if (best?.price && best.metadata?.fill_source !== "adjacent_tier") {
        tierTotals[tier] += best.price;
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Tier totals summary — visible on all screen sizes so mobile users can compare budgets */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3">
        {(["budget", "balanced", "high_end"] as PriceTier[]).map((tier) => (
          <div key={tier} className="flex flex-col items-center gap-0.5">
            <span className={cn("text-[10px] font-semibold uppercase tracking-wide", TIER_COLORS[tier].text)}>
              {TIER_LABELS[tier]}
            </span>
            <span className={cn("text-base font-bold tabular-nums", TIER_COLORS[tier].text)}>
              {tierTotals[tier] > 0 ? `$${tierTotals[tier].toLocaleString()}` : "—"}
            </span>
          </div>
        ))}
      </div>

      {/* Desktop: Table view */}
      <div className="hidden md:block rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 w-[200px]">Item</th>
              <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Why</th>
              <th className="text-center text-xs font-semibold px-4 py-3 w-[140px]">
                <div className={cn("flex items-center justify-center gap-1.5", TIER_COLORS.budget.text)}>
                  <DollarSign className="h-3.5 w-3.5" /> {TIER_LABELS.budget}
                </div>
              </th>
              <th className="text-center text-xs font-semibold px-4 py-3 w-[140px]">
                <div className={cn("flex items-center justify-center gap-1.5", TIER_COLORS.balanced.text)}>
                  <TrendingUp className="h-3.5 w-3.5" /> {TIER_LABELS.balanced}
                </div>
              </th>
              <th className="text-center text-xs font-semibold px-4 py-3 w-[140px]">
                <div className={cn("flex items-center justify-center gap-1.5", TIER_COLORS.high_end.text)}>
                  <Crown className="h-3.5 w-3.5" /> {TIER_LABELS.high_end}
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
              <td className={cn("px-4 py-3 text-center text-sm font-semibold", TIER_COLORS.budget.text)}>
                ${tierTotals.budget.toLocaleString()}
              </td>
              <td className={cn("px-4 py-3 text-center text-sm font-semibold", TIER_COLORS.balanced.text)}>
                ${tierTotals.balanced.toLocaleString()}
              </td>
              <td className={cn("px-4 py-3 text-center text-sm font-semibold", TIER_COLORS.high_end.text)}>
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
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.image_url} alt={product.title || "Product image"} className="h-12 w-12 rounded object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={cn("text-[10px]", TIER_COLORS[tier].badge)}>
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
  const tierColorClass = TIER_COLORS[tier].text;

  // When fillEmptyTiers borrowed this product from an adjacent tier, the
  // metadata is tagged. Render a compact "→ [origin]" stub instead of a
  // full duplicate row, so the user sees one pick rather than 3 copies.
  const isBorrowed = product.metadata?.fill_source === "adjacent_tier";
  if (isBorrowed) {
    const origin = product.metadata?.fill_origin_tier;
    const originLabel = origin === "budget" ? "Budget" : origin === "balanced" ? "Mid-Range" : origin === "high_end" ? "Luxury" : "other tier";
    return (
      <td className="px-4 py-3">
        <div className="flex flex-col items-center gap-0.5 text-center text-muted-foreground">
          <span className="text-[10px] italic">Same as {originLabel} →</span>
        </div>
      </td>
    );
  }

  return (
    <td className="px-4 py-3">
      <div className="flex flex-col items-center gap-1 text-center">
        {product.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.title || "Product image"} className="h-10 w-10 rounded object-cover" />
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

