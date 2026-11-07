import { defineConfig } from "vite";
import pkg from "./package.json";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 发版号(用户拍板 2026-11-01 #952:构建戳全链退役——同日 #981「两把尺」口径随之
// 翻面,诊断包 build 字段与文件名戳一并退役,ADR-0047 已修订)。
// 单源 package.json 的 CalVer version,构建期注入 __APP_VERSION__:设置弹层「版本」行、
// 主页角落小字、诊断包三方消费;与 Release tag(v 前缀)、APK versionName 同值
// (release.ts 对账闸兜真)。
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
        // manualChunks 三分(#1273,与 GameScreen React.lazy 配套):
        //   vendor = 三方运行时(react/react-dom/zustand/tauri 插件);
        //   ui     = 弹层原语族(@base-ui/tailwind-merge/floating-ui/clsx)——主页/
        //           设置屏也消费 dialog/switch/scroll-area,本 chunk 仍随入口加载,
        //           拆出只为缓存粒度;对局屏独占的 tooltip 原语让 Rollup 自然归入
        //           GameScreen 异步 chunk(不人为拖回首包);
        //   core   = 权威引擎 + 进程内房间编排(src/core + scripts/room|wire,零 DOM
        //           可上服务器的一侧)。
        // src/app 其余模块按引用关系自然分屏 chunk(GameScreen 懒化后即异步)。
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("@base-ui/react/tooltip")) return undefined;
            if (
              id.includes("@base-ui") || // @base-ui/react + @base-ui/utils 同族,拆开会造 ui<->vendor 环
              id.includes("tailwind-merge") ||
              id.includes("@floating-ui") ||
              id.includes("clsx")
            ) {
              return "ui";
            }
            return "vendor";
          }
          if (id.includes("/src/core/") || id.includes("/scripts/")) return "core";
          return undefined;
        },
      },
    },
  },
});
