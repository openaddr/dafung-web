import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
      "@render": resolve(__dirname, "src/render"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
