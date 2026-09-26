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
    // 联机 API 反代到引擎服务器(bun run dev 编排起 scripts/server.ts,dev 专用 :3001,
    // 刻意错开 serve 的 3000,二者可并存)。前端联机地址取 location.origin(App.tsx),
    // 代理后 dev 端口同源可玩联机,零配置。只代理引擎命名空间(/room /ws /health /help);
    // /assets /fonts /maps /config 由 vite 从 public/ 直出,不得进代理。env 可覆盖:DEV_ENGINE_URL。
    proxy: (() => {
      const engine = process.env.DEV_ENGINE_URL ?? "http://127.0.0.1:3001";
      return {
        "/room": { target: engine, changeOrigin: true },
        "/ws": { target: engine, ws: true, changeOrigin: true },
        "/health": { target: engine, changeOrigin: true },
        "/help": { target: engine, changeOrigin: true },
      };
    })(),
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
