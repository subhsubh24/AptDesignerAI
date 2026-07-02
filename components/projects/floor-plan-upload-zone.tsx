"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileImage, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import type { ExtractedFloorPlan } from "@/lib/types/database";

interface FloorPlanUploadZoneProps {
  projectId: string;
  onExtracted?: (data: ExtractedFloorPlan | null) => void;
  className?: string;
}

type UploadState = "idle" | "uploading" | "extracting" | "done" | "error";

export function FloorPlanUploadZone({
  projectId,
  onExtracted,
  className,
}: FloorPlanUploadZoneProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedFloorPlan | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Load existing floor plan on mount
  useEffect(() => {
    fetch(`/api/projects/${projectId}/floor-plan`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.extracted_floor_plan) {
          setExtracted(data.extracted_floor_plan as ExtractedFloorPlan);
          setImageUrl(data.floor_plan_image_url as string);
          setState("done");
          onExtracted?.(data.extracted_floor_plan as ExtractedFloorPlan);
        }
      })
      .catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleRemove = async () => {
    await fetch(`/api/projects/${projectId}/floor-plan`, { method: "DELETE" });
    setExtracted(null);
    setImageUrl(null);
    setPreview(null);
    setState("idle");
    setErrorMsg(null);
    onExtracted?.(null);
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setErrorMsg(null);
      setPreview(URL.createObjectURL(file));
      setState("uploading");

      try {
        // Step 1: upload file to storage
        const formData = new FormData();
        formData.append("file", file);
        formData.append("bucket", "room-images");

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Storage upload failed");
        const { url } = await uploadRes.json() as { url: string; path: string };

        // Step 2: extract spatial data
        setState("extracting");
        const extractRes = await fetch(`/api/projects/${projectId}/floor-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: url }),
        });

        if (!extractRes.ok) {
          const err = await extractRes.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error || "Extraction failed");
        }

        const result = await extractRes.json() as {
          extracted_floor_plan: ExtractedFloorPlan;
          floor_plan_image_url: string;
        };

        setExtracted(result.extracted_floor_plan);
        setImageUrl(result.floor_plan_image_url ?? url);
        setState("done");
        onExtracted?.(result.extracted_floor_plan);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Upload failed");
        setState("error");
        setPreview(null);
      }
    },
    [projectId, onExtracted],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"], "application/pdf": [".pdf"] },
    maxFiles: 1,
    multiple: false,
    disabled: state === "uploading" || state === "extracting",
  });

  // ── Extracted summary card ───────────────────────────────────────────────────
  if (state === "done" && extracted) {
    const roomCount = extracted.rooms.length;
    const sqft = extracted.total_sqft;
    const confidenceColor = {
      high: "text-green-600",
      medium: "text-amber-600",
      low: "text-red-500",
    }[extracted.confidence];

    return (
      <div className={cn("rounded-lg border bg-muted/30 p-4 space-y-3", className)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium">Floor plan uploaded</p>
              <p className={cn("text-xs", confidenceColor)}>
                {extracted.confidence.charAt(0).toUpperCase() + extracted.confidence.slice(1)} confidence extraction
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={handleRemove}
            title="Remove floor plan"
            aria-label="Remove floor plan"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          {sqft && (
            <div className="rounded-md bg-background border px-3 py-2">
              <p className="text-xs text-muted-foreground">Total area</p>
              <p className="font-semibold">{sqft.toLocaleString()} sqft</p>
            </div>
          )}
          <div className="rounded-md bg-background border px-3 py-2">
            <p className="text-xs text-muted-foreground">Rooms detected</p>
            <p className="font-semibold">{roomCount}</p>
          </div>
        </div>

        {extracted.rooms.length > 0 && (
          <div className="space-y-1">
            {extracted.rooms.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="capitalize">{r.label || r.room_type.replace("_", " ")}</span>
                <span>{r.dimensions_text ?? (r.sqft ? `${r.sqft} sqft` : "")}</span>
              </div>
            ))}
          </div>
        )}

        {imageUrl && (
          <div className="mt-2">
            {imageUrl.toLowerCase().endsWith(".pdf") ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-background border text-xs text-muted-foreground">
                <FileImage className="h-4 w-4 shrink-0 text-accent-warm" />
                <span className="truncate font-medium">Floor plan · PDF</span>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt="Floor plan"
                className="max-h-40 w-full rounded-md object-contain bg-white border"
              />
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Applied to all rooms in this apartment.{" "}
          <button
            className="underline hover:text-foreground"
            onClick={handleRemove}
          >
            Replace
          </button>
        </p>
      </div>
    );
  }

  // ── Upload / extracting zone ─────────────────────────────────────────────────
  const isProcessing = state === "uploading" || state === "extracting";

  return (
    <div className={cn("space-y-2", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
          isDragActive
            ? "border-primary/50 bg-primary/5 cursor-copy"
            : "border-muted-foreground/25 hover:border-muted-foreground/50 cursor-pointer",
          isProcessing && "pointer-events-none opacity-60",
        )}
      >
        <input {...getInputProps()} />

        {isProcessing ? (
          <>
            <Loader2 className="h-8 w-8 text-primary/50 mb-3 animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">
              {state === "uploading" ? "Uploading..." : "Extracting room data..."}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">This may take 10–20 seconds</p>
          </>
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" className="max-h-32 rounded-md object-contain" />
        ) : (
          <>
            <FileImage className="h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {isDragActive ? "Drop floor plan here" : "Drag & drop your floor plan"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">PNG, JPG, or PDF · or click to browse</p>
          </>
        )}
      </div>

      {state === "error" && errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errorMsg}
        </div>
      )}
    </div>
  );
}
