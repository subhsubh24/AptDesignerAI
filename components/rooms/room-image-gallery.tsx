"use client";

import Image from "next/image";
import type { RoomImage } from "@/lib/types/database";

interface RoomImageGalleryProps {
  images: RoomImage[];
}

/**
 * `isAcceptableStoredImageUrl` (lib/utils/image-url.ts) only requires
 * `https:` or an internal relative path — it has no host allowlist. Mirrors
 * next.config.ts's `images.remotePatterns` so a room_images row with a host
 * next/image doesn't recognize falls back to a plain `<img>` instead of
 * throwing a hard runtime error.
 */
const OPTIMIZABLE_HOSTS = [
  /\.supabase\.co$/,
  /\.supabase\.in$/,
  /\.googleusercontent\.com$/,
  /^places\.googleapis\.com$/,
  /^generativelanguage\.googleapis\.com$/,
];

function canOptimize(url: string): boolean {
  if (url.startsWith("/")) return true; // internal storage path, same-origin
  try {
    const { hostname } = new URL(url);
    return OPTIMIZABLE_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
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
          {canOptimize(image.image_url) ? (
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
