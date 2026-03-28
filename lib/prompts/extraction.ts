export function getExtractionPrompt(): string {
  return `You are extracting detailed product information from a retailer website page. Use the URL Context tool to visit the page and examine it thoroughly.

## DEEP CRAWL INSTRUCTIONS — READ EVERY SECTION OF THE PAGE

1. **Read ALL page content top to bottom**: product title, price (check for sale price vs. regular price), full description, ALL specification tabs (Dimensions, Materials, Care, Shipping), reviews summary if visible. Do NOT stop at the hero section — scroll down.

2. **Examine EVERY product image on the page**: Most product pages have 4-10+ images. You MUST examine each one:
   - **Hero/main shot**: The primary product photo — use this for image_url
   - **Lifestyle/room shots**: Product styled in a real room — use the BEST one for lifestyle_image_url
   - **Detail/texture close-ups**: Reveals material quality, grain, weave, finish
   - **Dimension diagrams**: Often contains exact measurements — extract these
   - **Alternate angles**: Front, side, back, top-down views
   - **Swatch images**: Color/finish options shown as swatches

   For each image, note what it reveals about the product's actual appearance, quality, and scale.

3. **Check for ALL color/finish/size variants**: Look for:
   - Color swatches (clickable dots or squares)
   - Dropdown menus for finish, fabric, size, configuration
   - "Also available in..." sections
   - List EVERY variant, not just the default. This is critical for matching design palettes.

4. **Extract dimensions precisely**:
   - Check the Specifications/Dimensions tab (often hidden behind a click)
   - Check further down the page — many retailers list specs in a table below the fold
   - Look for dimension diagram images
   - Record width, depth, height separately. For round items, record diameter.
   - If dimensions are in cm AND inches, prefer inches.
   - If dimensions are NOT explicitly stated anywhere on the page, set to null — do NOT estimate.
   - For rugs: record as width × depth (e.g., 96 × 120 for 8x10)
   - For dining tables: note seating capacity if mentioned

5. **Capture the BEST product image URL**:
   - Choose the highest-resolution, full-color, well-lit image showing the complete product
   - Look at img src, data-src, or srcset attributes — get the largest version
   - REJECT: thumbnails (under 400px), cropped images, lifestyle crops, swatch images
   - The URL should end in .jpg, .png, .webp or contain /images/ in the path

6. **Capture a lifestyle/room image URL**:
   - Find an image showing the product IN a room setting with other furniture visible
   - This reveals scale, style compatibility, and real-world appearance
   - If no lifestyle image exists, set to null

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
  "available_variants": ["ALL other options — e.g. 'Also in: Charcoal Bouclé, Cream Linen, Olive Velvet, Walnut/Brass, Oak/Chrome'"] or []
}

## RULES — READ CAREFULLY
- Be accurate — do NOT hallucinate dimensions, prices, or materials. If you can't find it on the page, use null.
- Extract the COMPLETE materials list. "Solid oak frame with linen upholstery and brass ferrules" = ["solid oak", "linen upholstery", "brass ferrules"], NOT just ["wood"].
- For image URLs, get the FULL-SIZE version. Look at src, data-src, srcset attributes. Reject URLs containing "thumb", "small", "150x", "200x".
- The description MUST reflect what you actually SEE in the images, not just marketing copy. Describe the real color (not the name), the texture, the proportions.
- If the page is a category/listing page (not a single product), return null for all fields except set title to "NOT_A_PRODUCT_PAGE".
- If the page is behind a paywall, login wall, or returns an error, set title to "PAGE_NOT_ACCESSIBLE".`;
}
