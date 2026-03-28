import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import type {
  AIProvider,
  AIMessage,
  AIResponse,
  AIContentBlock,
  GeminiTool,
} from "./provider";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }
  return client;
}

/**
 * Fetch an image URL and return base64-encoded data.
 */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  // Handle relative URLs by reading directly from the local filesystem
  if (url.startsWith("/uploads/")) {
    const filePath = path.join(process.cwd(), "public", url);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Local image not found: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.byteLength === 0) {
      throw new Error(`Local image is empty: ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { data: buffer.toString("base64"), mimeType };
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": new URL(url).origin + "/",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  // Reject responses that aren't actually images (e.g., HTML 404 pages, redirects to login)
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Image URL returned non-image content-type: ${contentType} for ${url}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error(`Image fetch returned empty data for ${url}`);
  }
  const data = Buffer.from(buffer).toString("base64");
  return { data, mimeType: contentType.split(";")[0].trim() };
}

/**
 * Convert our abstract AIMessage[] to Gemini content parts.
 */
async function convertMessages(
  messages: AIMessage[]
): Promise<{ role: string; parts: Record<string, unknown>[] }[]> {
  const result: { role: string; parts: Record<string, unknown>[] }[] = [];

  let totalImages = 0;
  let failedImages = 0;

  for (const msg of messages) {
    const parts: Record<string, unknown>[] = [];

    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else {
      for (const block of msg.content) {
        if (block.type === "image" && block.source) {
          totalImages++;
          if (block.source.type === "base64" && block.source.data) {
            parts.push({
              inlineData: {
                mimeType: block.source.media_type || "image/jpeg",
                data: block.source.data,
              },
            });
          } else if (block.source.type === "url" && block.source.url) {
            try {
              const { data, mimeType } = await fetchImageAsBase64(block.source.url);
              parts.push({
                inlineData: { mimeType, data },
              });
            } catch (err) {
              failedImages++;
              console.error(`[gemini] Failed to fetch image: ${block.source.url}`, err instanceof Error ? err.message : err);
            }
          }
        } else if (block.type === "text" && block.text) {
          parts.push({ text: block.text });
        }
      }
    }

    result.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  // If ALL images failed, throw so the caller knows analysis would be blind
  if (totalImages > 0 && failedImages === totalImages) {
    throw new Error(
      `All ${totalImages} image(s) failed to load. Cannot proceed with analysis without visual input. Check that image URLs are accessible.`
    );
  }

  if (failedImages > 0) {
    console.warn(`[gemini] ${failedImages}/${totalImages} images failed to load — proceeding with partial visual context`);
  }

  return result;
}

/**
 * Convert our tool definitions to Gemini format.
 */
function convertTools(tools?: GeminiTool[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools as Record<string, unknown>[];
}

export const geminiProvider: AIProvider = {
  async chat({
    model,
    system,
    messages,
    max_tokens = 4000,
    temperature = 0.3,
    tools,
    responseSchema,
    responseMimeType,
    thinkingConfig,
    responseModalities,
  }): Promise<AIResponse> {
    const ai = getClient();
    const contents = await convertMessages(messages);

    // Build config
    const config: Record<string, unknown> = {
      maxOutputTokens: max_tokens,
      temperature,
    };

    if (system) {
      config.systemInstruction = system;
    }

    if (tools) {
      config.tools = convertTools(tools);
    }

    if (responseMimeType) {
      config.responseMimeType = responseMimeType;
    }

    if (responseSchema) {
      config.responseSchema = responseSchema;
      // Auto-set mime type for JSON schema responses
      if (!responseMimeType) {
        config.responseMimeType = "application/json";
      }
    }

    if (thinkingConfig) {
      config.thinkingConfig = thinkingConfig;
    }

    if (responseModalities) {
      config.responseModalities = responseModalities;
    }

    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
    } catch (err) {
      const e = err as Record<string, unknown>;
      console.error(`[gemini] API error for model=${model}:`, JSON.stringify({
        name: e.name,
        status: e.status,
        message: e.message || (err instanceof Error ? err.message : "unknown"),
        details: e.details || e.errorDetails,
      }, null, 2));
      throw err;
    }

    // Extract text content
    let content = "";
    let imageData: { mimeType: string; data: string } | undefined;

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          const p = part as Record<string, unknown>;
          if (p.text) {
            content += p.text as string;
          }
          if (p.inlineData) {
            const inline = p.inlineData as { mimeType: string; data: string };
            imageData = {
              mimeType: inline.mimeType,
              data: inline.data,
            };
          }
        }
      }
    }

    // Fallback to response.text if available
    if (!content && response.text) {
      content = response.text;
    }

    // Extract grounding metadata
    let groundingMetadata: AIResponse["groundingMetadata"];
    if (response.candidates?.[0]) {
      const candidate = response.candidates[0] as Record<string, unknown>;
      const gm = candidate.groundingMetadata as Record<string, unknown> | undefined;
      if (gm?.groundingChunks) {
        const chunks = gm.groundingChunks as Array<{ web?: { uri: string; title: string } }>;
        groundingMetadata = {
          sources: chunks
            .filter((c) => c.web)
            .map((c) => ({
              uri: c.web!.uri,
              title: c.web!.title || "",
            })),
        };
      }
    }

    // Detect truncation — response was cut off due to max_tokens
    const finishReason = response.candidates?.[0]?.finishReason as string | undefined;
    const truncated = finishReason === "MAX_TOKENS";
    if (truncated) {
      console.warn(`[gemini] ⚠️ Response TRUNCATED (MAX_TOKENS) for model=${model}. Increase max_tokens for this call.`);
    }

    // Extract usage — include thinking tokens for accurate cost tracking
    const usageMetadata = response.usageMetadata as Record<string, number> | undefined;
    const thinkingTokens = usageMetadata?.thoughtsTokenCount || 0;

    if (thinkingTokens > 0) {
      console.log(`[gemini] Thinking tokens: ${thinkingTokens}, Output tokens: ${usageMetadata?.candidatesTokenCount || 0}`);
    }

    return {
      content,
      model,
      usage: {
        input_tokens: usageMetadata?.promptTokenCount || 0,
        output_tokens: usageMetadata?.candidatesTokenCount || 0,
        thinking_tokens: thinkingTokens,
      },
      truncated,
      groundingMetadata,
      imageData,
    };
  },
};
