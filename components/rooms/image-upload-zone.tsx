"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Loader2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ImageUploadZoneProps {
  roomId: string;
  imageType?: "room" | "apartment_context" | "detail";
  onUploadComplete?: (image: { url: string; path: string; id: string }) => void;
  className?: string;
}

export function ImageUploadZone({
  roomId,
  imageType = "room",
  onUploadComplete,
  className,
}: ImageUploadZoneProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      // Show the image immediately — optimistic preview so the user gets
      // visual confirmation before the network round-trip completes.
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
      setUploading(true);
      setUploadError(null);

      // HEIC files are native on iOS but not universally renderable in browsers
      // via createObjectURL. Safari handles them; Chrome/Firefox may show broken
      // preview — the upload itself will still work since the server accepts them.
      const isHeic = file.name.toLowerCase().endsWith(".heic") || file.type === "image/heic";
      if (isHeic && !("CSS" in window && CSS.supports("content", "url('x.heic')"))) {
        // Preview may not render — use a placeholder text instead of broken img
        URL.revokeObjectURL(objectUrl);
        setPreview(null); // fall through to spinner-only display during upload
      }

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("bucket", "room-images");

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(body?.error || `Upload failed (HTTP ${uploadRes.status})`);
        }
        const { url, path } = await uploadRes.json();

        const imageRes = await fetch(`/api/rooms/${roomId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: url,
            image_type: imageType,
            storage_path: path,
          }),
        });

        if (!imageRes.ok) throw new Error("Failed to save image record");
        const imageData = await imageRes.json();

        onUploadComplete?.({ url, path, id: imageData.id });
        setPreview(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed — please try again.";
        setUploadError(message);
        setPreview(null);
      } finally {
        setUploading(false);
      }
    },
    [roomId, imageType, onUploadComplete]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic"] },
    maxFiles: 1,
    multiple: false,
  });

  // react-dropzone routes an unsupported file type to `fileRejections`, never
  // to `onDrop`'s acceptedFiles — without reading it, a rejected drop (e.g. a
  // PDF) produced zero feedback: no preview, no error, nothing. The user just
  // sees nothing happen.
  const rejectedFile = fileRejections[0]?.file;

  // A fresh rejection must replace a STALE upload-failure message, not sit
  // behind it — `uploadError` only clears on a successful onDrop (never
  // called for a rejected file) or the dismiss button, so without this a
  // prior "storage is down" error would keep rendering over a new,
  // unrelated "not a supported image type" rejection.
  useEffect(() => {
    if (rejectedFile) setUploadError(null);
  }, [rejectedFile]);

  return (
    <div
      {...getRootProps()}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
        isDragActive
          ? "border-primary/50 bg-primary/5"
          : uploadError || rejectedFile
          ? "border-destructive/40 bg-destructive/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
        uploading && "pointer-events-none",
        className
      )}
    >
      <input {...getInputProps()} aria-label="Upload room photo" />

      {/* Optimistic preview while uploading */}
      {preview && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Uploading preview" className="max-h-32 rounded-md object-contain opacity-60" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </div>
      )}

      {/* HEIC upload in progress (no renderable preview) */}
      {uploading && !preview && (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Uploading…</p>
        </div>
      )}

      {/* Error state */}
      {uploadError && !uploading && !rejectedFile && (
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle className="h-7 w-7 text-destructive" />
          <p className="text-xs text-destructive font-medium">{uploadError}</p>
          <p className="text-xs text-muted-foreground">Click or drag to retry</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setUploadError(null); }}
            className="absolute top-2 right-2 rounded-full p-1 hover:bg-muted"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Rejected file type (e.g. a PDF dropped on an image-only zone).
          Takes priority over a stale uploadError from a prior attempt —
          the effect above clears it, but this guard makes the correct
          message win in the SAME render, with no one-tick flash of the
          old message. */}
      {rejectedFile && !uploading && !preview && (
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle className="h-7 w-7 text-destructive" />
          <p className="text-xs text-destructive font-medium">
            &quot;{rejectedFile.name}&quot; isn&apos;t a supported image type
          </p>
          <p className="text-xs text-muted-foreground">
            Click or drag to retry · HEIC, JPG, PNG, WEBP
          </p>
        </div>
      )}

      {/* Idle state */}
      {!uploading && !uploadError && !preview && !rejectedFile && (
        <>
          <Upload className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {isDragActive ? "Drop your photo here" : "Drag & drop a photo"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            or click to browse · HEIC, JPG, PNG, WEBP
          </p>
        </>
      )}
    </div>
  );
}
