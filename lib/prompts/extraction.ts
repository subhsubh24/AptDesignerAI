export function getExtractionPrompt(): string {
  return `You are extracting detailed product information from a retailer website page. Read carefully through the supplied page content (provided in the prompt) and extract structured data.

## EXTRACTION PROCESS — Follow these steps in order:

### Step 1: READ the entire supplied content
Scan ALL the supplied page content, not just the top. Look for: product title, price (check for sale price vs. regular price), full description, specification tables (Dimensions, Materials, Care, Shipping), and any visible reviews summary. Use everything available in the supplied content.

### Step 2: EXAMINE any image URLs in the content
Look for img src, data-src, srcset, and og:image references in the supplied content. For each, note what it shows:
   - **Hero/main shot**: The primary product photo — use this for image_url
   - **Lifestyle/room shots**: Product styled in a real room — use the BEST one for lifestyle_image_url
   - **Detail/texture close-ups**: Reveals material quality, grain, weave, finish

### Step 3: FIND all variants in the supplied content
Look for:
   - Color swatch labels
   - "Also available in..." sections
   - Variant dropdown options for finish, fabric, size, configuration
   - List EVERY variant referenced in the content, not just the default.

### Step 4: EXTRACT dimensions precisely
   - Look for explicit dimensions in specification tables, JSON-LD data, or product descriptions
   - Record width, depth, height separately. For round items, record diameter.
   - If dimensions are in cm AND inches, prefer inches.
   - If dimensions are NOT explicitly stated in the supplied content, set to null — do NOT estimate.
   - For rugs: record as width × depth (e.g., 96 × 120 for 8x10)
   - For dining tables: note seating capacity if mentioned

### Step 5: CAPTURE image URLs
   - **CRITICAL: You MUST extract the EXACT URL from the supplied content. NEVER construct, guess, or invent an image URL.** If no image URL appears in the supplied content, set image_url to null.
   - Choose the highest-resolution, full-color, well-lit image showing the complete product
   - Prefer URLs from og:image meta tags or JSON-LD image fields
   - REJECT: thumbnails (under 400px), cropped images, swatch images
   - **Do NOT fabricate URLs by combining a domain with a guessed path. If you didn't read the exact URL from the supplied content, use null.**

### Step 6: CAPTURE lifestyle image
   - Find an image URL referenced in the content that shows the product IN a room setting
   - **Same rule: only use URLs you actually found in the supplied content. Never invent a URL. Use null if none found.**

## OUTPUT FORMAT
Return a JSON object with ALL fields populated (use null only when truly unavailable):
{
  "title": "exact product name/title from page — include collection name if shown",
  "retailer": "store/brand name (e.g. 'West Elm', 'Article', 'CB2')",
  "price": number or null (use sale price if on sale, otherwise regular price — extract the number only, no $ sign),
  "dimensions": {
    "width": number or null,
    "depth": number or null,
    "height": number or null,
    "diameter": number or null,
    "unit": "inches" or "cm"
  } or null,
  "materials": ["list ALL materials — be specific: 'solid walnut' not just 'wood', 'performance velvet' not just 'fabric', 'brushed brass' not just 'metal'"],
  "colors": ["list ALL available colors/finishes from swatches and dropdowns — e.g. 'Natural Oak', 'Walnut', 'Dark Mineral'"],
  "category": "rug | coffee_table | accent_chair | dining_table | dining_chair | art | plant | floor_lamp | table_lamp | side_table | bookshelf | console_table | media_console | kitchen_runner | throw_pillow | throw_blanket | vase | candle | curtains | pendant_light | other",
  "description": "3-4 sentences combining page text AND what you see in images — describe actual visual appearance (color in real light, texture, sheen), construction quality, style, and scale. Do NOT just copy marketing text.",
  "image_url": "direct URL to the highest-resolution product image (not thumbnail, not cropped)" or null,
  "lifestyle_image_url": "direct URL to the best lifestyle/room-setting image" or null,
  "visual_style_tags": ["5-7 style tags based on what you SEE — e.g. 'mid-century', 'warm-toned', 'organic-texture', 'matte-finish', 'tapered-legs', 'low-profile', 'natural-grain'"],
  "available_variants": ["ALL other options — e.g. 'Also in: Charcoal Bouclé, Cream Linen, Olive Velvet, Walnut/Brass, Oak/Chrome'"] or [],
  "in_stock": true/false/null (check for "Out of Stock", "Sold Out", "Backordered", "Pre-order" badges — null if you can't determine),
  "stock_notes": "any stock/shipping notes — e.g. 'Backordered until March', 'Ships in 4-6 weeks', 'Only 2 left', 'Made to order'" or null
}

## RULES — READ CAREFULLY
- Be accurate — do NOT hallucinate dimensions, prices, materials, or image URLs. If you can't find it on the page, use null.
- **NEVER fabricate image URLs.** Every image_url and lifestyle_image_url MUST be copied verbatim from the page's HTML. URLs you make up will return 404 errors and break the app. When in doubt, use null — a missing image is far better than a fake URL.
- Extract the COMPLETE materials list. "Solid oak frame with linen upholstery and brass ferrules" = ["solid oak", "linen upholstery", "brass ferrules"], NOT just ["wood"].
- For image URLs, get the FULL-SIZE version. Look at src, data-src, srcset, og:image attributes. Reject URLs containing "thumb", "small", "150x", "200x".
- The description MUST reflect what you actually SEE in the images, not just marketing copy. Describe the real color (not the name), the texture, the proportions.
- If the supplied content is a category/listing page (not a single product), return null for all fields except set title to "NOT_A_PRODUCT_PAGE".
- If the supplied content is behind a paywall, login wall, or shows an error, set title to "PAGE_NOT_ACCESSIBLE".
- If the supplied content has no usable product data (almost empty, garbled, or unrelated), set title to "PRODUCT_DATA_UNAVAILABLE".

## COMMON MISTAKES TO AVOID:
1. NEVER fabricate image URLs — this breaks the app. Use null if you can't find a real URL.
2. NEVER say materials are just "wood" or "fabric" — be specific: "solid oak", "linen blend".
3. NEVER guess dimensions — use null if not explicitly on the page.
4. NEVER use marketing language in description — describe what you SEE.`;
}
