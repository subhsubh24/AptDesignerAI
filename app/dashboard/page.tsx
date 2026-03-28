"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Camera, Sparkles, ArrowRight, CheckCircle2, X, Building2, ChevronRight } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils/cn";
import { LogoMark } from "@/components/ui/logo-mark";

// ─── Room Sections Config ────────────────────────────────────────────
function getRoomSections(bedrooms: number, bathrooms: number) {
  const sections: { key: string; label: string; icon: string }[] = [];

  if (bedrooms === 0) {
    // Studio
    sections.push({ key: "main_room", label: "Main Room", icon: "🏠" });
  } else {
    sections.push({ key: "living_room", label: "Living Room / Dining", icon: "🛋️" });
  }

  sections.push({ key: "kitchen", label: "Kitchen", icon: "🍳" });

  if (bedrooms === 0) {
    // Studio — no separate bedroom
  } else if (bedrooms === 1) {
    sections.push({ key: "bedroom", label: "Bedroom", icon: "🛏️" });
  } else {
    for (let i = 1; i <= Math.min(bedrooms, 3); i++) {
      sections.push({
        key: i === 1 ? "bedroom" : `bedroom_${i}`,
        label: i === 1 ? "Primary Bedroom" : `Bedroom ${i}`,
        icon: "🛏️",
      });
    }
  }

  if (bathrooms >= 1) {
    sections.push({ key: "bathroom", label: bathrooms > 1 ? "Primary Bathroom" : "Bathroom", icon: "🚿" });
  }
  for (let i = 2; i <= Math.min(bathrooms, 3); i++) {
    sections.push({ key: `bathroom_${i}`, label: `Bathroom ${i}`, icon: "🚿" });
  }

  return sections;
}

interface UploadedImage {
  id: string;
  url: string;
  path: string;
}

// ─── Step Components ─────────────────────────────────────────────────
const STEPS = ["welcome", "layout", "location", "setup", "analyzing", "room_select"] as const;
type Step = (typeof STEPS)[number];

export default function DashboardPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [buildingUrl, setBuildingUrl] = useState("");
  const [buildingResearch, setBuildingResearch] = useState<Record<string, unknown> | null>(null);
  const [roomImages, setRoomImages] = useState<Record<string, UploadedImage[]>>({});
  const [projectId, setProjectId] = useState<string | null>(null);
  const [roomIds, setRoomIds] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzePhase, setAnalyzePhase] = useState<"building" | "photos" | "done">("building");
  const [apartmentSummary, setApartmentSummary] = useState<{
    overall: string;
    rooms: Record<string, {
      summary: string;
      score: number;
      keep?: string[];
      replace?: string[];
      add?: string[];
      needs?: string[]; // legacy fallback
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [roomContext, setRoomContext] = useState<Record<string, string>>({});
  const [savingContext, setSavingContext] = useState(false);

  const roomSections = getRoomSections(bedrooms, bathrooms);
  const showNeighborhood = ["new york", "nyc", "los angeles", "la", "san francisco", "sf", "chicago"].some(
    (c) => city.toLowerCase().includes(c)
  );

  // Load existing project on mount
  useEffect(() => {
    async function loadExisting() {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const projects = await res.json();
        if (projects.length > 0) {
          const project = projects[0];
          setProjectId(project.id);

          // Restore onboarding state
          if (project.bedrooms) setBedrooms(project.bedrooms);
          if (project.bathrooms) setBathrooms(project.bathrooms);
          if (project.city) setCity(project.city);
          if (project.state) setState(project.state);
          if (project.neighborhood) setNeighborhood(project.neighborhood);
          if (project.building_name) setBuildingName(project.building_name);
          if (project.building_url) setBuildingUrl(project.building_url);
          if (project.building_research) setBuildingResearch(project.building_research);

          // Load rooms and images
          const roomsRes = await fetch(`/api/rooms?project_id=${project.id}`);
          if (roomsRes.ok) {
            const rooms = await roomsRes.json();
            const ids: Record<string, string> = {};
            const images: Record<string, UploadedImage[]> = {};
            let hasAnalysis = false;

            for (const room of rooms) {
              ids[room.room_type] = room.id;
              const imgRes = await fetch(`/api/rooms/${room.id}/images`);
              if (imgRes.ok) {
                const imgs = await imgRes.json();
                images[room.room_type] = imgs.map((img: { id: string; image_url: string; storage_path: string }) => ({
                  id: img.id,
                  url: img.image_url,
                  path: img.storage_path,
                }));
              }
              if (["diagnosed", "sourcing", "completed"].includes(room.status)) {
                hasAnalysis = true;
              }
            }
            setRoomIds(ids);
            setRoomImages(images);

            if (hasAnalysis) {
              // Jump to room selection
              const summaryRes = await fetch(`/api/analyze-apartment?project_id=${project.id}`);
              if (summaryRes.ok) {
                const data = await summaryRes.json();
                setApartmentSummary(data.summary);
              }
              setStep("room_select");
            } else if (Object.keys(images).some((k) => (images[k]?.length || 0) > 0)) {
              setStep("setup");
            } else if (project.building_research) {
              setStep("setup");
            } else if (project.city) {
              setStep("setup");
            } else if (project.bedrooms) {
              setStep("location");
            }
          }
        }
      }
      setLoading(false);
    }
    loadExisting();
  }, []);

  // Ensure project exists
  const ensureProject = useCallback(async (): Promise<string> => {
    if (projectId) return projectId;

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My Apartment",
        description: `${bedrooms}BD/${bathrooms}BA${city ? ` in ${city}` : ""}`,
      }),
    });
    const project = await res.json();
    setProjectId(project.id);
    return project.id;
  }, [projectId, bedrooms, bathrooms, city]);

  // Save project metadata
  const saveProjectMeta = useCallback(async (data: Record<string, unknown>) => {
    const projId = await ensureProject();
    await fetch(`/api/projects/${projId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }, [ensureProject]);

  // Ensure room exists
  const ensureRoom = useCallback(async (projId: string, roomType: string, label: string): Promise<string> => {
    if (roomIds[roomType]) return roomIds[roomType];

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
  }, [roomIds]);

  // Handle image upload
  const handleUpload = useCallback(async (roomType: string, label: string, files: File[]) => {
    const projId = await ensureProject();
    const roomId = await ensureRoom(projId, roomType, label);

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
        [roomType]: [...(prev[roomType] || []), { id: imageData.id, url, path }],
      }));
    }
  }, [ensureProject, ensureRoom]);

  const removeImage = useCallback(async (roomType: string, imageId: string) => {
    const roomId = roomIds[roomType];
    if (!roomId) return;

    await fetch(`/api/rooms/${roomId}/images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: imageId }),
    });

    setRoomImages((prev) => ({
      ...prev,
      [roomType]: (prev[roomType] || []).filter((img) => img.id !== imageId),
    }));
  }, [roomIds]);

  // Combined analyze: building research (if needed) → photo analysis
  // Sequential because photo analysis uses building research as context
  const handleAnalyze = useCallback(async () => {
    const totalImages = Object.values(roomImages).flat().length;
    if (totalImages === 0) return;
    setAnalyzing(true);
    setStep("analyzing");

    try {
      const projId = projectId || await ensureProject();

      // Phase 1: Research building (if we have a building name and haven't already)
      if (buildingName && !buildingResearch) {
        setAnalyzePhase("building");
        try {
          const res = await fetch("/api/apartment-research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              building_name: buildingName,
              building_url: buildingUrl || undefined,
              city, state, neighborhood,
              project_id: projId,
              bedrooms, bathrooms,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setBuildingResearch(data.research);
          }
        } catch {
          // Building research is optional — continue to photo analysis
          console.warn("[dashboard] Building research failed, continuing without it");
        }
      }

      // Phase 2: Analyze apartment photos (uses building research as context)
      setAnalyzePhase("photos");
      const res = await fetch("/api/analyze-apartment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projId }),
      });

      if (res.ok) {
        const data = await res.json();
        setApartmentSummary(data.summary);
        setAnalyzePhase("done");
        setStep("room_select");
      } else {
        setStep("setup");
      }
    } catch {
      setStep("setup");
    } finally {
      setAnalyzing(false);
    }
  }, [roomImages, projectId, buildingName, buildingUrl, buildingResearch, city, state, neighborhood, bedrooms, bathrooms, ensureProject]);

  const totalImages = Object.values(roomImages).flat().length;

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ─── Step: Welcome ─────────────────────────────────────────────
  if (step === "welcome") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 animate-fade-in-up">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <LogoMark className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Welcome to Apt<span className="text-accent-warm">Designer</span></h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Show us your apartment, and we&apos;ll help you furnish it — room by room, piece by piece.
          </p>
          <Button
            size="lg"
            className="h-14 px-10 text-base mt-4"
            onClick={() => setStep("layout")}
          >
            Let&apos;s go
            <ChevronRight className="h-5 w-5 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // ─── Step: Layout (Bed/Bath) ──────────────────────────────────
  if (step === "layout") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 animate-fade-in-up">
        <StepHeader
          step={2}
          total={4}
          title="What&apos;s your layout?"
          subtitle="So we know which rooms to ask for."
        />

        <div className="space-y-8 mt-8">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-3 block">Bedrooms</label>
            <div className="flex gap-3">
              {[{ value: 0, label: "Studio" }, { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3+" }].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setBedrooms(opt.value)}
                  className={cn(
                    "h-12 px-6 rounded-full border-2 text-sm font-medium transition-all duration-200",
                    bedrooms === opt.value
                      ? "border-primary bg-primary text-primary-foreground shadow-md"
                      : "border-border hover:border-primary/50 hover:bg-secondary"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground mb-3 block">Bathrooms</label>
            <div className="flex gap-3">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setBathrooms(n)}
                  className={cn(
                    "h-12 px-6 rounded-full border-2 text-sm font-medium transition-all duration-200",
                    bathrooms === n
                      ? "border-primary bg-primary text-primary-foreground shadow-md"
                      : "border-border hover:border-primary/50 hover:bg-secondary"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4">
            <p className="text-sm text-muted-foreground mb-4">
              We&apos;ll need photos of: {getRoomSections(bedrooms, bathrooms).map((s) => s.label).join(", ")}
            </p>
            <Button
              size="lg"
              className="w-full h-12"
              onClick={async () => {
                await saveProjectMeta({ bedrooms, bathrooms });
                setStep("location");
              }}
            >
              Continue
              <ChevronRight className="h-5 w-5 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step: Location ───────────────────────────────────────────
  if (step === "location") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 animate-fade-in-up">
        <StepHeader
          step={3}
          total={4}
          title="Where&apos;s home?"
          subtitle="Helps us understand your local design context and source from nearby retailers."
        />

        <div className="space-y-6 mt-8">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Chicago"
                className="w-full h-11 px-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">State</label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="IL"
                className="w-full h-11 px-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>
          </div>

          {showNeighborhood && (
            <div className="animate-fade-in-up">
              <label className="text-sm font-medium mb-1.5 block">Neighborhood</label>
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                placeholder="West Loop"
                className="w-full h-11 px-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="h-12" onClick={() => setStep("layout")}>Back</Button>
            <Button
              size="lg"
              className="flex-1 h-12"
              onClick={async () => {
                await saveProjectMeta({ city, state, neighborhood });
                setStep("setup");
              }}
              disabled={!city}
            >
              Continue
              <ChevronRight className="h-5 w-5 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step: Setup (Building + Photos combined) ─────────────────
  if (step === "setup") {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
        <StepHeader
          step={4}
          total={4}
          title="Your apartment"
          subtitle="Tell us about your building and show us your rooms. We&apos;ll handle the rest."
        />

        <div className="space-y-8 mt-8">
          {/* Building info section */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Building
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Building name</label>
                <input
                  type="text"
                  value={buildingName}
                  onChange={(e) => setBuildingName(e.target.value)}
                  placeholder="e.g. Porte Apartments"
                  className="w-full h-11 px-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block text-muted-foreground">
                  Website <span className="text-xs">(optional)</span>
                </label>
                <input
                  type="url"
                  value={buildingUrl}
                  onChange={(e) => setBuildingUrl(e.target.value)}
                  placeholder="https://www.porteapts.com"
                  className="w-full h-11 px-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
            </div>

            {/* Show research result if already done */}
            {buildingResearch && (() => {
              const br = buildingResearch as Record<string, unknown>;
              const fp = br.floor_plan as Record<string, unknown> | undefined;
              const hasFloorPlan = fp?.found === true;
              return (
                <div className="mt-3 flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-200">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Building researched — {String(br.building_style || "style identified")}
                    {hasFloorPlan && fp?.total_sqft ? ` · ~${String(fp.total_sqft)} sqft` : ""}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Room photos section */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Room Photos
            </h3>
            <div className="space-y-4">
              {roomSections.map((section) => (
                <RoomUploadSection
                  key={section.key}
                  section={section}
                  images={roomImages[section.key] || []}
                  onUpload={(files) => handleUpload(section.key, section.label, files)}
                  onRemove={(imageId) => removeImage(section.key, imageId)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-8 pb-8">
          <Button variant="outline" className="h-12" onClick={() => setStep("location")}>Back</Button>
          <Button
            size="lg"
            className="flex-1 h-14 text-base gap-3"
            onClick={handleAnalyze}
            disabled={totalImages === 0 || analyzing}
          >
            <Sparkles className="h-5 w-5" />
            Analyze My Apartment ({totalImages} {totalImages === 1 ? "photo" : "photos"})
          </Button>
        </div>
      </div>
    );
  }

  // ─── Step: Analyzing ──────────────────────────────────────────
  if (step === "analyzing") {
    const buildingDone = analyzePhase !== "building";
    const photosDone = analyzePhase === "done";
    const showBuildingStep = !!buildingName && !buildingResearch;

    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center animate-fade-in-up">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
        <h2 className="text-2xl font-bold mt-6">
          {analyzePhase === "building" ? "Researching your building..." : "Analyzing your rooms..."}
        </h2>
        <p className="text-muted-foreground mt-2 max-w-md mx-auto">
          {analyzePhase === "building"
            ? "Looking up floor plans, finishes, and architectural details."
            : "Examining each room, cross-referencing your building\u2019s finishes, and forming a design perspective."}
        </p>
        <div className="flex flex-col gap-2 mt-8 text-sm text-muted-foreground">
          <StepIndicator done label={`${totalImages} photo${totalImages === 1 ? "" : "s"} received`} />
          {showBuildingStep && (
            <StepIndicator done={buildingDone} active={analyzePhase === "building"} label="Researching building finishes & floor plans" />
          )}
          {buildingResearch && !showBuildingStep && <StepIndicator done label="Building context loaded" />}
          <StepIndicator done={photosDone} active={analyzePhase === "photos"} label="Studying rooms holistically" />
          <StepIndicator done={photosDone} label="Forming design direction" />
        </div>
      </div>
    );
  }

  // ─── Step: Room Selection ─────────────────────────────────────
  if (step === "room_select") {
    const handleProceedToRoom = async () => {
      if (!selectedRoom) return;
      const roomId = roomIds[selectedRoom];
      if (!roomId) return;

      const context = roomContext[selectedRoom]?.trim();
      if (context) {
        setSavingContext(true);
        try {
          await fetch(`/api/rooms/${roomId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_context: context }),
          });
        } finally {
          setSavingContext(false);
        }
      }

      router.push(`/projects/${projectId}/rooms/${roomId}/focus`);
    };

    return (
      <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium mb-4">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Apartment analyzed
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Where should we start?</h1>
          <p className="text-muted-foreground mt-2 max-w-md mx-auto">
            Pick a room and we&apos;ll do a deep dive — what to keep, what to change, and exactly what to get.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {roomSections.map((section) => {
            const hasImages = (roomImages[section.key]?.length || 0) > 0;
            const firstImage = roomImages[section.key]?.[0];
            const isSelected = selectedRoom === section.key;

            if (!hasImages) return null;

            return (
              <button
                key={section.key}
                onClick={() => setSelectedRoom(isSelected ? null : section.key)}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border-2 bg-card transition-all duration-300 text-left",
                  isSelected
                    ? "border-accent-warm shadow-xl ring-2 ring-accent-warm/20 -translate-y-1"
                    : "border-transparent hover:shadow-xl hover:-translate-y-1 hover:border-primary/30"
                )}
              >
                {/* Room thumbnail */}
                {firstImage && (
                  <div className="aspect-[16/10] overflow-hidden">
                    <img
                      src={firstImage.url}
                      alt={section.label}
                      className={cn(
                        "w-full h-full object-cover transition-transform duration-500",
                        isSelected ? "scale-105" : "group-hover:scale-105"
                      )}
                    />
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  </div>
                )}

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-3 right-3 h-7 w-7 rounded-full bg-accent-warm flex items-center justify-center shadow-lg animate-fade-in-up">
                    <CheckCircle2 className="h-4 w-4 text-white" />
                  </div>
                )}

                {/* Room label */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{section.icon}</span>
                      <h3 className="font-semibold text-white text-lg">{section.label}</h3>
                    </div>
                    {!isSelected && (
                      <div className="h-8 w-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/40 transition-colors">
                        <ArrowRight className="h-4 w-4 text-white" />
                      </div>
                    )}
                  </div>
                  <p className="text-white/70 text-xs mt-1">
                    {roomImages[section.key]?.length || 0} {(roomImages[section.key]?.length || 0) === 1 ? "photo" : "photos"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Context input — appears when a room is selected */}
        {selectedRoom && (
          <div className="mt-8 animate-fade-in-up">
            <Card>
              <CardContent className="pt-6 pb-5 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Anything we should know about these photos?
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Optional — mention anything temporary, out of place, or not obvious from the photos.
                  </p>
                  <textarea
                    value={roomContext[selectedRoom] || ""}
                    onChange={(e) =>
                      setRoomContext((prev) => ({ ...prev, [selectedRoom]: e.target.value }))
                    }
                    placeholder={"e.g. \"Ignore the yoga mat, it won't be there\" or \"The clutter will be cleaned up — focus on the furniture and layout\""}
                    className="w-full h-24 px-4 py-3 rounded-lg border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-warm/30 focus:border-accent-warm transition-all"
                  />
                </div>

                <Button
                  size="lg"
                  className="w-full h-12 text-base gap-2"
                  onClick={handleProceedToRoom}
                  disabled={savingContext}
                >
                  {savingContext ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      Design this room
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Sub-Components ────────────────────────────────────────────────

function StepHeader({ step, total, title, subtitle }: { step: number; total: number; title: string; subtitle: string }) {
  return (
    <div>
      {/* Progress bar */}
      <div className="flex gap-1.5 mb-8">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 rounded-full flex-1 transition-all duration-500",
              i < step ? "bg-primary" : "bg-border"
            )}
          />
        ))}
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function StepIndicator({ done, active, label }: { done?: boolean; active?: boolean; label: string }) {
  return (
    <div className={cn("flex items-center gap-2", done && "text-green-600", active && "text-primary font-medium")}>
      {done ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : active ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <div className="h-4 w-4 rounded-full border-2" />
      )}
      {label}
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
    <Card className="transition-all duration-200 hover:shadow-sm">
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
                className="h-24 w-24 rounded-lg object-cover border transition-transform duration-200 group-hover:scale-105"
              />
              <button
                onClick={() => onRemove(img.id)}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Upload zone — with mobile camera support */}
          <div
            {...getRootProps()}
            className={cn(
              "h-24 min-w-[6rem] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all duration-200",
              isDragActive ? "border-primary bg-primary/5 scale-105" : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-secondary/50",
              uploading && "pointer-events-none opacity-50"
            )}
          >
            <input {...getInputProps()} capture="environment" />
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Camera className="h-5 w-5 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground mt-1">
                  {images.length === 0 ? "Add photos" : "Add more"}
                </span>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
