# Fixtures

## `timecard.png`

A **synthetic** sample timecard (clearly-fake data: name "A. SAMPLE", a `RUNNING TOTAL`
column ending at `38.00`). It contains no real personal information and is safe to commit.

- **Mock path** (`moneyguard --mock`): the mock vision provider ignores image bytes entirely
  and returns a fixed OCR result, so this file is just a placeholder.
- **Live path** (`moneyguard fixtures/timecard.png` with real keys): the printed numbers are
  legible enough for the real OCR model to extract `38.00` as the largest running total.

## Using your own real timecard

Keep any real timecard photo as **`fixtures/timecard.local.png`** — the `*.local.*` pattern is
gitignored, so it never reaches the repo. Then point the CLI at it:

```bash
moneyguard fixtures/timecard.local.png      # live path, your real card stays local
```
