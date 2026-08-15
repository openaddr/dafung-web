// React 层入口(react-rewrite 分支)。原 vanilla 入口 src/main.ts 保留作对照,迁移完成后删除。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installDebugHooks } from "./controllers/registry";
import "./styles/app.css";

// window.__dafung 调试钩子(getEngine/snapshot/sync,重建旧 render/state.ts 的入口)
installDebugHooks();

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("#app 根元素缺失");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
