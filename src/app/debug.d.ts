// window.__dafung 调试钩子类型声明(实现在 src/app/controllers/registry.ts 的 installDebugHooks)。
// 仅开发/控制台排查用;生产环境同样挂载(旧版行为),不参与渲染。
import type { GameEngine } from "@core/authority";
import type { HeroDef } from "@core/heroes";
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
      /** 名将目录全量 HeroDef(含扩展包注册者;种植招贤候选用)。 */
      heroDefs: () => HeroDef[];
      /** 当前控制器(交互入口)。 */
      controller: () => GameController | null;
      /** 房间时钟冻结闸(#421 调试观测面):冻结期间看门狗/自动起摇/慢速托管的
       *  到点回调挂起;resume 按到点序补放。仅单机对局可冻结(无 Worker 时钟抛错)。 */
      clockPause: () => void;
      clockResume: () => void;
    };
  }
}

export {};
