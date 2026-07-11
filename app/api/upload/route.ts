import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

// Accepts files up to 20MB and streams them to Supabase Storage. A large upload
// over a slow client link can legitimately exceed the platform's default budget
// and get killed mid-write; give it explicit headroom so the store call completes.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Storage abuse guard: uploads accept files up to 20MB and write to object
  // storage. Without a per-user cap a compromised session can burn storage
  // quota / rack up egress. 20 uploads/min is generous for real use (Track G1).
  const limit = checkRateLimit(`upload:${user.id}`, RATE_LIMITS.upload);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File;
  const ALLOWED_BUCKETS = new Set(["room-images", "floor-plans"]);
  const rawBucket = (formData.get("bucket") as string) || "room-images";
  const bucket = ALLOWED_BUCKETS.has(rawBucket) ? rawBucket : "room-images";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // The room-images bucket stores both room photos and floor plan PDFs
  // (see floor-plan-upload-zone.tsx). Allow image MIME types + PDF.
  const ALLOWED_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
  ]);
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, WebP, HEIC, or PDF files are allowed" },
      { status: 400 },
    );
  }

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File size exceeds 20MB limit" }, { status: 400 });
  }

  const fileExt = file.name.split(".").pop();

  // Convert File to Buffer before uploading — some Next.js runtimes don't
  // pass the Blob through correctly to downstream consumers
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  // Content-addressed filename: same bytes → same path. This makes uploads
  // idempotent (useful for deterministic replay) and lets us dedupe
  // accidental re-uploads naturally. `upsert: true` so a repeat upload of
  // the same image doesn't 409.
  const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex").slice(0, 16);
  const fileName = `${user.id}/${contentHash}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(fileName, fileBuffer, {
      contentType: file.type,
      upsert: true,
    });

  if (error) return apiError("upload", error);
  if (!data) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);

  return NextResponse.json({
    path: data.path,
    url: urlData.publicUrl,
  });
}
