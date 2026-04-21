// Color HSL lookup table and material property vectors for mathematical harmony validation

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface MaterialProperties {
  warmth: number;   // 0-1: cool to warm
  roughness: number; // 0-1: smooth to rough
  sheen: number;    // 0-1: matte to glossy
  weight: number;   // 0-1: light to heavy
}

// ~100 common interior design colors → HSL
const COLOR_HSL_MAP: Record<string, HSL> = {
  // Whites & Creams
  "white": { h: 0, s: 0, l: 100 },
  "pure white": { h: 0, s: 0, l: 100 },
  "off-white": { h: 40, s: 20, l: 95 },
  "warm white": { h: 40, s: 30, l: 95 },
  "cool white": { h: 210, s: 15, l: 96 },
  "ivory": { h: 50, s: 50, l: 93 },
  "warm ivory": { h: 45, s: 55, l: 92 },
  "cream": { h: 40, s: 55, l: 90 },
  "eggshell": { h: 48, s: 25, l: 92 },
  "linen white": { h: 45, s: 20, l: 93 },
  "alabaster": { h: 48, s: 18, l: 94 },
  "pearl": { h: 30, s: 15, l: 90 },

  // Beiges & Tans
  "beige": { h: 40, s: 30, l: 80 },
  "warm beige": { h: 35, s: 35, l: 78 },
  "sand": { h: 38, s: 35, l: 75 },
  "tan": { h: 35, s: 30, l: 70 },
  "taupe": { h: 30, s: 15, l: 55 },
  "warm taupe": { h: 25, s: 20, l: 52 },
  "greige": { h: 40, s: 10, l: 65 },
  "mushroom": { h: 30, s: 12, l: 58 },
  "khaki": { h: 55, s: 30, l: 65 },
  "camel": { h: 35, s: 45, l: 60 },
  "wheat": { h: 42, s: 40, l: 75 },

  // Browns
  "brown": { h: 25, s: 50, l: 35 },
  "dark brown": { h: 20, s: 55, l: 22 },
  "chocolate": { h: 20, s: 55, l: 25 },
  "espresso": { h: 20, s: 60, l: 15 },
  "walnut": { h: 22, s: 45, l: 30 },
  "walnut brown": { h: 22, s: 45, l: 30 },
  "oak": { h: 35, s: 50, l: 50 },
  "light oak": { h: 38, s: 50, l: 60 },
  "cognac": { h: 25, s: 60, l: 40 },
  "saddle brown": { h: 25, s: 55, l: 35 },
  "chestnut": { h: 15, s: 50, l: 32 },
  "mocha": { h: 20, s: 30, l: 35 },
  "umber": { h: 30, s: 40, l: 28 },
  "sienna": { h: 18, s: 55, l: 40 },

  // Grays
  "gray": { h: 0, s: 0, l: 50 },
  "grey": { h: 0, s: 0, l: 50 },
  "light gray": { h: 0, s: 0, l: 75 },
  "light grey": { h: 0, s: 0, l: 75 },
  "dark gray": { h: 0, s: 0, l: 30 },
  "dark grey": { h: 0, s: 0, l: 30 },
  "charcoal": { h: 0, s: 0, l: 20 },
  "slate": { h: 210, s: 10, l: 40 },
  "slate gray": { h: 210, s: 10, l: 40 },
  "warm gray": { h: 30, s: 8, l: 55 },
  "warm grey": { h: 30, s: 8, l: 55 },
  "cool gray": { h: 210, s: 8, l: 55 },
  "silver": { h: 0, s: 0, l: 75 },
  "pewter": { h: 0, s: 5, l: 45 },
  "stone": { h: 35, s: 8, l: 55 },
  "concrete": { h: 30, s: 5, l: 60 },

  // Blacks
  "black": { h: 0, s: 0, l: 0 },
  "matte black": { h: 0, s: 0, l: 5 },
  "jet black": { h: 0, s: 0, l: 3 },
  "ebony": { h: 30, s: 10, l: 8 },
  "onyx": { h: 0, s: 0, l: 7 },

  // Blues
  "navy": { h: 220, s: 60, l: 20 },
  "navy blue": { h: 220, s: 60, l: 20 },
  "dark blue": { h: 220, s: 55, l: 25 },
  "blue": { h: 220, s: 60, l: 50 },
  "powder blue": { h: 200, s: 40, l: 80 },
  "sky blue": { h: 200, s: 50, l: 75 },
  "steel blue": { h: 207, s: 30, l: 45 },
  "slate blue": { h: 215, s: 25, l: 45 },
  "dusty blue": { h: 210, s: 25, l: 60 },
  "indigo": { h: 245, s: 50, l: 30 },
  "cobalt": { h: 215, s: 70, l: 40 },
  "cerulean": { h: 195, s: 60, l: 55 },
  "teal": { h: 180, s: 50, l: 35 },
  "ocean blue": { h: 200, s: 55, l: 40 },

  // Greens
  "green": { h: 120, s: 40, l: 40 },
  "sage": { h: 130, s: 20, l: 55 },
  "sage green": { h: 130, s: 20, l: 55 },
  "olive": { h: 80, s: 35, l: 35 },
  "olive green": { h: 80, s: 35, l: 35 },
  "forest green": { h: 140, s: 50, l: 25 },
  "emerald": { h: 145, s: 55, l: 35 },
  "hunter green": { h: 145, s: 45, l: 22 },
  "moss": { h: 100, s: 25, l: 40 },
  "moss green": { h: 100, s: 25, l: 40 },
  "eucalyptus": { h: 155, s: 20, l: 55 },
  "mint": { h: 150, s: 35, l: 75 },
  "seafoam": { h: 160, s: 30, l: 70 },

  // Pinks & Reds
  "red": { h: 0, s: 70, l: 45 },
  "burgundy": { h: 345, s: 60, l: 25 },
  "wine": { h: 340, s: 55, l: 28 },
  "cranberry": { h: 345, s: 55, l: 30 },
  "terracotta": { h: 16, s: 55, l: 48 },
  "rust": { h: 15, s: 60, l: 40 },
  "coral": { h: 16, s: 65, l: 65 },
  "blush": { h: 350, s: 40, l: 85 },
  "blush pink": { h: 350, s: 40, l: 85 },
  "dusty rose": { h: 345, s: 30, l: 60 },
  "mauve": { h: 330, s: 20, l: 55 },
  "rose": { h: 345, s: 45, l: 55 },
  "pink": { h: 340, s: 50, l: 75 },
  "salmon": { h: 15, s: 55, l: 65 },

  // Yellows & Oranges
  "yellow": { h: 50, s: 70, l: 60 },
  "gold": { h: 45, s: 65, l: 50 },
  "golden": { h: 45, s: 65, l: 50 },
  "mustard": { h: 42, s: 65, l: 45 },
  "amber": { h: 35, s: 70, l: 50 },
  "honey": { h: 38, s: 60, l: 55 },
  "butter": { h: 50, s: 50, l: 80 },
  "orange": { h: 25, s: 70, l: 55 },
  "burnt orange": { h: 20, s: 65, l: 40 },
  "copper": { h: 20, s: 55, l: 45 },
  "peach": { h: 25, s: 55, l: 78 },
  "apricot": { h: 28, s: 60, l: 72 },

  // Purples
  "purple": { h: 280, s: 50, l: 40 },
  "plum": { h: 300, s: 35, l: 30 },
  "eggplant": { h: 290, s: 40, l: 20 },
  "lavender": { h: 270, s: 35, l: 75 },
  "lilac": { h: 280, s: 35, l: 75 },
  "aubergine": { h: 290, s: 45, l: 22 },
  "amethyst": { h: 275, s: 40, l: 45 },

  // Common interior design descriptive colors
  "oatmeal": { h: 38, s: 25, l: 78 },
  "warm oatmeal": { h: 35, s: 30, l: 76 },
  "natural linen": { h: 45, s: 22, l: 82 },
  "flax": { h: 48, s: 30, l: 78 },
  "parchment": { h: 42, s: 28, l: 85 },
  "bisque": { h: 33, s: 45, l: 84 },
  "ecru": { h: 45, s: 35, l: 82 },
  "bone": { h: 40, s: 15, l: 88 },
  "vanilla": { h: 48, s: 40, l: 88 },
  "soft white": { h: 40, s: 15, l: 95 },
  "warm sand": { h: 35, s: 35, l: 73 },
  "driftwood": { h: 30, s: 18, l: 55 },
  "fog": { h: 210, s: 8, l: 82 },
  "mist": { h: 200, s: 10, l: 85 },
  "cloud": { h: 220, s: 5, l: 90 },
  "graphite": { h: 0, s: 0, l: 25 },
  "iron gray": { h: 0, s: 3, l: 35 },
  "smoke": { h: 0, s: 0, l: 65 },
  "ash": { h: 30, s: 5, l: 60 },
  "ash gray": { h: 30, s: 5, l: 60 },
  "dove gray": { h: 30, s: 5, l: 70 },
  "heather": { h: 270, s: 12, l: 65 },
  "storm": { h: 215, s: 12, l: 40 },
  "dusk": { h: 250, s: 15, l: 45 },
  "midnight": { h: 230, s: 30, l: 15 },
  "ink": { h: 230, s: 25, l: 12 },

  // Nature-inspired design colors
  "clay": { h: 18, s: 40, l: 50 },
  "adobe": { h: 15, s: 45, l: 55 },
  "sandstone": { h: 35, s: 30, l: 65 },
  "limestone": { h: 42, s: 15, l: 75 },
  "travertine": { h: 38, s: 20, l: 70 },
  "pebble": { h: 35, s: 10, l: 60 },
  "bark": { h: 25, s: 35, l: 25 },
  "cedar": { h: 15, s: 40, l: 35 },
  "dune": { h: 40, s: 30, l: 72 },
  "sahara": { h: 35, s: 40, l: 65 },
  "seagrass": { h: 100, s: 20, l: 50 },
  "lichen": { h: 120, s: 12, l: 55 },
  "fern": { h: 130, s: 30, l: 40 },
  "ivy": { h: 140, s: 35, l: 30 },
  "pine": { h: 140, s: 40, l: 28 },
  "basil": { h: 125, s: 30, l: 35 },
  "thyme": { h: 100, s: 15, l: 45 },
  "rosemary": { h: 150, s: 20, l: 35 },
  "ocean": { h: 200, s: 45, l: 40 },
  "sky": { h: 200, s: 50, l: 75 },
  "horizon": { h: 210, s: 20, l: 70 },

  // Popular design accent colors
  "dusty pink": { h: 350, s: 25, l: 70 },
  "dusty sage": { h: 130, s: 15, l: 60 },
  "soft sage": { h: 130, s: 18, l: 62 },
  "muted sage": { h: 130, s: 15, l: 58 },
  "warm sage": { h: 125, s: 18, l: 55 },
  "soft blue": { h: 210, s: 30, l: 72 },
  "muted blue": { h: 215, s: 25, l: 55 },
  "french blue": { h: 215, s: 40, l: 55 },
  "mineral blue": { h: 200, s: 25, l: 50 },
  "ice blue": { h: 195, s: 20, l: 82 },
  "warm terracotta": { h: 15, s: 55, l: 50 },
  "burnt sienna": { h: 15, s: 50, l: 40 },
  "cinnamon": { h: 20, s: 55, l: 38 },
  "spice": { h: 18, s: 50, l: 42 },
  "paprika": { h: 10, s: 60, l: 38 },
  "ochre": { h: 40, s: 55, l: 50 },
  "turmeric": { h: 38, s: 70, l: 50 },
  "saffron": { h: 42, s: 65, l: 55 },
  "brass gold": { h: 45, s: 50, l: 48 },
  "champagne": { h: 42, s: 30, l: 80 },
  "prosecco": { h: 45, s: 25, l: 78 },
  "rose gold": { h: 15, s: 35, l: 72 },
};

// ~50 common materials → property vectors
const MATERIAL_PROPERTIES_MAP: Record<string, MaterialProperties> = {
  // Woods
  "walnut": { warmth: 0.8, roughness: 0.3, sheen: 0.4, weight: 0.9 },
  "solid walnut": { warmth: 0.8, roughness: 0.3, sheen: 0.4, weight: 0.9 },
  "oak": { warmth: 0.75, roughness: 0.35, sheen: 0.35, weight: 0.85 },
  "white oak": { warmth: 0.65, roughness: 0.35, sheen: 0.35, weight: 0.85 },
  "red oak": { warmth: 0.8, roughness: 0.35, sheen: 0.35, weight: 0.85 },
  "ash": { warmth: 0.6, roughness: 0.3, sheen: 0.35, weight: 0.8 },
  "maple": { warmth: 0.6, roughness: 0.2, sheen: 0.45, weight: 0.85 },
  "cherry": { warmth: 0.8, roughness: 0.2, sheen: 0.5, weight: 0.85 },
  "teak": { warmth: 0.85, roughness: 0.35, sheen: 0.4, weight: 0.9 },
  "pine": { warmth: 0.65, roughness: 0.4, sheen: 0.3, weight: 0.6 },
  "birch": { warmth: 0.55, roughness: 0.25, sheen: 0.4, weight: 0.7 },
  "bamboo": { warmth: 0.55, roughness: 0.3, sheen: 0.4, weight: 0.5 },
  "mahogany": { warmth: 0.85, roughness: 0.2, sheen: 0.55, weight: 0.9 },
  "mango wood": { warmth: 0.75, roughness: 0.35, sheen: 0.3, weight: 0.8 },
  "acacia": { warmth: 0.75, roughness: 0.4, sheen: 0.35, weight: 0.85 },
  "reclaimed wood": { warmth: 0.7, roughness: 0.6, sheen: 0.15, weight: 0.8 },

  // Metals
  "brass": { warmth: 0.6, roughness: 0.1, sheen: 0.8, weight: 0.9 },
  "brushed brass": { warmth: 0.6, roughness: 0.2, sheen: 0.7, weight: 0.9 },
  "polished brass": { warmth: 0.65, roughness: 0.05, sheen: 0.95, weight: 0.9 },
  "gold": { warmth: 0.7, roughness: 0.05, sheen: 0.9, weight: 0.95 },
  "chrome": { warmth: 0.2, roughness: 0.05, sheen: 0.95, weight: 0.85 },
  "polished chrome": { warmth: 0.2, roughness: 0.02, sheen: 1.0, weight: 0.85 },
  "nickel": { warmth: 0.3, roughness: 0.1, sheen: 0.8, weight: 0.85 },
  "brushed nickel": { warmth: 0.3, roughness: 0.2, sheen: 0.65, weight: 0.85 },
  "iron": { warmth: 0.3, roughness: 0.4, sheen: 0.3, weight: 0.95 },
  "wrought iron": { warmth: 0.3, roughness: 0.5, sheen: 0.2, weight: 0.95 },
  "black iron": { warmth: 0.25, roughness: 0.4, sheen: 0.25, weight: 0.95 },
  "steel": { warmth: 0.2, roughness: 0.15, sheen: 0.7, weight: 0.9 },
  "stainless steel": { warmth: 0.2, roughness: 0.1, sheen: 0.75, weight: 0.9 },
  "matte black metal": { warmth: 0.2, roughness: 0.3, sheen: 0.15, weight: 0.85 },
  "copper": { warmth: 0.7, roughness: 0.15, sheen: 0.75, weight: 0.9 },
  "bronze": { warmth: 0.55, roughness: 0.2, sheen: 0.6, weight: 0.9 },

  // Textiles
  "linen": { warmth: 0.7, roughness: 0.6, sheen: 0.1, weight: 0.2 },
  "cotton": { warmth: 0.6, roughness: 0.5, sheen: 0.1, weight: 0.2 },
  "velvet": { warmth: 0.7, roughness: 0.3, sheen: 0.35, weight: 0.35 },
  "silk": { warmth: 0.5, roughness: 0.1, sheen: 0.7, weight: 0.15 },
  "wool": { warmth: 0.8, roughness: 0.7, sheen: 0.05, weight: 0.4 },
  "cashmere": { warmth: 0.85, roughness: 0.3, sheen: 0.15, weight: 0.25 },
  "jute": { warmth: 0.65, roughness: 0.85, sheen: 0.05, weight: 0.35 },
  "sisal": { warmth: 0.55, roughness: 0.9, sheen: 0.05, weight: 0.4 },
  "boucle": { warmth: 0.75, roughness: 0.7, sheen: 0.1, weight: 0.3 },
  "chenille": { warmth: 0.75, roughness: 0.5, sheen: 0.15, weight: 0.3 },
  "tweed": { warmth: 0.7, roughness: 0.65, sheen: 0.05, weight: 0.4 },
  "performance fabric": { warmth: 0.5, roughness: 0.4, sheen: 0.2, weight: 0.3 },

  // Stone & Mineral
  "marble": { warmth: 0.3, roughness: 0.1, sheen: 0.8, weight: 1.0 },
  "granite": { warmth: 0.3, roughness: 0.25, sheen: 0.6, weight: 1.0 },
  "travertine": { warmth: 0.6, roughness: 0.4, sheen: 0.4, weight: 1.0 },
  "slate": { warmth: 0.3, roughness: 0.5, sheen: 0.25, weight: 0.95 },
  "concrete": { warmth: 0.25, roughness: 0.55, sheen: 0.15, weight: 1.0 },
  "terrazzo": { warmth: 0.35, roughness: 0.15, sheen: 0.65, weight: 1.0 },
  "quartz": { warmth: 0.3, roughness: 0.05, sheen: 0.75, weight: 1.0 },
  "limestone": { warmth: 0.5, roughness: 0.35, sheen: 0.3, weight: 1.0 },
  "ceramic": { warmth: 0.35, roughness: 0.2, sheen: 0.65, weight: 0.85 },
  "porcelain": { warmth: 0.3, roughness: 0.1, sheen: 0.75, weight: 0.85 },

  // Other
  "glass": { warmth: 0.2, roughness: 0.02, sheen: 0.9, weight: 0.7 },
  "frosted glass": { warmth: 0.25, roughness: 0.15, sheen: 0.4, weight: 0.7 },
  "rattan": { warmth: 0.7, roughness: 0.65, sheen: 0.1, weight: 0.3 },
  "wicker": { warmth: 0.65, roughness: 0.7, sheen: 0.05, weight: 0.25 },
  "cane": { warmth: 0.65, roughness: 0.5, sheen: 0.15, weight: 0.25 },
  "leather": { warmth: 0.7, roughness: 0.3, sheen: 0.4, weight: 0.6 },
  "full grain leather": { warmth: 0.7, roughness: 0.35, sheen: 0.4, weight: 0.65 },
  "faux leather": { warmth: 0.5, roughness: 0.2, sheen: 0.5, weight: 0.45 },
  "plywood": { warmth: 0.5, roughness: 0.3, sheen: 0.25, weight: 0.6 },
  "mdf": { warmth: 0.4, roughness: 0.15, sheen: 0.3, weight: 0.7 },
  "lacquer": { warmth: 0.4, roughness: 0.02, sheen: 0.95, weight: 0.5 },
  "resin": { warmth: 0.3, roughness: 0.05, sheen: 0.8, weight: 0.6 },
};

// Known wood species for conflict detection
export const WOOD_SPECIES = new Set([
  "walnut", "oak", "white oak", "red oak", "ash", "maple", "cherry",
  "teak", "pine", "birch", "mahogany", "mango wood", "acacia", "bamboo",
]);

// Known metal finishes for conflict detection
export const WARM_METALS = new Set([
  "brass", "brushed brass", "polished brass", "gold", "copper", "bronze",
]);
export const COOL_METALS = new Set([
  "chrome", "polished chrome", "nickel", "brushed nickel", "steel",
  "stainless steel", "iron", "wrought iron", "black iron", "matte black metal",
]);

/**
 * Fuzzy-match a color name against the lookup table.
 * Returns HSL if found, null otherwise.
 */
/** Parse a `#RGB`, `#RRGGBB`, or `rgb(r,g,b)` string into HSL. */
function hexToHsl(input: string): HSL | null {
  const s = input.trim().toLowerCase();
  let r = 0, g = 0, b = 0;
  const hexMatch = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    const hx = hexMatch[1];
    const full = hx.length === 3 ? hx.split("").map((c) => c + c).join("") : hx;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const rgbMatch = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
    if (!rgbMatch) return null;
    r = parseInt(rgbMatch[1], 10);
    g = parseInt(rgbMatch[2], 10);
    b = parseInt(rgbMatch[3], 10);
  }
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(sat * 100), l: Math.round(l * 100) };
}

export function lookupColor(name: string): HSL | null {
  const raw = name.trim();

  // 1. If the model emitted a hex or rgb code (either standalone or inside
  //    parens, e.g. "warm ivory (#F3ECE0)"), parse that directly. Avoids the
  //    palette_fit → 0.5 floor when the name isn't in the table.
  //    Anchor the hex length to EXACTLY 3 or 6 chars via a negative lookahead
  //    — `{3,6}` greedily truncates malformed 7+ char sequences (e.g.
  //    `#ABCDEF12` → `#ABCDEF`) and silently accepts a wrong color.
  const hexInside = raw.match(
    /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/,
  );
  if (hexInside) {
    const parsed = hexToHsl(hexInside[0]);
    if (parsed) return parsed;
  }

  const normalized = raw.toLowerCase();

  // Exact match
  if (COLOR_HSL_MAP[normalized]) return COLOR_HSL_MAP[normalized];

  // Try removing common prefixes/suffixes
  const stripped = normalized
    .replace(/^(light|dark|deep|bright|soft|muted|pale|rich|warm|cool)\s+/, "")
    .replace(/\s+(color|tone|shade|hue)$/, "");
  if (COLOR_HSL_MAP[stripped]) return COLOR_HSL_MAP[stripped];

  // Substring match: find any key that contains the input or vice versa
  for (const [key, hsl] of Object.entries(COLOR_HSL_MAP)) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return hsl;
    }
  }

  return null;
}

/**
 * Fuzzy-match a material name against the lookup table.
 * Returns MaterialProperties if found, null otherwise.
 */
export function lookupMaterial(name: string): MaterialProperties | null {
  const normalized = name.toLowerCase().trim();

  // Exact match
  if (MATERIAL_PROPERTIES_MAP[normalized]) return MATERIAL_PROPERTIES_MAP[normalized];

  // Try removing common prefixes
  const stripped = normalized
    .replace(/^(solid|natural|organic|recycled|sustainable|genuine|real|faux|artificial|synthetic)\s+/, "");
  if (MATERIAL_PROPERTIES_MAP[stripped]) return MATERIAL_PROPERTIES_MAP[stripped];

  // Substring match
  for (const [key, props] of Object.entries(MATERIAL_PROPERTIES_MAP)) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return props;
    }
  }

  return null;
}

/**
 * Identify the wood species from a material string.
 * Returns the species name or null.
 */
export function identifyWoodSpecies(material: string): string | null {
  const lower = material.toLowerCase();
  for (const species of WOOD_SPECIES) {
    if (lower.includes(species)) return species;
  }
  return null;
}

/**
 * Identify metal finish from a material string.
 * Returns { name, warm } or null.
 */
export function identifyMetalFinish(material: string): { name: string; warm: boolean } | null {
  const lower = material.toLowerCase();
  for (const metal of WARM_METALS) {
    if (lower.includes(metal)) return { name: metal, warm: true };
  }
  for (const metal of COOL_METALS) {
    if (lower.includes(metal)) return { name: metal, warm: false };
  }
  return null;
}
