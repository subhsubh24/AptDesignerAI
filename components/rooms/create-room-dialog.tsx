"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

const ROOM_TYPES = [
  { value: "living_room", label: "Living Room" },
  { value: "dining_area", label: "Dining Area" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bedroom", label: "Bedroom" },
  { value: "bathroom", label: "Bathroom" },
];

const BUDGET_MODES = [
  { value: "budget", label: "Budget" },
  { value: "balanced", label: "Balanced" },
  { value: "best_possible", label: "Best Possible" },
];

const SOURCING_MODES = [
  { value: "manual", label: "Manual" },
  { value: "agentic", label: "AI Search" },
  { value: "hybrid", label: "Hybrid" },
];

interface CreateRoomDialogProps {
  projectId: string;
}

export function CreateRoomDialog({ projectId }: CreateRoomDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [roomType, setRoomType] = useState("");
  const [budgetMode, setBudgetMode] = useState("balanced");
  const [sourcingMode, setSourcingMode] = useState("manual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleCreate = async () => {
    if (!name.trim() || !roomType) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: name.trim(),
          room_type: roomType,
          budget_mode: budgetMode,
          sourcing_mode: sourcingMode,
        }),
      });
      if (!res.ok) throw new Error("Failed to create room");
      const room = (await res.json()) as { id?: string };
      if (!room?.id) throw new Error("Failed to create room");
      setOpen(false);
      setName("");
      setRoomType("");
      router.push(`/projects/${projectId}/rooms/${room.id}`);
      router.refresh();
    } catch {
      // Keep the dialog open and tell the user, rather than silently
      // clearing the spinner (which read as "nothing happened").
      setError("Couldn't create the room. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setError(null);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Room
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Room</DialogTitle>
          <DialogDescription>
            Add a new room to design.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="room-name">Room Name</Label>
            <Input
              id="room-name"
              placeholder="e.g., Living Room"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Room Type</Label>
            {/* aria-label, not the visible <Label>: SelectTrigger renders
                role="combobox", which does not take its name from content, so
                neither the trigger text nor a sibling <Label> names it. */}
            <Select value={roomType} onValueChange={setRoomType}>
              <SelectTrigger aria-label="Room Type">
                <SelectValue placeholder="Select room type" />
              </SelectTrigger>
              <SelectContent>
                {ROOM_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Budget</Label>
              <Select value={budgetMode} onValueChange={setBudgetMode}>
                <SelectTrigger aria-label="Budget">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Sourcing</Label>
              <Select value={sourcingMode} onValueChange={setSourcingMode}>
                <SelectTrigger aria-label="Sourcing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCING_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || !roomType || loading}>
            {loading ? "Creating..." : "Add Room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
