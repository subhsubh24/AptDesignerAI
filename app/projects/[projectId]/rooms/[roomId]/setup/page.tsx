"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadZone } from "@/components/rooms/image-upload-zone";
import { SourcingModeSelector } from "@/components/rooms/sourcing-mode-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/rooms/${roomId}`);
      if (res.ok) {
        const data = await res.json();
        setRoom(data);
        setBudgetMode(data.budget_mode || "balanced");
        setBudgetDollars(data.budget_dollars ? String(data.budget_dollars) : "");
        setSourcingMode(data.sourcing_mode || "manual");
        setKeepItems((data.keep_items || []).join(", "));
        setReplaceItems((data.replace_items || []).join(", "));
        setPriorities((data.priorities || []).join(", "));
        setImages(
          (data.room_images || []).map((img: { id: string; image_url: string }) => ({
            id: img.id,
            url: img.image_url,
          }))
        );
      }
    }
    load();
  }, [roomId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget_mode: budgetMode,
          budget_dollars: budgetDollars ? parseInt(budgetDollars, 10) : null,
          sourcing_mode: sourcingMode,
          keep_items: keepItems.split(",").map((s) => s.trim()).filter(Boolean),
          replace_items: replaceItems.split(",").map((s) => s.trim()).filter(Boolean),
          priorities: priorities.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      router.push(`/projects/${projectId}/rooms/${roomId}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleImageUploaded = (image: { url: string; path: string; id: string }) => {
    setImages((prev) => [...prev, { id: image.id, url: image.url }]);
  };

  if (!room) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
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
            <div className="grid grid-cols-3 gap-3">
              {images.map((img) => (
                <div key={img.id} className="relative aspect-video rounded-lg overflow-hidden bg-muted group">
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
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

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save & Continue"}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
