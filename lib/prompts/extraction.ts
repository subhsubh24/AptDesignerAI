export function getExtractionPrompt(): string {
  return `Extract structured product information from the provided content.

## INSTRUCTIONS
Parse the product page content or image and extract all available information.
If information is not available, use null.
Be accurate — do not hallucinate dimensions, prices, or materials.

## OUTPUT FORMAT
Return a JSON object:
{
  "title": "product name/title",
  "retailer": "store/brand name",
  "price": number or null,
  "dimensions": {
    "width": number or null,
    "depth": number or null,
    "height": number or null,
    "diameter": number or null,
    "unit": "inches" or "cm"
  } or null,
  "materials": ["list of materials mentioned"],
  "colors": ["list of colors/finishes"],
  "category": "rug | coffee_table | accent_chair | dining_table | dining_chair | art | plant | floor_lamp | side_table | bookshelf | console_table | kitchen_runner | throw_pillow | throw_blanket | vase | candle | other",
  "description": "brief product description",
  "image_url": "main product image URL if found" or null
}`;
}
