import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import type { AgentResult } from "./types";

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  revisedAnalysis?: Record<string, unknown>;
}

/**
 * Validation agent that checks analysis consistency and confidence.
 * Uses Gemini with high thinking level for deep reasoning.
 */
export async function validateAnalysis(
  analysisType: "room_diagnosis" | "product_search" | "bundle",
  analysis: Record<string, unknown>,
  context: {
    buildingResearch?: Record<string, unknown>;
    apartmentAnalysis?: Record<string, unknown>;
    roomImages?: string[];
    userAesthetic?: string;
  }
): Promise<AgentResult<ValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt();

  const validationPrompt = `You are a validation agent. Your job is to critically review an AI analysis for consistency, accuracy, and holistic sense.

## ANALYSIS TYPE
${analysisType}

## ANALYSIS TO VALIDATE
${JSON.stringify(analysis, null, 2)}

## CONTEXT
${context.buildingResearch ? `Building research: ${JSON.stringify(context.buildingResearch)}` : ""}
${context.apartmentAnalysis ? `Apartment analysis: ${JSON.stringify(context.apartmentAnalysis)}` : ""}
${context.userAesthetic ? `User aesthetic: ${context.userAesthetic}` : ""}

## VALIDATION CHECKLIST
1. Does the analysis make holistic sense? Are there internal contradictions?
2. Are recommendations consistent with the user's aesthetic preferences?
3. Are item descriptions specific enough? (materials, colors, dimensions, finishes)
4. Do the recommended items actually fit together as a cohesive set?
5. Are there any hallucinated or unrealistic recommendations?
6. Is the confidence justified given the available information?
7. Would a professional interior designer agree with this analysis?

## OUTPUT FORMAT
Return JSON:
{
  "isValid": true/false,
  "confidence": 0-10 (how confident you are the analysis is correct),
  "issues": ["list of specific problems found"],
  "suggestions": ["list of specific improvements"],
  "revisedAnalysis": null or { revised version if confidence < 7 }
}`;

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: validationPrompt }],
      max_tokens: 4096,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as ValidationResult;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Validation failed",
    };
  }
}

/**
 * Validate a set of product search results holistically.
 * Checks that all items work together across tiers.
 */
export async function validateProductSet(
  products: Array<{
    title: string;
    category: string;
    tier: string;
    materials?: string[];
    colors?: string[];
    price?: number;
    description?: string;
  }>,
  roomContext: {
    roomType: string;
    designDirection: string;
    existingItems: string[];
  }
): Promise<AgentResult<ValidationResult>> {
  const model = selectModel("validation");
  const system = getSystemPrompt();

  const prompt = `Validate this set of product search results. Check that:
1. Every item description is detailed enough (specific materials, exact colors with undertones, dimensions)
2. All items within each tier work together aesthetically
3. Items match the room's design direction
4. Budget/Middle/Luxury tiers have appropriate price differentiation
5. No duplicate or near-duplicate products across tiers
6. All items fit with existing furniture

## ROOM CONTEXT
- Room type: ${roomContext.roomType}
- Design direction: ${roomContext.designDirection}
- Existing items: ${roomContext.existingItems.join(", ")}

## PRODUCTS TO VALIDATE
${JSON.stringify(products, null, 2)}

Return JSON:
{
  "isValid": true/false,
  "confidence": 0-10,
  "issues": ["specific problems"],
  "suggestions": ["specific improvements"]
}`;

  try {
    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "medium" },
      responseMimeType: "application/json",
    });

    const parsed = JSON.parse(response.content) as ValidationResult;
    return {
      success: true,
      data: parsed,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Product set validation failed",
    };
  }
}
