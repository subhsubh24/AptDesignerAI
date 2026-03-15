export function getMockupPrompt(roomType: string, diagnosisSummary: string, productDescriptions: string[]): string {
  return `Generate an image generation prompt for a room mockup.

## CONTEXT
- Room type: ${roomType}
- Current room state: ${diagnosisSummary}
- Selected products to visualize:
${productDescriptions.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}

## INSTRUCTIONS
Create a detailed, specific prompt for an AI image generator (like DALL-E) that would produce a realistic interior design visualization of this room with the selected products placed in it.

The prompt should:
1. Describe the room's architectural shell (grey wood floors, white walls, large windows, modern apartment)
2. Include the existing furniture (dark gray sectional sofa, arc floor lamp)
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
