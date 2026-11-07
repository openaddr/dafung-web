// window.__dafung 调试钩子类型声明(实现在 src/app/controllers/registry.ts 的 installDebugHooks)。
// 仅开发/控制台排查用;生产环境同样挂载(旧版行为),不参与渲染。
import type { GameEngine, TurnPhase } from "@core/authority";
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
      /** 种局式快路径开局(#1211,e2e 专用):复刻 App.handleStart 生产三步(loadMapById →
       *  LocalController → setController/进 game 屏)+ 程序化选都(公共命令 setupPickCapital),
       *  缺省逐项对齐设置屏默认,机遇硬关。实现见 registry.ts installDebugHooks。 */
      seedSolo: (opts?: { seed?: number; mapId?: string; seats?: number }) => Promise<void>;
      /** 中盘构造器(ADR-0059 示导波,#1252):seedSolo 同款开局 → 冻结房间时钟 → 页内
       *  经房间命令面逐拍应答真人决策点(策略钉死:选项 ≤1 引擎自决/首个可用、反应窗
       *  「不用」、锦囊今不用、珍宝交涉不交易)推进至第 targetRound 回合边界(parkMyTurn
       *  谓词停靠态;afterFirstRoll=#1254 开口吸收,到站钉在首掷后——开手可用牌时
       *  seedSolo 后即停 AwaitingJinnang,不排除会停在未掷态)→ 解冻。返回停靠态读数;
       *  沉降(waitFxIdle/waitSettled)归调用方。实现见 registry.ts installDebugHooks
       *  (answerAtHumanStop/driveToRound)。 */
      seedSoloToRound: (opts: {
        seed?: number;
        mapId?: string;
        seats?: number;
        targetRound: number;
        afterFirstRoll?: boolean;
      }) => Promise<{ turnNumber: number; round: number; turnPhase: TurnPhase }>;
      /** 瞬空钉(#1254,ADR-0059 决策 1;词条 GLOSSARY「瞬空」):演出层测试阀门——
       *  钉住期间 SnapshotEffects 出队点一律走吸附档(未播演出整块弃播、棋盘直切引擎
       *  终态,引擎状态分毫不动),解除恢复正常三档。经本桥双门禁,生产构建零暴露;
       *  产品默认关闭零变化。实体 fx/catchup.ts setSnapPin,消费挂点
       *  net/snapshot-effects.ts dequeueChunk。 */
      setSnapPin: (on: boolean) => void;
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
