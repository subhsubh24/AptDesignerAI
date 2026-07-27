/**
 * Deleting a user's stored objects.
 *
 * Deleting the auth user cascades through every Postgres table, but Supabase
 * Storage is NOT part of that cascade — and both buckets this app writes to are
 * created `public` (supabase/migrations/001_initial_schema.sql:408-410) with an
 * "Anyone can view" policy. So without an explicit purge a deleted user's room
 * photos and generated mockups stay publicly fetchable forever at a
 * guessable-prefix URL, contradicting the promise the app makes on
 * app/privacy/page.tsx ("immediately and permanently removes all your content")
 * and failing Apple 5.1.1(v) / Google Play's deletion policy, both of which
 * require the account AND its associated data to go.
 *
 * Two classes of object belong to a user, and they are keyed differently:
 *
 *  1. DIRECT UPLOADS — `app/api/upload` writes `${userId}/${hash}.${ext}` into
 *     one of `USER_UPLOAD_BUCKETS`. These are found by listing the prefix, so
 *     they need no database read and are purged even if the row that referenced
 *     them is already gone.
 *  2. GENERATED MOCKUPS — `app/api/mockups` writes `mockups/${stem}.${ext}`
 *     into the room-images bucket. That key carries no user id, so the only way
 *     to attribute one is through the rows that reference it.
 *
 * The referenced sweep reads ONLY server-written URL columns and only removes a
 * path under `mockups/` or under the user's own prefix. Both restrictions are
 * load-bearing: without them a user could persist a URL pointing at another
 * tenant's object and have their own account deletion delete it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Buckets `app/api/upload` accepts, and therefore buckets a purge must sweep.
 * The upload route imports this same constant, so a bucket cannot be added to
 * one side without the other.
 */
export const USER_UPLOAD_BUCKETS = ["room-images", "floor-plans"] as const;

/** Bucket + key prefix that generated mockups are written to. */
export const MOCKUP_BUCKET = "room-images";
export const MOCKUP_PREFIX = "mockups/";

/** Supabase `list()` caps at 100 by default; ask for the max explicitly. */
const LIST_PAGE_SIZE = 1000;
/** `remove()` takes an array of paths — chunk it rather than sending thousands. */
const REMOVE_CHUNK_SIZE = 100;

export class StoragePurgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoragePurgeError";
  }
}

/**
 * Extract the object path from a Supabase public URL for `bucket`.
 *
 * Handles both shapes the app produces:
 *   - real Supabase:  https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
 *   - memory backend: /uploads/<bucket>/<path>   (see lib/utils/image-url.ts)
 *
 * Returns null for anything else — a data: URI, a third-party CDN URL, a URL
 * for a different bucket, or a traversal attempt.
 */
export function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  if (typeof url !== "string" || url.length === 0) return null;

  // Strip query/fragment before matching so a signed-URL suffix can't smuggle
  // characters into the path.
  const withoutQuery = url.split(/[?#]/)[0];

  const markers = [`/storage/v1/object/public/${bucket}/`, `/uploads/${bucket}/`];
  for (const marker of markers) {
    const at = withoutQuery.indexOf(marker);
    if (at === -1) continue;

    let path = withoutQuery.slice(at + marker.length);
    try {
      path = decodeURIComponent(path);
    } catch {
      return null; // malformed percent-encoding — not a path we wrote
    }
    if (path.length === 0) return null;
    // Reject traversal and absolute paths outright rather than normalising them.
    if (path.startsWith("/") || path.split("/").includes("..")) return null;
    return path;
  }

  return null;
}

/** True when `path` is an object this user is entitled to have deleted. */
function isPurgeablePath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`) || path.startsWith(MOCKUP_PREFIX);
}

/** A bucket that was never created is a no-op, not a failure. */
function isMissingBucket(error: { message?: string } | null): boolean {
  return /bucket not found/i.test(error?.message ?? "");
}

async function listUserPrefix(
  admin: SupabaseClient,
  bucket: string,
  userId: string,
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;

  // `list()` is paginated; keep going until a short page comes back.
  for (;;) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(userId, { limit: LIST_PAGE_SIZE, offset });

    if (error) {
      if (isMissingBucket(error)) return [];
      throw new StoragePurgeError(`list ${bucket}/${userId}: ${error.message}`);
    }

    const page = data ?? [];
    for (const entry of page) {
      // Directory placeholders come back with no id; only real objects here.
      if (entry.id === null || entry.id === undefined) continue;
      paths.push(`${userId}/${entry.name}`);
    }

    if (page.length < LIST_PAGE_SIZE) break;
    offset += page.length;
  }

  return paths;
}

async function removeAll(admin: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK_SIZE) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK_SIZE);
    const { error } = await admin.storage.from(bucket).remove(chunk);
    if (error) {
      if (isMissingBucket(error)) return;
      throw new StoragePurgeError(`remove from ${bucket}: ${error.message}`);
    }
  }
}

/**
 * Collect the generated-mockup object paths this user's rows reference.
 *
 * Only columns the SERVER writes are read (`thumbnail_url`, `cover_image_url`,
 * `result_image_url`) — never free-form client JSON — and the result is filtered
 * to paths the user owns, so this cannot be steered at another tenant's object.
 */
async function referencedMockupPaths(admin: SupabaseClient, userId: string): Promise<string[]> {
  const urls: string[] = [];

  const collect = (rows: Array<Record<string, unknown>> | null, column: string) => {
    for (const row of rows ?? []) {
      const value = row[column];
      if (typeof value === "string") urls.push(value);
    }
  };

  const saved = await admin.from("saved_designs").select("thumbnail_url").eq("user_id", userId);
  if (saved.error) throw new StoragePurgeError(`read saved_designs: ${saved.error.message}`);
  collect(saved.data, "thumbnail_url");

  const projects = await admin.from("projects").select("id, cover_image_url").eq("user_id", userId);
  if (projects.error) throw new StoragePurgeError(`read projects: ${projects.error.message}`);
  collect(projects.data, "cover_image_url");

  const projectIds = (projects.data ?? [])
    .map((p) => p.id)
    .filter((id): id is string => typeof id === "string");

  if (projectIds.length > 0) {
    const rooms = await admin.from("rooms").select("id").in("project_id", projectIds);
    if (rooms.error) throw new StoragePurgeError(`read rooms: ${rooms.error.message}`);

    const roomIds = (rooms.data ?? [])
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string");

    if (roomIds.length > 0) {
      const jobs = await admin
        .from("mockup_jobs")
        .select("result_image_url")
        .in("room_id", roomIds);
      if (jobs.error) throw new StoragePurgeError(`read mockup_jobs: ${jobs.error.message}`);
      collect(jobs.data, "result_image_url");
    }
  }

  const paths = new Set<string>();
  for (const url of urls) {
    const path = storagePathFromPublicUrl(url, MOCKUP_BUCKET);
    if (path && isPurgeablePath(path, userId)) paths.add(path);
  }
  return [...paths];
}

/**
 * Delete every stored object belonging to `userId`.
 *
 * Throws `StoragePurgeError` on any failure so the caller can refuse to report a
 * successful deletion it did not perform. Safe to retry: listing is re-done from
 * scratch and removing an already-removed object is a no-op.
 */
export async function purgeUserStorage(
  admin: SupabaseClient,
  userId: string,
): Promise<{ removed: number }> {
  if (!userId) throw new StoragePurgeError("purgeUserStorage called without a user id");

  let removed = 0;

  for (const bucket of USER_UPLOAD_BUCKETS) {
    const paths = await listUserPrefix(admin, bucket, userId);
    if (paths.length === 0) continue;
    await removeAll(admin, bucket, paths);
    removed += paths.length;
  }

  const mockupPaths = await referencedMockupPaths(admin, userId);
  if (mockupPaths.length > 0) {
    await removeAll(admin, MOCKUP_BUCKET, mockupPaths);
    removed += mockupPaths.length;
  }

  return { removed };
}
