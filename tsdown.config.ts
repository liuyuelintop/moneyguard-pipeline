import { defineConfig } from "tsdown";

// Two entry points: the importable library barrel and the CLI binary.
// `@google/genai` stays external — it is a runtime dependency, not bundled.
export default defineConfig({
  entry: ["src/index.ts", "src/cli/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: { entry: "src/index.ts" },
  clean: true,
  external: ["@google/genai"],
});
