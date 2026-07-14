import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiVisionProvider } from "./gemini.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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

  it.each([429, 503])(
    "propagates a transient %s failure to the wrapper policy",
    async (status) => {
      const generateContent = async () => {
        throw Object.assign(new Error("private provider detail"), { status });
      };
      const client = {
        models: {
          generateContent: vi.fn(generateContent),
        },
      };
      const provider = new GeminiVisionProvider("test-key", client);

      await expect(
        provider.vision(
          Buffer.from("synthetic image"),
          "prompt",
          "gemini-test",
          "image/png",
        ),
      ).rejects.toMatchObject({ status });
      expect(client.models.generateContent).toHaveBeenCalledTimes(1);
      expect(client.models.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-test" }),
      );
    },
  );

  it("keeps debug diagnostics payload-free", async () => {
    vi.stubEnv("MONEY_GUARD_DEBUG", "true");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const client = {
      models: {
        generateContent: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "{\"totalHours\":38,\"period\":\"2026-W27\",\"confidence\":\"high\"}",
                  },
                ],
              },
            },
          ],
        }),
      },
    };
    const provider = new GeminiVisionProvider("test-key", client);

    await provider.vision(
      Buffer.from("private image bytes"),
      "private prompt",
      "gemini-test",
      "image/png",
    );

    expect(consoleLog).toHaveBeenCalledWith(
      "[moneyGuard] gemini_vision_started",
    );
    expect(JSON.stringify(consoleLog.mock.calls)).not.toMatch(
      /private|image\/png|prompt|bytes/,
    );
  });
});
