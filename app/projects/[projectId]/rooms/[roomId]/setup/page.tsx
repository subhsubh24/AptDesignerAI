"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ImageUploadZone } from "@/components/rooms/image-upload-zone";
import { SourcingModeSelector } from "@/components/rooms/sourcing-mode-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Paperclip, Lightbulb, AlertTriangle, RefreshCw } from "lucide-react";
import { PageTransition } from "@/components/ui/motion";

export default function RoomSetupPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const roomId = params.roomId as string;

  const [room, setRoom] = useState<Record<string, unknown> | null>(null);
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  const [budgetMode, setBudgetMode] = useState("balanced");
  const [budgetDollars, setBudgetDollars] = useState<string>("");
  const [sourcingMode, setSourcingMode] = useState("manual");
  const [keepItems, setKeepItems] = useState("");
  const [replaceItems, setReplaceItems] = useState("");
  const [priorities, setPriorities] = useState("");
  const [userContext, setUserContext] = useState("");
  const [referenceImages, setReferenceImages] = useState<{ id: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBudgetMode(data.budget_mode || "balanced");
      setBudgetDollars(data.budget_dollars ? String(data.budget_dollars) : "");
      setSourcingMode(data.sourcing_mode || "manual");
      setKeepItems((data.keep_items || []).join(", "));
      setReplaceItems((data.replace_items || []).join(", "));
      setPriorities((data.priorities || []).join(", "));
      setUserContext(data.user_context || "");
      const roomImgs: { id: string; url: string }[] = [];
      const refImgs: { id: string; url: string }[] = [];
      for (const img of (data.room_images || []) as { id: string; image_url: string; image_type: string }[]) {
        if (img.image_type === "detail") {
          refImgs.push({ id: img.id, url: img.image_url });
        } else {
          roomImgs.push({ id: img.id, url: img.image_url });
        }
      }
      setImages(roomImgs);
      setReferenceImages(refImgs);
      setRoom(data);
      setLoadError(false);
    } catch {
      // Without this the failed load leaves room=null forever → an infinite
      // skeleton with no error and no recovery path. Surface it instead.
      setLoadError(true);
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget_mode: budgetMode,
          budget_dollars: budgetDollars ? parseInt(budgetDollars, 10) : null,
          sourcing_mode: sourcingMode,
          keep_items: keepItems.split(",").map((s) => s.trim()).filter(Boolean),
          replace_items: replaceItems.split(",").map((s) => s.trim()).filter(Boolean),
          priorities: priorities.split(",").map((s) => s.trim()).filter(Boolean),
          user_context: userContext.trim() || null,
        }),
      });
      // Only navigate away once the save actually succeeded — otherwise the
      // user's budget / sourcing / keep-replace / priorities / context is
      // silently lost and they land back on the room believing it was saved.
      if (!res.ok) throw new Error("We couldn't save your room preferences. Please try again.");
      router.push(`/projects/${projectId}/rooms/${roomId}`);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "We couldn't save your room preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleImageUploaded = (image: { url: string; path: string; id: string }) => {
    setImages((prev) => [...prev, { id: image.id, url: image.url }]);
  };

  const handleReferenceUploaded = (image: { url: string; path: string; id: string }) => {
    setReferenceImages((prev) => [...prev, { id: image.id, url: image.url }]);
  };

  if (!room && loadError) {
    return (
      <div className="max-w-3xl mx-auto py-16 px-4">
        <Card className="border-dashed border-2 border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-3xl bg-destructive/10 flex items-center justify-center mb-5">
              <AlertTriangle className="h-8 w-8 text-destructive/70" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Couldn&apos;t load this room</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-5">
              Something went wrong loading this room&apos;s setup. Check your connection and try again.
            </p>
            <Button variant="outline" onClick={() => { setLoadError(false); load(); }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 py-8 px-4">
        <div className="space-y-3">
          <div className="skeleton-pulse h-8 w-40 rounded-lg" />
          <div className="skeleton-pulse h-4 w-72 rounded-lg" />
        </div>
        <div className="rounded-2xl border bg-card p-6 space-y-4">
          <div className="skeleton-pulse h-5 w-32" />
          <div className="skeleton-pulse h-40 rounded-xl" />
        </div>
        <div className="rounded-2xl border bg-card p-6 space-y-4">
          <div className="skeleton-pulse h-5 w-28" />
          <div className="skeleton-pulse h-10 rounded-lg" />
          <div className="skeleton-pulse h-10 rounded-lg" />
          <div className="skeleton-pulse h-10 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <PageTransition className="max-w-3xl mx-auto space-y-6 sm:space-y-8 px-4 sm:px-0">
      <div>
        <Link
          href={`/projects/${projectId}/rooms/${roomId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Room
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Room Setup</h1>
        <p className="text-muted-foreground mt-1">
          Upload photos and configure your room preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Room Photos</CardTitle>
          <CardDescription>
            Upload 1-3 photos of the room. Include at least one wide shot showing the full room.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
              {images.map((img, i) => (
                <div key={img.id} className="relative aspect-video rounded-lg overflow-hidden bg-muted group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`Room photo ${i + 1}`} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}
          <ImageUploadZone
            roomId={roomId}
            imageType="room"
            onUploadComplete={handleImageUploaded}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apartment Context Photos</CardTitle>
          <CardDescription>
            Upload 1-2 full-apartment photos for context (e.g., showing the open layout).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImageUploadZone
            roomId={roomId}
            imageType="apartment_context"
            onUploadComplete={handleImageUploaded}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-2">
            <Label>Budget Mode</Label>
            <Select value={budgetMode} onValueChange={setBudgetMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="budget">Budget</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="best_possible">Best Possible</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Total Budget (optional)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                placeholder="e.g., 3000"
                value={budgetDollars}
                onChange={(e) => setBudgetDollars(e.target.value)}
                className="pl-7"
                min={0}
                step={100}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Set a target budget to track spending against. Leave blank if flexible.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Sourcing Mode</Label>
            <SourcingModeSelector value={sourcingMode} onChange={setSourcingMode} />
          </div>

          <div className="grid gap-2">
            <Label>Furniture to Keep (comma-separated)</Label>
            <Input
              placeholder="e.g., KIVIK sofa, arc floor lamp, TV stand"
              value={keepItems}
              onChange={(e) => setKeepItems(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Furniture to Replace (comma-separated)</Label>
            <Input
              placeholder="e.g., coffee table, rug"
              value={replaceItems}
              onChange={(e) => setReplaceItems(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Priorities (comma-separated)</Label>
            <Input
              placeholder="e.g., comfort, style, hosting, evening ambience"
              value={priorities}
              onChange={(e) => setPriorities(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            Anything else?
          </CardTitle>
          <CardDescription>
            Share inspiration, context, or reference images — anything that helps us
            understand your vision. A Pinterest board screenshot, a photo of a sofa
            layout you love, notes about how you use the space.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label>Notes & context</Label>
            <Textarea
              placeholder={'e.g. "I host dinner parties most weekends" or "The yoga mat won\'t be there — ignore it" or "I love the warm tones in this Japandi cafe I visited"'}
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              className="min-h-[100px] resize-y"
            />
            <p className="text-xs text-muted-foreground">
              Lifestyle details, things to ignore in photos, style references — all helpful.
            </p>
          </div>

          <div className="grid gap-2">
            <Label className="flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5" />
              Reference images
            </Label>
            <p className="text-xs text-muted-foreground">
              Inspiration photos, layout sketches, furniture you&apos;re eyeing — drag them in.
            </p>
            {referenceImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                {referenceImages.map((img, i) => (
                  <div key={img.id} className="relative aspect-video rounded-lg overflow-hidden bg-muted group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`Reference photo ${i + 1}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            <ImageUploadZone
              roomId={roomId}
              imageType="detail"
              onUploadComplete={handleReferenceUploaded}
            />
          </div>
        </CardContent>
      </Card>

      {saveError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive/70 mt-0.5" />
          <p className="text-sm text-foreground">{saveError}</p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save & Continue"}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </PageTransition>
  );
}
