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
      /** 房间时钟冻结闸(#421 调试观测面):冻结期间看门狗/自动起摇/托管步进的
       *  到点回调挂起;resume 按到点序补放。仅单机对局可冻结(无 Worker 时钟抛错)。 */
      clockPause: () => void;
      clockResume: () => void;
      /** 落后即校准诊断计数(#610,ADR-0029 ③;只读快照,累计值——实体现在
       *  fx/catchup.ts catchupCounters):laggy/catchup/snap 分类计数 + 末次判据
       *  依据(游标差/批龄/生效倍率),e2e 可断言、现场排查可取。 */
      fxCatchup: () => {
        laggyBatches: number;
        catchupBatches: number;
        snapBatches: number;
        lastGapBatches: number;
        lastWaitMs: number;
        lastRuntimeScale: number;
      };
    };
  }
}

export {};
