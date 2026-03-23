export function getExtractionPrompt(): string {
  return `You are extracting detailed product information from a retailer website page. Use the URL Context tool to visit the page and examine it thoroughly.

## DEEP CRAWL INSTRUCTIONS

1. **Read ALL page content**: product title, price, description, specifications, dimensions, materials, available finishes.

2. **Examine ALL product images on the page**: Most product pages have multiple images — main hero shot, lifestyle/room shots, detail/texture close-ups, dimension diagrams, alternate angles. Study each one to understand:
   - The actual visual appearance (color in real light, texture, sheen/finish)
   - The style (modern, traditional, mid-century, industrial, bohemian, etc.)
   - The scale relative to other objects in lifestyle photos
   - Material quality visible in detail shots

3. **Check for color/finish variants**: Many product pages have swatches or dropdown selectors for multiple colors or materials. List ALL available options, not just the default shown.

4. **Look at the dimensions section carefully**: Find width, depth, height. Check if there's a dimension diagram image. Some pages list dimensions in the specs tab or further down the page.

5. **Capture the main product image URL**: Find the primary/hero product image URL (the largest, clearest product photo — not a thumbnail).

6. **Capture a lifestyle/room image URL if available**: Many retailers show the product styled in a room setting. This is extremely valuable for understanding scale and style context.

## OUTPUT FORMAT
Return a JSON object:
{
  "title": "exact product name/title from page",
  "retailer": "store/brand name",
  "price": number or null (current sale price if on sale, otherwise regular price),
  "dimensions": {
    "width": number or null,
    "depth": number or null,
    "height": number or null,
    "diameter": number or null,
    "unit": "inches" or "cm"
  } or null,
  "materials": ["list of ALL materials mentioned — e.g. 'solid walnut', 'linen upholstery', 'brass hardware'"],
  "colors": ["list of ALL available colors/finishes — e.g. 'Natural Oak', 'Walnut', 'White'"],
  "category": "rug | coffee_table | accent_chair | dining_table | dining_chair | art | plant | floor_lamp | side_table | bookshelf | console_table | kitchen_runner | throw_pillow | throw_blanket | vase | candle | other",
  "description": "2-3 sentence description combining page text AND what you see in the product images — describe the actual visual appearance, texture, style",
  "image_url": "direct URL to the main/hero product image (full size, not thumbnail)" or null,
  "lifestyle_image_url": "direct URL to a lifestyle/room-setting image showing the product in context" or null,
  "visual_style_tags": ["3-5 style tags based on what you SEE in the images — e.g. 'modern', 'warm-toned', 'minimalist', 'organic-shapes', 'matte-finish'"],
  "available_variants": ["list of other color/material options available on this page — e.g. 'Also in: Charcoal, Cream, Navy'"] or []
}

## RULES
- Be accurate — do not hallucinate dimensions, prices, or materials.
- If information is not available, use null.
- For image URLs, try to get the full-size image URL, not a tiny thumbnail. Look at the src or data-src attributes of the main product image.
- The description should reflect what you actually SEE in the images, not just marketing copy.`;
}
