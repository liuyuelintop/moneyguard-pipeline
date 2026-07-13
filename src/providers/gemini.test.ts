import { describe, expect, it } from "vitest";
import { GeminiVisionProvider } from "./gemini.js";

describe("GeminiVisionProvider", () => {
  it("sends the validated MIME type in the inline image payload", async () => {
    const calls: unknown[] = [];
    const client = {
      models: {
        generateContent: async (request: unknown) => {
          calls.push(request);
          return {
            candidates: [
              {
                content: {
                  parts: [{ text: "{\"totalHours\":38,\"period\":\"2026-W27\",\"confidence\":\"high\"}" }],
                },
              },
            ],
          };
        },
      },
    };

    const provider = new GeminiVisionProvider("test-key", client);
    const result = await provider.vision(Buffer.from("synthetic image"), "prompt", "gemini-test", "image/png");

    expect(result).toEqual({ totalHours: 38, period: "2026-W27", confidence: "high" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      contents: [
        {
          parts: [
            { text: "prompt" },
            {
              inlineData: {
                mimeType: "image/png",
              },
            },
          ],
        },
      ],
      model: "gemini-test",
    });
  });
});
