"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Stethoscope, Loader2, AlertCircle, CheckCircle2, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type { DiagnosisData, DesignDirection, ActionItem } from "@/lib/types/database";

interface DiagnosisStep {
  step: string;
  status: "running" | "done" | "error";
  detail?: string;
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
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<DiagnosisStep[]>([]);

  useEffect(() => {
    async function loadExisting() {
      const res = await fetch(`/api/rooms/${roomId}`);
      if (res.ok) {
        const room = await res.json();
        if (room.status !== "setup") {
          // Room already diagnosed — could load existing diagnosis
          // For now, just note it exists
        }
      }
    }
    loadExisting();
  }, [roomId]);

  const handleRunDiagnosis = async () => {
    setLoading(true);
    setError(null);
    setSteps([]);

    try {
      const res = await fetch("/api/diagnosis/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Diagnosis failed");
      }

      if (!res.body) {
        throw new Error("No response stream");
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
                toast.success("Diagnosis complete!", "Your room has been analyzed successfully.");
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
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error("Diagnosis failed", message);
    } finally {
      setLoading(false);
    }
  };

  const d = diagnosis?.diagnosis_json;
  const dd = diagnosis?.design_direction_json;
  const actions = diagnosis?.action_list;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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
            <h1 className="text-3xl font-bold tracking-tight">Room Diagnosis</h1>
            <p className="text-muted-foreground mt-1">
              AI analysis of your room with actionable recommendations
            </p>
          </div>
          <Button onClick={handleRunDiagnosis} disabled={loading} variant={diagnosis ? "outline" : "warm"}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Stethoscope className="h-4 w-4 mr-2" />
                {diagnosis ? "Re-analyze" : "Run Diagnosis"}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Progress Steps */}
      {loading && steps.length > 0 && (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {step.status === "running" ? (
                    <Loader2 className="h-4 w-4 text-accent-warm animate-spin shrink-0" />
                  ) : step.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{step.step}</p>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground">{step.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center mb-5">
              <Stethoscope className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No diagnosis yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Click &quot;Run Diagnosis&quot; to have the AI analyze your room photos and
              provide detailed recommendations.
            </p>
          </CardContent>
        </Card>
      )}

      {d && (
        <>
          {/* Vibe Summary */}
          <Card className="bg-secondary/30">
            <CardHeader>
              <CardTitle className="text-base">Current Vibe</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">{d.current_vibe_summary}</p>
            </CardContent>
          </Card>

          {/* What's Working / Not Working */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-emerald-200/50 dark:border-emerald-800/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2.5 text-base">
                  <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  What&apos;s Working
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {d.what_is_working.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-2 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="border-amber-200/50 dark:border-amber-800/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2.5 text-base">
                  <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                    <AlertCircle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
                  </div>
                  What&apos;s Not Working
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {d.what_is_not_working.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Improvement Opportunities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Biggest Improvement Opportunities</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {d.biggest_improvement_opportunities.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-warm text-white text-xs font-bold">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground pt-1 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Issues Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Color Issues", items: d.color_issues },
              { title: "Texture & Material", items: d.texture_material_issues },
              { title: "Scale & Proportion", items: d.scale_proportion_issues },
              { title: "Layout", items: d.layout_issues },
              { title: "Lighting", items: d.lighting_issues },
              { title: "Clutter & Editing", items: d.clutter_editing_issues },
            ].map((section) => (
              <Card key={section.title}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{section.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  {section.items.length > 0 ? (
                    <ul className="space-y-2">
                      {section.items.map((item, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <span className="h-1 w-1 rounded-full bg-border mt-1.5 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground/40 italic">No issues found</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Missing Categories */}
          {diagnosis?.missing_categories && diagnosis.missing_categories.length > 0 && (
            <Card>
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
            <Card className="bg-secondary/30">
              <CardHeader>
                <CardTitle className="text-base">Recommended Design Direction</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2.5">Palette</p>
                  <div className="flex flex-wrap gap-2">
                    {dd.recommended_palette.map((color) => (
                      <Badge key={color} variant="outline" className="py-1 px-3">
                        {color}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2.5">Materials</p>
                  <div className="flex flex-wrap gap-2">
                    {dd.recommended_materials.map((m) => (
                      <Badge key={m} variant="outline" className="py-1 px-3">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2.5">Style Notes</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{dd.style_notes}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action List */}
          {actions && actions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Prioritized Action List</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-4 pb-4 border-b last:border-0 last:pb-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm font-semibold">
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

          {/* Next Step */}
          <div className="flex justify-end">
            <Button asChild variant="warm">
              <Link href={`/projects/${projectId}/rooms/${roomId}/products`}>
                Continue to Products
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
