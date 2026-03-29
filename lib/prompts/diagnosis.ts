export function getDiagnosisPrompt(roomType: string, keepItems: string[], replaceItems: string[], priorities: string[]): string {
  return `Analyze the room photos provided and produce a comprehensive room diagnosis.

## ROOM CONTEXT
- Room type: ${roomType}
- Items to keep: ${keepItems.length > 0 ? keepItems.join(", ") : "none specified"}
- Items to replace: ${replaceItems.length > 0 ? replaceItems.join(", ") : "none specified"}
- User priorities: ${priorities.length > 0 ? priorities.join(", ") : "not specified"}

## STEP-BY-STEP ANALYSIS PROCESS — Follow this order exactly:

### Step 1: OBSERVE the room (spend the most time here)
Look at EVERY photo carefully. For each photo, note:
- Floor: What material? What color? (e.g., "medium-tone oak engineered hardwood" not just "wood floor")
- Walls: What color exactly? (e.g., "warm off-white, close to Benjamin Moore Swiss Coffee" not just "white")
- Windows: How many? What size? What direction might they face based on light? Any treatments (curtains/blinds)?
- Ceiling: Height estimate? Any features (molding, beams, recessed lights)?
- Every piece of furniture: Name it, describe its material, color, condition, and approximate size
- Lighting: What fixtures exist? Where are dark corners? How much natural light?

### Step 2: ASSESS what's working
For each item you're keeping or that works well, explain specifically WHY it works:
- "The dark gray fabric sectional (approx 95" wide) — good scale for the room width (~12ft), neutral enough to build around, provides ample seating for 4-5 people"
- NOT: "The sofa works well" (too vague)

### Step 3: IDENTIFY what's NOT working
For each problem, be specific about WHAT and WHY:
- "Small round glass coffee table (approx 24" diameter) is drastically undersized for the L-shaped sectional — should be at least 48" long rectangular or 36" round to anchor the seating area"
- NOT: "Coffee table is too small" (too vague)

### Step 4: DETERMINE what's MISSING
Think like a designer completing a room. Common things people forget:
- Layered lighting (floor lamp + table lamp + overhead)
- Textiles (throw pillows, blankets, curtains)
- Wall art/decor
- Area rug (properly sized!)
- Plants
- Side tables / surfaces near seating
- Storage solutions

### Step 5: DESIGN DIRECTION
Based on the existing finishes (floors, walls, fixed elements), recommend:
- Specific color palette (name 6-10 actual colors like "warm ivory", "walnut brown", "muted sage")
- Specific materials (name 5-8 like "solid walnut", "linen", "bouclé", "brushed brass")
- Style direction in 3-4 sentences

## EXAMPLE of a good diagnosis entry:
\`\`\`
"what_is_working": [
  "Wide-plank light oak hardwood floors — warm undertone that pairs well with natural materials, good condition, sets a warm-modern foundation",
  "Large south-facing window (~5ft wide) — excellent natural light, makes the space feel open, good opportunity for a reading nook nearby",
  "Charcoal gray linen sofa (approx 84\" wide) — appropriate scale for the room, neutral base that works with warm or cool accent palettes, appears comfortable"
]
\`\`\`

## EXAMPLE of a bad diagnosis entry (DO NOT do this):
\`\`\`
"what_is_working": [
  "The sofa works",
  "Good natural light",
  "Nice floors"
]
\`\`\`

## ARRAY SIZE REQUIREMENTS — THESE ARE MINIMUMS
- what_is_working: **at least 5-8 items**. Every room has things working — find them all.
- what_is_not_working: **at least 5-8 issues**. Be thorough — don't stop at the obvious.
- biggest_improvement_opportunities: **5-7 changes** ranked by visual impact.
- missing_furniture_categories: **ALL missing categories** (typically 6-12). Include throw pillows, plants, art, lamps, runners, trays, etc.
- color_issues: **3-5 observations**. Name the actual colors you see (e.g., "the cool gray throw clashes with the warm oak floors").
- texture_material_issues: **3-5 observations**. Count distinct textures present.
- scale_proportion_issues: **3-5 observations**. Reference specific items and their approximate sizes.
- layout_issues: **3-5 observations**. Note traffic paths, dead zones, awkward gaps.
- lighting_issues: **3-5 observations**. Note natural light direction and artificial gaps.
- clutter_editing_issues: Items to remove or edit. Can be 0 if room is clean.

## OUTPUT FORMAT — Return this exact JSON structure:
{
  "diagnosis": {
    "current_vibe_summary": "3-4 sentences: dominant colors, materials, current style, overall feel. Be specific — name colors and materials.",
    "what_is_working": ["at least 5-8 entries, each with item name + material + color + WHY it works"],
    "what_is_not_working": ["at least 5-8 entries, each with item name + material + color + WHY it fails"],
    "biggest_improvement_opportunities": ["5-7 highest-impact changes, ranked by visual impact. Each entry = specific action + expected result"],
    "missing_furniture_categories": ["ALL missing categories — be thorough, typically 6-12"],
    "color_issues": ["3-5 specific observations — name actual colors you see and explain conflicts/gaps"],
    "texture_material_issues": ["3-5 observations — count textures, identify gaps or monotony"],
    "scale_proportion_issues": ["3-5 observations — reference actual item sizes vs. room size"],
    "layout_issues": ["3-5 observations — traffic flow, dead zones, furniture arrangement problems"],
    "lighting_issues": ["3-5 observations — natural light, artificial light gaps, dark corners"],
    "clutter_editing_issues": ["things to remove — be specific about what and why"]
  },
  "design_direction": {
    "recommended_palette": ["6-10 specific named colors — e.g. 'warm ivory', 'walnut brown', 'muted sage', 'soft blush', 'charcoal'. NOT just 'neutral' or 'warm'."],
    "recommended_materials": ["5-8 specific materials — e.g. 'solid walnut', 'linen upholstery', 'bouclé fabric', 'brushed brass hardware', 'natural marble'. NOT just 'wood' or 'fabric'."],
    "recommended_textures": ["4-6 textures to introduce — e.g. 'high-low pile wool rug', 'ribbed knit throw', 'woven rattan basket', 'smooth matte ceramic'"],
    "recommended_furniture_types": ["every needed furniture type with specific notes — e.g. 'Area rug — at least 8x10, wool or wool-blend, warm neutral with subtle texture, must extend under front legs of sofa'"],
    "style_notes": "3-4 sentences on overall style direction, referencing the building's finishes and the client's life. Be opinionated."
  },
  "missing_categories": ["rug", "coffee_table", "accent_chair", "art", "floor_lamp", "throw_pillows", "side_table", "plant", etc.],
  "action_list": [
    {
      "priority": 1,
      "action": "specific action — include material, color, size guidance (e.g., 'Add 8x10 wool area rug in warm cream/ivory to anchor the seating area')",
      "category": "furniture category slug",
      "reasoning": "why this matters — what specific problem it solves (e.g., 'The seating area floats on the hardwood without definition. A properly sized rug will anchor the sofa and chair arrangement and add warmth + acoustic comfort.')"
    }
  ]
}

## FINAL CHECKLIST — Verify EACH of these before returning:
1. Did I list at least 5 items in what_is_working? Each with name + material + color + reasoning?
2. Did I list at least 5 items in what_is_not_working? Each specific and actionable?
3. Did I name specific colors (not just "neutral") in recommended_palette?
4. Did I name specific materials (not just "wood") in recommended_materials?
5. Did I include 6+ missing categories?
6. Does every action_list entry include material, color, AND size guidance?
7. Did I reference actual items I can see in the photos throughout?

Be specific and opinionated. Reference actual items visible in the photos. This is not a generic analysis — it is tailored to this specific apartment and space.`;
}
