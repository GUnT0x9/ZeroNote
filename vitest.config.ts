import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/server/**/*.test.ts",
      "apps/web/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@zeronote/shared": new URL(
        "./packages/shared/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
