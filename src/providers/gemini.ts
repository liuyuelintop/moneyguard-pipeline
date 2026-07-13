import { GoogleGenAI } from "@google/genai";
import { DEFAULT_VISION_MODEL } from "../config.js";
import { DEFAULT_IMAGE_MIME_TYPE, type SupportedImageMimeType } from "../image.js";
import { logSafeError } from "../safe-log.js";
import type { VisionProvider } from "./types.js";

interface GeminiGenerateContentRequest {
  model: string;
  contents: Array<{
    parts: Array<
      | { text: string }
      | {
          inlineData: {
            data: string;
            mimeType: SupportedImageMimeType;
          };
        }
    >;
  }>;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

interface GeminiClient {
  models: {
    generateContent(request: GeminiGenerateContentRequest): Promise<GeminiGenerateContentResponse>;
  };
}

// Gemini vision adapter. Returns raw parsed JSON (unknown — caller validates with
// Zod), or null when the model produced no parseable text. Transient API errors
// (429/5xx) are NOT caught here: they propagate so the caller's retry/backoff acts.
export class GeminiVisionProvider implements VisionProvider {
  private readonly client: GeminiClient;

  constructor(apiKey: string | undefined = process.env.GEMINI_API_KEY, client?: GeminiClient) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async vision(
    imageBuffer: Buffer,
    prompt: string,
    model: string = process.env.MONEY_GUARD_VISION_MODEL ?? DEFAULT_VISION_MODEL,
    mimeType: SupportedImageMimeType = DEFAULT_IMAGE_MIME_TYPE,
  ): Promise<unknown> {
    if (process.env.MONEY_GUARD_DEBUG === "true") {
      console.log("gemini.vision called. MIME:", mimeType);
    }

    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: imageBuffer.toString("base64"),
                mimeType,
              },
            },
          ],
        },
      ],
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) {
      logSafeError("provider_invalid_response");
      return null;
    }

    // Strip markdown code fences (e.g. ```json ... ```) in case the model wraps output
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    try {
      return JSON.parse(jsonMatch ? jsonMatch[0] : stripped);
    } catch {
      logSafeError("provider_invalid_response");
      return null;
    }
  }
}
