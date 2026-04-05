import { parseUserContext, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";

export function getDiagnosisPrompt(roomType: string, keepItems: string[], replaceItems: string[], priorities: string[], userContext?: string): string {
  // Parse user context into structured constraints
  const parsed = userContext ? parseUserContext(userContext) : null;
  const parsedSections = parsed ? formatParsedContextForPrompt(parsed) : "";

  // Merge keep items from explicit list + parsed context
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

  return `Analyze the room photos provided and produce a comprehensive room diagnosis.

## ROOM CONTEXT
- Room type: ${roomType}
- Items to keep: ${allKeepItems.length > 0 ? allKeepItems.join(", ") : "none specified"}
- Items to replace: ${replaceItems.length > 0 ? replaceItems.join(", ") : "none specified"}
- User priorities: ${priorities.length > 0 ? priorities.join(", ") : "not specified"}${userNotes}${keepItemsWarning}
${parsedSections ? `\n${parsedSections}\n` : ""}
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
- Style direction in 3-4 sentences that reference the client's lifestyle and priorities, not just aesthetics

## ARRAY SIZE REQUIREMENTS
- what_is_working: List **at least 5-8 items**. Every room has things working — find them all.
- what_is_not_working: List **at least 5-8 issues**. Be thorough — don't stop at the obvious.
- biggest_improvement_opportunities: List **5-7 changes** ranked by impact.
- missing_furniture_categories: List **ALL missing categories** (typically 6-12). Include often-forgotten items like throw pillows, plants, art, table lamps, runners, trays.
- color_issues: List **3-5 observations**. Map the actual colors you see.
- texture_material_issues: List **3-5 observations**. Count distinct textures.
- scale_proportion_issues: List **3-5 observations**. Reference specific items.
- layout_issues: List **3-5 observations**. Note traffic paths, dead zones, awkward gaps.
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
    "lighting_issues": ["3-5 natural light, artificial light, evening ambience needs"],
    "clutter_editing_issues": ["things that should be removed or edited — be specific"]
  },
  "design_direction": {
    "recommended_palette": ["6-10 specific colors/tones — e.g. 'warm ivory', 'walnut brown', 'muted sage', not just 'neutral'"],
    "recommended_materials": ["5-8 specific materials — e.g. 'solid walnut', 'linen', 'bouclé', 'brushed brass', 'marble'"],
    "recommended_textures": ["4-6 textures to introduce — e.g. 'high-low pile wool', 'ribbed knit', 'woven rattan'"],
    "recommended_furniture_types": ["list every needed furniture type with specific notes — e.g. 'Area rug — at least 8x10, wool or wool-blend, warm neutral with subtle texture'"],
    "style_notes": "string - 3-4 sentences on overall style direction, referencing the building's finishes and the client's life"
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
- Did I list ALL missing furniture categories (usually 6-12)?
- Did I provide specific color names (not just "neutral" or "warm")?
- Did I include 6+ recommended_palette colors, 5+ materials, 4+ textures?
- ⚠️ Did I CHECK that NONE of my recommendations conflict with the client's EXCLUSIONS?
- ⚠️ Did I CHECK that NONE of my recommendations replace an item the client wants to KEEP?
- ⚠️ Did I include ALL items the client EXPLICITLY REQUESTED?
- ⚠️ If the client used PLURAL for a request (e.g., "plants", "decor"), did I recommend MULTIPLE items in that category?
- ⚠️ Did I note any culturally significant or personal items (statues, figurines, art) visible in the photos?

Be specific and opinionated. Reference actual items visible in the photos. This is not a generic analysis — it is tailored to this specific apartment and space.`;
}
