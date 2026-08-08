#!/usr/bin/env node
// scripts/check-security-invariants.mjs
//
// Standalone, CI-runnable gate for the two mechanical security invariants that
// protect every public Supabase table and every client bundle:
//
//   1. RLS coverage — every CREATE TABLE in supabase/migrations/*.sql must also
//      ENABLE ROW LEVEL SECURITY (directly, or via the shared dynamic do-block
//      convention used for admin-only shared tables — see migration 016).
//      Supabase exposes the ENTIRE public schema to the anon key via PostgREST,
//      so RLS is the only boundary; a created-but-unguarded public table is a
//      live tenant-data leak.
//   2. Client-secret leak — no NEXT_PUBLIC_*/EXPO_PUBLIC_* env name may contain
//      SECRET/SERVICE_ROLE/PRIVATE. Both prefixes get inlined into the shipped
//      client bundle at build time (the mobile case is worse: it's baked into
//      the shipped app BINARY and is unrevocable once released).
//
// Previously this logic lived only inline inside scripts/preflight.sh GATE 6,
// so it ran once — at ship-declaration time, long after a bad migration could
// already be merged and auto-applied to prod. Extracting it here lets a CI job
// run the SAME script pre-merge (see APT-1); preflight.sh calls this file too,
// so the two can never drift apart.
//
// USAGE:   node scripts/check-security-invariants.mjs
// EXIT:    0 — both invariants hold.
//          1 — at least one is violated (details printed to stdout).

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function checkRlsCoverage() {
  const migrationsDir = join(REPO_ROOT, "supabase/migrations");
  let files;
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return { ok: true, detail: "OK — no supabase/migrations directory found (nothing to check)" };
  }

  const created = new Map(); // table name -> migration filename that created it
  const rls = new Set();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8").toLowerCase();

    for (const m of sql.matchAll(
      /create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)/g
    )) {
      if (!created.has(m[1])) created.set(m[1], file);
    }
    for (const m of sql.matchAll(
      /alter table (?:public\.)?([a-z_][a-z0-9_]*)\s+enable row level security/g
    )) {
      rls.add(m[1]);
    }

    // Shared/internal tables enable RLS via a dynamic loop (migration 016 convention):
    //   do $$ ... array['tbl_a','tbl_b'] ... execute format('alter table
    //   public.%I enable row level security', t) ... $$;
    // Harvest table names ONLY from an array[...] literal INSIDE a do-block that
    // actually enables RLS — never from anywhere else in the file. A stray quoted
    // literal elsewhere (a default value, an enum comparison) must not be able to
    // mask a genuinely unguarded table. A tagged `do $tag$ ... $tag$` block or a
    // bare-literal `execute format(..., 'tbl')` is missed here — but that fails
    // SAFE (the table stays flagged uncovered), it never masks a real leak.
    for (const block of sql.matchAll(/do\s+\$\$(.*?)\$\$/gs)) {
      const body = block[1];
      if (!body.includes("enable row level security")) continue;
      for (const arr of body.matchAll(/array\s*\[(.*?)\]/gs)) {
        for (const t of arr[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)) {
          rls.add(t[1]);
        }
      }
    }
  }

  const missing = [...created.keys()].filter((t) => !rls.has(t)).sort();
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `RLS_MISSING: ${missing.map((t) => `${t} (${created.get(t)})`).join(", ")}`,
    };
  }
  return {
    ok: true,
    detail: `OK — ${created.size} public tables, all ENABLE ROW LEVEL SECURITY`,
  };
}

// Legitimate public values (NEXT_PUBLIC_SUPABASE_ANON_KEY, *_SITE_KEY, *_URL) are
// fine — only SECRET / SERVICE_ROLE / PRIVATE names are ever meant to stay
// server-side. Shells out to `grep` (present on every CI runner and this repo's
// dev containers) rather than reimplementing a recursive file walk, to keep this
// check byte-identical to what GATE 6 has run for months.
function grepLeak(prefix, dirs, extensions) {
  const pattern = `${prefix}_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE)`;
  const includeArgs = extensions.flatMap((ext) => ["--include", ext]);
  try {
    const out = execFileSync(
      "grep",
      ["-rniE", pattern, ...includeArgs, ...dirs],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    return out.trim();
  } catch (err) {
    // grep exits 1 (no match, not an error) or 2 (a listed dir/file is absent —
    // both are fine here, some dirs are optional across web/mobile checkouts).
    if (err.status === 1 || err.status === 2) return "";
    throw err;
  }
}

function main() {
  let ok = true;
  const lines = [];

  const rlsResult = checkRlsCoverage();
  if (rlsResult.ok) {
    lines.push(`PASS  RLS coverage — ${rlsResult.detail}`);
  } else {
    ok = false;
    lines.push(`FAIL  RLS coverage — ${rlsResult.detail}`);
    lines.push("      (every public table must ENABLE ROW LEVEL SECURITY in supabase/migrations)");
  }

  const webLeak = grepLeak(
    "NEXT_PUBLIC",
    ["app", "lib", "components", "mobile", "scripts", ".env.example"],
    ["*.ts", "*.tsx", "*.js", "*.mjs", "*.env*"]
  );
  if (!webLeak) {
    lines.push("PASS  Client-secret leak (web) — no secret exposed via a NEXT_PUBLIC_* env name");
  } else {
    ok = false;
    lines.push("FAIL  Client-secret leak (web) — a secret is exposed to the browser via a NEXT_PUBLIC_* name:");
    for (const l of webLeak.split("\n")) lines.push(`      ${l}`);
  }

  const mobileLeak = grepLeak(
    "EXPO_PUBLIC",
    ["mobile", ".env.example"],
    ["*.ts", "*.tsx", "*.js", "*.mjs", "*.json", "*.env*"]
  );
  if (!mobileLeak) {
    lines.push("PASS  Client-secret leak (mobile) — no secret exposed via an EXPO_PUBLIC_* env name");
  } else {
    ok = false;
    lines.push("FAIL  Client-secret leak (mobile) — a secret is baked into the app binary via an EXPO_PUBLIC_* name:");
    for (const l of mobileLeak.split("\n")) lines.push(`      ${l}`);
  }

  console.log(lines.join("\n"));
  process.exit(ok ? 0 : 1);
}

main();
