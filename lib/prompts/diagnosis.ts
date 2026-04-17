import { parseUserContext, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";
import { formatExtractedFloorPlanForPrompt } from "@/lib/agents/format-floor-plan";
import type { ExtractedFloorPlan } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

interface DiagnosisContextParts {
  allKeepItems: string[];
  userNotes: string;
  keepItemsWarning: string;
  parsedSections: string;
  crossRoomSection: string;
}

/**
 * Render explicit building + apartment + floor-plan grounding into the
 * diagnosis prompt. The system prompt already carries this, but falls back
 * to generic defaults when profile data is sparse — foregrounding it here
 * ensures the diagnostician actually references the specific finishes and
 * dimensions when they are available.
 */
function buildDesignProfileSection(profile?: DynamicDesignProfile): string {
  if (!profile) return "";
  const lines: string[] = [];
  // DynamicDesignProfile is loosely typed — probe for the well-known fields.
  const p = profile as unknown as Record<string, unknown>;
  const building = p.building_research as Record<string, unknown> | undefined;
  const apartment = p.apartment_analysis as Record<string, unknown> | undefined;
  const floorPlan = p.floor_plan as Record<string, unknown> | undefined;
  const extractedFloorPlan = p.extractedFloorPlan as ExtractedFloorPlan | undefined;

  if (building) {
    const style = building.building_style || building.style;
    const finishes = building.finishes;
    const aesthetic = building.design_aesthetic;
    const pieces: string[] = [];
    if (style) pieces.push(`style: ${typeof style === "string" ? style : JSON.stringify(style)}`);
    if (finishes) pieces.push(`finishes: ${typeof finishes === "string" ? finishes : JSON.stringify(finishes)}`);
    if (aesthetic) pieces.push(`aesthetic: ${typeof aesthetic === "string" ? aesthetic : JSON.stringify(aesthetic)}`);
    if (pieces.length) lines.push(`Building — ${pieces.join("; ")}`);
  }

  if (apartment) {
    const overall = apartment.overall;
    if (typeof overall === "string" && overall) lines.push(`Apartment — ${overall}`);
  }

  // Prefer structured extracted floor plan over legacy floor_plan object
  if (extractedFloorPlan) {
    lines.push(`Floor plan (extracted — authoritative) — ${formatExtractedFloorPlanForPrompt(extractedFloorPlan)}`);
  } else if (floorPlan) {
    const sqft = floorPlan.total_sqft;
    const dims = floorPlan.room_dimensions;
    const layout = floorPlan.room_layout;
    const pieces: string[] = [];
    if (sqft) pieces.push(`sqft: ${sqft}`);
    if (dims) pieces.push(`room dimensions: ${typeof dims === "string" ? dims : JSON.stringify(dims)}`);
    if (layout) pieces.push(`layout: ${typeof layout === "string" ? layout : JSON.stringify(layout)}`);
    if (pieces.length) lines.push(`Floor plan — ${pieces.join("; ")}`);
  }

  if (!lines.length) return "";
  return `\n## BUILDING & APARTMENT GROUNDING (reference these specifically in your analysis)\n${lines.map((l) => `- ${l}`).join("\n")}\nYour design direction MUST reference these actual finishes/dimensions — do not default to generic assumptions.\n`;
}

function buildDiagnosisContextParts(
  keepItems: string[],
  userContext?: string,
  otherRoomsContext?: string,
): DiagnosisContextParts {
  const parsed = userContext ? parseUserContext(userContext) : null;
  const parsedSections = parsed ? formatParsedContextForPrompt(parsed) : "";

  const allKeepItems = [
    ...keepItems,
    ...(parsed?.additionalKeepItems || []),
  ];

  const userNotes = userContext
    ? `\n- User notes about this room: "${userContext}"\nIMPORTANT: Take these notes into account. If they mention something not visible in photos, incorporate that. If they say to ignore something, exclude it from your assessment. If they express a preference for keeping or liking something, RESPECT that — design around it.`
    : "";

  const keepItemsWarning = allKeepItems.length > 0
    ? `\n\n## ⚠️ ITEMS THE CLIENT WANTS TO KEEP — DO NOT SUGGEST REMOVING THESE
${allKeepItems.map((item) => `- ${item}`).join("\n")}
These items are NON-NEGOTIABLE. The client explicitly chose to keep them. Your job is to design AROUND these pieces and make them work within the design direction. Include them in "what_is_working" and explain how the design will complement them. NEVER put these in "what_is_not_working" or suggest they should be replaced. NEVER recommend a replacement item in the same category as a kept item (e.g., if they're keeping a floor lamp, do NOT recommend a new floor lamp).`
    : "";

  const crossRoomSection = otherRoomsContext
    ? `
## CROSS-ROOM COHERENCE
${otherRoomsContext}
IMPORTANT: Your design direction for this room should be compatible with the other rooms. The apartment should feel like one cohesive home — not identical rooms, but harmonious palettes, complementary materials, and a consistent aesthetic thread. If another room uses walnut and brass, this room should either echo those materials or use something that complements them (not clashes).
`
    : "";

  return { allKeepItems, userNotes, keepItemsWarning, parsedSections, crossRoomSection };
}

export function getDiagnosisPrompt(roomType: string, keepItems: string[], replaceItems: string[], priorities: string[], userContext?: string, otherRoomsContext?: string): string {
  const { allKeepItems, userNotes, keepItemsWarning, parsedSections } = buildDiagnosisContextParts(keepItems, userContext, otherRoomsContext);

  return `Analyze the room photos provided and produce a comprehensive room diagnosis.

## ROOM CONTEXT
- Room type: ${roomType}
- Items to keep: ${allKeepItems.length > 0 ? allKeepItems.join(", ") : "none specified"}
- Items to replace: ${replaceItems.length > 0 ? replaceItems.join(", ") : "none specified"}
- User priorities: ${priorities.length > 0 ? priorities.join(", ") : "not specified"}${userNotes}${keepItemsWarning}
${parsedSections ? `\n${parsedSections}\n` : ""}${otherRoomsContext ? `
## CROSS-ROOM COHERENCE
${otherRoomsContext}
IMPORTANT: Your design direction for this room should be compatible with the other rooms. The apartment should feel like one cohesive home — not identical rooms, but harmonious palettes, complementary materials, and a consistent aesthetic thread. If another room uses walnut and brass, this room should either echo those materials or use something that complements them (not clashes).
` : ""}
## STEP-BY-STEP ANALYSIS PROCESS — Follow this order exactly:

### Step 1: OBSERVE the room (spend the most time here)
Look at EVERY photo carefully. For each photo, note:
- Floor: What material? What color? (e.g., "medium-tone oak engineered hardwood" not just "wood floor")
- Walls: What color exactly? (e.g., "warm off-white, close to Benjamin Moore Swiss Coffee" not just "white")
- Windows: How many? What size? What direction might they face based on light? Any treatments (curtains/blinds)?
- Ceiling: Height estimate? Any features (molding, beams, recessed lights)?
- Every piece of furniture: Name it, describe its material, color, condition, and approximate size
- Lighting: What fixtures exist? Where are dark corners? How much natural light?
- Personal items and decor: Note culturally significant or personal items (statues, art, collections) — these may be important to the client

### Step 2: ASSESS what's working
For each item you're keeping or that works well, explain specifically WHY it works.

### Step 3: IDENTIFY what's NOT working
For each problem, be specific about WHAT and WHY.

### Step 4: DETERMINE what's MISSING
Think like a designer completing a room. Common things people forget:
- Layered lighting (floor lamp + table lamp + overhead)
- Textiles (throw pillows, blankets, curtains)
- Wall art/decor
- Area rug (properly sized!)
- Plants
- Side tables / surfaces near seating
- Storage solutions
- **Corner and dead zone solutions** — look for empty corners, awkward gaps behind furniture, unused wall stretches, or dead zones that need activation (a tall plant, corner shelf, accent chair, floor lamp, or decorative object)

### Step 5: THINK ABOUT LIFESTYLE
Before making any recommendations, consider:
- How does someone actually LIVE in this ${roomType}? What happens here daily?
- Do they host guests? How many people need to sit comfortably?
- Where do they set their coffee/drink? Where do they charge their phone?
- Is there enough seating for entertaining? Enough surface area for daily life?
- Are materials practical for the room's use (pets, kids, high-traffic)?
- Consider morning vs. evening use — lighting changes, ambience shifts.
${priorities.length > 0 ? `- The client specifically cares about: ${priorities.join(", ")}. Weight these heavily in your recommendations.` : ""}

### Step 6: DESIGN DIRECTION
Based on the existing finishes (floors, walls, fixed elements) AND how the client lives, recommend:
- Specific color palette (name 6-10 actual colors like "warm ivory", "walnut brown", "muted sage")
- Specific materials (name 5-8 like "solid walnut", "linen", "bouclé", "brushed brass")
- Style direction in 3-4 sentences that MUST:
  1. Reference the client's specific lifestyle, age, personality, and how they use the space (e.g., "a 30-year-old bachelor who hosts frequently" — not just "someone who entertains")
  2. Connect design choices to WHO the client is (e.g., "The aesthetic should feel effortlessly stylish — curated but not try-hard, reflecting someone with taste who doesn't need to prove it")
  3. Reference the building's finishes and architectural context
  4. Explain how the design serves their actual daily life, not just how it looks

## ARRAY SIZE REQUIREMENTS
- what_is_working: List **at least 5-8 items**. Every room has things working — find them all.
- what_is_not_working: List **at least 5-8 issues**. Be thorough — don't stop at the obvious.
- biggest_improvement_opportunities: List **5-7 changes** ranked by impact.
- missing_furniture_categories: List **ALL missing categories** — aim for 8-15 items. Walk through ALL THREE TIERS:
  - ESSENTIAL: anchor furniture (sofa, bed, dining table), primary rug, primary lighting, main surfaces
  - STANDARD: accent seating, secondary lighting, textiles (curtains, throw pillows, blankets), wall art, storage
  - FINISHING: plants, decorative objects, vases, trays, candles, books/display items
  Do NOT stop after listing the obvious large pieces. A well-furnished room has items from ALL three tiers.
- color_issues: List **3-5 observations**. Map the actual colors you see.
- texture_material_issues: List **3-5 observations**. Count distinct textures.
- scale_proportion_issues: List **3-5 observations**. Reference specific items.
- layout_issues: List **3-5 observations**. Note traffic paths, dead zones, awkward gaps.
- spatial_gaps: List **3-5 observations**. Identify empty corners, unused wall stretches, dead zones behind furniture, awkward gaps, and areas that feel barren or unfinished. For each, suggest what could fill it (e.g., "Empty corner behind sofa — a tall fiddle leaf fig or arc floor lamp would activate this dead zone and add vertical interest").
- lighting_issues: List **3-5 observations**. Note natural light direction and artificial gaps.
- clutter_editing_issues: List items to remove or edit. Can be 0 if room is clean.

## SPECIFICITY REQUIREMENT
Every item in every array MUST reference a specific visible object.

### EXAMPLE of a good diagnosis entry:
\`\`\`
"what_is_working": [
  "Wide-plank light oak hardwood floors — warm undertone that pairs well with natural materials, good condition, sets a warm-modern foundation",
  "Large south-facing window (~5ft wide) — excellent natural light, makes the space feel open, good opportunity for a reading nook nearby",
  "Charcoal gray linen sofa (approx 84\" wide) — appropriate scale for the room, neutral base that works with warm or cool accent palettes"
]
\`\`\`

### EXAMPLE of a bad diagnosis entry (DO NOT do this):
\`\`\`
"what_is_working": [
  "The sofa works",
  "Good natural light",
  "Nice floors"
]
\`\`\`

More examples:
- GOOD: "Small round glass coffee table is drastically undersized for the L-shaped sectional — should be at least 48 inches"
- BAD: "Coffee table is too small" (too vague — what material? what size should it be?)

## OUTPUT FORMAT
Return a JSON object with this exact structure:
{
  "diagnosis": {
    "current_vibe_summary": "string - 3-4 sentences describing the current feel, including dominant colors, materials, and style. Be specific.",
    "what_is_working": ["at least 5-8 specific items with reasoning — name the item + material + color"],
    "what_is_not_working": ["at least 5-8 specific issues with reasoning"],
    "biggest_improvement_opportunities": ["5-7 highest-impact changes, ranked"],
    "missing_furniture_categories": ["ALL missing categories — be thorough, typically 6-12 items"],
    "color_issues": ["3-5 specific color/palette observations — name actual colors you see"],
    "texture_material_issues": ["3-5 texture/material gaps or conflicts"],
    "scale_proportion_issues": ["3-5 specific scale issues — reference actual item dimensions"],
    "layout_issues": ["3-5 traffic flow, furniture arrangement, zoning issues"],
    "spatial_gaps": ["3-5 empty corners, dead zones behind furniture, unused wall stretches, awkward gaps — with suggestions for what would fill each one"],
    "lighting_issues": ["3-5 natural light, artificial light, evening ambience needs"],
    "clutter_editing_issues": ["things that should be removed or edited — be specific"]
  },
  "design_direction": {
    "recommended_palette": ["6-10 specific colors/tones — e.g. 'warm ivory', 'walnut brown', 'muted sage', not just 'neutral'"],
    "recommended_materials": ["5-8 specific materials — e.g. 'solid walnut', 'linen', 'bouclé', 'brushed brass', 'marble'"],
    "recommended_textures": ["4-6 textures to introduce — e.g. 'high-low pile wool', 'ribbed knit', 'woven rattan'"],
    "recommended_furniture_types": ["list every needed furniture type with specific notes — e.g. 'Area rug — at least 8x10, wool or wool-blend, warm neutral with subtle texture'"],
    "style_notes": "string - 3-4 sentences on overall style direction. MUST reference the client's specific identity and lifestyle (age, personality, hosting habits, aesthetic sensibility) and explain how the design serves THEIR life specifically. Connect material/style choices to who they are as a person."
  },
  "missing_categories": ["rug", "coffee_table", "accent_chair", "art", "floor_lamp", "throw_pillows", etc.],
  "action_list": [
    {
      "priority": 1,
      "action": "specific action — include material, color, size guidance",
      "category": "furniture category",
      "reasoning": "why this matters — what problem it solves"
    }
  ]
}

## FINAL CHECKLIST before returning:
- Did I list at least 5 items in what_is_working?
- Did I list at least 5 items in what_is_not_working?
- Did I reference specific items by name, material, and color in every array?
- Did I list AT LEAST 8 missing categories (covering ALL three tiers: essential, standard, finishing)?
- Did I include finishing touches: plants, art, decorative objects, trays, candles — not just furniture?
- Did I list ALL missing furniture categories (usually 8-15)?
- Did I provide specific color names (not just "neutral" or "warm")?
- Did I include 6+ recommended_palette colors, 5+ materials, 4+ textures?
- ⚠️ Did I CHECK that NONE of my recommendations conflict with the client's EXCLUSIONS?
- ⚠️ Did I CHECK that NONE of my recommendations replace an item the client wants to KEEP?
- ⚠️ Did I include ALL items the client EXPLICITLY REQUESTED?
- ⚠️ If the client used PLURAL for a request (e.g., "plants", "decor"), did I recommend MULTIPLE items in that category?
- ⚠️ Did I note any culturally significant or personal items (statues, figurines, art) visible in the photos?

Be specific and opinionated. Reference actual items visible in the photos. This is not a generic analysis — it is tailored to this specific apartment and space.`;
}

/**
 * Split-pass Call A: analyze the room from photos.
 * Produces diagnosis + design_direction only. The plan (missing_categories +
 * action_list) comes from a second call that consumes this output as text.
 *
 * This separation lets the model spend its full token budget on observation
 * and problem identification rather than trading that off against
 * plan synthesis within a single response.
 */
export function getDiagnosisAnalysisPrompt(
  roomType: string,
  keepItems: string[],
  replaceItems: string[],
  priorities: string[],
  userContext?: string,
  otherRoomsContext?: string,
  profile?: DynamicDesignProfile,
): string {
  const { allKeepItems, userNotes, keepItemsWarning, parsedSections, crossRoomSection } =
    buildDiagnosisContextParts(keepItems, userContext, otherRoomsContext);
  const profileSection = buildDesignProfileSection(profile);

  return `<role>
You are a world-class interior designer conducting a rigorous room diagnosis from photos. You see what other designers miss: the understated carpet that's a half-tone too cool, the empty corner that needs a tall plant, the dead zone that only a floor lamp can activate. You are opinionated, specific, and never generic.
</role>

<task>
This is PASS 1 of 2. Your ONLY job: observe the room, identify problems, and recommend a design direction. A separate pass synthesizes the action plan — do NOT produce missing_categories or action_list in this response.
</task>

## ROOM CONTEXT
- Room type: ${roomType}
- Items to keep: ${allKeepItems.length > 0 ? allKeepItems.join(", ") : "none specified"}
- Items to replace: ${replaceItems.length > 0 ? replaceItems.join(", ") : "none specified"}
- User priorities: ${priorities.length > 0 ? priorities.join(", ") : "not specified"}${userNotes}${keepItemsWarning}
${parsedSections ? `\n${parsedSections}\n` : ""}${crossRoomSection}${profileSection}
<reasoning_process>
Work through these steps in order. Spend the most time on Step 1.

**Step 1: OBSERVE every photo**
For each photo:
- Floor: material + exact color (e.g., "medium-tone oak engineered hardwood" not "wood floor")
- Walls: exact color (e.g., "warm off-white, close to Benjamin Moore Swiss Coffee" not "white")
- Windows: count, size, light direction, treatments
- Ceiling: height estimate, features (molding, beams, recessed lights)
- Every piece of furniture: name, material, color, condition, approximate size
- Lighting: existing fixtures, dark corners, natural light quality
- Personal items: culturally significant or personal items (art, statues, collections)

**Step 2: ASSESS what's working** — explain WHY each kept/working item works

**Step 3: IDENTIFY what's NOT working** — be specific about WHAT and WHY. GOOD: "Small round glass coffee table is drastically undersized for the L-shaped sectional — should be at least 48 inches". BAD: "Coffee table is too small."

**Step 4: CALL OUT SPATIAL GAPS** — empty corners, dead zones behind furniture, unused wall stretches

**Step 5: THINK ABOUT LIFESTYLE** — how does someone actually LIVE here?${priorities.length > 0 ? ` The client cares about: ${priorities.join(", ")}. Weight these heavily.` : ""}

**Step 6: DESIGN DIRECTION** based on existing finishes + lifestyle
- Specific color palette (6-10 named colors like "warm ivory", "walnut brown")
- Specific materials (5-8 like "solid walnut", "linen", "brushed brass")
- Style direction (3-4 sentences) MUST reference the client's specific identity, personality, building finishes, and how design serves their daily life
</reasoning_process>

## ARRAY SIZE REQUIREMENTS
- what_is_working: **5-8 items**. Every room has things working — find them all.
- what_is_not_working: **5-8 issues**. Be thorough.
- biggest_improvement_opportunities: **5-7 changes** ranked by impact.
- missing_furniture_categories: **ALL missing categories** (8-15 items across essential/standard/finishing tiers). This is part of the DIAGNOSIS — the top-level \`missing_categories\` + \`action_list\` come from pass 2.
- color_issues / texture_material_issues / scale_proportion_issues / layout_issues / spatial_gaps / lighting_issues: **3-5 observations each**
- clutter_editing_issues: can be 0 if room is clean

<output_contract>
JSON only. No prose, no markdown fences. Do NOT include missing_categories or action_list — those come from pass 2.

{
  "diagnosis": {
    "current_vibe_summary": "3-4 sentences with dominant colors/materials/style",
    "what_is_working": ["5-8 specific items with item name + material + color"],
    "what_is_not_working": ["5-8 specific issues with item name + problem + why"],
    "biggest_improvement_opportunities": ["5-7 ranked changes"],
    "missing_furniture_categories": ["8-15 items across essential/standard/finishing tiers"],
    "color_issues": ["3-5 specific observations naming actual colors"],
    "texture_material_issues": ["3-5 observations"],
    "scale_proportion_issues": ["3-5 observations referencing actual item dimensions"],
    "layout_issues": ["3-5 observations noting traffic paths and dead zones"],
    "spatial_gaps": ["3-5 empty corners/dead zones with suggestions for each"],
    "lighting_issues": ["3-5 observations on natural light direction and artificial gaps"],
    "clutter_editing_issues": ["specific items to remove, or empty array"]
  },
  "design_direction": {
    "recommended_palette": ["6-10 specific named colors — e.g. 'warm ivory', 'walnut brown', 'muted sage'"],
    "recommended_materials": ["5-8 specific materials — e.g. 'solid walnut', 'linen', 'brushed brass'"],
    "recommended_textures": ["4-6 textures — e.g. 'high-low pile wool', 'ribbed knit', 'woven rattan'"],
    "recommended_furniture_types": ["every needed furniture type with specific notes"],
    "style_notes": "3-4 sentences referencing client's specific identity, lifestyle, building finishes, and how design serves their daily life"
  }
}
</output_contract>`;
}

/**
 * Split-pass Call B: synthesize the plan from Call A's analysis.
 * No images — consumes the diagnosis + design_direction as text input
 * and produces missing_categories + action_list.
 *
 * @param fewShotBlock  Pre-formatted XML block from formatExamplesForPrompt().
 *                      Pass "" (empty string) for zero-shot (default).
 */
export function getDiagnosisPlanPrompt(
  roomType: string,
  analysisJson: string,
  keepItems: string[],
  replaceItems: string[],
  priorities: string[],
  userContext?: string,
  fewShotBlock?: string,
): string {
  const { allKeepItems, userNotes, keepItemsWarning } = buildDiagnosisContextParts(keepItems, userContext);

  return `<role>
You are synthesizing an action plan for a ${roomType} from a completed room diagnosis. The observation and problem-identification phase is done — your ONLY job is to translate it into a ranked shopping list.
</role>

<task>
Produce two outputs:
1. missing_categories — flat array of snake_case shopping-pipeline keys
2. action_list — ranked, specific, buyable recommendations with material/color/size guidance
</task>

## ROOM CONTEXT
- Room type: ${roomType}
- Items to keep: ${allKeepItems.length > 0 ? allKeepItems.join(", ") : "none specified"}
- Items to replace: ${replaceItems.length > 0 ? replaceItems.join(", ") : "none specified"}
- User priorities: ${priorities.length > 0 ? priorities.join(", ") : "not specified"}${userNotes}${keepItemsWarning}

${fewShotBlock ?? ""}
<prior_diagnosis>
The following is the completed observation and problem-identification analysis for this room.
Treat every field as ground truth — do not contradict it. Your action_list must trace
every item back to a problem or gap identified here.

${analysisJson}
</prior_diagnosis>

## DERIVATION RULES

### missing_categories
Derive from \`diagnosis.missing_furniture_categories\`. Normalize to snake_case keys (e.g., "rug", "coffee_table", "accent_chair", "floor_lamp", "throw_pillows", "wall_art", "plant"). Include ALL missing items across essential/standard/finishing tiers (typically 8-15). Do NOT include items the client wants to keep.

Finishing tier checklist — include any that are missing and relevant:
candles, baskets, books_styled, greenery_small, greenery_tall, sculptures, frames, poufs,
decorative_bowls, tray_styling, throw_blanket, decorative_objects, vase, wall_art, plant,
bench, table_runner, pouf, floor_cushion.

### action_list
Write ONE action per DISTINCT variant. If a category has meaningfully different variants, emit separate entries:
- "tall floor plant (fiddle leaf)" AND "trailing shelf plant (pothos)" → two entries, each with a \`variant\` field
- "3 throw pillows, same fabric, different sizes" → single entry with \`quantity: 3\`

Fields:
- priority: 1 = highest impact, increasing as priority drops
- action: specific, with material/color/size guidance (reference design_direction palette + materials from the diagnosis)
- category: matches an entry in missing_categories
- reasoning: which diagnosis problem this solves (trace back to what_is_not_working or missing_furniture_categories)
- placement: WHERE in the room, referencing specific walls, windows, doors, and existing furniture as landmarks (e.g., "against the south wall, between the window and the entry door" or "centered under the pendant light, in front of the sofa")
- variant: (optional) sub-type label when the same category has multiple distinct entries
- quantity: (optional) integer when multiple identical/near-identical items are needed

Rank by impact: foundational (rug, anchor seating, primary lighting) → standard (accent seating, textiles, art) → finishing (plants, objects, candles, baskets, books).

⚠️ If the user used plural language (e.g., "plants", "art", "candles") infer quantity ≥ 2 for that category.

<constraints>
- NEVER recommend a new item in the same category as a kept item
- NEVER include kept items in missing_categories
- Every action must trace back to a problem in the diagnosis
${priorities.length > 0 ? `- Weight priorities: ${priorities.join(", ")}` : ""}
</constraints>

<output_contract>
JSON only. No prose, no markdown fences.

{
  "missing_categories": ["rug", "coffee_table", "accent_chair", "wall_art", "floor_lamp", "throw_pillows", "plant", "candles"],
  "action_list": [
    {
      "priority": 1,
      "action": "Area rug at least 8x10, wool or wool-blend, warm neutral with subtle texture — extends beyond front legs of sofa to anchor seating area",
      "category": "rug",
      "placement": "Centered in front of the sofa, extending under the front legs, between the sofa and the TV wall",
      "reasoning": "Current rug (5x7) is drastically undersized for the L-shaped sectional; properly scaled rug anchors the seating zone and adds warm texture flagged as missing"
    },
    {
      "priority": 4,
      "action": "Tall statement plant, fiddle leaf fig or olive tree, 5–6 ft, in a woven rattan basket planter",
      "category": "plant",
      "variant": "tall floor",
      "placement": "In the empty corner between the window wall and the entry wall, behind the sofa arm",
      "reasoning": "Diagnosis noted room lacks greenery and the tall corner is visually empty"
    },
    {
      "priority": 5,
      "action": "Trailing pothos or philodendron on the bookshelf, 4-inch pot in a ceramic planter",
      "category": "plant",
      "variant": "trailing shelf",
      "placement": "On the second shelf of the bookshelf on the east wall, trailing over the edge",
      "reasoning": "Second scale of greenery adds life to the shelf without competing with the floor plant"
    },
    {
      "priority": 5,
      "action": "Set of 3 pillar candles, varying heights 4\"/6\"/8\", unscented, cream wax, grouped on a small round tray on the coffee table",
      "category": "candles",
      "quantity": 3,
      "placement": "Grouped on a tray on the coffee table, slightly off-center toward the sofa side",
      "reasoning": "Adds warm ambient texture and breaks up the empty coffee table surface"
    }
  ]
}
</output_contract>`;
}
