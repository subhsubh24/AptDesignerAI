// Social publishing queue — durable, server-side (E7.3).
//
// The Growth Agent enqueues drafts (through the internal API); the deployed app
// flushes due rows through lib/social providers. All access is via the
// service-role admin client against social_post_queue (migration 023), which is
// admin-only (RLS enabled, no policy). Functions here never throw on a provider
// failure — a failed post is recorded as `failed` and the flush continues.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSocialPlatform,
  PLATFORM_MAX_BODY,
  publishPost,
  type SocialPlatform,
} from "./index";

const TABLE = "social_post_queue";

export interface EnqueueInput {
  platform: SocialPlatform;
  body: string;
  mediaUrls?: string[];
  /** Optional earliest send time (ISO string). Omit to send on the next flush. */
  scheduledFor?: string;
  /** Optional idempotency key so the same draft isn't queued twice. */
  dedupeKey?: string;
}

export type EnqueueResult =
  | { ok: true; id: string; duplicate?: boolean }
  | { ok: false; error: string };

/** Validate + insert a draft. Honors the dedupe_key unique index (idempotent). */
export async function enqueuePost(
  admin: SupabaseClient,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  if (!isSocialPlatform(input.platform)) return { ok: false, error: "Unknown platform" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, error: "Empty post body" };
  // Validate the LENGTH OF WHAT WE ACTUALLY STORE (the trimmed body inserted
  // below) — not the raw input. Checking input.body.length let a post padded
  // with leading/trailing whitespace slip past the platform cap.
  if (body.length > PLATFORM_MAX_BODY[input.platform]) {
    return { ok: false, error: `Body exceeds ${PLATFORM_MAX_BODY[input.platform]} characters` };
  }
  const mediaUrls = input.mediaUrls ?? [];
  if (!Array.isArray(mediaUrls) || mediaUrls.some((u) => typeof u !== "string" || !u.trim())) {
    return { ok: false, error: "Invalid media URLs" };
  }

  const { data, error } = await admin
    .from(TABLE)
    .insert({
      platform: input.platform,
      body,
      media_urls: mediaUrls,
      scheduled_for: input.scheduledFor ?? null,
      dedupe_key: input.dedupeKey ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = the dedupe_key already exists. Treat as a successful no-op so the
    // agent can safely re-run without creating duplicates.
    if ((error as { code?: string }).code === "23505") {
      const { data: existing } = await admin
        .from(TABLE)
        .select("id")
        .eq("dedupe_key", input.dedupeKey ?? "")
        .maybeSingle();
      if (existing?.id) return { ok: true, id: existing.id as string, duplicate: true };
    }
    return { ok: false, error: "Could not enqueue post" };
  }
  if (!data?.id) return { ok: false, error: "Could not enqueue post" };
  return { ok: true, id: data.id as string };
}

export interface QueueStatus {
  pending: number;
  publishing: number;
  published: number;
  failed: number;
  skipped: number;
}

/** Count rows by status for GROWTH_STATUS / dashboards. */
export async function getQueueStatus(admin: SupabaseClient): Promise<QueueStatus> {
  const statuses: (keyof QueueStatus)[] = [
    "pending",
    "publishing",
    "published",
    "failed",
    "skipped",
  ];
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await admin
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw error;
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as unknown as QueueStatus;
}

export interface FlushSummary {
  claimed: number;
  published: number;
  dryRun: number;
  failed: number;
}

interface DueRow {
  id: string;
  platform: string;
  body: string;
  media_urls: unknown;
}

/**
 * Flush due posts: claim each pending row whose schedule has arrived, publish it
 * through its provider (dry-run until the channel is connected), and record the
 * outcome. Claiming uses a status-guarded UPDATE so two concurrent flushes can't
 * publish the same row twice.
 */
export async function flushDueQueue(
  admin: SupabaseClient,
  opts: { limit?: number; now?: Date } = {},
): Promise<FlushSummary> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const nowIso = (opts.now ?? new Date()).toISOString();

  // Due = pending AND (no schedule OR schedule already passed). Oldest first.
  const { data, error } = await admin
    .from(TABLE)
    .select("id, platform, body, media_urls")
    .eq("status", "pending")
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as DueRow[];
  const summary: FlushSummary = { claimed: 0, published: 0, dryRun: 0, failed: 0 };

  for (const row of rows) {
    // Claim: only the flush that flips pending -> publishing owns the row.
    const { data: claimed } = await admin
      .from(TABLE)
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed || claimed.length === 0) continue; // already taken by another flush
    summary.claimed++;

    if (!isSocialPlatform(row.platform)) {
      await admin
        .from(TABLE)
        .update({ status: "failed", error: "Unknown platform", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.failed++;
      continue;
    }

    const mediaUrls = Array.isArray(row.media_urls)
      ? (row.media_urls.filter((u) => typeof u === "string") as string[])
      : [];
    const result = await publishPost({ platform: row.platform, body: row.body, mediaUrls });

    if (result.published || result.dryRun) {
      await admin
        .from(TABLE)
        .update({
          status: "published",
          dry_run: result.dryRun,
          provider_post_id: result.id ?? null,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (result.dryRun) summary.dryRun++;
      else summary.published++;
    } else {
      await admin
        .from(TABLE)
        .update({
          status: "failed",
          error: result.error ?? "Publish failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      summary.failed++;
    }
  }

  return summary;
}
