import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup-obsidian-globals.ts"],
    testTimeout: 20_000,
  },
});
