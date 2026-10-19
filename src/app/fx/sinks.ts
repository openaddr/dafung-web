// FxSink 的两个实现(表现事件的"出口"):
//   ① createEngineSink —— 生产 adapter:把接口组装到既有单例(getAudio/diceApi/
//      useFxStore/useMarch),行为与 Wave1 之前逐一对齐(零行为变化)。
//      引擎经 getter 注入而非直接闭包:联机 rebuildForMap 会整体替换引擎实例,
//      getter 保证 sink 永远指向当前引擎(棋子行军/印章坐标都读引擎态)。
//   ② createMemorySink —— 测试 adapter:只录制调用序列,供单测断言
//      present() 的播放顺序与内容,不碰 DOM/音频/store。
import type { GameEngine } from "@core/authority";
import type { MovePath } from "@core/board";
import { playerColor, rgba } from "@core/theme";
import { getAudio, type SoundEvent } from "./audio";
import { duelSignsApi } from "./DuelSignsOverlay";
import { fallTokenFlag, shakeDesk } from "./desk";
import { useFxStore } from "./fxStore";
import { animateDice, animateMove, beginMarch } from "./orchestrator";
import { CEREMONY, DUEL, delay } from "./timings";
import type { DuelSide, FxSink, PropertyChangedEvent } from "./presentation";

/** 生产 sink:单机/联机控制器共用(各持一份,引擎 getter 各自绑定)。 */
export function createEngineSink(getEngine: () => GameEngine): FxSink {
  return {
    playSound(event: SoundEvent) {
      getAudio().play(event);
    },
    rollDice(die: number) {
      return animateDice(die);
    },
    marchBegin(playerId: string, path: MovePath) {
      beginMarch(getEngine(), playerId, path);
    },
    marchToken(playerId: string, path: MovePath) {
      return animateMove(getEngine(), playerId, path);
    },
    spawnFloater(x, y, amount, coins) {
      useFxStore.getState().spawnFloater(x, y, amount, coins);
    },
    spawnTextFloater(x, y, text) {
      useFxStore.getState().spawnTextFloater(x, y, text);
    },
    showBanner(guohao, colorIndex) {
      getAudio().play("banner");
      useFxStore.getState().showBanner(guohao, rgba(playerColor(colorIndex)));
    },
    stampSeal(tileIndex, char, tone) {
      const engine = getEngine();
      const pos = engine.board.positionOf(tileIndex);
      getAudio().play("stamp");
      useFxStore.getState().stampSeal(pos.x, pos.y - 20, char, tone);
    },
    landPulse(tileIndex) {
      const pos = getEngine().board.positionOf(tileIndex);
      useFxStore.getState().spawnPulse(pos.x, pos.y);
    },
    stampDuel(ev) {
      // 拼点双印(S7):双骰印落店 CSS 错拍自走,骨牌叩声随两印错拍、合印拍落
      // stamp 音;大胜负(|a−b|≥DUEL.blowoutMargin)合印同拍震屏。T3 随全屏签面退役。
      useFxStore.getState().stampDuel(ev.x, ev.y, ev.a, ev.b, ev.verdict);
      const audio = getAudio();
      audio.play("tileClack");
      window.setTimeout(() => audio.play("tileClack"), DUEL.clackGapMs);
      window.setTimeout(() => {
        audio.play("stamp");
        if (Math.abs(ev.a - ev.b) >= DUEL.blowoutMargin) shakeDesk();
      }, DUEL.verdictMs);
    },
    showDuelSigns(ev) {
      // 拼点签面(#637,ADR-0030):全屏多签演出整场经模块桥直调 DiceOverlay 同族
      // 组件,await 到整幕收口(节拍/音画/震屏全在组件内编排)。
      return duelSignsApi.play(ev);
    },
    showHaltBanner(ev) {
      // 都城停全屏宣告(S7):号角(haltGong,复用 gong-long 素材)+震屏同拍,
      // 横幅动画 CSS 自走;编排时长由 present 侧 haltHoldMs 承担。
      getAudio().play("haltGong");
      shakeDesk();
      useFxStore
        .getState()
        .showHaltBanner(ev.guohao, rgba(playerColor(ev.colorIndex)), ev.cityName);
    },
    async bankruptCeremony(ev) {
      // 破产仪式(S7 #513)三拍串行:长锣开锣+雨床铺底+震屏 → 旌旗缓倒 →
      // 墨渍晕开 → 铜钱撒落(coinsBox 同拍)。
      const audio = getAudio();
      audio.play("bankrupt");
      audio.play("rain");
      shakeDesk();
      fallTokenFlag(ev.playerId);
      await delay(CEREMONY.blotAtMs);
      useFxStore.getState().spawnInkBlot(ev.x, ev.y);
      await delay(CEREMONY.coinsAtMs - CEREMONY.blotAtMs);
      audio.play("coinsBox");
      useFxStore.getState().spawnCoinBurst(ev.x, ev.y, CEREMONY.coinCount);
      await delay(CEREMONY.settleMs - CEREMONY.coinsAtMs);
    },
    spawnJinnangLine(x1, y1, x2, y2) {
      useFxStore.getState().spawnJinnangLine(x1, y1, x2, y2);
    },
    revealPeek(ev) {
      useFxStore.getState().revealPeek(ev.viewerSeat, ev.targetSeat, ev.guohao, ev.hand);
    },
    announceTileChange(ev: PropertyChangedEvent) {
      // 城池宣告(ADR-0015):经 store 下发 nonce,Tile 订阅重播(何时播归播放器)
      useFxStore
        .getState()
        .announceTileChange(ev.tileIndex, ev.levelChanged, ev.ownerChanged, ev.ownerColorIndex);
    },
  };
}

/** memorySink 录制的调用记录(op + 参数):测试断言的就是这个序列。 */
export type FxSinkCall =
  | { op: "sound"; event: SoundEvent }
  | { op: "dice"; die: number }
  | { op: "marchBegin"; playerId: string; path: MovePath }
  | { op: "march"; playerId: string; path: MovePath }
  | { op: "floater"; x: number; y: number; amount: number; coins: boolean }
  | { op: "textFloater"; x: number; y: number; text: string }
  | { op: "banner"; guohao: string; colorIndex: number }
  | { op: "seal"; tileIndex: number; char: string; tone?: "gold" }
  | { op: "landPulse"; tileIndex: number }
  | { op: "duel"; x: number; y: number; a: number; b: number; verdict: "lose" | "tie" }
  | { op: "duelSigns"; sides: DuelSide[]; winnerSeat: number | null }
  | { op: "haltBanner"; guohao: string; colorIndex: number; cityName: string }
  | { op: "bankruptCeremony"; playerId: string; x: number; y: number }
  | { op: "jinnangLine"; x1: number; y1: number; x2: number; y2: number }
  | {
      op: "peekRevealed";
      viewerSeat: number;
      targetSeat: number;
      guohao: string;
      hand: string[];
    }
  | {
      op: "announceTile";
      tileIndex: number;
      level: number;
      ownerColorIndex: number | null;
      levelChanged: boolean;
      ownerChanged: boolean;
    };

/** 测试 sink:录制所有调用;march/dice/签面/仪式立即 resolve(不测 DOM 细节,只测事件语义与时序)。 */
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
    marchBegin(playerId: string, path: MovePath) {
      calls.push({ op: "marchBegin", playerId, path });
    },
    async marchToken(playerId: string, path: MovePath) {
      calls.push({ op: "march", playerId, path });
    },
    spawnFloater(x, y, amount, coins) {
      calls.push({ op: "floater", x, y, amount, coins });
    },
    spawnTextFloater(x, y, text) {
      calls.push({ op: "textFloater", x, y, text });
    },
    showBanner(guohao, colorIndex) {
      calls.push({ op: "banner", guohao, colorIndex });
    },
    stampSeal(tileIndex, char, tone) {
      calls.push({ op: "seal", tileIndex, char, tone });
    },
    landPulse(tileIndex) {
      calls.push({ op: "landPulse", tileIndex });
    },
    stampDuel(ev) {
      calls.push({ op: "duel", x: ev.x, y: ev.y, a: ev.a, b: ev.b, verdict: ev.verdict });
    },
    async showDuelSigns(ev) {
      calls.push({ op: "duelSigns", sides: ev.sides, winnerSeat: ev.winnerSeat });
    },
    showHaltBanner(ev) {
      calls.push({
        op: "haltBanner",
        guohao: ev.guohao,
        colorIndex: ev.colorIndex,
        cityName: ev.cityName,
      });
    },
    async bankruptCeremony(ev) {
      calls.push({ op: "bankruptCeremony", playerId: ev.playerId, x: ev.x, y: ev.y });
    },
    spawnJinnangLine(x1, y1, x2, y2) {
      calls.push({ op: "jinnangLine", x1, y1, x2, y2 });
    },
    revealPeek(ev) {
      calls.push({
        op: "peekRevealed",
        viewerSeat: ev.viewerSeat,
        targetSeat: ev.targetSeat,
        guohao: ev.guohao,
        hand: [...ev.hand],
      });
    },
    announceTileChange(ev) {
      calls.push({
        op: "announceTile",
        tileIndex: ev.tileIndex,
        level: ev.level,
        ownerColorIndex: ev.ownerColorIndex,
        levelChanged: ev.levelChanged,
        ownerChanged: ev.ownerChanged,
      });
    },
  };
}
