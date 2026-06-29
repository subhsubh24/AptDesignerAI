#!/usr/bin/env node
/**
 * validate-capabilities — the loop's self-validation gate.
 *
 * Enforces validation/CAPABILITIES.yml as the single source of truth for what it takes to
 * VALIDATE every capability of the app. Fails CLOSED so the factory can never accumulate
 * work it cannot actually validate.
 *
 * Checks (in order):
 *   1. MANIFEST SHAPE — every capability has the required fields and a known `validation`.
 *   2. ENV DRIFT (global) — every `process.env.*` the app reads on a runtime path is declared
 *      in the manifest (as a capability `env` OR in non_credential_allowlist). A new undeclared
 *      key = a new service/credential the loop must declare + classify -> FAIL.
 *   3. UNMET CAPABILITY — a capability with `ci_validatable: false` needs an owner-only secret
 *      to validate. Behaviour:
 *        - default (per-PR) mode: SCOPED — fails only if CHANGED_FILES touch that capability;
 *          always prints an URGENT OWNER block so PENDING_OPS can surface it.
 *        - --readiness mode (preflight / ship gate): ANY unmet capability fails (global).
 *
 * Usage:
 *   node scripts/validate-capabilities.mjs                # per-PR (scoped); reads CHANGED_FILES env
 *   node scripts/validate-capabilities.mjs --readiness    # ship-gate (any unmet capability fails)
 *
 * NEVER reads or prints a secret VALUE — only env var NAMES.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "validation", "CAPABILITIES.yml");
const READINESS = process.argv.includes("--readiness");

// Runtime app code whose env reads MUST be declared (NOT tests/scripts/e2e — those use
// CI-only envs that are not app capabilities).
const SCAN_DIRS = ["app", "lib", "components"];
const SCAN_FILES = ["middleware.ts", "instrumentation.ts"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const CREDENTIAL_RE = /(_API_KEY|_SECRET|_SECRET_KEY|_TOKEN|_PASSWORD|_WEBHOOK_SECRET|_PROJECT_ID)$|^STRIPE_PRICE_ID_|_SITE_KEY$/;
const VALIDATIONS = new Set(["local", "sandbox", "mock", "dummy", "none"]);

const errors = [];
const warnings = [];

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith("__tests__")) continue;
      walk(p, out);
    } else if (CODE_EXT.has(path.extname(e.name)) && !/\.(test|spec)\.[tj]sx?$/.test(e.name)) {
      out.push(p);
    }
  }
}

function envReadsIn(content) {
  const keys = new Set();
  const re = /process\.env\.([A-Z0-9_]+)/g;
  let m;
  while ((m = re.exec(content))) keys.add(m[1]);
  return keys;
}

// --- load manifest ---
if (!fs.existsSync(MANIFEST)) {
  console.error(`FATAL: ${path.relative(ROOT, MANIFEST)} is missing. The capability manifest is required.`);
  process.exit(2);
}
let manifest;
try {
  manifest = yaml.load(fs.readFileSync(MANIFEST, "utf8"));
} catch (e) {
  console.error(`FATAL: could not parse CAPABILITIES.yml: ${e.message}`);
  process.exit(2);
}

const caps = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
const allowlist = new Set(manifest?.non_credential_allowlist ?? []);

// 1. MANIFEST SHAPE
const declaredEnv = new Set();
const envToCap = new Map(); // env key -> capability id
for (const c of caps) {
  if (!c.id) errors.push(`manifest: a capability is missing 'id'`);
  if (!Array.isArray(c.env) || c.env.length === 0) errors.push(`manifest: capability '${c.id}' has no 'env'`);
  if (!VALIDATIONS.has(c.validation)) errors.push(`manifest: capability '${c.id}' has invalid validation '${c.validation}' (allowed: ${[...VALIDATIONS].join("|")})`);
  if (typeof c.ci_validatable !== "boolean") errors.push(`manifest: capability '${c.id}' must set ci_validatable: true|false`);
  if (c.validation === "none" && c.ci_validatable !== false) errors.push(`manifest: capability '${c.id}' validation=none must be ci_validatable: false`);
  for (const k of c.env ?? []) {
    if (declaredEnv.has(k)) errors.push(`manifest: env '${k}' declared by more than one capability`);
    declaredEnv.add(k);
    envToCap.set(k, c.id);
  }
}
for (const k of allowlist) {
  if (declaredEnv.has(k)) errors.push(`manifest: '${k}' is both a capability env and in non_credential_allowlist`);
}

// 2. ENV DRIFT (global)
const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
for (const f of SCAN_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) files.push(p);
}
const used = new Map(); // env key -> [files]
for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  for (const k of envReadsIn(content)) {
    if (!used.has(k)) used.set(k, []);
    used.get(k).push(path.relative(ROOT, f));
  }
}
const undeclared = [];
for (const [k, where] of used) {
  if (declaredEnv.has(k) || allowlist.has(k)) continue;
  undeclared.push({ key: k, where, credential: CREDENTIAL_RE.test(k) });
}
if (undeclared.length) {
  errors.push(
    `ENV DRIFT — ${undeclared.length} env var(s) read by app code are NOT declared in CAPABILITIES.yml:\n` +
      undeclared
        .map(
          (u) =>
            `    - ${u.key}  (${u.where[0]}${u.where.length > 1 ? ` +${u.where.length - 1} more` : ""})\n` +
            `        -> ${u.credential
              ? "looks like a SERVICE CREDENTIAL: add a `capabilities:` entry stating how CI validates the flow that uses it."
              : "looks like a tuning knob: add it to `non_credential_allowlist`."}`,
        )
        .join("\n"),
  );
}

// dead-capability warning (declared env no longer read anywhere) — non-fatal
for (const [k, capId] of envToCap) {
  if (!used.has(k)) warnings.push(`capability '${capId}' declares ${k} but no app code reads it (dead? prune the manifest).`);
}

// 3. UNMET CAPABILITY (ci_validatable: false)
const unmet = caps.filter((c) => c.ci_validatable === false);
const changedRaw = (process.env.CHANGED_FILES || "").trim();
const changedFiles = changedRaw ? changedRaw.split(/\s+/).filter(Boolean) : null;

const ownerBlock = [];
for (const c of unmet) {
  ownerBlock.push({ id: c.id, env: c.env, summary: c.summary || "" });
  if (READINESS) {
    errors.push(`UNMET CAPABILITY '${c.id}' (ci_validatable: false) blocks the readiness/ship gate. Provide ${c.env.join(", ")} or wire a CI substitute (sandbox/local/mock).`);
    continue;
  }
  // scoped: does this PR touch the capability?
  if (changedFiles) {
    const touched = changedFiles.filter((cf) => {
      const abs = path.join(ROOT, cf);
      if (!fs.existsSync(abs)) return false;
      let txt;
      try {
        txt = fs.readFileSync(abs, "utf8");
      } catch {
        return false;
      }
      return c.env.some((k) => txt.includes(k));
    });
    if (touched.length) {
      errors.push(
        `UNMET CAPABILITY '${c.id}' is touched by this PR but cannot be validated in CI ` +
          `(needs owner secret: ${c.env.join(", ")}). This PR is BLOCKED until the capability is ` +
          `CI-validatable (wire a sandbox/local/mock) or the owner provides the key.\n    touched: ${touched.join(", ")}`,
      );
    }
  }
}

// --- report ---
if (ownerBlock.length) {
  console.log("UNMET_VALIDATION_CAPABILITIES (surface as URGENT OWNER_ACTIONS):");
  console.log(
    yaml.dump(
      { unmet_validation_capabilities: ownerBlock },
      { lineWidth: 120 },
    ),
  );
}
for (const w of warnings) console.warn(`warning: ${w}`);

if (errors.length) {
  console.error(`\nvalidate-capabilities: FAIL (${errors.length})\n`);
  for (const e of errors) console.error(` - ${e}`);
  console.error("\nSee validation/CAPABILITIES.yml for the contract.");
  process.exit(1);
}

console.log(
  `validate-capabilities: OK — ${caps.length} capabilities, ${declaredEnv.size} declared env keys, ` +
    `${used.size} read by app code, ${unmet.length} unmet${READINESS ? " (readiness mode)" : ""}.`,
);
