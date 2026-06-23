import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Camera,
  Stethoscope,
  ShoppingBag,
  GitCompare,
  LayoutGrid,
  Image as ImageIcon,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { RoomImageGallery } from "@/components/rooms/room-image-gallery";
import { cn } from "@/lib/utils/cn";

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

  // Fetch counts in parallel — all three are independent of each other
  const [{ data: productsData }, { data: bundlesData }, { data: mockupsData }] =
    await Promise.all([
      supabase.from("candidate_products").select("id, status").eq("room_id", roomId),
      supabase.from("product_bundles").select("id").eq("room_id", roomId),
      supabase.from("room_mockups").select("id").eq("room_id", roomId),
    ]);

  const productCount = productsData?.length ?? 0;
  const shortlistedCount = productsData?.filter(
    (p: { status: string }) => p.status === "shortlisted" || p.status === "accepted"
  ).length ?? 0;
  const bundleCount = bundlesData?.length ?? 0;
  const mockupCount = mockupsData?.length ?? 0;

  const hasImages = room.room_images && room.room_images.length > 0;
  const basePath = `/projects/${projectId}/rooms/${roomId}`;

  const statusOrder = ["setup", "diagnosed", "sourcing", "bundled", "completed"];
  const currentStatusIndex = statusOrder.indexOf(room.status);

  const steps = [
    {
      title: "Setup & Photos",
      description: "Upload room photos and configure preferences",
      href: `${basePath}/setup`,
      icon: Camera,
      available: true,
      completed: hasImages,
      status: hasImages
        ? `${room.room_images.length} photo${room.room_images.length === 1 ? "" : "s"} uploaded`
        : "Not started",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-950",
      completedBg: "bg-blue-500",
    },
    {
      title: "Room Diagnosis",
      description: "AI analysis of your room with design direction",
      href: `${basePath}/diagnosis`,
      icon: Stethoscope,
      available: hasImages,
      completed: currentStatusIndex >= 1,
      status: currentStatusIndex >= 1 ? "Analysis complete" : "Ready to analyze",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-100 dark:bg-emerald-950",
      completedBg: "bg-emerald-500",
    },
    {
      title: "Products",
      description: "Find and evaluate furniture & decor for your space",
      href: `${basePath}/products`,
      icon: ShoppingBag,
      available: currentStatusIndex >= 1,
      completed: (productCount || 0) > 0,
      status:
        (productCount || 0) > 0
          ? `${productCount} product${productCount === 1 ? "" : "s"}, ${shortlistedCount || 0} shortlisted`
          : "No products yet",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-100 dark:bg-amber-950",
      completedBg: "bg-amber-500",
    },
    {
      title: "Compare",
      description: "Side-by-side product comparison across all scores",
      href: `${basePath}/compare`,
      icon: GitCompare,
      available: currentStatusIndex >= 1,
      completed: (shortlistedCount || 0) >= 2,
      status:
        (shortlistedCount || 0) >= 2
          ? `${shortlistedCount} products to compare`
          : "Need 2+ scored products",
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-100 dark:bg-purple-950",
      completedBg: "bg-purple-500",
    },
    {
      title: "Bundles",
      description: "Room concepts with holistic scoring and vibe analysis",
      href: `${basePath}/bundles`,
      icon: LayoutGrid,
      available: currentStatusIndex >= 1,
      completed: (bundleCount || 0) > 0,
      status:
        (bundleCount || 0) > 0
          ? `${bundleCount} bundle${bundleCount === 1 ? "" : "s"} created`
          : "No bundles yet",
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-100 dark:bg-rose-950",
      completedBg: "bg-rose-500",
    },
    {
      title: "Mockups",
      description: "AI-generated room visualizations with your selections",
      href: `${basePath}/mockups`,
      icon: ImageIcon,
      available: currentStatusIndex >= 1,
      completed: (mockupCount || 0) > 0,
      status:
        (mockupCount || 0) > 0
          ? `${mockupCount} mockup${mockupCount === 1 ? "" : "s"} generated`
          : "No mockups yet",
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-100 dark:bg-cyan-950",
      completedBg: "bg-cyan-500",
    },
  ];

  // Find the recommended next step (first incomplete and available)
  const nextStepIndex = steps.findIndex((s) => s.available && !s.completed);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header with room photo banner */}
      <div>
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Link>

        {/* Room hero banner */}
        {hasImages && room.room_images[0]?.image_url && (
          <div className="relative rounded-2xl overflow-hidden mb-6 shadow-warm-sm">
            <div className="aspect-[21/9] w-full">
              <img
                src={room.room_images[0].image_url}
                alt={room.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-6">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">{room.name}</h1>
              <div className="flex items-center gap-2.5 mt-2">
                <span className="text-sm text-white/70">
                  {ROOM_TYPE_LABELS[room.room_type] || room.room_type}
                </span>
                <Badge variant="warm" className="capitalize">
                  {room.budget_mode}
                </Badge>
                <Badge variant={room.status === "completed" ? "success" : "secondary"} className="capitalize">
                  {room.status}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {!hasImages && (
          <div className="mb-6">
            <h1 className="text-headline">{room.name}</h1>
            <div className="flex items-center gap-2.5 mt-2.5">
              <span className="text-sm text-muted-foreground">
                {ROOM_TYPE_LABELS[room.room_type] || room.room_type}
              </span>
              <Badge variant="warm" className="capitalize">
                {room.budget_mode}
              </Badge>
              <Badge variant={room.status === "completed" ? "success" : "secondary"} className="capitalize">
                {room.status}
              </Badge>
            </div>
          </div>
        )}
      </div>

      {/* Room images gallery (if more than 1) */}
      {hasImages && room.room_images.length > 1 && (
        <RoomImageGallery images={room.room_images} />
      )}

      {/* Journey Stepper */}
      <div className="space-y-0">
        {steps.map((step, i) => {
          const isNext = i === nextStepIndex;
          const isLast = i === steps.length - 1;

          return (
            <div key={step.title} className="relative flex gap-3 sm:gap-4 md:gap-6">
              {/* Timeline connector */}
              <div className="flex flex-col items-center shrink-0">
                {/* Circle */}
                <div
                  className={cn(
                    "relative z-10 flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 shrink-0",
                    step.completed
                      ? `${step.completedBg} text-white shadow-sm`
                      : isNext
                      ? "bg-accent-warm text-white shadow-warm-md animate-gentle-glow"
                      : step.available
                      ? "border-2 border-border bg-card"
                      : "border-2 border-border/50 bg-muted"
                  )}
                >
                  {step.completed ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <step.icon className={cn("h-5 w-5", step.available ? step.color : "text-muted-foreground/40")} />
                  )}
                </div>
                {/* Line */}
                {!isLast && (
                  <div
                    className={cn(
                      "w-0.5 flex-1 min-h-[24px] transition-colors",
                      step.completed ? "bg-emerald-300 dark:bg-emerald-700" : "bg-border"
                    )}
                  />
                )}
              </div>

              {/* Content card */}
              <div className={cn("flex-1 pb-6", isLast && "pb-0")}>
                <Link
                  href={step.available ? step.href : "#"}
                  className={cn(!step.available && "pointer-events-none")}
                >
                  <Card
                    variant={isNext ? "accent" : "default"}
                    className={cn(
                      "group transition-all duration-300",
                      step.available && !isNext && "hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
                      isNext && "shadow-warm-sm hover:shadow-warm-md hover:-translate-y-0.5 cursor-pointer border-l-accent-warm",
                      !step.available && "opacity-60 grayscale-[30%]"
                    )}
                  >
                    <CardContent className="p-4 md:p-5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className={cn(
                              "font-semibold text-base",
                              isNext && "text-accent-warm"
                            )}>
                              {step.title}
                            </h3>
                            {isNext && (
                              <Badge variant="warm" className="text-[10px]">Next</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{step.description}</p>
                          <p className={cn(
                            "text-xs mt-1.5",
                            step.completed ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground/60"
                          )}>
                            {step.status}
                          </p>
                        </div>
                        {step.available && (
                          <div className="shrink-0">
                            {isNext ? (
                              <Button size="sm" variant="warm" className="gap-1.5">
                                Start
                                <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                              </Button>
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
