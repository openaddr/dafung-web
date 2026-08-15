import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
      "@app": resolve(__dirname, "src/app"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
