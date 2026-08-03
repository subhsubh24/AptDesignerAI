"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Camera, ArrowRight, CheckCircle2, X, Building2, ChevronRight, MapPin, FileImage, Home, Sofa, UtensilsCrossed, BedDouble, Bath, type LucideIcon } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils/cn";
import { LogoMark } from "@/components/ui/logo-mark";
import { PlaceAutocomplete, type PlaceResult } from "@/components/ui/place-autocomplete";
import { FloorPlanUploadZone } from "@/components/projects/floor-plan-upload-zone";
import { PageTransition, StaggerList, StaggerItem } from "@/components/ui/motion";
import { trackEvent } from "@/lib/analytics";
import { orderRoomImages } from "@/lib/rooms/embedded-images";
import { toast } from "@/components/ui/toast";

// ─── Room Sections Config ────────────────────────────────────────────
function getRoomSections(bedrooms: number, bathrooms: number) {
  const sections: { key: string; label: string; icon: LucideIcon }[] = [];

  if (bedrooms === 0) {
    // Studio
    sections.push({ key: "main_room", label: "Main Room", icon: Home });
  } else {
    sections.push({ key: "living_room", label: "Living Room / Dining", icon: Sofa });
  }

  sections.push({ key: "kitchen", label: "Kitchen", icon: UtensilsCrossed });

  if (bedrooms === 0) {
    // Studio — no separate bedroom
  } else if (bedrooms === 1) {
    sections.push({ key: "bedroom", label: "Bedroom", icon: BedDouble });
  } else {
    for (let i = 1; i <= Math.min(bedrooms, 3); i++) {
      sections.push({
        key: i === 1 ? "bedroom" : `bedroom_${i}`,
        label: i === 1 ? "Primary Bedroom" : `Bedroom ${i}`,
        icon: BedDouble,
      });
    }
  }

  if (bathrooms >= 1) {
    sections.push({ key: "bathroom", label: bathrooms > 1 ? "Primary Bathroom" : "Bathroom", icon: Bath });
  }
  for (let i = 2; i <= Math.min(bathrooms, 3); i++) {
    sections.push({ key: `bathroom_${i}`, label: `Bathroom ${i}`, icon: Bath });
  }

  return sections;
}

interface UploadedImage {
  id: string;
  url: string;
  path: string;
}

/** A room row as returned by GET /api/rooms, which embeds its room_images. */
interface RoomWithImages {
  id: string;
  room_type: string;
  status: string;
  room_images?: { id: string; image_url: string; storage_path: string; created_at?: string }[];
}

// ─── Step Components ─────────────────────────────────────────────────
type Step = "welcome" | "layout" | "location" | "setup" | "analyzing" | "room_select";

export default function DashboardPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  // User's apartment square footage — optional but drives unit-plan matching
  // against the building's floor-plan variants (apartment-research agent).
  const [apartmentSqft, setApartmentSqft] = useState<string>("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [buildingUrl, setBuildingUrl] = useState("");
  const [buildingResearch, setBuildingResearch] = useState<Record<string, unknown> | null>(null);
  const [locationPlaceId, setLocationPlaceId] = useState<string | null>(null);
  const [buildingPlaceId, setBuildingPlaceId] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [roomImages, setRoomImages] = useState<Record<string, UploadedImage[]>>({});
  const [projectId, setProjectId] = useState<string | null>(null);
  const [roomIds, setRoomIds] = useState<Record<string, string>>({});
  const [roomStatuses, setRoomStatuses] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzePhase, setAnalyzePhase] = useState<"building" | "photos" | "done">("building");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- setter used, value consumed in future iteration
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
          if (project.apartment_sqft) setApartmentSqft(String(project.apartment_sqft));
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

            const statuses: Record<string, string> = {};
            // /api/rooms now embeds room_images, so the project load is a
            // single request instead of 1 + N (one image fetch per room, each
            // paying its own auth + ownership round-trip).
            for (const room of rooms as RoomWithImages[]) {
              ids[room.room_type] = room.id;
              statuses[room.room_type] = room.status ?? "setup";
              if (["diagnosed", "sourcing", "completed"].includes(room.status)) {
                hasAnalysis = true;
              }
              // Neither backend orders an embedded relation, and images[0] is
              // the room's primary thumbnail — see lib/rooms/embedded-images.ts.
              images[room.room_type] = orderRoomImages(room.room_images);
            }
            setRoomIds(ids);
            setRoomStatuses(statuses);
            setRoomImages(images);

            if (hasAnalysis) {
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

  // Ensure project exists. Guards against concurrent callers (two "Save"
  // triggers in flight at once) double-creating a project by sharing a
  // single in-flight promise keyed off the ref.
  const ensureProjectInFlight = useRef<Promise<string> | null>(null);
  const ensureProject = useCallback(async (): Promise<string> => {
    if (projectId) return projectId;
    if (ensureProjectInFlight.current) return ensureProjectInFlight.current;

    const p = (async () => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Apartment",
          description: `${bedrooms}BD/${bathrooms}BA${city ? ` in ${city}` : ""}`,
        }),
      });
      // Guard the response: a non-ok status used to slip through and set
      // projectId = undefined, which then poisoned every downstream room/upload/
      // analyze call — the canonical "account → broken dashboard" failure. Throw
      // so callers surface it instead of proceeding with a bad id.
      if (!res.ok) throw new Error(`Failed to create your project (HTTP ${res.status})`);
      const project = await res.json();
      if (!project?.id) throw new Error("Project creation returned no id");
      setProjectId(project.id);
      return project.id as string;
    })();
    ensureProjectInFlight.current = p;
    try {
      return await p;
    } finally {
      ensureProjectInFlight.current = null;
    }
  }, [projectId, bedrooms, bathrooms, city]);

  // Save project metadata
  const saveProjectMeta = useCallback(async (data: Record<string, unknown>) => {
    const projId = await ensureProject();
    const res = await fetch(`/api/projects/${projId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    // Throw on failure so the caller can keep the user on the current step
    // instead of advancing while their bedrooms/location silently failed to save.
    if (!res.ok) throw new Error(`Failed to save your details (HTTP ${res.status})`);
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
    if (!res.ok) throw new Error(`Failed to create the room (HTTP ${res.status})`);
    const room = await res.json();
    if (!room?.id) throw new Error("Room creation returned no id");
    setRoomIds((prev) => ({ ...prev, [roomType]: room.id }));
    return room.id;
  }, [roomIds]);

  // Handle image upload
  const handleUpload = useCallback(async (roomType: string, label: string, files: File[]) => {
    try {
      const projId = await ensureProject();
      const roomId = await ensureRoom(projId, roomType, label);

      let failed = 0;
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("bucket", "room-images");

        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) { failed++; continue; }
        const { url, path } = await uploadRes.json();

        const imageRes = await fetch(`/api/rooms/${roomId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: url, image_type: "room", storage_path: path }),
        });
        if (!imageRes.ok) { failed++; continue; }
        const imageData = await imageRes.json();

        setRoomImages((prev) => ({
          ...prev,
          [roomType]: [...(prev[roomType] || []), { id: imageData.id, url, path }],
        }));
      }

      // Per-file failures used to be silently skipped — the photo just never
      // appeared, with no explanation. Tell the user how many didn't upload.
      if (failed > 0) {
        toast.error(
          `${failed} photo${failed > 1 ? "s" : ""} didn't upload`,
          "Check your connection and try adding them again.",
        );
      }
    } catch (err) {
      // ensureProject / ensureRoom now throw on failure — surface it instead of
      // an unhandled rejection that leaves the user staring at an inert dropzone.
      toast.error(
        "Couldn't set up your room",
        err instanceof Error ? err.message : "Please try again in a moment.",
      );
    }
  }, [ensureProject, ensureRoom]);

  const removeImage = useCallback(async (roomType: string, imageId: string) => {
    const roomId = roomIds[roomType];
    if (!roomId) return;

    let res: Response;
    try {
      res = await fetch(`/api/rooms/${roomId}/images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_id: imageId }),
      });
    } catch {
      toast.error("Couldn't remove photo", "Check your connection and try again.");
      return;
    }
    if (!res.ok) {
      // The DELETE failed — leave the photo in place rather than showing it gone
      // while it still exists on the server (a silent state/server desync).
      toast.error("Couldn't remove photo", "Please try again in a moment.");
      return;
    }

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
              apartment_sqft: apartmentSqft ? parseInt(apartmentSqft, 10) || undefined : undefined,
              building_place_id: buildingPlaceId || undefined,
              latitude: locationCoords?.lat,
              longitude: locationCoords?.lng,
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
      trackEvent("analysis_started");
      const res = await fetch("/api/analyze-apartment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projId }),
      });

      if (res.ok) {
        const data = await res.json();
        setApartmentSummary(data.summary);
        setAnalyzePhase("done");
        trackEvent("analysis_complete");
        setStep("room_select");
      } else {
        // Surface the failure — silently dropping back to "setup" leaves the
        // user staring at the upload step with no idea their analysis failed.
        toast.error("Couldn't analyze your apartment", "Something went wrong. Please check your photos and try again.");
        setStep("setup");
      }
    } catch {
      toast.error("Couldn't analyze your apartment", "Something went wrong. Please check your connection and try again.");
      setStep("setup");
    } finally {
      setAnalyzing(false);
    }
  }, [roomImages, projectId, buildingName, buildingUrl, buildingResearch, city, state, neighborhood, bedrooms, bathrooms, apartmentSqft, ensureProject, buildingPlaceId, locationCoords?.lat, locationCoords?.lng]);

  const totalImages = Object.values(roomImages).flat().length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-accent-warm" />
        <p className="text-sm text-muted-foreground animate-pulse">Loading your space...</p>
      </div>
    );
  }

  // ─── Step: Welcome ─────────────────────────────────────────────
  if (step === "welcome") {
    return (
      <PageTransition className="max-w-2xl mx-auto px-4 py-20">
        <StaggerList className="text-center space-y-8">
          <StaggerItem className="flex justify-center">
            <div className="h-20 w-20 rounded-3xl bg-secondary flex items-center justify-center shadow-sm animate-float">
              <LogoMark className="h-10 w-10 text-foreground" />
            </div>
          </StaggerItem>
          <StaggerItem className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent-warm/10 border border-accent-warm/20 text-xs font-medium text-accent-warm-strong mb-2">
              Let&apos;s design your apartment
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-balance">Welcome to Apt<span className="text-accent-warm">Designer</span></h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto leading-relaxed">
              A few minutes of photos and notes, and we&apos;ll hand you a fully
              furnished apartment — every piece chosen for your space.
            </p>
          </StaggerItem>

          {/* Quick what-to-expect strip */}
          <StaggerItem>
            <StaggerList className="grid grid-cols-3 gap-3 max-w-md mx-auto pt-2">
              {[
                { n: "01", label: "Layout & location", hint: "30 sec" },
                { n: "02", label: "Photos & floor plan", hint: "3 min" },
                { n: "03", label: "Your designs", hint: "2 min" },
              ].map((s) => (
                <StaggerItem key={s.n} className="rounded-xl border bg-card p-3 text-left hover:shadow-sm transition-shadow">
                  <div className="text-[10px] font-bold text-accent-warm">{s.n}</div>
                  <div className="text-xs font-semibold mt-0.5">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">~{s.hint}</div>
                </StaggerItem>
              ))}
            </StaggerList>
          </StaggerItem>

          <StaggerItem>
            <Button
              size="xl"
              variant="warm"
              className="mt-4"
              onClick={() => setStep("layout")}
            >
              Start designing
              <ChevronRight className="h-5 w-5 ml-2" />
            </Button>
            <p className="text-xs text-muted-foreground mt-3">Free forever on one room. No credit card.</p>
          </StaggerItem>
        </StaggerList>
      </PageTransition>
    );
  }

  // ─── Step: Layout (Bed/Bath) ──────────────────────────────────
  if (step === "layout") {
    return (
      <PageTransition className="max-w-2xl mx-auto px-4 py-12">
        <StepHeader
          step={1}
          total={3}
          title="Tell us about your apartment"
          subtitle="We&apos;ll tailor the design journey to your exact layout."
        />

        <div className="space-y-8 mt-8">
          <div>
            <label id="bedrooms-label" className="text-sm font-medium text-muted-foreground mb-3 block">Bedrooms</label>
            <div className="flex gap-3" role="group" aria-labelledby="bedrooms-label">
              {[{ value: 0, label: "Studio" }, { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3+" }].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setBedrooms(opt.value)}
                  aria-pressed={bedrooms === opt.value}
                  className={cn(
                    "h-12 px-6 rounded-full border-2 text-sm font-medium transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-warm/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    bedrooms === opt.value
                      ? "border-accent-warm bg-accent-warm text-accent-warm-on-solid shadow-md"
                      : "border-border hover:border-accent-warm/50 hover:bg-secondary"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label id="bathrooms-label" className="text-sm font-medium text-muted-foreground mb-3 block">Bathrooms</label>
            <div className="flex gap-3" role="group" aria-labelledby="bathrooms-label">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setBathrooms(n)}
                  aria-pressed={bathrooms === n}
                  className={cn(
                    "h-12 px-6 rounded-full border-2 text-sm font-medium transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-warm/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    bathrooms === n
                      ? "border-accent-warm bg-accent-warm text-accent-warm-on-solid shadow-md"
                      : "border-border hover:border-accent-warm/50 hover:bg-secondary"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="apartment-sqft" className="text-sm font-medium text-muted-foreground mb-3 block">
              Square footage <span className="text-xs opacity-60">(optional — helps match your exact unit plan)</span>
            </label>
            <input
              id="apartment-sqft"
              type="number"
              inputMode="numeric"
              min={100}
              max={10000}
              placeholder="e.g. 725"
              value={apartmentSqft}
              onChange={(e) => setApartmentSqft(e.target.value.replace(/[^\d]/g, ""))}
              className="h-12 w-full rounded-full border-2 border-border bg-background px-5 text-sm font-medium outline-none transition-all focus:border-accent-warm focus-visible:ring-2 focus-visible:ring-accent-warm/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>

          <div className="pt-4">
            <p className="text-sm text-muted-foreground mb-4">
              We&apos;ll need photos of: {getRoomSections(bedrooms, bathrooms).map((s) => s.label).join(", ")}
            </p>
            <Button
              size="lg"
              className="w-full h-12"
              onClick={async () => {
                const sqftNum = apartmentSqft ? parseInt(apartmentSqft, 10) : null;
                try {
                  await saveProjectMeta({
                    bedrooms,
                    bathrooms,
                    ...(sqftNum && !Number.isNaN(sqftNum) ? { apartment_sqft: sqftNum } : {}),
                  });
                  setStep("location");
                } catch (err) {
                  // Don't advance past a failed save — the user would lose these
                  // details silently and hit a broken flow downstream.
                  toast.error(
                    "Couldn't save your details",
                    err instanceof Error ? err.message : "Please try again in a moment.",
                  );
                }
              }}
            >
              Continue
              <ChevronRight className="h-5 w-5 ml-2" />
            </Button>
          </div>
        </div>
      </PageTransition>
    );
  }

  // ─── Step: Location ───────────────────────────────────────────
  if (step === "location") {
    const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const locationConfirmed = !!(city && locationCoords);

    const handleLocationSelected = (place: PlaceResult) => {
      if (place.city) setCity(place.city);
      if (place.state) setState(place.state);
      if (place.neighborhood) setNeighborhood(place.neighborhood);
      if (place.placeId) setLocationPlaceId(place.placeId);
      if (place.lat && place.lng) setLocationCoords({ lat: place.lat, lng: place.lng });
    };

    const handleLocationReset = () => {
      setCity("");
      setState("");
      setNeighborhood("");
      setLocationPlaceId(null);
      setLocationCoords(null);
    };

    const locationLabel = [neighborhood, city, state].filter(Boolean).join(", ");

    return (
      <PageTransition className="max-w-2xl mx-auto px-4 py-12">
        <StepHeader
          step={2}
          total={3}
          title="Where&apos;s home?"
          subtitle="Your neighborhood shapes the design — local light, local style, nearby retailers."
        />

        <div className="space-y-6 mt-8">
          {!locationConfirmed ? (
            /* ── Search state ── */
            <PlaceAutocomplete
              searchType="regions"
              placeholder="Search your city or neighborhood..."
              icon="pin"
              onPlaceSelected={handleLocationSelected}
            />
          ) : (
            /* ── Confirmed state with map ── */
            <div className="animate-fade-in-up space-y-4">
              {/* Location badge with change button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-warm/10">
                    <MapPin className="h-4.5 w-4.5 text-accent-warm" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{locationLabel}</p>
                    <p className="text-xs text-muted-foreground">Your neighborhood</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={handleLocationReset}
                >
                  Change
                </Button>
              </div>

              {/* Map embed */}
              {mapsApiKey && (
                <div className="overflow-hidden rounded-2xl border shadow-sm">
                  <iframe
                    title={`Map of ${locationLabel}`}
                    width="100%"
                    height="240"
                    style={{ border: 0, display: "block" }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    src={`https://www.google.com/maps/embed/v1/place?key=${mapsApiKey}&q=${encodeURIComponent(locationLabel)}&zoom=14`}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="h-12" onClick={() => setStep("layout")}>Back</Button>
            <Button
              size="lg"
              className="flex-1 h-12"
              onClick={async () => {
                try {
                  await saveProjectMeta({
                    city, state, neighborhood,
                    location_place_id: locationPlaceId,
                    latitude: locationCoords?.lat,
                    longitude: locationCoords?.lng,
                  });
                  setStep("setup");
                } catch (err) {
                  toast.error(
                    "Couldn't save your location",
                    err instanceof Error ? err.message : "Please try again in a moment.",
                  );
                }
              }}
              disabled={!city}
            >
              {locationConfirmed ? "Looks good" : "Continue"}
              <ChevronRight className="h-5 w-5 ml-2" />
            </Button>
          </div>
        </div>
      </PageTransition>
    );
  }

  // ─── Step: Setup (Building + Photos combined) ─────────────────

  function BuildingPhoto({ placeId }: { placeId: string }) {
    const [photo, setPhoto] = useState<{ url: string; attributions: string[] } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      fetch(`/api/places/photo?place_id=${encodeURIComponent(placeId)}`)
        .then((r) => r.json())
        .then((data: { photoUrl?: string | null; attributions?: string[] }) => {
          if (!cancelled && data.photoUrl) {
            setPhoto({ url: data.photoUrl, attributions: data.attributions ?? [] });
          }
          setLoading(false);
        })
        .catch(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [placeId]);

    if (!loading && !photo) return null;

    return (
      <div className="overflow-hidden rounded-2xl border shadow-sm">
        {loading ? (
          <div className="h-[180px] bg-muted animate-pulse flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo!.url}
              alt={buildingName || "Building exterior"}
              className="w-full h-[180px] object-cover"
            />
            {photo!.attributions.length > 0 && (
              <p className="text-[10px] text-muted-foreground px-2 py-1 bg-muted/50">
                Photo: {photo!.attributions.join(", ")}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  if (step === "setup") {
    return (
      <PageTransition className="max-w-3xl mx-auto px-4 py-12">
        <StepHeader
          step={3}
          total={3}
          title="Show us your space"
          subtitle="Find your building and share a photo or two of each room. That&apos;s all we need."
        />

        <div className="space-y-8 mt-8">
          {/* Building info section */}
          {(() => {
            const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
            const buildingConfirmed = !!buildingPlaceId;
            // locationLabel available: [neighborhood, city, state].filter(Boolean).join(", ")

            const handleBuildingReset = () => {
              setBuildingName("");
              setBuildingUrl("");
              setBuildingPlaceId(null);
            };

            return (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Building
                </h2>

                {!buildingConfirmed ? (
                  /* ── Search state ── */
                  <div className="space-y-3">
                    <PlaceAutocomplete
                      searchType="establishment"
                      placeholder={city ? `Search apartments in ${city}...` : "Search your building..."}
                      icon="building"
                      locationBias={locationCoords ?? undefined}
                      onPlaceSelected={(place) => {
                        setBuildingName(place.displayName);
                        if (place.websiteUri) setBuildingUrl(place.websiteUri);
                        if (place.placeId) setBuildingPlaceId(place.placeId);
                      }}
                    />
                    <label htmlFor="building-name-manual" className="text-xs text-muted-foreground pl-1 block">
                      Or type a name manually:
                    </label>
                    <input
                      id="building-name-manual"
                      type="text"
                      value={buildingName}
                      onChange={(e) => setBuildingName(e.target.value)}
                      placeholder="e.g. Porte Apartments"
                      className="w-full h-11 px-4 rounded-xl border bg-background text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-all"
                    />
                  </div>
                ) : (
                  /* ── Confirmed state with map ── */
                  <div className="animate-fade-in-up space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-warm/10">
                          <Building2 className="h-4.5 w-4.5 text-accent-warm" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{buildingName}</p>
                          {buildingUrl && (
                            <p className="text-xs text-muted-foreground truncate max-w-[250px]">{buildingUrl}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                        onClick={handleBuildingReset}
                      >
                        Change
                      </Button>
                    </div>

                    <BuildingPhoto placeId={buildingPlaceId!} />

                    {mapsApiKey && (
                      <div className="overflow-hidden rounded-2xl border shadow-sm">
                        <iframe
                          title="Building location map"
                          width="100%"
                          height="180"
                          style={{ border: 0, display: "block" }}
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                          src={`https://www.google.com/maps/embed/v1/place?key=${mapsApiKey}&q=place_id:${buildingPlaceId}&zoom=16`}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Show research result if already done */}
                {buildingResearch && (() => {
                  const br = buildingResearch as Record<string, unknown>;
                  const fp = br.floor_plan as Record<string, unknown> | undefined;
                  const hasFloorPlan = fp?.found === true;
                  return (
                    <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 rounded-xl px-3 py-2.5 border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Building researched — {String(br.building_style || "style identified")}
                        {hasFloorPlan && fp?.total_sqft ? ` · ~${String(fp.total_sqft)} sqft` : ""}
                      </span>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* Floor plan upload section — sits between building research and room photos */}
          {projectId && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
                <FileImage className="h-4 w-4" />
                Do you have a floor plan?
                <span className="text-xs font-normal text-muted-foreground normal-case tracking-normal ml-1">— would help with design</span>
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Drop in a floor plan image or PDF and we&apos;ll pull room dimensions, wall features, and layout — so every piece we pick fits exactly where it belongs.
              </p>
              <FloorPlanUploadZone projectId={projectId} />
            </div>
          )}

          {/* Room photos section */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Room Photos
            </h2>
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
            Design my apartment · {totalImages} {totalImages === 1 ? "photo" : "photos"}
            <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      </PageTransition>
    );
  }

  // ─── Step: Analyzing ──────────────────────────────────────────
  if (step === "analyzing") {
    const buildingDone = analyzePhase !== "building";
    const photosDone = analyzePhase === "done";
    const showBuildingStep = !!buildingName && !buildingResearch;

    return (
      <PageTransition className="max-w-xl mx-auto px-4 py-20 text-center">
        {/* Animated loading indicator */}
        <div className="relative inline-flex h-20 w-20 items-center justify-center mx-auto">
          <div className="absolute inset-0 rounded-full bg-accent-warm/15 animate-ping" />
          <div className="relative h-20 w-20 rounded-full bg-gradient-warm-button flex items-center justify-center shadow-warm-md">
            <Loader2 className="h-9 w-9 text-accent-warm-on-solid animate-spin" />
          </div>
        </div>

        <h2 className="text-2xl md:text-3xl font-bold mt-8">
          {analyzePhase === "building" ? "Getting to know your building…" : "Finding your style…"}
        </h2>
        <p className="text-muted-foreground mt-3 max-w-md mx-auto leading-relaxed">
          {analyzePhase === "building"
            ? "We're researching the floor plans, finishes, and architectural details that make your space unique."
            : "We're studying how your rooms feel — the light, the proportions, the details — so every recommendation fits like it was made for you."}
        </p>

        <div className="flex flex-col gap-2.5 mt-10 text-sm text-left max-w-sm mx-auto">
          <StepIndicator done label={`${totalImages} photo${totalImages === 1 ? "" : "s"} safely uploaded`} />
          {showBuildingStep && (
            <StepIndicator done={buildingDone} active={analyzePhase === "building"} label="Researching your building's finishes & floor plans" />
          )}
          {buildingResearch && !showBuildingStep && <StepIndicator done label="Building context loaded" />}
          <StepIndicator done={photosDone} active={analyzePhase === "photos"} label="Reading each room — light, scale, and materials" />
          <StepIndicator done={photosDone} active={analyzePhase === "photos"} label="Forming a design direction that feels like you" />
        </div>

        <p className="text-xs text-muted-foreground mt-8 italic">
          This usually takes a minute. Grab a coffee — we&apos;re almost there.
        </p>
      </PageTransition>
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
          const res = await fetch(`/api/rooms/${roomId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_context: context }),
          });
          if (!res.ok) {
            console.error("[dashboard] Failed to save user_context:", await res.text());
            // Don't let the save fail silently — the user typed notes and
            // believes they were captured. Inform them; the note is optional to
            // the room flow, so we still proceed rather than trapping them.
            toast.error("Your notes didn't save", "We'll take you to the room, but please re-enter any notes there.");
          }
        } finally {
          setSavingContext(false);
        }
      }

      router.push(`/projects/${projectId}/rooms/${roomId}/focus`);
    };

    return (
      <PageTransition className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <Badge variant="success" className="inline-flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Apartment analyzed · ready to design
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Pick a room to start with</h1>
          <p className="text-muted-foreground mt-3 max-w-lg mx-auto leading-relaxed">
            We recommend the room you spend the most time in. Don&apos;t worry — you can
            design the others right after, and they&apos;ll all speak the same design language.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {roomSections.map((section) => {
            const hasImages = (roomImages[section.key]?.length || 0) > 0;
            const firstImage = roomImages[section.key]?.[0];
            const isSelected = selectedRoom === section.key;
            const roomStatus = roomStatuses[section.key] ?? "setup";
            const isDone = roomStatus === "completed";
            const isInProgress = ["diagnosed", "sourcing", "bundled"].includes(roomStatus);
            const isOutstanding = hasImages && !isDone && !isInProgress;

            if (!hasImages) return null;

            return (
              <button
                key={section.key}
                onClick={() => setSelectedRoom(isSelected ? null : section.key)}
                aria-pressed={isSelected}
                aria-label={`${section.label} — ${isDone ? "done" : isInProgress ? "in progress" : "outstanding"}`}
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
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

                {/* Status badge — top-left. A one-hue emphasis ladder (quiet →
                    house accent → solid ink), not three unrelated colours —
                    see lib/scoring/verdicts.ts for the same pattern. */}
                <div className="absolute top-3 left-3">
                  {isDone ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-foreground text-background text-[10px] font-semibold shadow">
                      <CheckCircle2 className="h-3 w-3" /> Done
                    </span>
                  ) : isInProgress ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-warm text-accent-warm-on-solid text-[10px] font-semibold shadow">
                      In Progress
                    </span>
                  ) : isOutstanding ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/90 text-foreground text-[10px] font-semibold shadow">
                      Outstanding
                    </span>
                  ) : null}
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-3 right-3 h-7 w-7 rounded-full bg-accent-warm flex items-center justify-center shadow-lg animate-fade-in-up">
                    <CheckCircle2 className="h-4 w-4 text-accent-warm-on-solid" />
                  </div>
                )}

                {/* Room label */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <section.icon className="h-5 w-5 text-white" />
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
                  <label htmlFor="room-photo-context" className="text-sm font-medium mb-1.5 block">
                    Anything we should know about these photos?
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Optional — mention anything temporary, out of place, or not obvious from the photos.
                  </p>
                  <textarea
                    id="room-photo-context"
                    value={roomContext[selectedRoom] || ""}
                    onChange={(e) =>
                      setRoomContext((prev) => ({ ...prev, [selectedRoom]: e.target.value }))
                    }
                    placeholder={"e.g. \"Ignore the yoga mat, it won't be there\" or \"The clutter will be cleaned up — focus on the furniture and layout\""}
                    className="w-full h-24 px-4 py-3 rounded-xl border bg-background text-sm shadow-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-all"
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
                      Design this room
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </PageTransition>
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
              "h-1.5 rounded-full flex-1 transition-all duration-500",
              i < step ? "bg-accent-warm" : "bg-border"
            )}
          />
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-accent-warm uppercase tracking-wider">Step {step} of {total}</p>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function StepIndicator({ done, active, label }: { done?: boolean; active?: boolean; label: string }) {
  return (
    <div className={cn(
      "flex items-center gap-3 py-1",
      done && "text-emerald-600 dark:text-emerald-400",
      active && "text-accent-warm font-medium",
      !done && !active && "text-muted-foreground"
    )}>
      {done ? (
        <CheckCircle2 className="h-4.5 w-4.5" />
      ) : active ? (
        <Loader2 className="h-4.5 w-4.5 animate-spin" />
      ) : (
        <div className="h-4.5 w-4.5 rounded-full border-2 border-border" />
      )}
      <span className="text-sm">{label}</span>
    </div>
  );
}

function RoomUploadSection({
  section,
  images,
  onUpload,
  onRemove,
}: {
  section: { key: string; label: string; icon: LucideIcon };
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
          <div className="h-9 w-9 rounded-xl bg-secondary flex items-center justify-center"><section.icon className="h-5 w-5 text-muted-foreground" /></div>
          <CardTitle className="text-base flex-1">{section.label}</CardTitle>
          {images.length > 0 && (
            <Badge variant="success">
              {images.length} {images.length === 1 ? "photo" : "photos"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 flex-wrap">
          {images.map((img, i) => (
            <div key={img.id} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={`Uploaded room photo ${i + 1}`}
                className="h-24 w-24 rounded-xl object-cover border shadow-sm transition-transform duration-200 group-hover:scale-105"
              />
              <button
                onClick={() => onRemove(img.id)}
                aria-label="Remove image"
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-md"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Upload zone */}
          <div
            {...getRootProps()}
            className={cn(
              "h-24 min-w-[6rem] rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all duration-200",
              isDragActive ? "border-accent-warm bg-accent-warm/5 scale-105" : "border-muted-foreground/20 hover:border-accent-warm/40 hover:bg-secondary/50",
              uploading && "pointer-events-none opacity-50"
            )}
          >
            <input {...getInputProps()} capture="environment" aria-label={`Upload photos for ${section.label}`} />
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-accent-warm" />
            ) : (
              <>
                <Camera className="h-5 w-5 text-muted-foreground/40" />
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
