/**
 * Hard-coded design profile for v1.
 * This entire module will be replaced with database-driven profiles
 * when generalizing for multi-user support.
 */

export const USER_DESIGN_PROFILE = {
  // User info
  user: {
    age: 29,
    gender: "male",
    occupation: "tech",
    living_situation: "bachelor, lives alone",
    personality: "highly analytical, detail-oriented, appreciates quality and taste",
  },

  // Location
  location: {
    city: "Chicago",
    neighborhood: "West Loop",
    building: "Porte apartments",
    building_type: "modern high-rise",
    view: "urban city view",
    architecture: "modern, contemporary",
  },

  // Apartment architectural context
  apartment: {
    floors: "grey-toned wood floors",
    kitchen_cabinets: "dark modern kitchen cabinets",
    walls: "neutral white walls",
    windows: "large windows, floor-to-ceiling feel",
    layout: "open layout between kitchen and living room",
    style: "contemporary urban shell, clean lines",
    lighting: "good natural light",
  },

  // Existing furniture
  existing_furniture: {
    sofa: "IKEA KIVIK sectional sofa in dark gray",
    tv_stand: "existing TV stand (likely stays unless strong reason otherwise)",
    floor_lamp: "arc floor lamp (already owned, stays)",
    decor: "currently minimal decor",
    state: "apartment still feels unfinished",
    temporary: "yoga pad may temporarily appear (ACL recovery, not permanent clutter)",
  },

  // Lifestyle
  lifestyle: {
    after_work: "wants apartment to feel comfortable after work",
    hosting: "likes hosting friends, wants impressive but relaxed vibe",
    work_from_home: "occasionally works from home",
    values: ["comfort", "sophistication", "low clutter", "intentional furniture"],
    philosophy: "fewer better pieces instead of lots of filler decor",
  },

  // Emotional design goals
  emotional_goals: {
    should_feel: [
      "sophisticated",
      "warm",
      "modern",
      "comfortable",
      "masculine but not cold",
      "upscale without being flashy",
      "curated but still relaxed",
      "polished but not staged",
      "like a boutique hotel / high-end Airbnb / elevated city apartment",
    ],
    should_not_feel: [
      "sterile",
      "generic",
      "boho-chaotic",
      "farmhouse",
      "too industrial",
      "college apartment",
      "full of random decor clutter",
      "trendy in a cheap or obvious way",
    ],
  },

  // Palette
  palette: {
    preferred: ["walnut", "oatmeal", "taupe", "cream", "camel", "olive", "warm beige", "soft charcoal (anchor only)"],
    avoid: [
      "more cool grey furniture",
      "overly black-heavy interiors",
      "bright colors",
      "busy multicolor rugs",
      "glossy cheap materials",
      "farmhouse wood tones",
      "industrial metal-heavy furniture",
      "loud boho patterns",
      "generic black-and-white wall art",
    ],
  },

  // Materials/textures
  materials: {
    preferred: [
      "walnut wood",
      "natural wood tones",
      "linen",
      "wool",
      "boucle",
      "camel/cognac leather or faux leather",
      "soft woven textiles",
      "stone/marble accents (moderation)",
      "matte finishes",
      "warm textured neutrals",
    ],
    avoid: [
      "glossy cheap materials",
      "overly synthetic finishes",
      "cold metal-heavy furniture",
    ],
  },

  // Style references
  style_references: [
    "modern warm",
    "urban contemporary",
    "boutique hotel",
    "elevated masculine apartment",
    "refined but livable",
    "Article / CB2 / West Elm / RH-adjacent taste level",
    "Scandinavian warmth blended with masculine urban polish",
  ],

  // Furniture philosophy
  furniture_philosophy: [
    "fewer but better pieces",
    "strong foundational items matter more than small decor",
    "large-scale pieces prioritized before styling accessories",
    "scale and proportion matter a lot",
    "rug should support the room, not dominate it",
    "furniture should look intentional and correctly sized",
    "room should feel zoned and composed, not randomly filled",
  ],

  // Room-specific priorities
  room_priorities: {
    living_room: {
      priority: 1,
      goals: ["warm", "social", "comfortable", "grounded", "impressive for guests", "strong evening ambience"],
      likely_needs: ["large warm neutral rug", "better coffee table", "accent chair", "large-scale art", "plant", "better styling around KIVIK"],
    },
    dining_area: {
      priority: 2,
      goals: ["round dining table likely best", "4 chairs", "integrated with living room", "warm and sophisticated, not bulky"],
      likely_needs: ["round dining table", "4 dining chairs"],
    },
    kitchen: {
      priority: 3,
      goals: ["already has good bones", "clean and edited", "subtle warmth via wood accessories / runner", "avoid clutter"],
      likely_needs: ["kitchen runner", "wood accessories", "restrained styling"],
    },
    bedroom: {
      priority: 4,
      goals: ["comfortable retreat", "warm and calming"],
      likely_needs: ["bedding upgrade", "bedside tables", "soft lighting"],
    },
    bathroom: {
      priority: 5,
      goals: ["clean", "edited", "subtle warmth"],
      likely_needs: ["matching accessories", "quality towels"],
    },
  },

  // Art preferences
  art_preferences: {
    style: "large-scale abstract art",
    palette: ["neutral", "earthy", "tonal", "cream", "taupe", "olive", "brown", "muted rust"],
    avoid: ["generic posters", "skyline photography", "filler gallery wall unless justified"],
  },

  // Plant preferences
  plant_preferences: {
    size: "5-7 ft",
    types: ["olive tree", "rubber tree", "similar statement plant"],
    purpose: "soften architecture and add life",
  },

  // Current apartment improvement priorities
  improvement_priorities: [
    "define the living room with a large rug",
    "replace weak coffee table if current one is not strong enough",
    "add an accent chair",
    "add large-scale art",
    "add plants",
    "define the dining area",
    "warm up the apartment without cluttering it",
  ],
} as const;

/**
 * Generates the system prompt context string from the design profile.
 */
export function getDesignContextPrompt(): string {
  const p = USER_DESIGN_PROFILE;
  return `
## USER DESIGN PROFILE

You are advising a ${p.user.age}-year-old ${p.user.gender} who works in ${p.user.occupation}. He is a ${p.user.living_situation}. He is ${p.user.personality}.

## LOCATION
- City: ${p.location.city}, ${p.location.neighborhood}
- Building: ${p.location.building} — ${p.location.building_type}
- View: ${p.location.view}
- Architecture: ${p.location.architecture}

## APARTMENT CONTEXT
- Floors: ${p.apartment.floors}
- Kitchen: ${p.apartment.kitchen_cabinets}
- Walls: ${p.apartment.walls}
- Windows: ${p.apartment.windows}
- Layout: ${p.apartment.layout}
- Style: ${p.apartment.style}
- Light: ${p.apartment.lighting}

## EXISTING FURNITURE
- Sofa: ${p.existing_furniture.sofa}
- TV Stand: ${p.existing_furniture.tv_stand}
- Floor Lamp: ${p.existing_furniture.floor_lamp}
- Current state: ${p.existing_furniture.state}
- Note: ${p.existing_furniture.temporary}

## EMOTIONAL GOALS
The apartment SHOULD feel: ${p.emotional_goals.should_feel.join(", ")}
The apartment should NOT feel: ${p.emotional_goals.should_not_feel.join(", ")}

## PREFERRED PALETTE
${p.palette.preferred.join(", ")}

## COLORS/MATERIALS TO AVOID
${p.palette.avoid.join(", ")}

## PREFERRED MATERIALS & TEXTURES
${p.materials.preferred.join(", ")}

## STYLE REFERENCES
${p.style_references.join(", ")}

## FURNITURE PHILOSOPHY
${p.furniture_philosophy.join(". ")}

## ART PREFERENCES
${p.art_preferences.style}. Acceptable colors: ${p.art_preferences.palette.join(", ")}. Avoid: ${p.art_preferences.avoid.join(", ")}.

## PLANT PREFERENCES
${p.plant_preferences.size} ${p.plant_preferences.types.join(" or ")}. Purpose: ${p.plant_preferences.purpose}.
`.trim();
}
