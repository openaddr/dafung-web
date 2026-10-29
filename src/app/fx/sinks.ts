// FxSink 的两个实现(表现事件的"出口"):
//   ① createEngineSink —— 生产 adapter:把接口组装到既有单例(getAudio/diceApi/
//      useFxStore/useMarch)。不变量①全坐标化(ADR-0029/#608):一切坐标随事件
//      烤好进来,sink 零引擎读取——createEngineSink 无参数,签名即「播放期摸不到
//      引擎」的编译期证明。
//   ② createMemorySink —— 测试 adapter:只录制调用序列,供单测断言
//      present() 的播放顺序与内容,不碰 DOM/音频/store。
import { playerColor, rgba } from "@core/theme";
import { getAudio, type SoundEvent } from "./audio";
import { duelSignsApi } from "./DuelSignsOverlay";
import { fallTokenFlag, shakeDesk } from "./desk";
import { useFxStore } from "./fxStore";
import { animateDice, animateMove, beginMarch } from "./orchestrator";
import { CEREMONY, delay } from "./timings";
import type {
  CashFlyEvent,
  DuelSide,
  FxSink,
  MarchSegmentFrames,
  PropertyChangedEvent,
} from "./presentation";

/** 印章视觉上抬(格中心 → 印面锚点的静态偏移):表现几何常量,非引擎态。 */
const SEAL_LIFT_PX = 20;

/** 生产 sink:单机/联机控制器共用(无引擎依赖,换图换引擎实例均无感)。 */
export function createEngineSink(): FxSink {
  return {
    playSound(event: SoundEvent) {
      getAudio().play(event);
    },
    rollDice(die: number) {
      return animateDice(die);
    },
    marchBegin(playerId: string, keyframes: readonly MarchSegmentFrames[]) {
      beginMarch(playerId, keyframes);
    },
    marchToken(playerId: string, keyframes: readonly MarchSegmentFrames[]) {
      return animateMove(playerId, keyframes);
    },
    spawnFloater(x, y, amount, coins) {
      useFxStore.getState().spawnFloater(x, y, amount, coins);
    },
    spawnTextFloater(x, y, text) {
      useFxStore.getState().spawnTextFloater(x, y, text);
    },
    showBanner(guohao, colorIndex, meta) {
      // #762:槽泵判别先行(bot→bot 同轮连续=只更新胶囊)——全幅才配 whoosh 音;
      // 判定结果透传播放器(全幅才让编排停留窗)。
      const full = useFxStore
        .getState()
        .showBanner(guohao, rgba(playerColor(colorIndex)), meta, colorIndex);
      if (full) getAudio().play("banner");
      return full;
    },
    stampSeal(x, y, char, tone) {
      getAudio().play("stamp");
      useFxStore.getState().stampSeal(x, y - SEAL_LIFT_PX, char, tone);
    },
    landPulse(x, y) {
      useFxStore.getState().spawnPulse(x, y);
    },
    showDuelSigns(ev) {
      // 拼点签面(#637,ADR-0030):全屏多签演出整场经模块桥直调 DiceOverlay 同族
      // 组件,await 到整幕收口(节拍/音画/震屏全在组件内编排)。
      return duelSignsApi.play(ev);
    },
    showHaltBanner(ev) {
      // 都城停条带(#732 降格,原 S7 全屏宣告):号角保留(haltGong,#751 换 CC0
      // 狩猎号角与 bankrupt 的 gong-long 分家);震屏随全屏仪式降格撤销(4px 档是
      // DESIGN §6 大事件制式,条带级知会不再配发),横幅动画 CSS 自走;编排时长由
      // present 侧 haltHoldMs 条带级校准。
      getAudio().play("haltGong");
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
    cashFly(ev: CashFlyEvent) {
      // 金钱飞行归账(#764):铜钱经 store 下发,FxLayer 的 body portal 渲染,
      // 抵达拍 bump 席位现金数字(渲染组件回调,此处零 DOM)。
      useFxStore.getState().spawnCashFly(ev.playerId, ev.amount, ev.x, ev.y);
    },
  };
}

/** memorySink 录制的调用记录(op + 参数):测试断言的就是这个序列。 */
export type FxSinkCall =
  | { op: "sound"; event: SoundEvent }
  | { op: "dice"; die: number }
  | { op: "marchBegin"; playerId: string; keyframes: MarchSegmentFrames[] }
  | { op: "march"; playerId: string; keyframes: MarchSegmentFrames[] }
  | { op: "floater"; x: number; y: number; amount: number; coins: boolean }
  | { op: "textFloater"; x: number; y: number; text: string }
  | { op: "banner"; guohao: string; colorIndex: number; isBot: boolean; round: number }
  | { op: "seal"; x: number; y: number; char: string; tone?: "gold" }
  | { op: "landPulse"; x: number; y: number }
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
    }
  | { op: "cashFly"; playerId: string; amount: number; x: number; y: number };

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
    marchBegin(playerId: string, keyframes: readonly MarchSegmentFrames[]) {
      calls.push({ op: "marchBegin", playerId, keyframes: [...keyframes] });
    },
    async marchToken(playerId: string, keyframes: readonly MarchSegmentFrames[]) {
      calls.push({ op: "march", playerId, keyframes: [...keyframes] });
    },
    spawnFloater(x, y, amount, coins) {
      calls.push({ op: "floater", x, y, amount, coins });
    },
    spawnTextFloater(x, y, text) {
      calls.push({ op: "textFloater", x, y, text });
    },
    showBanner(guohao, colorIndex, meta) {
      // memorySink 恒按全幅语义回 true(present 据此走编排停留窗;合并判别是
      // fxStore 槽泵的职责,录制 sink 不经 store)。
      calls.push({ op: "banner", guohao, colorIndex, ...meta });
      return true;
    },
    stampSeal(x, y, char, tone) {
      calls.push({ op: "seal", x, y, char, ...(tone == null ? {} : { tone }) });
    },
    landPulse(x, y) {
      calls.push({ op: "landPulse", x, y });
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
    cashFly(ev: CashFlyEvent) {
      calls.push({ op: "cashFly", playerId: ev.playerId, amount: ev.amount, x: ev.x, y: ev.y });
    },
  };
}
