import { defineConfig } from "tsdown";

// Entry points: the importable library barrel, CLI binary, and Render HTTP binary.
// `@google/genai` stays external — it is a runtime dependency, not bundled.
export default defineConfig({
  entry: ["src/index.ts", "src/cli/main.ts", "src/http/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: { entry: "src/index.ts" },
  clean: true,
  external: ["@google/genai"],
});
