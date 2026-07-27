import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  MOCKUP_BUCKET,
  MOCKUP_PREFIX,
  StoragePurgeError,
  UPLOAD_ROUTE_BUCKETS,
  USER_UPLOAD_BUCKETS,
  purgeUserStorage,
  storagePathFromPublicUrl,
} from "@/lib/storage/user-storage";

/**
 * Apple 5.1.1(v) and Google Play's deletion policy require an account delete to
 * take the associated data with it. Deleting the auth user cascades through
 * Postgres but NOT through Storage, and both buckets are public — so without an
 * explicit purge a deleted user's room photos stay fetchable forever. These
 * tests pin the purge itself; the route-level tests below pin that a failed
 * purge never reports a successful deletion.
 */

type StorageStub = {
  list: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

/**
 * Minimal Supabase double. `objects` maps bucket -> object paths; `rows` maps
 * table -> rows. Records every remove() call so tests can assert exact paths.
 */
function fakeAdmin(opts: {
  objects?: Record<string, string[]>;
  rows?: Record<string, Array<Record<string, unknown>>>;
  listError?: { message: string };
  removeError?: { message: string };
  tableError?: { table: string; message: string };
}) {
  const objects = opts.objects ?? {};
  const rows = opts.rows ?? {};
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const listCalls: Array<{ bucket: string; prefix: string; offset: number }> = [];

  const storage: Record<string, StorageStub> = {};

  function bucketStub(bucket: string): StorageStub {
    if (storage[bucket]) return storage[bucket];
    storage[bucket] = {
      list: vi.fn(async (prefix: string, { limit, offset }: { limit: number; offset: number }) => {
        listCalls.push({ bucket, prefix, offset });
        if (opts.listError) return { data: null, error: opts.listError };
        // Supabase returns folder entries with a null id alongside real
        // objects; a path ending in "/" models one here.
        const all = (objects[bucket] ?? [])
          .filter((p) => p.startsWith(`${prefix}/`))
          .map((p) => ({
            id: p.endsWith("/") ? null : p,
            name: p.slice(prefix.length + 1),
          }));
        return { data: all.slice(offset, offset + limit), error: null };
      }),
      remove: vi.fn(async (paths: string[]) => {
        if (opts.removeError) return { data: null, error: opts.removeError };
        removed.push({ bucket, paths });
        return { data: paths.map((p) => ({ name: p })), error: null };
      }),
    };
    return storage[bucket];
  }

  // Chainable PostgREST-ish builder: .select().eq()/.in() resolves to the rows.
  function from(table: string) {
    const result = opts.tableError?.table === table
      ? { data: null, error: { message: opts.tableError.message } }
      : { data: rows[table] ?? [], error: null };
    const builder = {
      select: () => builder,
      eq: () => Promise.resolve(result),
      in: () => Promise.resolve(result),
    };
    return builder;
  }

  return {
    admin: { storage: { from: bucketStub }, from } as never,
    removed,
    listCalls,
  };
}

describe("storagePathFromPublicUrl", () => {
  it("extracts the object path from a real Supabase public URL", () => {
    expect(
      storagePathFromPublicUrl(
        "https://abc.supabase.co/storage/v1/object/public/room-images/u1/deadbeef.png",
        "room-images",
      ),
    ).toBe("u1/deadbeef.png");
  });

  it("extracts the object path from the memory-backend /uploads form", () => {
    expect(storagePathFromPublicUrl("/uploads/room-images/mockups/abc.png", "room-images")).toBe(
      "mockups/abc.png",
    );
  });

  it("ignores a query string rather than folding it into the path", () => {
    expect(
      storagePathFromPublicUrl(
        "https://abc.supabase.co/storage/v1/object/public/room-images/u1/a.png?token=xyz",
        "room-images",
      ),
    ).toBe("u1/a.png");
  });

  it("returns null for a different bucket, a data URI, and a foreign host", () => {
    expect(
      storagePathFromPublicUrl(
        "https://abc.supabase.co/storage/v1/object/public/other-bucket/u1/a.png",
        "room-images",
      ),
    ).toBeNull();
    expect(storagePathFromPublicUrl("data:image/png;base64,AAAA", "room-images")).toBeNull();
    expect(storagePathFromPublicUrl("https://cdn.example.com/a.png", "room-images")).toBeNull();
    expect(storagePathFromPublicUrl("", "room-images")).toBeNull();
  });

  it("rejects traversal, including percent-encoded traversal", () => {
    expect(
      storagePathFromPublicUrl("/uploads/room-images/../../etc/passwd", "room-images"),
    ).toBeNull();
    expect(
      storagePathFromPublicUrl("/uploads/room-images/%2e%2e/other/a.png", "room-images"),
    ).toBeNull();
  });
});

describe("purgeUserStorage", () => {
  it("removes every object under the user's prefix in each upload bucket", async () => {
    const { admin, removed } = fakeAdmin({
      objects: { "room-images": ["u1/a.png", "u1/b.png", "u2/other.png"] },
    });

    const { removed: count } = await purgeUserStorage(admin, "u1");

    expect(count).toBe(2);
    const roomImages = removed.find((r) => r.bucket === "room-images");
    expect(roomImages?.paths.sort()).toEqual(["u1/a.png", "u1/b.png"]);
    // Another tenant's object is never listed, let alone removed.
    expect(removed.flatMap((r) => r.paths)).not.toContain("u2/other.png");
  });

  it("sweeps every bucket the upload route accepts", async () => {
    const { admin, listCalls } = fakeAdmin({});
    await purgeUserStorage(admin, "u1");
    expect(listCalls.map((c) => c.bucket).sort()).toEqual([...USER_UPLOAD_BUCKETS].sort());
    // Anything the upload route will write to must be swept.
    for (const bucket of UPLOAD_ROUTE_BUCKETS) {
      expect(USER_UPLOAD_BUCKETS as readonly string[]).toContain(bucket);
    }
  });

  it("sweeps the bucket the NATIVE app uploads to, read from the mobile source", async () => {
    // The native app bypasses /api/upload and PUTs straight to Supabase
    // Storage, so the upload route's allow-list does not cover it. Derived from
    // the mobile source rather than hardcoded: renaming the bucket there fails
    // here instead of silently leaving every native photo unpurged.
    const mobileSource = fs.readFileSync(
      path.join(process.cwd(), "mobile/src/app/results.tsx"),
      "utf8",
    );
    const buckets = [...mobileSource.matchAll(/storage\/v1\/object\/(?:public\/)?([\w-]+)\//g)].map(
      (m) => m[1],
    );
    expect(buckets.length, "expected mobile results.tsx to upload to Supabase Storage").toBeGreaterThan(0);

    for (const bucket of new Set(buckets)) {
      expect(
        USER_UPLOAD_BUCKETS as readonly string[],
        `mobile uploads to "${bucket}" but the purge does not sweep it`,
      ).toContain(bucket);
    }
  });

  it("pages past the first list() page, and folder entries never desync the offset", async () => {
    // A folder entry (null id) is skipped as an object but still consumes a slot
    // in the page, so the offset must advance by the RAW page length or the
    // second page re-reads rows — or, worse, the loop never terminates.
    const many = Array.from({ length: 1200 }, (_, i) => `u1/f${i}.png`);
    many.splice(500, 0, "u1/subfolder/");
    const { admin, removed, listCalls } = fakeAdmin({ objects: { "room-images": many } });

    const { removed: count } = await purgeUserStorage(admin, "u1");

    // 1201 entries listed, 1200 of them real objects.
    expect(count).toBe(1200);
    expect(listCalls.filter((c) => c.bucket === "room-images").map((c) => c.offset)).toEqual([
      0, 1000,
    ]);
    expect(removed.filter((r) => r.bucket === "room-images").flatMap((r) => r.paths)).toHaveLength(
      1200,
    );
  });

  it("removes generated mockups, which carry no user prefix in their key", async () => {
    const { admin, removed } = fakeAdmin({
      rows: {
        projects: [{ id: "p1" }],
        rooms: [{ id: "r1" }],
        mockup_jobs: [
          { result_image_url: `/uploads/${MOCKUP_BUCKET}/${MOCKUP_PREFIX}job1.png` },
          { result_image_url: null },
        ],
      },
    });

    await purgeUserStorage(admin, "u1");

    expect(
      removed.filter((r) => r.bucket === MOCKUP_BUCKET).flatMap((r) => r.paths),
    ).toEqual([`${MOCKUP_PREFIX}job1.png`]);
  });

  it("never reads a CLIENT-SETTABLE url column, so one tenant cannot delete another's mockup", async () => {
    // `mockups/` keys carry no owner, so isPurgeablePath must admit the whole
    // namespace — which makes whatever feeds it a delete instruction. Both
    // saved_designs.thumbnail_url (app/api/mobile/saved-designs POST body) and
    // projects.cover_image_url (projects PATCH allow-list) are client-settable.
    // If either were read, a user could point their own row at ANOTHER tenant's
    // mockup and delete it by deleting their own account.
    const victim = `/uploads/${MOCKUP_BUCKET}/${MOCKUP_PREFIX}victims-design.png`;
    const { admin, removed } = fakeAdmin({
      rows: {
        saved_designs: [{ thumbnail_url: victim }],
        projects: [{ id: "p1", cover_image_url: victim }],
        rooms: [{ id: "r1" }],
        mockup_jobs: [],
      },
    });

    await purgeUserStorage(admin, "u1");

    expect(removed.flatMap((r) => r.paths)).not.toContain(`${MOCKUP_PREFIX}victims-design.png`);
    expect(removed).toHaveLength(0);
  });

  it("refuses a referenced path outside the user's own prefix", async () => {
    const { admin, removed } = fakeAdmin({
      rows: {
        projects: [{ id: "p1" }],
        rooms: [{ id: "r1" }],
        mockup_jobs: [{ result_image_url: `/uploads/${MOCKUP_BUCKET}/victim-user/private.png` }],
      },
    });

    await purgeUserStorage(admin, "u1");

    expect(removed.flatMap((r) => r.paths)).not.toContain("victim-user/private.png");
    expect(removed).toHaveLength(0);
  });

  it("throws when listing fails, so the caller cannot report a deletion it did not perform", async () => {
    const { admin } = fakeAdmin({ listError: { message: "network down" } });
    await expect(purgeUserStorage(admin, "u1")).rejects.toBeInstanceOf(StoragePurgeError);
  });

  it("throws when removal fails", async () => {
    const { admin } = fakeAdmin({
      objects: { "room-images": ["u1/a.png"] },
      removeError: { message: "permission denied" },
    });
    await expect(purgeUserStorage(admin, "u1")).rejects.toBeInstanceOf(StoragePurgeError);
  });

  it("throws when a row read fails rather than silently skipping mockups", async () => {
    const { admin } = fakeAdmin({
      tableError: { table: "projects", message: "relation missing" },
    });
    await expect(purgeUserStorage(admin, "u1")).rejects.toBeInstanceOf(StoragePurgeError);
  });

  it("treats a bucket that was never created as a no-op, not a failure", async () => {
    const { admin } = fakeAdmin({ listError: { message: "Bucket not found" } });
    await expect(purgeUserStorage(admin, "u1")).resolves.toEqual({ removed: 0 });
  });

  it("refuses an empty user id rather than sweeping a bare prefix", async () => {
    const { admin } = fakeAdmin({});
    await expect(purgeUserStorage(admin, "")).rejects.toBeInstanceOf(StoragePurgeError);
  });
});
