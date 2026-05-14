import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/_fixtures/**", "test-integration/**", "node_modules/**"],
    testTimeout: 5000,
  },
});
