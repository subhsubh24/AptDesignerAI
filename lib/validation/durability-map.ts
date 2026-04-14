// Material ↔ lifestyle durability lookup.
// Keyed by material (and category fallbacks) → structured durability vector.
// Used to give the LLM concrete numbers for "is this livable with pets/kids?"
// instead of re-deriving it every prompt.
//
// NOTE: Intentionally a static TS lookup. If the user eventually wants this
// backed by a CMS-editable table, promote the map to a DB — the scoring
// function below already depends only on the `DurabilityVector` interface.

export interface DurabilityVector {
  /** 0-1: claws/shedding resistance. 1 = bombproof (leather, performance fabric). 0 = a cat will destroy it (boucle, linen). */
  pet_friendly: number;
  /** 0-1: juice-proof, crayon-proof, no sharp edges. 1 = laminated + rounded. 0 = white silk with hard corners. */
  kid_friendly: number;
  /** 0-1: holds up to daily foot traffic / repeated use. 1 = hard surface or wool. 0 = delicate natural fiber. */
  high_traffic: number;
  /** 0-1: spills wipe off. 1 = sealed stone, performance fabric, vinyl. 0 = raw wood, suede. */
  easy_clean: number;
  /** 0-1: survives bathrooms, kitchens, humid apartments. */
  moisture_resist: number;
  /** 0-1: resists UV fading on sunny walls. */
  fade_resist: number;
}

const NEUTRAL: DurabilityVector = {
  pet_friendly: 0.5, kid_friendly: 0.5, high_traffic: 0.5,
  easy_clean: 0.5, moisture_resist: 0.5, fade_resist: 0.5,
};

// Keyed by canonical material name (same keys as lookups.ts MATERIAL_PROPERTIES where possible).
// Values hand-tuned from common interior-design durability references.
const MATERIAL_DURABILITY: Record<string, DurabilityVector> = {
  // ── Textiles ────────────────────────────────────────────────
  "linen":               { pet_friendly: 0.30, kid_friendly: 0.35, high_traffic: 0.40, easy_clean: 0.30, moisture_resist: 0.25, fade_resist: 0.50 },
  "cotton":              { pet_friendly: 0.40, kid_friendly: 0.45, high_traffic: 0.45, easy_clean: 0.55, moisture_resist: 0.30, fade_resist: 0.55 },
  "velvet":              { pet_friendly: 0.25, kid_friendly: 0.30, high_traffic: 0.40, easy_clean: 0.30, moisture_resist: 0.30, fade_resist: 0.45 },
  "silk":                { pet_friendly: 0.10, kid_friendly: 0.10, high_traffic: 0.15, easy_clean: 0.10, moisture_resist: 0.10, fade_resist: 0.25 },
  "wool":                { pet_friendly: 0.55, kid_friendly: 0.55, high_traffic: 0.80, easy_clean: 0.55, moisture_resist: 0.40, fade_resist: 0.75 },
  "cashmere":            { pet_friendly: 0.20, kid_friendly: 0.20, high_traffic: 0.25, easy_clean: 0.20, moisture_resist: 0.20, fade_resist: 0.45 },
  "jute":                { pet_friendly: 0.45, kid_friendly: 0.50, high_traffic: 0.55, easy_clean: 0.30, moisture_resist: 0.20, fade_resist: 0.65 },
  "sisal":               { pet_friendly: 0.40, kid_friendly: 0.45, high_traffic: 0.70, easy_clean: 0.30, moisture_resist: 0.25, fade_resist: 0.70 },
  "boucle":              { pet_friendly: 0.15, kid_friendly: 0.25, high_traffic: 0.35, easy_clean: 0.25, moisture_resist: 0.25, fade_resist: 0.50 },
  "chenille":            { pet_friendly: 0.35, kid_friendly: 0.40, high_traffic: 0.45, easy_clean: 0.35, moisture_resist: 0.30, fade_resist: 0.55 },
  "tweed":               { pet_friendly: 0.60, kid_friendly: 0.55, high_traffic: 0.65, easy_clean: 0.50, moisture_resist: 0.45, fade_resist: 0.70 },
  "performance fabric":  { pet_friendly: 0.90, kid_friendly: 0.90, high_traffic: 0.85, easy_clean: 0.95, moisture_resist: 0.85, fade_resist: 0.85 },
  "leather":             { pet_friendly: 0.75, kid_friendly: 0.70, high_traffic: 0.80, easy_clean: 0.85, moisture_resist: 0.70, fade_resist: 0.65 },
  "full grain leather":  { pet_friendly: 0.70, kid_friendly: 0.65, high_traffic: 0.85, easy_clean: 0.80, moisture_resist: 0.65, fade_resist: 0.70 },
  "faux leather":        { pet_friendly: 0.75, kid_friendly: 0.75, high_traffic: 0.65, easy_clean: 0.90, moisture_resist: 0.85, fade_resist: 0.70 },
  "suede":               { pet_friendly: 0.15, kid_friendly: 0.15, high_traffic: 0.30, easy_clean: 0.15, moisture_resist: 0.15, fade_resist: 0.40 },

  // ── Woods ──────────────────────────────────────────────────
  "walnut":              { pet_friendly: 0.70, kid_friendly: 0.60, high_traffic: 0.80, easy_clean: 0.65, moisture_resist: 0.50, fade_resist: 0.75 },
  "oak":                 { pet_friendly: 0.75, kid_friendly: 0.65, high_traffic: 0.85, easy_clean: 0.65, moisture_resist: 0.55, fade_resist: 0.80 },
  "white oak":           { pet_friendly: 0.75, kid_friendly: 0.65, high_traffic: 0.85, easy_clean: 0.65, moisture_resist: 0.55, fade_resist: 0.80 },
  "maple":               { pet_friendly: 0.80, kid_friendly: 0.70, high_traffic: 0.85, easy_clean: 0.70, moisture_resist: 0.55, fade_resist: 0.75 },
  "cherry":              { pet_friendly: 0.65, kid_friendly: 0.60, high_traffic: 0.75, easy_clean: 0.60, moisture_resist: 0.45, fade_resist: 0.60 },
  "teak":                { pet_friendly: 0.75, kid_friendly: 0.65, high_traffic: 0.85, easy_clean: 0.70, moisture_resist: 0.80, fade_resist: 0.80 },
  "pine":                { pet_friendly: 0.50, kid_friendly: 0.45, high_traffic: 0.55, easy_clean: 0.55, moisture_resist: 0.40, fade_resist: 0.60 },
  "bamboo":              { pet_friendly: 0.70, kid_friendly: 0.65, high_traffic: 0.75, easy_clean: 0.70, moisture_resist: 0.65, fade_resist: 0.70 },
  "mahogany":            { pet_friendly: 0.70, kid_friendly: 0.60, high_traffic: 0.80, easy_clean: 0.65, moisture_resist: 0.55, fade_resist: 0.65 },
  "reclaimed wood":      { pet_friendly: 0.60, kid_friendly: 0.50, high_traffic: 0.70, easy_clean: 0.45, moisture_resist: 0.40, fade_resist: 0.70 },
  "plywood":             { pet_friendly: 0.55, kid_friendly: 0.55, high_traffic: 0.60, easy_clean: 0.55, moisture_resist: 0.40, fade_resist: 0.60 },
  "mdf":                 { pet_friendly: 0.40, kid_friendly: 0.45, high_traffic: 0.45, easy_clean: 0.55, moisture_resist: 0.25, fade_resist: 0.55 },

  // ── Stone / hard surfaces ──────────────────────────────────
  "marble":              { pet_friendly: 0.80, kid_friendly: 0.45, high_traffic: 0.90, easy_clean: 0.50, moisture_resist: 0.70, fade_resist: 0.85 },
  "granite":             { pet_friendly: 0.90, kid_friendly: 0.70, high_traffic: 0.95, easy_clean: 0.85, moisture_resist: 0.85, fade_resist: 0.90 },
  "quartz":              { pet_friendly: 0.95, kid_friendly: 0.85, high_traffic: 0.95, easy_clean: 0.95, moisture_resist: 0.95, fade_resist: 0.95 },
  "travertine":          { pet_friendly: 0.80, kid_friendly: 0.55, high_traffic: 0.80, easy_clean: 0.50, moisture_resist: 0.65, fade_resist: 0.85 },
  "concrete":            { pet_friendly: 0.85, kid_friendly: 0.55, high_traffic: 0.90, easy_clean: 0.70, moisture_resist: 0.70, fade_resist: 0.80 },
  "terrazzo":            { pet_friendly: 0.90, kid_friendly: 0.70, high_traffic: 0.90, easy_clean: 0.85, moisture_resist: 0.80, fade_resist: 0.90 },
  "porcelain":           { pet_friendly: 0.95, kid_friendly: 0.75, high_traffic: 0.95, easy_clean: 0.95, moisture_resist: 0.95, fade_resist: 0.95 },
  "ceramic":             { pet_friendly: 0.90, kid_friendly: 0.70, high_traffic: 0.90, easy_clean: 0.90, moisture_resist: 0.90, fade_resist: 0.90 },
  "glass":               { pet_friendly: 0.60, kid_friendly: 0.25, high_traffic: 0.55, easy_clean: 0.90, moisture_resist: 0.95, fade_resist: 0.95 },
  "frosted glass":       { pet_friendly: 0.60, kid_friendly: 0.30, high_traffic: 0.55, easy_clean: 0.80, moisture_resist: 0.95, fade_resist: 0.95 },
  "lacquer":             { pet_friendly: 0.55, kid_friendly: 0.55, high_traffic: 0.65, easy_clean: 0.80, moisture_resist: 0.75, fade_resist: 0.70 },
  "resin":               { pet_friendly: 0.75, kid_friendly: 0.65, high_traffic: 0.75, easy_clean: 0.85, moisture_resist: 0.85, fade_resist: 0.70 },

  // ── Metals ────────────────────────────────────────────────
  "brass":               { pet_friendly: 0.80, kid_friendly: 0.55, high_traffic: 0.80, easy_clean: 0.70, moisture_resist: 0.65, fade_resist: 0.80 },
  "brushed brass":       { pet_friendly: 0.85, kid_friendly: 0.60, high_traffic: 0.85, easy_clean: 0.75, moisture_resist: 0.70, fade_resist: 0.80 },
  "chrome":              { pet_friendly: 0.85, kid_friendly: 0.60, high_traffic: 0.85, easy_clean: 0.90, moisture_resist: 0.85, fade_resist: 0.90 },
  "nickel":              { pet_friendly: 0.85, kid_friendly: 0.60, high_traffic: 0.85, easy_clean: 0.85, moisture_resist: 0.80, fade_resist: 0.85 },
  "brushed nickel":      { pet_friendly: 0.85, kid_friendly: 0.60, high_traffic: 0.85, easy_clean: 0.85, moisture_resist: 0.80, fade_resist: 0.85 },
  "iron":                { pet_friendly: 0.85, kid_friendly: 0.45, high_traffic: 0.90, easy_clean: 0.65, moisture_resist: 0.50, fade_resist: 0.70 },
  "wrought iron":        { pet_friendly: 0.80, kid_friendly: 0.40, high_traffic: 0.90, easy_clean: 0.60, moisture_resist: 0.50, fade_resist: 0.70 },
  "steel":               { pet_friendly: 0.85, kid_friendly: 0.55, high_traffic: 0.90, easy_clean: 0.85, moisture_resist: 0.80, fade_resist: 0.85 },
  "stainless steel":     { pet_friendly: 0.90, kid_friendly: 0.65, high_traffic: 0.95, easy_clean: 0.95, moisture_resist: 0.95, fade_resist: 0.90 },
  "copper":              { pet_friendly: 0.80, kid_friendly: 0.55, high_traffic: 0.80, easy_clean: 0.70, moisture_resist: 0.65, fade_resist: 0.75 },
  "bronze":              { pet_friendly: 0.80, kid_friendly: 0.55, high_traffic: 0.80, easy_clean: 0.70, moisture_resist: 0.70, fade_resist: 0.80 },

  // ── Woven / natural ───────────────────────────────────────
  "rattan":              { pet_friendly: 0.30, kid_friendly: 0.45, high_traffic: 0.55, easy_clean: 0.45, moisture_resist: 0.35, fade_resist: 0.60 },
  "wicker":              { pet_friendly: 0.25, kid_friendly: 0.40, high_traffic: 0.50, easy_clean: 0.40, moisture_resist: 0.35, fade_resist: 0.55 },
  "cane":                { pet_friendly: 0.25, kid_friendly: 0.40, high_traffic: 0.50, easy_clean: 0.45, moisture_resist: 0.35, fade_resist: 0.55 },
};

// Category-level fallback: if we can't resolve a material, use the category.
// Useful when products have rich category metadata but sparse materials arrays.
const CATEGORY_DURABILITY: Record<string, DurabilityVector> = {
  area_rug:              { pet_friendly: 0.55, kid_friendly: 0.55, high_traffic: 0.65, easy_clean: 0.45, moisture_resist: 0.35, fade_resist: 0.60 },
  rug:                   { pet_friendly: 0.55, kid_friendly: 0.55, high_traffic: 0.65, easy_clean: 0.45, moisture_resist: 0.35, fade_resist: 0.60 },
  coffee_table:          { pet_friendly: 0.70, kid_friendly: 0.55, high_traffic: 0.75, easy_clean: 0.70, moisture_resist: 0.55, fade_resist: 0.70 },
  dining_table:          { pet_friendly: 0.75, kid_friendly: 0.65, high_traffic: 0.85, easy_clean: 0.75, moisture_resist: 0.60, fade_resist: 0.75 },
  sofa:                  { pet_friendly: 0.45, kid_friendly: 0.50, high_traffic: 0.60, easy_clean: 0.50, moisture_resist: 0.45, fade_resist: 0.60 },
  accent_chair:          { pet_friendly: 0.45, kid_friendly: 0.50, high_traffic: 0.60, easy_clean: 0.50, moisture_resist: 0.45, fade_resist: 0.60 },
  dining_chair:          { pet_friendly: 0.65, kid_friendly: 0.65, high_traffic: 0.75, easy_clean: 0.65, moisture_resist: 0.55, fade_resist: 0.70 },
  bed:                   { pet_friendly: 0.55, kid_friendly: 0.55, high_traffic: 0.70, easy_clean: 0.55, moisture_resist: 0.50, fade_resist: 0.65 },
  nightstand:            { pet_friendly: 0.70, kid_friendly: 0.55, high_traffic: 0.75, easy_clean: 0.70, moisture_resist: 0.55, fade_resist: 0.70 },
  dresser:               { pet_friendly: 0.70, kid_friendly: 0.55, high_traffic: 0.75, easy_clean: 0.70, moisture_resist: 0.55, fade_resist: 0.70 },
  curtains:              { pet_friendly: 0.50, kid_friendly: 0.55, high_traffic: 0.60, easy_clean: 0.55, moisture_resist: 0.40, fade_resist: 0.45 },
  wall_art:              { pet_friendly: 0.80, kid_friendly: 0.55, high_traffic: 0.90, easy_clean: 0.70, moisture_resist: 0.55, fade_resist: 0.55 },
};

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Look up a durability vector for a single material string. Fuzzy match. */
export function lookupDurability(material: string): DurabilityVector | null {
  const key = normalize(material).replace(/^(solid|natural|organic|recycled|sustainable|genuine|real|faux|artificial|synthetic)\s+/, "");
  if (MATERIAL_DURABILITY[key]) return MATERIAL_DURABILITY[key];
  if (MATERIAL_DURABILITY[normalize(material)]) return MATERIAL_DURABILITY[normalize(material)];
  // Substring
  for (const [k, v] of Object.entries(MATERIAL_DURABILITY)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

export function lookupCategoryDurability(category: string): DurabilityVector | null {
  const key = normalize(category).replace(/[\s-]+/g, "_");
  if (CATEGORY_DURABILITY[key]) return CATEGORY_DURABILITY[key];
  for (const [k, v] of Object.entries(CATEGORY_DURABILITY)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

/** Weighted-mean over multiple materials — the "worst link" also pulls the score down. */
export function aggregateDurability(
  materials: string[],
  categoryFallback?: string,
): DurabilityVector {
  const vectors: DurabilityVector[] = [];
  for (const m of materials) {
    const v = lookupDurability(m);
    if (v) vectors.push(v);
  }
  if (vectors.length === 0) {
    const cat = categoryFallback ? lookupCategoryDurability(categoryFallback) : null;
    return cat ?? { ...NEUTRAL };
  }

  const axes: (keyof DurabilityVector)[] = [
    "pet_friendly", "kid_friendly", "high_traffic",
    "easy_clean", "moisture_resist", "fade_resist",
  ];
  const out = { ...NEUTRAL };
  for (const axis of axes) {
    const values = vectors.map((v) => v[axis]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    // Blend 70% mean + 30% min so a single bad material drags the score
    out[axis] = mean * 0.7 + min * 0.3;
  }
  return out;
}

// ─── Lifestyle parsing ──────────────────────────────────────────────────
// Derive boolean lifestyle flags from the DynamicDesignProfile.lifestyle shape.
// Extracted here so fit-scorer / bundle-optimizer / harmony-math can share it.

export interface LifestyleFlags {
  has_pets: boolean;
  has_kids: boolean;
  entertains: boolean;
  high_traffic: boolean; // derived: pets OR kids OR entertains OR WFH = daily wear
  works_from_home: boolean;
}

const NEGATIVE_PATTERNS = /^(no|none|n\/a|not applicable|false|never|0)$/i;

export function resolveLifestyleFlags(
  lifestyle?: {
    pets?: string;
    kids?: string;
    hosting?: string;
    work_from_home?: boolean;
    notes?: string;
  },
): LifestyleFlags {
  if (!lifestyle) {
    return { has_pets: false, has_kids: false, entertains: false, high_traffic: false, works_from_home: false };
  }
  const has_pets = !!lifestyle.pets && !NEGATIVE_PATTERNS.test(lifestyle.pets.trim());
  const has_kids = !!lifestyle.kids && !NEGATIVE_PATTERNS.test(lifestyle.kids.trim());
  const entertains = !!lifestyle.hosting && !NEGATIVE_PATTERNS.test(lifestyle.hosting.trim());
  const wfh = !!lifestyle.work_from_home;
  // Scan notes for durability-relevant signals too
  const notesLower = (lifestyle.notes || "").toLowerCase();
  const noteSignalsHighTraffic =
    /\b(muddy|shed|shedding|claw|scratch|spill|messy|active|busy)\b/.test(notesLower);
  return {
    has_pets,
    has_kids,
    entertains,
    works_from_home: wfh,
    high_traffic: has_pets || has_kids || entertains || wfh || noteSignalsHighTraffic,
  };
}

// ─── Scoring: product vs lifestyle ──────────────────────────────────────

export interface LifestyleFitResult {
  /** 0-1 overall fit. Weighted by which lifestyle flags are set. */
  score: number;
  /** Per-axis sub-scores for transparency in prompts. */
  axes: DurabilityVector;
  /** Flagged concerns — e.g., "white linen sofa + shedding pets". */
  issues: string[];
}

export function scoreLifestyleFit(
  product: { category?: string; materials?: string[]; colors?: string[] },
  lifestyle: LifestyleFlags,
): LifestyleFitResult {
  const materials = product.materials ?? [];
  const v = aggregateDurability(materials, product.category);
  const issues: string[] = [];

  // Build weight vector — only axes that matter for this lifestyle.
  const weights: Record<keyof DurabilityVector, number> = {
    pet_friendly: lifestyle.has_pets ? 1 : 0,
    kid_friendly: lifestyle.has_kids ? 1 : 0,
    high_traffic: lifestyle.high_traffic ? 0.8 : 0,
    easy_clean: (lifestyle.has_pets || lifestyle.has_kids) ? 0.8 : 0.3,
    moisture_resist: 0.2, // baseline — useful for bathrooms anyway
    fade_resist: 0.2,
  };
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  let score = 0;
  (Object.keys(weights) as Array<keyof DurabilityVector>).forEach((axis) => {
    score += weights[axis] * v[axis];
  });
  score /= weightSum;

  // Flag "big red" issues where axis score is very low on an axis that matters.
  const LOW = 0.35;
  const hints: string[] = [];
  if (lifestyle.has_pets && v.pet_friendly < LOW) {
    hints.push(
      `Low pet-friendliness (${v.pet_friendly.toFixed(2)}) — ${(materials[0] || product.category || "this piece")} is prone to claws/shedding damage`,
    );
  }
  if (lifestyle.has_kids && v.kid_friendly < LOW) {
    hints.push(
      `Low kid-friendliness (${v.kid_friendly.toFixed(2)}) — hard to clean stains or easy to damage`,
    );
  }
  if (lifestyle.high_traffic && v.high_traffic < LOW) {
    hints.push(
      `Low traffic durability (${v.high_traffic.toFixed(2)}) — not built for daily wear`,
    );
  }
  if ((lifestyle.has_pets || lifestyle.has_kids) && v.easy_clean < LOW) {
    hints.push(
      `Hard to clean (${v.easy_clean.toFixed(2)}) — spills/accidents will leave marks`,
    );
  }
  // Light-colored soft materials + pets is a common footgun
  const colorsLower = (product.colors ?? []).map((c) => c.toLowerCase()).join(" ");
  const lightShade = /\b(white|ivory|cream|linen white|off-white|pale|blush|dove|alabaster)\b/.test(colorsLower);
  const softMat = materials.some((m) => /\b(linen|velvet|boucle|silk|cashmere|suede|cotton)\b/i.test(m));
  if (lifestyle.has_pets && lightShade && softMat) {
    hints.push(
      `Light-colored ${materials[0] || "soft"} fabric + pets — high risk of visible wear and staining`,
    );
  }
  issues.push(...hints);

  return {
    score: round2(Math.max(0, Math.min(1, score))),
    axes: {
      pet_friendly: round2(v.pet_friendly),
      kid_friendly: round2(v.kid_friendly),
      high_traffic: round2(v.high_traffic),
      easy_clean: round2(v.easy_clean),
      moisture_resist: round2(v.moisture_resist),
      fade_resist: round2(v.fade_resist),
    },
    issues,
  };
}

export function formatLifestyleFitForPrompt(result: LifestyleFitResult): string {
  const lines: string[] = [];
  lines.push(`### Lifestyle Durability: ${result.score.toFixed(2)}/1.0`);
  lines.push(
    `- pet=${result.axes.pet_friendly.toFixed(2)} kid=${result.axes.kid_friendly.toFixed(2)} traffic=${result.axes.high_traffic.toFixed(2)} clean=${result.axes.easy_clean.toFixed(2)}`,
  );
  for (const issue of result.issues) lines.push(`- ISSUE: ${issue}`);
  return lines.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
