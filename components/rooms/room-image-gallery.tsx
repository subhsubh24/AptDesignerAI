"use client";

import Image from "next/image";
import type { RoomImage } from "@/lib/types/database";
import { canOptimizeImageHost } from "@/lib/utils/image-url";

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
          className="relative aspect-video rounded-lg overflow-hidden bg-muted"
        >
          {canOptimizeImageHost(image.image_url) ? (
            <Image
              src={image.image_url}
              alt={image.caption || "Room photo"}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
              className="object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.image_url}
              alt={image.caption || "Room photo"}
              className="h-full w-full object-cover"
            />
          )}
        </div>
      ))}
    </div>
  );
}
