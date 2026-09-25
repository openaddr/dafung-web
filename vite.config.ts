import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 构建戳(用户拍板 2026-09-26:版本角标直接用年月日时分,如 v2026.09.26.0102)。
// 取构建发生的本地时刻——页面角标一眼可辨「这是哪次构建」,serve 常驻时端旧 dist 立现。
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const BUILD_STAMP = `v${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}.${pad(now.getHours())}${pad(now.getMinutes())}`;

export default defineConfig({
  define: {
    __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@core": resolve(__dirname, "src/core"),
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
