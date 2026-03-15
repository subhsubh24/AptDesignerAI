"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setPreview(URL.createObjectURL(file));
      setUploading(true);

      try {
        // Upload to Supabase Storage
        const formData = new FormData();
        formData.append("file", file);
        formData.append("bucket", "room-images");

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) throw new Error("Upload failed");
        const { url, path } = await uploadRes.json();

        // Save image record
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
      } catch (err) {
        console.error("Upload error:", err);
      } finally {
        setUploading(false);
        setPreview(null);
      }
    },
    [roomId, imageType, onUploadComplete]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic"] },
    maxFiles: 1,
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
        isDragActive
          ? "border-primary/50 bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
        uploading && "pointer-events-none opacity-60",
        className
      )}
    >
      <input {...getInputProps()} />
      {preview ? (
        <img
          src={preview}
          alt="Preview"
          className="max-h-32 rounded-md object-contain"
        />
      ) : (
        <>
          <Upload className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {isDragActive ? "Drop your photo here" : "Drag & drop a photo"}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            or click to browse
          </p>
        </>
      )}
      {uploading && (
        <p className="text-sm text-primary mt-3">Uploading...</p>
      )}
    </div>
  );
}
