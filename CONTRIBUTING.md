# Contributing

Thanks for your interest in MoneyGuard! This is a small, focused project — contributions that keep it that way are very welcome.

## Getting started

```bash
pnpm install
pnpm test          # offline, no API keys needed
pnpm exec tsc --noEmit
```

## Before opening a PR

- `pnpm test` and `pnpm exec tsc --noEmit` must pass (CI runs both plus `pnpm build`).
- Keep changes scoped; add a test for new behavior.
- Match the existing style — small comments only where logic is non-obvious.

## Architectural redlines

Three properties are intentional and load-bearing. Please don't regress them:

1. **Privacy boundary** (`src/payload.ts`, `src/metrics.ts`) — only tag-aggregated metrics and *derived* directives may leave the machine. Never forward raw amounts, item names, the hourly rate, or raw `context` values. The boundary is locked by a test in `src/pipeline.test.ts`.
2. **Stream-safe retry** (`src/resilience.ts`) — a live token stream is wrapped only by `streamWithConnectRetry` (retries connection establishment, never mid-stream). Re-running a live stream would replay tokens.
3. **Transport throttle** — streamed re-renders are gated to one per `1000ms` in the transport layer (CLI / Telegram), never in the pipeline.

## Adding a cost category

Add a tag to `COST_TAGS` in `src/schemas.ts`. Aggregation is tag-driven (`tags.includes(...)`), so no new `if` branches are needed.

## Privacy

Never commit real financial data or real timecards. Keep your real timecard as `fixtures/timecard.local.png` (gitignored) and your real ledger as `finance.json` (gitignored). Only the synthetic `finance.example.json` and `fixtures/timecard.png` are tracked.
