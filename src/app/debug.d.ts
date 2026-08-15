// window.__dafung 调试钩子类型声明(实现在 src/app/controllers/registry.ts 的 installDebugHooks)。
// 仅开发/控制台排查用;生产环境同样挂载(旧版行为),不参与渲染。
import type { GameEngine } from "@core/game";
import type { GameSnapshot } from "@app/store/gameStore";
import type { GameController } from "@app/controllers/controller";

declare global {
  interface Window {
    __dafung?: {
      /** 当前引擎实例(null = 未开局)。 */
      getEngine: () => GameEngine | null;
      /** 绑定/解绑引擎(调试恢复用)。 */
      setEngine: (e: GameEngine | null) => void;
      /** 当前 zustand store 里的快照。 */
      snapshot: () => GameSnapshot | null;
      /** 手动从引擎重灌快照到 store。 */
      sync: () => void;
      /** 当前控制器(交互入口)。 */
      controller: () => GameController | null;
    };
  }
}

export {};
