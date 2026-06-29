import { runMoneyGuardPipeline } from "../../src/index.js";
import { toUserMessage } from "../../src/resilience.js";

// This is the ORIGINAL real-world transport, lifted verbatim in spirit from the
// OpenClaw Telegram plugin. It demonstrates how thin a transport adapter is once
// the pipeline is decoupled: it owns ONLY the placeholder reply, the 1000ms edit
// throttle, and user-facing error mapping. All domain logic stays in the pipeline.

const THROTTLE_MS = 1000;

/**
 * Minimal chat surface the adapter needs. Any bot framework (grammY, Telegraf,
 * node-telegram-bot-api) can satisfy this with a few lines — no framework type
 * leaks into MoneyGuard.
 */
export interface ChatTransport {
  reply: (text: string) => Promise<{ message_id: number }>;
  editMessage: (messageId: number, text: string) => Promise<void>;
}

export const moneyGuardSkill = {
  name: "money_guard",
  description: "Vision-based wage parsing and strategic financial auditing.",

  async execute(imageBuffer: Buffer, chat: ChatTransport): Promise<void> {
    const debug = process.env.MONEY_GUARD_DEBUG === "true";
    if (debug) console.log("[moneyGuard] start");

    // Step 0: instant acknowledgment (<200ms TTFF)
    const placeholder = await chat.reply("Analyzing your timecard... ⏳");
    let lastEdit = 0;

    try {
      const result = await runMoneyGuardPipeline(imageBuffer, {
        // Telegram rate-limit protection: throttle streamed edits, always apply the final one.
        onReportUpdate: async (text, final) => {
          const now = Date.now();
          if (final || now - lastEdit >= THROTTLE_MS) {
            await chat.editMessage(placeholder.message_id, text);
            lastEdit = now;
          }
        },
      });

      if (!result.ok) {
        await chat.editMessage(placeholder.message_id, result.message);
      }
      if (debug) console.log(`[moneyGuard] finish ok=${result.ok}`);
    } catch (err) {
      console.error("[moneyGuard] adapter failure:", err);
      await chat.editMessage(placeholder.message_id, toUserMessage(err)).catch(() => {});
    }
  },
};
