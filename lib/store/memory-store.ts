/**
 * In-memory data store that replaces Supabase.
 * Implements a Supabase-compatible query builder API so existing
 * API routes work without modification.
 *
 * Data persists only for the lifetime of the server process.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

// ─── Data Store ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const tables: Record<string, Row[]> = {
  projects: [],
  rooms: [],
  room_images: [],
  room_diagnoses: [],
  agent_runs: [],
  agent_steps: [],
  candidate_products: [],
  product_evaluations: [],
  product_bundles: [],
  product_bundle_items: [],
  bundle_evaluations: [],
  mockup_jobs: [],
  search_sessions: [],
};

// Fake user for auth bypass
const MOCK_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "user@aptdesigner.local",
  user_metadata: { full_name: "Designer" },
};

// ─── Query Builder ───────────────────────────────────────────────

class QueryBuilder {
  private table: string;
  private filters: Array<{ column: string; op: string; value: unknown }> = [];
  private selectColumns: string | null = null;
  private insertData: Row | Row[] | null = null;
  private updateData: Row | null = null;
  private deleteMode = false;
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitCount: number | null = null;
  private singleMode = false;
  private maybeSingleMode = false;
  private returnSelect = false;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = "*") {
    this.selectColumns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ column, op: "neq", value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, op: "in", value: values });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderCol = column;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleMode = true;
    return this.execute();
  }

  maybeSingle() {
    this.maybeSingleMode = true;
    return this.execute();
  }

  insert(data: Row | Row[]) {
    this.insertData = data;
    return {
      select: () => this._returnSelectAfterInsert(),
      // Support bare .insert() without .select() — still need to persist data
      then: (resolve: (value: { data: any; error: any }) => void) => {
        resolve(this._doInsert(false));
      },
    };
  }

  private _returnSelectAfterInsert() {
    this.returnSelect = true;
    // Support both .insert().select().single() AND bare .insert().select()
    const result = {
      single: () => this._doInsert(true),
      maybeSingle: () => this._doInsert(true),
      then: (resolve: (value: { data: any; error: any }) => void) => {
        resolve(this._doInsert(false));
      },
    };
    return result;
  }

  private _doInsert(asSingle: boolean): { data: any; error: any } {
    const rows = Array.isArray(this.insertData) ? this.insertData : [this.insertData!];
    const inserted: Row[] = [];

    for (const row of rows) {
      const newRow: Row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      };
      if (!tables[this.table]) tables[this.table] = [];
      tables[this.table].push(newRow);
      inserted.push(newRow);
    }

    return {
      data: asSingle ? inserted[0] : inserted,
      error: null,
    };
  }

  update(data: Row) {
    this.updateData = data;
    return this;
  }

  delete() {
    this.deleteMode = true;
    return this;
  }

  // Execute the query chain
  execute(): { data: any; error: any } {
    if (!tables[this.table]) tables[this.table] = [];

    // Handle insert without .select()
    if (this.insertData) {
      return this._doInsert(this.singleMode || this.maybeSingleMode);
    }

    // Handle update
    if (this.updateData) {
      const rows = this.getFilteredRows();
      for (const row of rows) {
        Object.assign(row, this.updateData);
      }
      return { data: rows.length > 0 ? rows[0] : null, error: null };
    }

    // Handle delete
    if (this.deleteMode) {
      const toDelete = new Set(this.getFilteredRows());
      tables[this.table] = tables[this.table].filter((r) => !toDelete.has(r));
      return { data: null, error: null };
    }

    // Handle select
    let rows = this.getFilteredRows();

    // Resolve relations from select columns (e.g. "*, room_images(*)")
    if (this.selectColumns && this.selectColumns !== "*") {
      rows = rows.map((row) => this.resolveRelations(row));
    }

    // Order
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows.sort((a, b) => {
        const va = a[col] as string || "";
        const vb = b[col] as string || "";
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }

    // Limit
    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    // Single
    if (this.singleMode) {
      return { data: rows[0] || null, error: rows[0] ? null : null };
    }
    if (this.maybeSingleMode) {
      return { data: rows[0] || null, error: null };
    }

    return { data: rows, error: null };
  }

  private getFilteredRows(): Row[] {
    return (tables[this.table] || []).filter((row) => {
      return this.filters.every(({ column, op, value }) => {
        if (op === "eq") return row[column] === value;
        if (op === "neq") return row[column] !== value;
        if (op === "in") return (value as unknown[]).includes(row[column]);
        return true;
      });
    });
  }

  private resolveRelations(row: Row): Row {
    const result = { ...row };
    const selectStr = this.selectColumns || "";

    // Parse relation patterns like "room_images(*)" or "room_diagnoses(*)"
    const relationPattern = /(\w+)\(\*\)/g;
    let match;
    while ((match = relationPattern.exec(selectStr)) !== null) {
      const relTable = match[1];
      if (tables[relTable]) {
        // Find FK column: try room_id, project_id, bundle_id, product_id
        const fkCandidates = [
          { fk: "room_id", pk: "id" },
          { fk: "project_id", pk: "id" },
          { fk: "bundle_id", pk: "id" },
          { fk: "product_id", pk: "id" },
        ];
        for (const { fk, pk } of fkCandidates) {
          if (tables[relTable].some((r) => r[fk] !== undefined)) {
            result[relTable] = tables[relTable].filter((r) => r[fk] === row[pk]);
            break;
          }
        }
        if (!result[relTable]) {
          result[relTable] = [];
        }
      }
    }

    // Handle nested relations like "product_bundle_items(*, candidate_products(*))"
    const nestedPattern = /(\w+)\(\*,\s*(\w+)\(\*\)\)/g;
    while ((match = nestedPattern.exec(selectStr)) !== null) {
      const relTable = match[1];
      const nestedTable = match[2];
      if (result[relTable] && Array.isArray(result[relTable])) {
        result[relTable] = (result[relTable] as Row[]).map((item) => {
          const nested = (tables[nestedTable] || []).find(
            (r) => r.id === item[`${nestedTable.replace(/s$/, "")}_id`] || r.id === item.product_id
          );
          return { ...item, [nestedTable]: nested || null };
        });
      }
    }

    return result;
  }

  // Allow .then() for promise-like behavior
  then(resolve: (value: { data: any; error: any }) => void) {
    resolve(this.execute());
  }
}

// ─── Storage ─────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

class StorageBucket {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async upload(
    filePath: string,
    data: Buffer | Blob,
    opts?: { contentType?: string; upsert?: boolean }
  ): Promise<{ data: { path: string } | null; error: { message: string } | null }> {
    try {
      const dir = path.join(UPLOAD_DIR, this.bucket, path.dirname(filePath));
      fs.mkdirSync(dir, { recursive: true });

      const fullPath = path.join(UPLOAD_DIR, this.bucket, filePath);
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(await (data as Blob).arrayBuffer());
      fs.writeFileSync(fullPath, buffer);

      return { data: { path: filePath }, error: null };
    } catch (err) {
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : "Upload failed" },
      };
    }
  }

  getPublicUrl(filePath: string): { data: { publicUrl: string } } {
    return {
      data: { publicUrl: `/uploads/${this.bucket}/${filePath}` },
    };
  }
}

class StorageClient {
  from(bucket: string) {
    return new StorageBucket(bucket);
  }
}

// ─── Mock Supabase Client ────────────────────────────────────────

export function createMemoryClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: MOCK_USER }, error: null }),
      signInWithPassword: async () => ({
        data: { user: MOCK_USER, session: { access_token: "mock" } },
        error: null,
      }),
      signUp: async () => ({
        data: { user: MOCK_USER, session: { access_token: "mock" } },
        error: null,
      }),
      signOut: async () => ({ error: null }),
      exchangeCodeForSession: async () => ({
        data: { user: MOCK_USER, session: { access_token: "mock" } },
        error: null,
      }),
    },
    from: (table: string) => new QueryBuilder(table),
    storage: new StorageClient(),
    rpc: (fn: string, params: Record<string, unknown>) => {
      console.warn(`[memory-store] RPC call to "${fn}" ignored`, params);
      return { data: null, error: null, single: () => ({ data: null, error: null }) };
    },
  };
}

export type MemoryClient = ReturnType<typeof createMemoryClient>;
