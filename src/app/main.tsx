// React 层入口(react-rewrite 分支)。原 vanilla 入口 src/main.ts 保留作对照,迁移完成后删除。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installDebugHooks } from "./controllers/registry";
import { loadInstalledExtensionPackages } from "./extensions/loader";
import "./styles/app.css";

// window.__dafung 调试钩子(getEngine/snapshot/sync,重建旧 render/state.ts 的入口)
installDebugHooks();

// 扩展包装载(#378,ADR-0022):先于首帧——单机/联机同一路径,任何引擎构造前
// 名将池与客户端扩展面(动画/渲染)即全量;零包环境为空表,行为与无扩展完全一致。
await loadInstalledExtensionPackages();

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("#app 根元素缺失");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
