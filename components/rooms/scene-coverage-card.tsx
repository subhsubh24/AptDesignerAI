"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, Layers, CheckCircle2, ScanEye } from "lucide-react";
import type { RoomSceneGraph } from "@/lib/types/database";

/**
 * Surfaces the multi-view scene graph to the user: how many photos were pieced
 * together, how many distinct objects were found (after deduping the same piece
 * across angles), and — most actionably — which areas the photos never showed,
 * with concrete "take this shot" prompts that link back to the photo uploader.
 */
export function SceneCoverageCard({
  graph,
  setupHref,
}: {
  graph: RoomSceneGraph;
  setupHref?: string;
}) {
  const photoCount = graph.source_image_urls.length;
  const objectCount = graph.objects.length;
  const merged = graph.reconciled_duplicate_count;
  const coveragePct = Math.round(graph.coverage.estimated_coverage * 100);
  const gaps = graph.coverage.gaps;
  const shots = graph.coverage.suggested_shots;
  const wellCovered = gaps.length === 0 && coveragePct >= 80;

  return (
    <Card variant="elevated" className="animate-fade-in-up">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ScanEye className="h-4 w-4 text-accent-warm" />
          Whole-space understanding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stat row — what we pieced together across all angles */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat icon={<Camera className="h-3.5 w-3.5" />} value={photoCount} label={photoCount === 1 ? "photo" : "photos"} />
          <Stat icon={<Layers className="h-3.5 w-3.5" />} value={objectCount} label={objectCount === 1 ? "object" : "objects"} />
          <Stat
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            value={`${coveragePct}%`}
            label="covered"
          />
        </div>

        {merged > 0 && (
          <p className="text-xs text-muted-foreground">
            Merged {merged} duplicate sighting{merged === 1 ? "" : "s"} of the same object seen from different angles into a single understanding.
          </p>
        )}

        {graph.summary && (
          <p className="text-sm leading-relaxed text-foreground/90">{graph.summary}</p>
        )}

        {/* Coverage gaps — the actionable part */}
        {wellCovered ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Good coverage — your photos show the whole room from enough angles.
          </div>
        ) : (
          <div className="space-y-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Camera className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-medium">Some areas aren&apos;t visible yet</span>
              {gaps.map((g) => (
                <Badge key={g} variant="outline" className="text-xs capitalize">
                  {g.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
            {shots.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {shots.slice(0, 4).map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="text-amber-500">+</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
            {setupHref && (
              <Link
                href={setupHref}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-warm hover:underline"
              >
                <Camera className="h-3.5 w-3.5" />
                Add more photos
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg bg-muted/40 py-2.5">
      <div className="flex items-center gap-1 text-accent-warm">{icon}</div>
      <span className="mt-0.5 text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
