import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Camera,
  Stethoscope,
  ShoppingBag,
  GitCompare,
  LayoutGrid,
  Image as ImageIcon,
  ChevronRight,
} from "lucide-react";
import { RoomImageGallery } from "@/components/rooms/room-image-gallery";

const ROOM_TYPE_LABELS: Record<string, string> = {
  living_room: "Living Room",
  dining_area: "Dining Area",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  bathroom: "Bathroom",
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ projectId: string; roomId: string }>;
}) {
  const { projectId, roomId } = await params;
  const supabase = await createClient();

  const { data: room, error } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", roomId)
    .single();

  if (error || !room) notFound();

  const hasImages = room.room_images && room.room_images.length > 0;
  const basePath = `/projects/${projectId}/rooms/${roomId}`;

  const steps = [
    {
      title: "Setup & Photos",
      description: "Upload room photos and configure preferences",
      href: `${basePath}/setup`,
      icon: Camera,
      available: true,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-950",
    },
    {
      title: "Room Diagnosis",
      description: "AI analysis of your room",
      href: `${basePath}/diagnosis`,
      icon: Stethoscope,
      available: hasImages,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-100 dark:bg-emerald-950",
    },
    {
      title: "Products",
      description: "Find and evaluate furniture & decor",
      href: `${basePath}/products`,
      icon: ShoppingBag,
      available: room.status !== "setup",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-100 dark:bg-amber-950",
    },
    {
      title: "Compare",
      description: "Side-by-side product comparison",
      href: `${basePath}/compare`,
      icon: GitCompare,
      available: room.status !== "setup",
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-100 dark:bg-purple-950",
    },
    {
      title: "Bundles",
      description: "Room concept bundles with holistic scoring",
      href: `${basePath}/bundles`,
      icon: LayoutGrid,
      available: room.status !== "setup",
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-100 dark:bg-rose-950",
    },
    {
      title: "Mockups",
      description: "Visualize your room with selected furniture",
      href: `${basePath}/mockups`,
      icon: ImageIcon,
      available: room.status !== "setup",
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-100 dark:bg-cyan-950",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{room.name}</h1>
            <div className="flex items-center gap-2.5 mt-2.5">
              <span className="text-sm text-muted-foreground">
                {ROOM_TYPE_LABELS[room.room_type]}
              </span>
              <span className="text-border">|</span>
              <Badge variant="secondary" className="capitalize">
                {room.budget_mode}
              </Badge>
              <Badge variant="secondary" className="capitalize">
                {room.sourcing_mode}
              </Badge>
              <Badge variant={room.status === "completed" ? "success" : "secondary"}>
                {room.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {hasImages && <RoomImageGallery images={room.room_images} />}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => (
          <Link
            key={step.title}
            href={step.available ? step.href : "#"}
            className={!step.available ? "pointer-events-none" : ""}
          >
            <Card
              className={`h-full transition-all duration-300 group ${
                step.available
                  ? "hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
                  : "opacity-40"
              }`}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${step.bg} transition-transform duration-200 group-hover:scale-110`}>
                    <step.icon className={`h-5 w-5 ${step.color}`} />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base">{step.title}</CardTitle>
                  </div>
                  {step.available && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
