import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts", "src/analysis-worker.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  external: ["electron", "better-sqlite3"],
  noExternal: [/^@project-xray\//, /^zod$/],
});
