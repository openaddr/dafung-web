// window.__dafung 调试钩子类型声明(实现在 src/app/controllers/registry.ts 的 installDebugHooks)。
// 仅开发/控制台排查用;生产环境同样挂载(旧版行为),不参与渲染。
import type { GameEngine } from "@core/authority";
import type { HeroDef } from "@core/heroes";
import type { GameSnapshot } from "@app/store/gameStore";
import type { GameController } from "@app/controllers/controller";
import type { FrameDiagDump } from "@app/frameDiag";

declare global {
  interface Window {
    __dafung?: {
      /** 帧诊读取口(ADR-0047 消费面;scripts/frame-probe.ts 消费,只读不启停)。 */
      frameDiag: () => FrameDiagDump | null;
      /** 当前引擎实例(null = 未开局)。 */
      getEngine: () => GameEngine | null;
      /** 单机权威访问口(#1240 双口预置):直取单机房间权威引擎本体(force 注入/种植段
       *  专用,凡走此口即种植段);登记位在 controllers/registry.ts,联机对局/未开局
       *  无登记,调用抛错。 */
      getAuthorityEngine: () => GameEngine;
      /** 绑定/解绑引擎(调试恢复用)。 */
      setEngine: (e: GameEngine | null) => void;
      /** 当前 zustand store 里的快照。 */
      snapshot: () => GameSnapshot | null;
      /** 名将目录全量 HeroDef(含扩展包注册者;种植招贤候选用)。 */
      heroDefs: () => HeroDef[];
      /** 当前控制器(交互入口)。 */
      controller: () => GameController | null;
      /** 种局式快路径开局(#1211,e2e 专用):复刻 App.handleStart 生产三步(loadMapById →
       *  LocalController → setController/进 game 屏)+ 程序化选都(公共命令 setupPickCapital),
       *  缺省逐项对齐设置屏默认,机遇硬关。实现见 registry.ts installDebugHooks。 */
      seedSolo: (opts?: { seed?: number; mapId?: string; seats?: number }) => Promise<void>;
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
