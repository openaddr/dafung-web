// window.__dafung 调试桥声明;实现在 controllers/registry.ts 的 installDebugHooks。
// 仅 dev 构建或显式预置 E2E_DEBUG_BRIDGE_KEY 时挂载;单次辅助边界见 ADR-0065。
import type { GameEngine, TurnPhase } from "@core/authority";
import type { HeroDef } from "@core/heroes";
import type { PlantOp } from "@core/planter";
import type { GameSnapshot } from "@app/store/gameStore";
import type { GameController } from "@app/controllers/controller";
import type { FrameDiagDump } from "@app/frameDiag";
import type { PresentationEvent } from "@app/fx/presentation";

declare global {
  interface Window {
    __dafung?: {
      /** 表现态构造:原样转发产品 present + createEngineSink。 */
      playPresentation: (events: PresentationEvent[]) => Promise<void>;
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
      /** 转发 core/planter.applyPlant,只种植不重灌。
       *  调用方须写前等演出排空,写后经 controller().sync() 刷 UI 并再次等排空。 */
      plant: (op: PlantOp) => void;
      /** 当前控制器(交互入口)。 */
      controller: () => GameController | null;
      /** 加载地图、创建 LocalController、注册并切屏,再经 setupPickCapital 选都。
       *  默认值共用 setup-defaults.ts;显式 seats 须为 2–8 整数。 */
      seedSolo: (opts?: { seed?: number; mapId?: string; seats?: number }) => Promise<void>;
      /** seedSolo 开局后冻结房间时钟,经公共命令推进到目标回合的稳定停靠态后解冻。
       *  afterFirstRoll 要求首掷已发生;应答/停靠规则见 registry.ts answerAtHumanStop/driveToRound。
       *  演出排空由调用方等待。 */
      seedSoloToRound: (opts: {
        seed?: number;
        mapId?: string;
        seats?: number;
        targetRound: number;
        afterFirstRoll?: boolean;
      }) => Promise<{ turnNumber: number; round: number; turnPhase: TurnPhase }>;
      /** 瞬空钉:catchup.setSnapPin 使 SnapshotEffects.dequeueChunk 常开吸附档。
       *  只弃未播演出、棋子直切终态,不改引擎;默认关闭,解除后恢复正常判档(ADR-0065)。 */
      setSnapPin: (on: boolean) => void;
      /** 房间时钟冻结闸:冻结期间看门狗/自动起摇/托管步进的
       *  到点回调挂起;resume 按到点序补放。仅单机对局可冻结(无 Worker 时钟抛错)。 */
      clockPause: () => void;
      clockResume: () => void;
      /** catchup.catchupCounters 的累计只读快照:分类计数与末次游标差/批龄/倍率(ADR-0029)。 */
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
