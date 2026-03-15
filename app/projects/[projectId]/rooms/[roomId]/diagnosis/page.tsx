"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Stethoscope, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import type { DiagnosisData, DesignDirection, ActionItem } from "@/lib/types/database";

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
  const [hasDiagnosis, setHasDiagnosis] = useState(false);

  useEffect(() => {
    async function loadExisting() {
      const res = await fetch(`/api/rooms/${roomId}`);
      if (res.ok) {
        const room = await res.json();
        if (room.status !== "setup") {
          // Try to load existing diagnosis
          const diagRes = await fetch(`/api/diagnosis?room_id=${roomId}`);
          // If there's a GET endpoint, load it. Otherwise, we know there's a diagnosis from status.
          setHasDiagnosis(room.status !== "setup");
        }
      }
    }
    loadExisting();
  }, [roomId]);

  const handleRunDiagnosis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Diagnosis failed");
      }
      const data = await res.json();
      setDiagnosis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
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
          <Button onClick={handleRunDiagnosis} disabled={loading}>
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

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-800">{error}</p>
          </CardContent>
        </Card>
      )}

      {!diagnosis && !loading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Stethoscope className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No diagnosis yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
              Click &quot;Run Diagnosis&quot; to have the AI analyze your room photos and
              provide detailed recommendations.
            </p>
          </CardContent>
        </Card>
      )}

      {d && (
        <>
          {/* Vibe Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Current Vibe</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{d.current_vibe_summary}</p>
            </CardContent>
          </Card>

          {/* What's Working / Not Working */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  What&apos;s Working
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {d.what_is_working.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                  What&apos;s Not Working
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {d.what_is_not_working.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground">
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
              <ul className="space-y-2">
                {d.biggest_improvement_opportunities.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground pt-0.5">{item}</span>
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
                    <ul className="space-y-1.5">
                      {section.items.map((item, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground/60">No issues found</p>
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
                  <Badge key={cat} variant="secondary" className="capitalize">
                    {cat.replace(/_/g, " ")}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Design Direction */}
          {dd && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommended Design Direction</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">Palette</p>
                  <div className="flex flex-wrap gap-2">
                    {dd.recommended_palette.map((color) => (
                      <Badge key={color} variant="outline">
                        {color}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Materials</p>
                  <div className="flex flex-wrap gap-2">
                    {dd.recommended_materials.map((m) => (
                      <Badge key={m} variant="outline">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Style Notes</p>
                  <p className="text-sm text-muted-foreground">{dd.style_notes}</p>
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
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                        {action.priority}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{action.action}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <Badge variant="outline" className="mr-2 capitalize">
                            {action.category.replace(/_/g, " ")}
                          </Badge>
                          {action.reasoning}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Next Step */}
          <div className="flex justify-end">
            <Button asChild>
              <Link href={`/projects/${projectId}/rooms/${roomId}/products`}>
                Continue to Products
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
