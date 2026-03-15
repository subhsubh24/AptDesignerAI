"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Camera, Sparkles, ArrowRight, CheckCircle2, X } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils/cn";

const ROOM_SECTIONS = [
  { key: "living_room", label: "Living Room / Dining", icon: "🛋️" },
  { key: "kitchen", label: "Kitchen", icon: "🍳" },
  { key: "bedroom", label: "Bedroom", icon: "🛏️" },
  { key: "bathroom", label: "Bathroom", icon: "🚿" },
] as const;

type RoomKey = (typeof ROOM_SECTIONS)[number]["key"];

interface UploadedImage {
  id: string;
  url: string;
  path: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [roomImages, setRoomImages] = useState<Record<RoomKey, UploadedImage[]>>({
    living_room: [],
    kitchen: [],
    bedroom: [],
    bathroom: [],
  });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [roomIds, setRoomIds] = useState<Record<RoomKey, string>>({} as Record<RoomKey, string>);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [apartmentSummary, setApartmentSummary] = useState<{
    overall: string;
    rooms: Record<string, { summary: string; score: number; needs: string[] }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Check for existing project on load
  useEffect(() => {
    async function loadExisting() {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const projects = await res.json();
        if (projects.length > 0) {
          const project = projects[0];
          setProjectId(project.id);

          // Load existing rooms and their images
          const roomsRes = await fetch(`/api/rooms?project_id=${project.id}`);
          if (roomsRes.ok) {
            const rooms = await roomsRes.json();
            const ids: Record<string, string> = {};
            const images: Record<string, UploadedImage[]> = {
              living_room: [],
              kitchen: [],
              bedroom: [],
              bathroom: [],
            };

            for (const room of rooms) {
              ids[room.room_type as RoomKey] = room.id;
              const imgRes = await fetch(`/api/rooms/${room.id}/images`);
              if (imgRes.ok) {
                const imgs = await imgRes.json();
                images[room.room_type as RoomKey] = imgs.map((img: { id: string; image_url: string; storage_path: string }) => ({
                  id: img.id,
                  url: img.image_url,
                  path: img.storage_path,
                }));
              }

              // Check if analysis exists
              if (room.status === "diagnosed" || room.status === "sourcing" || room.status === "completed") {
                setAnalysisComplete(true);
              }
            }
            setRoomIds(ids as Record<RoomKey, string>);
            setRoomImages(images as Record<RoomKey, UploadedImage[]>);
          }
        }
      }
      setLoading(false);
    }
    loadExisting();
  }, []);

  // Ensure project exists
  const ensureProject = async (): Promise<string> => {
    if (projectId) return projectId;

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My Apartment",
        description: "West Loop, Chicago - Porte Apartments",
      }),
    });
    const project = await res.json();
    setProjectId(project.id);
    return project.id;
  };

  // Ensure room exists for a section
  const ensureRoom = async (projId: string, roomType: RoomKey): Promise<string> => {
    if (roomIds[roomType]) return roomIds[roomType];

    const label = ROOM_SECTIONS.find((s) => s.key === roomType)?.label || roomType;
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projId,
        name: label,
        room_type: roomType,
      }),
    });
    const room = await res.json();
    setRoomIds((prev) => ({ ...prev, [roomType]: room.id }));
    return room.id;
  };

  const handleUpload = async (roomType: RoomKey, files: File[]) => {
    const projId = await ensureProject();
    const roomId = await ensureRoom(projId, roomType);

    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bucket", "room-images");

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) continue;
      const { url, path } = await uploadRes.json();

      const imageRes = await fetch(`/api/rooms/${roomId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: url, image_type: "room", storage_path: path }),
      });
      if (!imageRes.ok) continue;
      const imageData = await imageRes.json();

      setRoomImages((prev) => ({
        ...prev,
        [roomType]: [...prev[roomType], { id: imageData.id, url, path }],
      }));
    }
  };

  const removeImage = async (roomType: RoomKey, imageId: string) => {
    const roomId = roomIds[roomType];
    if (!roomId) return;

    await fetch(`/api/rooms/${roomId}/images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: imageId }),
    });

    setRoomImages((prev) => ({
      ...prev,
      [roomType]: prev[roomType].filter((img) => img.id !== imageId),
    }));
  };

  const totalImages = Object.values(roomImages).flat().length;

  const handleAnalyze = async () => {
    if (totalImages === 0) return;
    setAnalyzing(true);

    try {
      const res = await fetch("/api/analyze-apartment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });

      if (res.ok) {
        const data = await res.json();
        setApartmentSummary(data.summary);
        setAnalysisComplete(true);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If analysis is complete, show summary + area selection
  if (analysisComplete && apartmentSummary) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Apartment</h1>
          <p className="text-muted-foreground mt-1">{apartmentSummary.overall}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Which area would you like to focus on?</CardTitle>
            <CardDescription>
              We&apos;ll do a deep analysis and find the perfect pieces. One area at a time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {ROOM_SECTIONS.map((section) => {
                const roomData = apartmentSummary.rooms[section.key];
                const hasImages = roomImages[section.key].length > 0;
                const roomId = roomIds[section.key];

                if (!hasImages || !roomData) return null;

                return (
                  <button
                    key={section.key}
                    onClick={() => router.push(`/projects/${projectId}/rooms/${roomId}/focus`)}
                    className="text-left p-4 rounded-lg border hover:border-primary hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{section.icon}</span>
                        <div>
                          <h3 className="font-semibold">{section.label}</h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {roomData.summary}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                    {roomData.needs.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {roomData.needs.slice(0, 3).map((need) => (
                          <Badge key={need} variant="secondary" className="text-xs">
                            {need}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If analysis is complete but no summary loaded yet, redirect to load it
  if (analysisComplete && !apartmentSummary) {
    // Load the apartment summary from existing diagnoses
    (async () => {
      const res = await fetch(`/api/analyze-apartment?project_id=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setApartmentSummary(data.summary);
      }
    })();
  }

  // Upload flow
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome to AptDesigner</h1>
        <p className="text-muted-foreground mt-1">
          Upload photos of your apartment and I&apos;ll analyze everything. Add photos to each room section below.
        </p>
      </div>

      <div className="space-y-6">
        {ROOM_SECTIONS.map((section) => (
          <RoomUploadSection
            key={section.key}
            section={section}
            images={roomImages[section.key]}
            onUpload={(files) => handleUpload(section.key, files)}
            onRemove={(imageId) => removeImage(section.key, imageId)}
          />
        ))}
      </div>

      <div className="flex justify-center pt-4 pb-8">
        <Button
          size="lg"
          className="h-14 px-8 text-base gap-3"
          onClick={handleAnalyze}
          disabled={totalImages === 0 || analyzing}
        >
          {analyzing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Analyzing your apartment...
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              Analyze My Apartment ({totalImages} {totalImages === 1 ? "photo" : "photos"})
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function RoomUploadSection({
  section,
  images,
  onUpload,
  onRemove,
}: {
  section: { key: string; label: string; icon: string };
  images: UploadedImage[];
  onUpload: (files: File[]) => void;
  onRemove: (imageId: string) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: async (files) => {
      setUploading(true);
      await onUpload(files);
      setUploading(false);
    },
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic"] },
    multiple: true,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <span className="text-xl">{section.icon}</span>
          <CardTitle className="text-base">{section.label}</CardTitle>
          {images.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {images.length} {images.length === 1 ? "photo" : "photos"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 flex-wrap">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={img.url}
                alt=""
                className="h-24 w-24 rounded-lg object-cover border"
              />
              <button
                onClick={() => onRemove(img.id)}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          <div
            {...getRootProps()}
            className={cn(
              "h-24 w-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors",
              isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50",
              uploading && "pointer-events-none opacity-50"
            )}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Camera className="h-5 w-5 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground mt-1">Add</span>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
