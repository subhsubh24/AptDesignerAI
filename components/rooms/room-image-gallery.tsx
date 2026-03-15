"use client";

import type { RoomImage } from "@/lib/types/database";

interface RoomImageGalleryProps {
  images: RoomImage[];
}

export function RoomImageGallery({ images }: RoomImageGalleryProps) {
  if (!images || images.length === 0) return null;

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {images.map((image) => (
        <div
          key={image.id}
          className="aspect-video rounded-lg overflow-hidden bg-muted"
        >
          <img
            src={image.image_url}
            alt={image.caption || "Room photo"}
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}
