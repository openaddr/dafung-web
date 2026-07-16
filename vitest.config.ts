import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
      "@render": resolve(__dirname, "src/render"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
