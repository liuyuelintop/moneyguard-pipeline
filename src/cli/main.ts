#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { loadConfig } from "../config.js";
import { runMoneyGuardPipeline } from "../pipeline.js";
import { selectProviders } from "../providers/index.js";
import { logSafeError } from "../safe-log.js";

// Telegram rate-limit protection lives in the TRANSPORT, never the pipeline. The
// CLI is just another transport: it throttles streamed re-renders to one per
// THROTTLE_MS and always applies the final render. Same contract as the Telegram
// editMessage adapter — proof the 1000ms throttle is a transport concern, not domain.
const THROTTLE_MS = 1000;

const HELP = `moneyguard — vision→reasoning wage audit

Usage:
  moneyguard [options] [image]

Arguments:
  image                 Path to a timecard image (default: fixtures/timecard.png)

Options:
  --mock                Use deterministic offline providers (no API keys needed)
  --debug               Safe diagnostics without payloads, headers, secrets, or env values
  -h, --help            Show this help

Environment:
  GEMINI_API_KEY, DEEPSEEK_API_KEY     required for the live path
  MONEY_GUARD_VISION_MODEL             default: gemini-2.5-flash
  MONEY_GUARD_TEXT_MODEL               default: deepseek-v4-flash

The local ledger is read from ./finance.json (falls back to ./finance.example.json).`;

// Minimal zero-dependency .env loader so `GEMINI_API_KEY=... ` in .env just works.
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function resolveFinancePath(preferred: string): string {
  if (fs.existsSync(preferred)) return preferred;
  const example = path.resolve(process.cwd(), "finance.example.json");
  if (fs.existsSync(example)) {
    console.error("Preferred finance config not found; using example config.");
    return example;
  }
  return preferred; // let the pipeline surface the clean "config" error
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(HELP);
    return;
  }

  const mock = args.includes("--mock");
  const debug = args.includes("--debug");
  if (mock) process.env.MONEYGUARD_MOCK = "1";
  if (debug) process.env.MONEY_GUARD_DEBUG = "true";

  const positional = args.filter((a) => !a.startsWith("-"));
  const imageArg = positional[0] ?? path.resolve(process.cwd(), "fixtures/timecard.png");

  loadDotEnv();

  const imagePath = path.resolve(process.cwd(), imageArg);
  if (!fs.existsSync(imagePath)) {
    console.error("Image not found.");
    process.exitCode = 1;
    return;
  }
  const imageBuffer = await fs.promises.readFile(imagePath);

  const config = loadConfig();
  config.financePath = resolveFinancePath(config.financePath);
  const providers = selectProviders(config);

  const isTty = Boolean(process.stdout.isTTY);
  console.error(`\nMoneyGuard ${mock ? "(mock)" : "(live)"} — analyzing image...\n`);

  let lastEdit = 0;
  const render = (text: string): void => {
    if (isTty) process.stdout.write(`\x1b[2J\x1b[H${text}\n`);
    else process.stdout.write(`${text}\n\n`);
  };

  const result = await runMoneyGuardPipeline(imageBuffer, {
    providers,
    config,
    // Throttle streamed re-renders; always apply the final one. Mirrors the
    // Telegram editMessage throttle exactly — same THROTTLE_MS contract.
    onReportUpdate: async (text, final) => {
      const now = Date.now();
      if (final || now - lastEdit >= THROTTLE_MS) {
        render(text);
        lastEdit = now;
      }
    },
  });

  if (!result.ok) {
    console.error(`\n❌ ${result.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  logSafeError("fatal_unexpected_failure");
  process.exitCode = 1;
});
