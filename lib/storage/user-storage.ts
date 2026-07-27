/**
 * Deleting a user's stored objects.
 *
 * Deleting the auth user cascades through every Postgres table, but Supabase
 * Storage is NOT part of that cascade — and `room-images`, which holds both the
 * web app's uploads and every generated mockup, is created `public` with an
 * "Anyone can view" policy (supabase/migrations/001_initial_schema.sql:408,417).
 * So without an explicit purge a deleted user's room photos and generated
 * mockups stay publicly fetchable forever at a
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
 * The referenced sweep is the dangerous half. `isPurgeablePath` has to admit the
 * whole `mockups/` namespace — those keys carry no owner — so whatever feeds it
 * is effectively a delete instruction. It therefore reads exactly ONE column,
 * `mockup_jobs.result_image_url`, which is written only by the generation
 * pipeline (app/api/mockups/route.ts:628,825) and never accepted from a request
 * body.
 *
 * Two other columns hold image URLs and are deliberately NOT read here:
 * `saved_designs.thumbnail_url` comes straight from the client
 * (app/api/mobile/saved-designs/route.ts:107,171 — validated only for https and
 * our Supabase host, which is public), and `projects.cover_image_url` is a
 * client-settable PATCH field (app/api/projects/[projectId]/route.ts:47-56).
 * Reading either would let a user persist a URL pointing at ANOTHER tenant's
 * `mockups/<hash>` object and then delete it by deleting their own account —
 * a cross-tenant delete. There is a test for exactly that.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Buckets `app/api/upload` accepts. The upload route imports this constant, so
 * a bucket cannot be accepted for upload without also being swept below.
 *
 * `floor-plans` used to be on this allow-list and is gone: no migration ever
 * creates that bucket (supabase/migrations/001_initial_schema.sql:408-410 makes
 * room-images, product-images and mockups, and nothing adds a fourth), and both
 * upload zones — including components/projects/floor-plan-upload-zone.tsx:83 —
 * post `bucket=room-images`. Accepting it only meant a request naming it wrote
 * to a bucket that does not exist instead of falling back to room-images.
 */
export const UPLOAD_ROUTE_BUCKETS = ["room-images"] as const;

/**
 * Every bucket holding objects keyed `${userId}/…`, and therefore every bucket
 * the purge must sweep. A superset of the upload route's list, because the
 * native app does NOT go through `/api/upload`: mobile/src/app/results.tsx:95,106
 * PUTs straight to Supabase Storage, into a bucket named `room-photos`, with the
 * same `${userId}/` prefix. Sweeping only the web route's buckets would leave
 * every photo taken in the native app — the platform whose store guidelines
 * require the deletion in the first place — publicly fetchable after the account
 * was deleted. A test derives that bucket name from the mobile source so a
 * rename there fails here instead of silently un-purging it.
 */
export const USER_UPLOAD_BUCKETS = ["room-images", "room-photos"] as const;

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
 * Reads ONE column — `mockup_jobs.result_image_url` — reached by walking
 * projects → rooms → mockup_jobs, all bound to `userId`. See the module header
 * for why the other two image-URL columns are excluded: both are client-settable,
 * and feeding a client-settable value into a delete over the shared `mockups/`
 * namespace is a cross-tenant delete.
 */
async function referencedMockupPaths(admin: SupabaseClient, userId: string): Promise<string[]> {
  const urls: string[] = [];

  const collect = (rows: Array<Record<string, unknown>> | null, column: string) => {
    for (const row of rows ?? []) {
      const value = row[column];
      if (typeof value === "string") urls.push(value);
    }
  };

  const projects = await admin.from("projects").select("id").eq("user_id", userId);
  if (projects.error) throw new StoragePurgeError(`read projects: ${projects.error.message}`);

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
