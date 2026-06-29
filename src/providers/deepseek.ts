import { DEFAULT_TEXT_MODEL } from "../config.js";
import type { AuditProvider } from "./types.js";

// DeepSeek audit adapter. Standard Instruct mode, non-thinking, streamed via SSE.
// The fetch + first chunk happen lazily on first `.next()`, so a connect failure
// surfaces before any token is yielded — exactly what streamWithConnectRetry needs.
export class DeepSeekAuditProvider implements AuditProvider {
  constructor(private readonly apiKey: string | undefined = process.env.DEEPSEEK_API_KEY) {}

  async *streamAudit(userPrompt: string, systemPrompt: string): AsyncGenerator<string> {
    const model = process.env.MONEY_GUARD_TEXT_MODEL ?? DEFAULT_TEXT_MODEL;
    console.log("[deepseek] streamAudit called. Model:", model);

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`DeepSeek error: ${response.status} ${response.statusText}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const rawChunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(rawChunk as Uint8Array, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data) as {
            choices: Array<{ delta: { content?: string } }>;
          };
          const content = json.choices[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }
  }
}
