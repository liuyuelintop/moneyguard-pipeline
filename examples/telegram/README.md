# Telegram example

`adapter.ts` is the **real-world transport** MoneyGuard was extracted from — the thin
glue that wires the channel-agnostic pipeline to a Telegram bot. It exists here to show
two things at a glance:

1. **How little a transport owns.** The adapter handles only the placeholder reply, the
   **1000ms edit throttle** (Telegram HTTP 429 protection), and user-facing error text.
   Every piece of domain logic — OCR, de-identification, metrics, audit streaming — lives
   in the pipeline and is reused untouched.
2. **No framework leakage.** The adapter depends on a tiny `ChatTransport` interface
   (`reply` + `editMessage`), not on any bot library. MoneyGuard never imports a Telegram type.

## Wiring it to a real bot (grammY)

```ts
import { Bot } from "grammy";
import { moneyGuardSkill } from "./adapter.js";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

bot.on("message:photo", async (ctx) => {
  const file = await ctx.getFile();
  const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
  const imageBuffer = Buffer.from(await (await fetch(url)).arrayBuffer());

  const chat = {
    reply: async (text: string) => {
      const m = await ctx.reply(text);
      return { message_id: m.message_id };
    },
    editMessage: async (messageId: number, text: string) => {
      await ctx.api.editMessageText(ctx.chat.id, messageId, text).catch(() => {});
    },
  };

  await moneyGuardSkill.execute(imageBuffer, chat);
});

bot.start();
```

The bot needs `GEMINI_API_KEY` and `DEEPSEEK_API_KEY` (or set `MONEYGUARD_MOCK=1` to demo
without keys), plus a `finance.json` in the working directory.
