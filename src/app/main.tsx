// React 层入口(react-rewrite 分支)。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { E2E_BOT_STEP_MS_KEY, E2E_DEBUG_BRIDGE_KEY, E2E_TIME_SCALE_KEY } from "./fx/timings";
import { targetDemo } from "./screens/game/TargetDecision.prototype";
import { installDebugHooks } from "./controllers/registry";
import { loadInstalledExtensionPackages } from "./extensions/loader";
import "./styles/app.css";
// 纯 opacity 演出原语(fx-fade-in/out、fx-breathe)单源,全屏共用一次导入
import "./styles/motion.css";

if (targetDemo != null) {
  localStorage.setItem(E2E_DEBUG_BRIDGE_KEY, "1");
  localStorage.setItem(E2E_BOT_STEP_MS_KEY, "0");
  localStorage.removeItem(E2E_TIME_SCALE_KEY);
}

// window.__dafung 调试钩子(getEngine/snapshot/sync,重建旧 render/state.ts 的入口)
installDebugHooks();

// 扩展包装载(#378,ADR-0022):先于首帧——单机/联机同一路径,任何引擎构造前
// 名将池与客户端扩展面(动画/渲染)即全量;零包环境为空表,行为与无扩展完全一致。
await loadInstalledExtensionPackages();
if (targetDemo != null) {
  const { startTargetSelectionDemo } = await import("./screens/game/TargetSelectionDemo.prototype");
  await startTargetSelectionDemo(targetDemo);
}

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("#app 根元素缺失");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
