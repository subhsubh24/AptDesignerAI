"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Stethoscope, Loader2, AlertCircle, CheckCircle2, ArrowRight, RotateCcw, Sparkles, Search } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { PageTransition } from "@/components/ui/motion";
import type { DiagnosisData, DesignDirection, ActionItem, RoomSceneGraph } from "@/lib/types/database";
import { IdentifiedProductPill } from "@/components/rooms/identified-product-pill";
import { SceneCoverageCard } from "@/components/rooms/scene-coverage-card";
import { ASSESSMENT_PANEL } from "@/lib/utils/assessment-colors";

interface DiagnosisStep {
  step: string;
  status: "running" | "done" | "error";
  detail?: string;
}

/**
 * Confetti burst for the "diagnosis complete" moment.
 *
 * Five warm hues, all of them neighbours of the house accent (#b4501e) and its
 * gradient end (#d4733e) — the two values `--gradient-warm-start` /
 * `--gradient-warm-end` already define in app/globals.css. The previous set
 * mixed emerald (#059669) and teal (#0d9488) into the burst, which put two
 * unrelated hue families on the warm-editorial celebration, and did it in raw
 * hex rather than a token.
 *
 * These stay literal hex rather than reading the tokens: a canvas-style particle
 * burst needs opaque paint values, the burst is decorative (aria-hidden), and
 * the intermediate shades between accent and gradient-end do not exist as
 * tokens. They are pinned in __tests__/design/off-system-palette-ratchet.test.ts
 * so a cool hue cannot creep back in.
 */
const CONFETTI_COLORS = ["#b4501e", "#c25c26", "#d4733e", "#e08c52", "#a3441a"];

function ConfettiParticle({ delay, x, y, colorIndex }: { delay: number; x: number; y: number; colorIndex: number }) {
  return (
    <div
      className="absolute h-2 w-2 rounded-full"
      style={{
        left: "50%",
        top: "50%",
        background: CONFETTI_COLORS[colorIndex % CONFETTI_COLORS.length],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["--confetti-x" as any]: `${x}px`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["--confetti-y" as any]: `${y}px`,
        animation: `confettiPop 0.8s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both`,
      }}
    />
  );
}

export default function DiagnosisPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [diagnosis, setDiagnosis] = useState<{
    diagnosis_json: DiagnosisData;
    design_direction_json: DesignDirection;
    action_list: ActionItem[];
    missing_categories: string[];
    scene_graph_json?: RoomSceneGraph | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<DiagnosisStep[]>([]);
  const [showCelebration, setShowCelebration] = useState(false);

  // Load existing diagnosis when the room has already been diagnosed — prevents
  // users from re-running an expensive pipeline they already paid for. They can
  // still explicitly re-run via the "Re-analyze" button.
  useEffect(() => {
    async function loadExisting() {
      try {
        const res = await fetch(`/api/rooms/${roomId}/diagnosis`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.diagnosis) {
          setDiagnosis({
            diagnosis_json: data.diagnosis.diagnosis_json,
            design_direction_json: data.diagnosis.design_direction_json,
            action_list: data.diagnosis.action_list ?? [],
            missing_categories: data.diagnosis.missing_categories ?? [],
            scene_graph_json: data.diagnosis.scene_graph_json ?? null,
          });
        }
      } catch {
        // Silent fallback — user can still trigger a fresh diagnosis.
      }
    }
    loadExisting();
  }, [roomId]);

  // Progress math: the stream emits 6–7 distinct step events in a fixed order.
  // Using (completedSteps / steps.length) causes the bar to jump backwards
  // whenever a new step arrives before the previous one is marked done —
  // numerator stays, denominator grows. Lock the denominator to the known
  // expected total and use a ref to enforce monotonic progress.
  const EXPECTED_STEP_COUNT = 7;
  const completedSteps = steps.filter((s) => s.status === "done").length;
  const maxProgressRef = useRef(0);
  const rawPercent = loading
    ? (completedSteps / Math.max(steps.length, EXPECTED_STEP_COUNT)) * 100
    : 0;
  if (!loading) maxProgressRef.current = 0;
  else if (rawPercent > maxProgressRef.current) maxProgressRef.current = rawPercent;
  const progressPercent = maxProgressRef.current;

  const handleRunDiagnosis = async () => {
    setLoading(true);
    setError(null);
    setSteps([]);
    setShowCelebration(false);

    // Cap the diagnosis SSE at 10min — diagnosis is far faster than search.
    const diagAbort = new AbortController();
    const diagTimeoutId = window.setTimeout(() => diagAbort.abort(), 10 * 60 * 1000);

    try {
      const res = await fetch("/api/diagnosis/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId }),
        signal: diagAbort.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Diagnosis failed");
      }

      if (!res.body) {
        throw new Error("No response stream");
      }

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
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.substring(6));

              if (currentEvent === "step") {
                setSteps((prev) => {
                  const existing = prev.findIndex((s) => s.step === data.step);
                  if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = data;
                    return updated;
                  }
                  return [...prev, data];
                });
              } else if (currentEvent === "done") {
                setDiagnosis(data.diagnosis);
                setShowCelebration(true);
                toast.success("Diagnosis complete!", "Your room has been analyzed successfully.");
                setTimeout(() => setShowCelebration(false), 2000);
              } else if (currentEvent === "error") {
                throw new Error(data.error);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
                throw parseErr;
              }
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      const aborted = (err as { name?: string })?.name === "AbortError";
      const message = aborted
        ? "Diagnosis timed out — please try again."
        : err instanceof Error
          ? err.message
          : "Something went wrong";
      setError(message);
      toast.error("Diagnosis failed", message);
    } finally {
      window.clearTimeout(diagTimeoutId);
      setLoading(false);
    }
  };

  const d = diagnosis?.diagnosis_json;
  const dd = diagnosis?.design_direction_json;
  const actions = diagnosis?.action_list;

  return (
    <PageTransition className="max-w-4xl mx-auto space-y-8">
      <div>
        <Link
          href={`/projects/${projectId}/rooms/${roomId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Room
        </Link>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-headline">Your room, studied</h1>
            <p className="text-muted-foreground mt-1">
              A clear read on what&apos;s working, what&apos;s not, and what to do about it.
            </p>
          </div>
          <Button onClick={handleRunDiagnosis} disabled={loading} variant={diagnosis ? "outline" : "warm"}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Studying your room…
              </>
            ) : (
              <>
                {diagnosis ? <RotateCcw className="h-4 w-4 mr-2" /> : <Stethoscope className="h-4 w-4 mr-2" />}
                {diagnosis ? "Re-analyze" : "Start diagnosis"}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Progress bar during streaming */}
      {loading && (
        <div className="space-y-4">
          <Progress value={progressPercent} className="h-2" />
          <Card variant="elevated">
            <CardContent className="py-6">
              <div className="space-y-3 animate-stagger-children" aria-live="polite" aria-atomic="false">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 animate-slide-up">
                    {step.status === "running" ? (
                      <Loader2 className="h-4 w-4 text-accent-warm animate-spin shrink-0" aria-hidden="true" />
                    ) : step.status === "done" ? (
                      // A finished step RECEDES so the running one (accent-warm,
                      // spinning) is the only thing pulling the eye down the
                      // list. Which state a row is in stays legible without
                      // colour — CheckCircle2 vs Loader2 vs AlertCircle.
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {step.step}
                        <span className="sr-only">
                          {step.status === "running"
                            ? " — in progress"
                            : step.status === "done"
                              ? " — done"
                              : " — failed"}
                        </span>
                      </p>
                      {step.detail && (
                        <p className="text-xs text-muted-foreground">{step.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive flex-1">{error}</p>
            <Button onClick={handleRunDiagnosis} variant="outline" size="sm">
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {!diagnosis && !loading && !error && (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20 relative">
            <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-accent-warm/10 to-accent-warm/5 flex items-center justify-center mb-6 animate-float">
              <Sparkles className="h-10 w-10 text-accent-warm/60" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Let&apos;s understand your room</h2>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
              Our AI will analyze your photos and provide a detailed design assessment
              with actionable recommendations.
            </p>
            <Button onClick={handleRunDiagnosis} variant="warm" size="lg" className="animate-gentle-glow">
              <Stethoscope className="h-4 w-4 mr-2" />
              Run Diagnosis
            </Button>
          </CardContent>
        </Card>
      )}

      {d && (
        <div className="relative">
          {/* Celebration confetti */}
          {showCelebration && (
            <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
              {Array.from({ length: 12 }, (_, i) => (
                <ConfettiParticle
                  key={i}
                  delay={i * 60}
                  x={((((i * 7 + 3) % 12) / 12) - 0.5) * 200}
                  y={-40 - ((i * 13 + 5) % 12) * (80 / 12)}
                  colorIndex={i}
                />
              ))}
            </div>
          )}

          <div className="space-y-6 animate-stagger-children">
            {/* Vibe Summary */}
            <Card variant="elevated" className="animate-fade-in-up bg-gradient-card-hero">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent-warm" />
                  Current Vibe
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">{d.current_vibe_summary}</p>
              </CardContent>
            </Card>

            {/* Multi-view coverage — what we pieced together across all photos,
                and which angles are still missing */}
            {diagnosis?.scene_graph_json && (
              <SceneCoverageCard
                graph={diagnosis.scene_graph_json}
                setupHref={`/projects/${projectId}/rooms/${roomId}/setup`}
              />
            )}

            {/* What's Working / Not Working */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* The SAME pair the user meets again on /focus, /saved, /shared
                  and /bundles — so it reads out of the shared palette rather
                  than a fourth local one. "Keep" recedes (it needs nothing);
                  the list to act on takes the house accent. */}
              <Card className={cn("border-l-4 animate-fade-in-up", ASSESSMENT_PANEL.keep.rail)}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2.5 text-base">
                    <CheckCircle2 className={cn("h-4 w-4 shrink-0", ASSESSMENT_PANEL.keep.heading)} />
                    What&apos;s Working
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5">
                    {d.what_is_working.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        {/* `bg-muted-foreground`, not the panel's `chip` tint: a
                            1.5px dot needs the ink weight of the marker, not the
                            surface weight of the chip behind an icon. */}
                        <span className="h-1.5 w-1.5 rounded-full mt-2 shrink-0 bg-muted-foreground" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className={cn("border-l-4 animate-fade-in-up", ASSESSMENT_PANEL.replace.rail)}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2.5 text-base">
                    <AlertCircle className={cn("h-4 w-4 shrink-0", ASSESSMENT_PANEL.replace.heading)} />
                    What&apos;s Not Working
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5">
                    {d.what_is_not_working.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full mt-2 shrink-0 bg-accent-warm" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Improvement Opportunities */}
            <Card className="animate-fade-in-up">
              <CardHeader>
                <CardTitle className="text-base">Biggest Improvement Opportunities</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {d.biggest_improvement_opportunities.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-warm-button text-accent-warm-on-solid text-xs font-bold shadow-warm-sm">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground pt-1 leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Identified Furniture — confirmation pills. Rendered only when
                the furniture identification pipeline ran (IDENTIFY_PRODUCTS=1)
                and produced at least one verified entry the user hasn't
                answered yet. Confirmed/rejected items show as static badges. */}
            {d.identified_products && d.identified_products.some((p) => p.verified) && (
              <Card className="animate-fade-in-up">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Search className="h-4 w-4 text-accent-warm" />
                    Identified Furniture
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    We spotted some specific pieces in your photos. Confirm or
                    correct each guess — we&apos;ll use the canonical specs for
                    scale &amp; palette when sourcing new items.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-2">
                    {d.identified_products
                      .filter((p) => p.verified)
                      .map((p, i) => (
                        <IdentifiedProductPill
                          key={`${p.brand}-${p.model}-${i}`}
                          product={p}
                          roomId={roomId}
                        />
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Issues Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-stagger-children">
              {([
                { title: "Color Issues", items: d.color_issues },
                { title: "Texture & Material", items: d.texture_material_issues },
                { title: "Scale & Proportion", items: d.scale_proportion_issues },
                { title: "Layout", items: d.layout_issues },
                { title: "Lighting", items: d.lighting_issues },
                { title: "Clutter & Editing", items: d.clutter_editing_issues },
              ]).map((section) => {
                // One-hue rail, three rungs by ISSUE COUNT — the same
                // muted → accent tint → accent ladder as the priority pill in
                // lib/utils/assessment-colors.ts. Clear sections recede; the
                // section with the most to fix carries the heaviest rail.
                //
                // This replaced a rail that crossed TWO signals: a per-section
                // `severity` of "amber" or "rose" times a light/strong weight by
                // count, plus emerald for clear. The category half was not
                // decodable — nothing on the page ever told a user that rose
                // outranks amber, and the two read as near-neighbours anyway —
                // and two independent dimensions cannot be encoded on one hue.
                // Count is the half the user acts on, so count is what the rail
                // now says; the Badge beside each title still names it in words.
                //
                // Static strings, not `border-l-${...}` template literals: the
                // Tailwind JIT scanner cannot see a dynamic class name and would
                // purge these utilities out of the build.
                const RAIL_BY_DENSITY = {
                  clear: "border-l-border",
                  some: "border-l-accent-warm/40",
                  many: "border-l-accent-warm",
                } as const;
                const borderColor = section.items.length === 0
                  ? RAIL_BY_DENSITY.clear
                  : section.items.length <= 2
                  ? RAIL_BY_DENSITY.some
                  : RAIL_BY_DENSITY.many;

                return (
                  <Card key={section.title} className={cn("border-l-4 animate-fade-in-up", borderColor)}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">{section.title}</CardTitle>
                        <Badge
                          variant={section.items.length === 0 ? "success" : section.items.length <= 2 ? "warning" : "destructive"}
                          className="text-[10px]"
                        >
                          {section.items.length === 0 ? "Clear" : `${section.items.length} issue${section.items.length === 1 ? "" : "s"}`}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {section.items.length > 0 ? (
                        <ul className="space-y-2">
                          {section.items.map((item, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                              <span className="h-1 w-1 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground font-medium">No issues found</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Missing Categories */}
            {diagnosis?.missing_categories && diagnosis.missing_categories.length > 0 && (
              <Card className="animate-fade-in-up">
                <CardHeader>
                  <CardTitle className="text-base">Missing Categories</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {diagnosis.missing_categories.map((cat) => (
                    <Badge key={cat} variant="warning" className="capitalize">
                      {cat.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Design Direction */}
            {dd && (
              <Card variant="elevated" className="animate-fade-in-up bg-gradient-card-hero">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent-warm" />
                    Recommended Design Direction
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <p className="text-caption mb-3">Palette</p>
                    <div className="flex flex-wrap gap-2">
                      {dd.recommended_palette.map((color) => (
                        <div key={color} className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-card">
                          <div
                            className="h-4 w-4 rounded-full border border-border/50 shadow-sm"
                            style={{ backgroundColor: color.toLowerCase().replace(/\s/g, "") }}
                          />
                          <span className="text-xs font-medium">{color}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-caption mb-3">Materials</p>
                    <div className="flex flex-wrap gap-2">
                      {dd.recommended_materials.map((m) => (
                        <Badge key={m} variant="outline" className="py-1 px-3">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-caption mb-3">Style Notes</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{dd.style_notes}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action List */}
            {actions && actions.length > 0 && (
              <Card className="animate-fade-in-up">
                <CardHeader>
                  <CardTitle className="text-base">Prioritized Action List</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {actions.map((action, i) => (
                      <div key={i} className="flex items-start gap-4 pb-4 border-b last:border-0 last:pb-0">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-warm-button text-accent-warm-on-solid text-sm font-semibold shadow-warm-sm">
                          {action.priority}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{action.action}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <Badge variant="outline" className="capitalize text-xs">
                              {action.category.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{action.reasoning}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sticky Continue Button */}
          <div className="sticky bottom-4 mt-8 z-10">
            <div className="absolute -top-12 left-0 right-0 h-12 fade-to-bg" />
            <div className="glass rounded-2xl border shadow-warm-md p-4 flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium">Diagnosis complete</span>
                <span className="text-muted-foreground ml-2 hidden sm:inline">Ready to find furniture</span>
              </div>
              <Button asChild variant="warm" size="lg">
                <Link href={`/projects/${projectId}/rooms/${roomId}/products`}>
                  Continue to Products
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
