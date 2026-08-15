import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
      "@render": resolve(__dirname, "src/render"),
      "@app": resolve(__dirname, "src/app"),
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
    // vite 打包产物(JS/CSS/chunk)输出到 dist/bundles/,避免与游戏素材目录 dist/assets/
    // (manifest.json / heroes/ / treasures/,来自 public/assets/)同名混放。
    assetsDir: "bundles",
    rollupOptions: {
      output: {
        // three.js + cannon-es 拆独立 chunk:浏览器并行加载 + 长期缓存(改游戏代码不重下引擎)
        manualChunks: { three: ["three"], cannon: ["cannon-es"] },
      },
    },
  },
});
