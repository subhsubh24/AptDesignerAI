import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, DoorOpen } from "lucide-react";
import { CreateRoomDialog } from "@/components/rooms/create-room-dialog";

const ROOM_TYPE_LABELS: Record<string, string> = {
  living_room: "Living Room",
  dining_area: "Dining Area",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  bathroom: "Bathroom",
};

const STATUS_COLORS: Record<string, "default" | "secondary" | "success" | "warning"> = {
  setup: "secondary",
  diagnosed: "warning",
  sourcing: "warning",
  bundled: "success",
  completed: "success",
};

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project, error } = await supabase
    .from("projects")
    .select("*, rooms(*)")
    .eq("id", projectId)
    .single();

  if (error || !project) notFound();

  const rooms = project.rooms || [];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
            {project.description && (
              <p className="text-muted-foreground mt-1">{project.description}</p>
            )}
          </div>
          <CreateRoomDialog projectId={projectId} />
        </div>
      </div>

      {rooms.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-14 w-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <DoorOpen className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No rooms yet</h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
              Add your first room to begin the design process. Start with your
              highest priority room.
            </p>
            <CreateRoomDialog projectId={projectId} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room: { id: string; name: string; room_type: string; status: string; budget_mode: string; sourcing_mode: string; updated_at: string }) => (
            <Link
              key={room.id}
              href={`/projects/${projectId}/rooms/${room.id}`}
            >
              <Card className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer h-full group">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg group-hover:text-accent-warm transition-colors">{room.name}</CardTitle>
                    <Badge variant={STATUS_COLORS[room.status] || "secondary"}>
                      {room.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {ROOM_TYPE_LABELS[room.room_type] || room.room_type}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs capitalize">{room.budget_mode}</Badge>
                    <Badge variant="outline" className="text-xs capitalize">{room.sourcing_mode}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
