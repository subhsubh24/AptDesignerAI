/**
 * Deterministic applier for AnalysisPatch.
 *
 * The refine-patcher LLM produces a patch describing only what changes;
 * this module walks the patch and produces a new analysis object with
 * those changes applied. Pure function — never calls the network.
 *
 * Edits made here are STRUCTURAL ONLY (set field, add/remove array entry,
 * update item by category). Any LLM-driven validation or warnings happen
 * elsewhere in the pipeline.
 */

import type { AnalysisPatch, WhatItNeedsItem } from "@/lib/types/database";

type AnalysisRecord = Record<string, unknown>;

function slug(s: string): string {
  return String(s || "").toLowerCase().replace(/[\s-]+/g, "_").trim();
}

export interface ApplyPatchResult {
  analysis: AnalysisRecord;
  /** Field paths that actually changed (for selective UI re-render). */
  changedFields: string[];
}

/**
 * Apply a patch to a previous analysis. Returns a new object — does NOT
 * mutate the input. Unknown fields in the patch are ignored (forward-compat).
 */
export function applyAnalysisPatch(
  prior: AnalysisRecord,
  patch: AnalysisPatch,
): ApplyPatchResult {
  const next: AnalysisRecord = { ...prior };
  const changed = new Set<string>();

  // ── Scalar overwrites ────────────────────────────────────────────
  for (const key of [
    "summary",
    "design_direction",
    "style_name",
    "spatial_layout",
    "lighting_conditions",
  ] as const) {
    const value = patch[key];
    if (typeof value === "string" && value.length > 0) {
      next[key] = value;
      changed.add(key);
    }
  }

  // ── Array overwrites ─────────────────────────────────────────────
  for (const key of [
    "recommended_palette",
    "recommended_materials",
    "recommended_textures",
  ] as const) {
    const value = patch[key];
    if (Array.isArray(value)) {
      next[key] = value.filter((s) => typeof s === "string" && s.length > 0);
      changed.add(key);
    }
  }

  // ── String-list diffs (what_works, what_should_go) ───────────────
  for (const key of ["what_works", "what_should_go"] as const) {
    const diff = patch[key];
    if (!diff) continue;
    const current = Array.isArray(next[key]) ? [...(next[key] as string[])] : [];
    let touched = false;

    if (Array.isArray(diff.remove) && diff.remove.length > 0) {
      const removeSet = new Set(diff.remove.map((s) => s.toLowerCase().trim()));
      const filtered = current.filter((entry) => {
        // Match by exact lowercased text OR by leading head-noun token.
        const head = entry.split(/\s[—–-]\s|:\s/)[0].toLowerCase().trim();
        return !removeSet.has(entry.toLowerCase().trim()) && !removeSet.has(head);
      });
      if (filtered.length !== current.length) {
        current.length = 0;
        current.push(...filtered);
        touched = true;
      }
    }

    if (Array.isArray(diff.add) && diff.add.length > 0) {
      for (const entry of diff.add) {
        if (typeof entry !== "string" || entry.length === 0) continue;
        // Dedup against existing entries (case-insensitive head match)
        const head = entry.split(/\s[—–-]\s|:\s/)[0].toLowerCase().trim();
        const dup = current.some((e) => {
          const h = e.split(/\s[—–-]\s|:\s/)[0].toLowerCase().trim();
          return h === head;
        });
        if (!dup) {
          current.push(entry);
          touched = true;
        }
      }
    }

    if (touched) {
      next[key] = current;
      changed.add(key);
    }
  }

  // ── what_it_needs operations ─────────────────────────────────────
  if (patch.what_it_needs) {
    const items: WhatItNeedsItem[] = Array.isArray(next.what_it_needs)
      ? [...(next.what_it_needs as WhatItNeedsItem[])]
      : [];
    let touched = false;

    if (Array.isArray(patch.what_it_needs.remove)) {
      const removeSlugs = new Set(patch.what_it_needs.remove.map(slug));
      const before = items.length;
      const filtered = items.filter((it) => !removeSlugs.has(slug(it.category)));
      if (filtered.length !== before) {
        items.length = 0;
        items.push(...filtered);
        touched = true;
      }
    }

    if (Array.isArray(patch.what_it_needs.update)) {
      for (const upd of patch.what_it_needs.update) {
        if (!upd?.category) continue;
        const targetSlug = slug(upd.category);
        const idx = items.findIndex((it) => slug(it.category) === targetSlug);
        if (idx === -1) continue;
        items[idx] = { ...items[idx], ...upd.changes };
        touched = true;
        changed.add(`what_it_needs.${targetSlug}`);
      }
    }

    if (Array.isArray(patch.what_it_needs.add)) {
      for (const newItem of patch.what_it_needs.add) {
        if (!newItem?.category) continue;
        const newSlug = slug(newItem.category);
        // If already present, treat add as update to avoid duplicate categories.
        const idx = items.findIndex((it) => slug(it.category) === newSlug);
        if (idx >= 0) {
          items[idx] = { ...items[idx], ...newItem };
        } else {
          items.push(newItem);
        }
        touched = true;
        changed.add(`what_it_needs.${newSlug}`);
      }
    }

    if (touched) {
      next.what_it_needs = items;
      changed.add("what_it_needs");
    }
  }

  return { analysis: next, changedFields: Array.from(changed) };
}
