export function getMockupPrompt(
  roomType: string,
  diagnosisSummary: string,
  productDescriptions: string[],
  existingItems?: string[],
  designDirection?: string,
  buildingResearch?: Record<string, unknown>,
  mockupContext?: {
    palette?: string[];
    materials?: string[];
    textures?: string[];
    spatialLayout?: string;
    lightingConditions?: string;
    windowDoorPositions?: string;
    priorities?: string[];
    userContext?: string;
  },
): string {
  const keepItems = existingItems && existingItems.length > 0
    ? existingItems.map((item, i) => `  ${i + 1}. ${item}`).join("\n")
    : "  (use the diagnosis summary to infer existing furniture)";

  // Extract specific finishes from building research
  let finishesBlock = "";
  if (buildingResearch) {
    const lines: string[] = [];
    const finishes = buildingResearch.finishes as Record<string, string> | undefined;
    if (finishes) {
      if (finishes.flooring) lines.push(`Flooring: ${finishes.flooring}`);
      if (finishes.countertops) lines.push(`Countertops: ${finishes.countertops}`);
      if (finishes.cabinetry) lines.push(`Cabinetry: ${finishes.cabinetry}`);
      if (finishes.appliances) lines.push(`Appliances: ${finishes.appliances}`);
      if (finishes.fixtures) lines.push(`Fixtures: ${finishes.fixtures}`);
    }
    if (buildingResearch.windows) lines.push(`Windows: ${buildingResearch.windows}`);
    if (buildingResearch.ceiling_height) lines.push(`Ceiling height: ${buildingResearch.ceiling_height}`);
    if (buildingResearch.layout_style) lines.push(`Layout: ${buildingResearch.layout_style}`);
    if (buildingResearch.building_style) lines.push(`Building style: ${buildingResearch.building_style}`);

    const fp = buildingResearch.floor_plan as Record<string, unknown> | undefined;
    if (fp) {
      const dims = fp.room_dimensions as Record<string, string> | undefined;
      const roomDim = dims?.[roomType] || dims?.living_room;
      if (roomDim) lines.push(`Room dimensions: ~${roomDim}`);
    }

    if (lines.length > 0) {
      finishesBlock = `\n- ACTUAL APARTMENT FINISHES (from building research — these are real, use them exactly):
${lines.map((l) => `  - ${l}`).join("\n")}`;
    }
  }

  // Build extra context sections from mockupContext
  let extraContext = "";
  if (mockupContext) {
    const sections: string[] = [];
    if (mockupContext.palette?.length) sections.push(`- Color palette: ${mockupContext.palette.join(", ")}`);
    if (mockupContext.materials?.length) sections.push(`- Materials: ${mockupContext.materials.join(", ")}`);
    if (mockupContext.textures?.length) sections.push(`- Textures: ${mockupContext.textures.join(", ")}`);
    if (mockupContext.spatialLayout) sections.push(`- Spatial layout: ${mockupContext.spatialLayout}`);
    if (mockupContext.lightingConditions) sections.push(`- Lighting conditions: ${mockupContext.lightingConditions}`);
    if (mockupContext.windowDoorPositions) sections.push(`- Window/door positions: ${mockupContext.windowDoorPositions}`);
    if (mockupContext.priorities?.length) sections.push(`- Client priorities: ${mockupContext.priorities.join(", ")}`);
    if (mockupContext.userContext) sections.push(`- User notes: "${mockupContext.userContext}"`);
    if (sections.length > 0) extraContext = `\n${sections.join("\n")}`;
  }

  return `Generate an image generation prompt for a room mockup.

## CONTEXT
- Room type: ${roomType}
- Current room state: ${diagnosisSummary}
${designDirection ? `- Design direction: ${designDirection}` : ""}${finishesBlock}${extraContext}
- Existing items to keep in the scene:
${keepItems}
- New products to visualize:
${productDescriptions.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}

## PROCESS — Follow these steps:
Step 1: Study the room photos. Note exact floor material+color, wall color, window positions, ceiling height.
Step 2: Note which existing furniture stays and where it sits.
Step 3: Plan where each new product goes — specific position, size, material, color.
Step 4: Write the prompt starting with room shell, then existing furniture, then new products, then lighting.

## INSTRUCTIONS
Create a detailed, specific prompt for an AI image generator that will produce a photorealistic mockup of this room with the new products placed in it.

The prompt MUST:
1. Describe the room's EXACT architectural shell as seen in the reference photos — be specific about:
   - Floor material, color, and pattern (e.g. "light oak wide-plank hardwood" not just "wood floor")
   - Wall color and finish (e.g. "warm white matte walls" not just "white walls")
   - Window style, size, and position (e.g. "two tall double-hung windows on the left wall with white trim")
   - Ceiling height and details (e.g. "standard 9ft ceilings with simple white crown molding")
2. Include the existing furniture the user is keeping — describe their position, color, and material
3. Describe each NEW product placed naturally in the room — include color, material, size, and placement
4. Specify warm, natural lighting consistent with the actual window positions
5. Use photorealistic, editorial interior photography style (like Architectural Digest)

The prompt must NOT:
- Change the room shell (walls, floors, ceiling, windows must match the real room)
- Use generic descriptions ("modern room") instead of specific ones ("9x12 living room with light oak floors")
- Add architectural features not in the reference photos
- Change the room proportions or layout

## OUTPUT FORMAT
Return a JSON object:
{
  "prompt": "the full image generation prompt — start with the room shell description, then existing furniture, then new products, then lighting/mood",
  "negative_prompt": "unrealistic proportions, changed wall color, different flooring, cartoon style, CGI render look, oversized furniture, generic stock photo, different window style",
  "style_notes": "any additional style guidance"
}`;
}
