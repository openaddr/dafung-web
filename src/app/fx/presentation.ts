// 表现事件(Wave1 统一表现事件流):把「一次引擎推进 / 一次快照 diff」翻译成
// 与介质无关的判别联合。为什么要有这一层:此前单机(orchestrator.playStepEffects)
// 与联机(online.playSnapshotEffects)各自拼装"骰子→行军→浮字→横幅"链,形状完全
// 不同且已发生漂移(联机缺破产表现)。统一成事件数组后:
//   - 提取器(local/online 两个 adapter)只负责"发生了什么"(纯数据);
//   - 播放器 present() 只负责"按什么顺序怎么播"(消费 FxSink);
//   - FxSink 收窄 audio/dice/fxStore/march 四个能力,生产 adapter 组装单例,
//     测试用 createMemorySink() 录制调用断言顺序与内容(ADR-0006 预留位)。
// 设计取舍:坐标(x/y,棋盘逻辑系)在提取期解析进事件——浮字锚定优先级依赖
// 提取时刻的玩家状态(辅路位置),事后无法从 atTile 单独还原,故事件自带坐标,
// atTile 仅保留语义信息供测试断言。
import type { MovePath } from "@core/types";
import type { SoundEvent } from "./audio";

/** 表现事件:数组顺序 = 播放顺序(present 串行 await)。宁可少而精,按两侧现有
 *  调用收口;新增表现 = 加判别分支,而不是在控制器里另起内联链。 */
export type PresentationEvent =
  | { kind: "diceRolled"; die: number }
  | { kind: "tokenMoved"; playerId: string; path: MovePath }
  | {
      kind: "cashDelta";
      playerId: string;
      amount: number;
      /** 棋盘逻辑坐标(SVG 系,提取期已按 旧优先级 锚定)。 */
      x: number;
      y: number;
      /** 语义锚点(浮字发生在哪格;null=锚到玩家自身)。 */
      atTile: number | null;
    }
  | {
      kind: "supplyRain";
      playerId: string;
      amount: number;
      x: number;
      y: number;
      atTile: number | null;
    }
  | { kind: "sealStamped"; tileIndex: number; char: string }
  | { kind: "turnBanner"; guohao: string; colorIndex: number }
  /** 语义音效(得宝/破产/扩军/买入等):不绑定视觉的纯声音事件。 */
  | { kind: "sound"; event: SoundEvent };

/**
 * 表现能力收口(真 seam):present() 通过本接口驱动一切外设。四个能力对应
 * 旧 orchestrator 直接 import 的四组单例——audio / dice / fxStore / march。
 * 生产实现见 sinks.ts createEngineSink;测试实现见 createMemorySink。
 */
export interface FxSink {
  /** 播一条语义音效(带声音的事件本身如骰子/印章/横幅由对应方法内发声)。 */
  playSound(event: SoundEvent): void;
  /** 掷骰动画(含 diceRoll/diceLand 音与 fallback 停顿),await 到落面。 */
  rollDice(die: number): Promise<void>;
  /** 行军锚定(同步):把棋子放进接管集并锚回 path.from,必须先于 React 渲染终态。 */
  marchBegin(playerId: string): void;
  /** 行军动画(异步):沿引擎当前 lastMove(真实或 presentation 注入)逐段推进。 */
  marchToken(playerId: string): Promise<void>;
  /** 浮动金额(coins=true 时附带补给铜钱雨)。 */
  spawnFloater(x: number, y: number, amount: number, coins: boolean): void;
  /** 回合横幅(含 whoosh 音)。 */
  showBanner(guohao: string, colorIndex: number): void;
  /** 朱砂印章(含 stamp 音);坐标由实现按 tileIndex 换算(需要引擎/棋盘)。 */
  stampSeal(tileIndex: number, char: string): void;
}
