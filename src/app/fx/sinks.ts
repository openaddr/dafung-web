// FxSink 的两个实现(表现事件的"出口"):
//   ① createEngineSink —— 生产 adapter:把接口组装到既有单例(getAudio/diceApi/
//      useFxStore/useMarch),行为与 Wave1 之前逐一对齐(零行为变化)。
//      引擎经 getter 注入而非直接闭包:联机 rebuildForMap 会整体替换引擎实例,
//      getter 保证 sink 永远指向当前引擎(棋子行军/印章坐标都读引擎态)。
//   ② createMemorySink —— 测试 adapter:只录制调用序列,供单测断言
//      present() 的播放顺序与内容,不碰 DOM/音频/store。
import type { GameEngine } from "@core/game";
import { playerColor, rgba } from "@core/theme";
import { getAudio, type SoundEvent } from "./audio";
import { useFxStore } from "./fxStore";
import { animateDice, animateMove, beginMarch } from "./orchestrator";
import type { FxSink } from "./presentation";

/** 生产 sink:单机/联机控制器共用(各持一份,引擎 getter 各自绑定)。 */
export function createEngineSink(getEngine: () => GameEngine): FxSink {
  return {
    playSound(event: SoundEvent) {
      getAudio().play(event);
    },
    rollDice(die: number) {
      return animateDice(die);
    },
    marchBegin(playerId: string) {
      beginMarch(getEngine(), playerId);
    },
    marchToken(playerId: string) {
      return animateMove(getEngine(), playerId);
    },
    spawnFloater(x, y, amount, coins) {
      useFxStore.getState().spawnFloater(x, y, amount, coins);
    },
    showBanner(guohao, colorIndex) {
      getAudio().play("banner");
      useFxStore.getState().showBanner(guohao, rgba(playerColor(colorIndex)));
    },
    stampSeal(tileIndex, char) {
      const engine = getEngine();
      const pos = engine.board.positionOf(tileIndex);
      getAudio().play("stamp");
      useFxStore.getState().stampSeal(pos.x, pos.y - 20, char);
    },
  };
}

/** memorySink 录制的调用记录(op + 参数):测试断言的就是这个序列。 */
export type FxSinkCall =
  | { op: "sound"; event: SoundEvent }
  | { op: "dice"; die: number }
  | { op: "marchBegin"; playerId: string }
  | { op: "march"; playerId: string }
  | { op: "floater"; x: number; y: number; amount: number; coins: boolean }
  | { op: "banner"; guohao: string; colorIndex: number }
  | { op: "seal"; tileIndex: number; char: string };

/** 测试 sink:录制所有调用;march/dice 立即 resolve(不测 DOM 细节,只测事件语义与时序)。 */
export function createMemorySink(): FxSink & { calls: FxSinkCall[] } {
  const calls: FxSinkCall[] = [];
  return {
    calls,
    playSound(event) {
      calls.push({ op: "sound", event });
    },
    async rollDice(die) {
      calls.push({ op: "dice", die });
    },
    marchBegin(playerId) {
      calls.push({ op: "marchBegin", playerId });
    },
    async marchToken(playerId) {
      calls.push({ op: "march", playerId });
    },
    spawnFloater(x, y, amount, coins) {
      calls.push({ op: "floater", x, y, amount, coins });
    },
    showBanner(guohao, colorIndex) {
      calls.push({ op: "banner", guohao, colorIndex });
    },
    stampSeal(tileIndex, char) {
      calls.push({ op: "seal", tileIndex, char });
    },
  };
}
