export function getMockupPrompt(
  roomType: string,
  diagnosisSummary: string,
  productDescriptions: string[],
  existingItems?: string[],
  designDirection?: string,
): string {
  const keepItems = existingItems && existingItems.length > 0
    ? existingItems.map((item, i) => `  ${i + 1}. ${item}`).join("\n")
    : "  (use the diagnosis summary to infer existing furniture)";

  return `Generate an image generation prompt for a room mockup.

## CONTEXT
- Room type: ${roomType}
- Current room state: ${diagnosisSummary}
${designDirection ? `- Design direction: ${designDirection}` : ""}
- Existing items to keep in the scene:
${keepItems}
- New products to visualize:
${productDescriptions.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}

## INSTRUCTIONS
Create a detailed, specific prompt for an AI image generator that would produce a realistic interior design visualization of this room with the selected products placed in it.

The prompt should:
1. Describe the room's architectural shell based on the diagnosis (floors, walls, windows, ceiling — use the actual details, do NOT assume)
2. Include the existing furniture that the user is keeping (from the list above)
3. Describe each new product's placement, color, material, and scale
4. Specify the lighting and mood (warm, inviting, evening or daytime)
5. Use photorealistic style direction

## OUTPUT FORMAT
Return a JSON object:
{
  "prompt": "the full image generation prompt",
  "negative_prompt": "what to avoid in the image",
  "style_notes": "any additional style guidance"
}`;
}
