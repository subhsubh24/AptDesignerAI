export function getExtractionPrompt(): string {
  return `You are extracting detailed product information from a retailer website page. Use the URL Context tool to visit the page and examine it thoroughly.

## EXTRACTION PROCESS — Follow these steps in order:

### Step 1: READ the entire page
Scan the FULL page, not just the top. Look at:
- Product title (exact name including collection name if shown)
- Price (check for sale price vs. regular price — use sale price if available)
- Full description text
- ALL specification tabs (Dimensions, Materials, Care, Shipping)
- Reviews summary if visible
- DO NOT stop at the hero section — scroll down and read all sections.

### Step 2: EXAMINE every product image
Most product pages have 4-10+ images. For each one, note what it shows:
- **Hero/main shot**: Primary product photo → use this for image_url
- **Lifestyle/room shots**: Product in a real room → use the best one for lifestyle_image_url
- **Detail/texture close-ups**: Reveals material quality, grain, weave, finish
- **Dimension diagrams**: Contains exact measurements
- **Alternate angles**: Front, side, back, top-down
- **Swatch images**: Color/finish options

### Step 3: FIND all variants
Look for:
- Color swatches (clickable dots or squares)
- Dropdown menus for finish, fabric, size, configuration
- "Also available in..." sections
- List EVERY variant, not just the default.

### Step 4: EXTRACT dimensions precisely
- Check Specifications/Dimensions tab (often behind a click)
- Check tables further down the page
- Check dimension diagram images
- Record width, depth, height separately. For round items, record diameter.
- If dimensions are in cm AND inches, prefer inches.
- If dimensions are NOT stated on the page, set dimensions to null — DO NOT guess or estimate.
- For rugs: width × depth (e.g., 96 × 120 for 8x10)
- For dining tables: note seating capacity if mentioned

### Step 5: CAPTURE image URLs
**CRITICAL RULES for image URLs:**
- You MUST extract the EXACT URL from the page's HTML (img src, data-src, srcset, og:image meta tag)
- NEVER construct, guess, or invent an image URL
- If you cannot find a real image URL in the page content, set to null
- Check the page's <meta property="og:image"> tag — often the most reliable source
- Get the highest-resolution version (avoid thumbnails with "thumb", "small", "150x", "200x" in URL)
- The URL should end in .jpg, .png, .webp or contain /images/ in the path
- A missing image (null) is MUCH better than a fake URL that returns 404

### Step 6: COMPOSE the description
Write 3-4 sentences combining:
- What you SEE in the images (actual color in real light, texture, proportions)
- Construction quality indicators
- Style and aesthetic
- DO NOT just copy marketing text — describe what you actually observe

## OUTPUT FORMAT — Return this exact JSON:
{
  "title": "exact product name from page — include collection name if shown",
  "retailer": "store/brand name (e.g. 'West Elm', 'Article', 'CB2')",
  "price": number or null (numeric only, no $ sign — use sale price if available),
  "dimensions": {
    "width": number or null,
    "depth": number or null,
    "height": number or null,
    "diameter": number or null,
    "unit": "inches" or "cm"
  } or null,
  "materials": ["SPECIFIC materials — 'solid walnut' not 'wood', 'performance velvet' not 'fabric', 'brushed brass' not 'metal'"],
  "colors": ["ALL available colors/finishes — e.g. 'Natural Oak', 'Walnut', 'Dark Mineral'"],
  "category": "rug | coffee_table | accent_chair | dining_table | dining_chair | art | plant | floor_lamp | table_lamp | side_table | bookshelf | console_table | media_console | kitchen_runner | throw_pillow | throw_blanket | vase | candle | curtains | pendant_light | other",
  "description": "3-4 sentences describing what you SEE — actual colors, texture, style, quality. Not marketing copy.",
  "image_url": "exact URL from page HTML of highest-res product image" or null,
  "lifestyle_image_url": "exact URL from page HTML of best room-setting image" or null,
  "visual_style_tags": ["5-7 tags based on appearance — e.g. 'mid-century', 'warm-toned', 'organic-texture', 'matte-finish', 'tapered-legs'"],
  "available_variants": ["ALL other options — e.g. 'Charcoal Bouclé', 'Cream Linen', 'Walnut/Brass'"] or []
}

## COMMON MISTAKES TO AVOID:
1. NEVER fabricate image URLs — this breaks the app. Use null if you can't find a real URL.
2. NEVER say materials are just "wood" or "fabric" — be specific: "solid oak", "linen blend".
3. NEVER guess dimensions — use null if not explicitly on the page.
4. NEVER use marketing language in description — describe what you SEE.
5. If the page is a category/listing page (not a single product), return: {"title": "NOT_A_PRODUCT_PAGE"} with all other fields null.
6. If the page is inaccessible (paywall, login, error), return: {"title": "PAGE_NOT_ACCESSIBLE"} with all other fields null.`;
}
