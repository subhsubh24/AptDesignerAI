import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File;
  const ALLOWED_BUCKETS = new Set(["room-images", "floor-plans"]);
  const rawBucket = (formData.get("bucket") as string) || "room-images";
  const bucket = ALLOWED_BUCKETS.has(rawBucket) ? rawBucket : "room-images";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  const FLOOR_PLAN_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);
  const allowedTypes = bucket === "floor-plans" ? FLOOR_PLAN_TYPES : IMAGE_TYPES;
  if (!allowedTypes.has(file.type)) {
    const allowedLabel = bucket === "floor-plans" ? "JPEG, PNG, WebP, HEIC, or PDF" : "JPEG, PNG, WebP, or HEIC";
    return NextResponse.json({ error: `Only ${allowedLabel} files are allowed` }, { status: 400 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);

  return NextResponse.json({
    path: data.path,
    url: urlData.publicUrl,
  });
}
