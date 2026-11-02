import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: { alias: { "@": path.resolve(__dirname), "server-only": path.resolve(__dirname, "test/empty.ts") } },
  test: { include: ["test/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false },
});
