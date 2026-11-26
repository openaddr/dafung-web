// FxSink 的两个实现(表现事件的"出口"):
//   ① createEngineSink —— 生产 adapter:把接口组装到既有单例(getAudio/diceApi/
//      useFxStore/useMarch)。不变量①全坐标化(ADR-0029/#608):一切坐标随事件
//      烤好进来,sink 零引擎读取——createEngineSink 无参数,签名即「播放期摸不到
//      引擎」的编译期证明。
//   ② createMemorySink —— 测试 adapter:只录制调用序列,供单测断言
//      present() 的播放顺序与内容,不碰 DOM/音频/store。
import { playerColor, rgba } from "@dafung/core/engine/theme";
import { getAudio, type SoundEvent } from "./audio";
import { finishCapitalSupply } from "./capital-supply-audio";
import { duelSignsApi } from "./DuelSignsOverlay";
import { fallTokenFlag, shakeDesk } from "./desk";
import { useFxStore } from "./fxStore";
import { animateDice, animateMove, beginMarch } from "./orchestrator";
import { CEREMONY, delay } from "./timings";
import type {
  CashArrivalCue,
  CashFlyEvent,
  DuelSide,
  FxSink,
  MarchSegmentFrames,
  PropertyChangedEvent,
  SealSound,
  SkillFloatTone,
} from "./presentation";

/** 印章视觉上抬(格中心 → 印面锚点的静态偏移):表现几何常量,非引擎态。 */
const SEAL_LIFT_PX = 20;
interface EngineSink extends FxSink {
  hasLaunchedCash(cue: CashArrivalCue): boolean;
  discardCashFlights(keep?: CashArrivalCue): void;
  /** 终局等当轮首枚铜钱抵达。已入账或已弃播的铜钱无需等待。 */
  waitForCashArrival(
    cue: CashArrivalCue,
    signal: AbortSignal,
    willLaunch: boolean,
  ): Promise<void> | undefined;
}

/** 生产 sink:单机/联机控制器共用(无引擎依赖,换图换引擎实例均无感)。 */
export function createEngineSink(): EngineSink {
  const arrived = new WeakSet<CashArrivalCue>();
  const flightCues = new WeakMap<() => void, Map<CashArrivalCue, () => void>>();
  const arrivalWaiters = new WeakMap<CashArrivalCue, { play: () => void; finish: () => void }>();
  const isCashInFlight = (cue: CashArrivalCue) =>
    useFxStore
      .getState()
      .cashFlies.some((fly) => fly.onArrival && flightCues.get(fly.onArrival)?.has(cue));
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
    spawnTextFloater(x, y, text, skill) {
      useFxStore.getState().spawnTextFloater(x, y, text, skill);
    },
    announceTurn(guohao, colorIndex, round) {
      // 回合宣告=只刷新常驻胶囊(#958 全幅横幅退役):无声、无停留窗,胶囊重挂
      // 即回合切换信号(席位金圈同拍换位)。
      useFxStore.getState().announceTurn(guohao, rgba(playerColor(colorIndex)), round, colorIndex);
    },
    stampSeal(x, y, char, tone, sound) {
      const audio = getAudio();
      if (sound === undefined) audio.play("stamp");
      let playLanding = sound == null ? undefined : audio.defer(sound);
      const onLanding =
        playLanding &&
        (() => {
          const play = playLanding;
          playLanding = undefined;
          play?.();
        });
      useFxStore.getState().stampSeal(x, y - SEAL_LIFT_PX, char, tone, onLanding);
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
      useFxStore
        .getState()
        .showHaltBanner(
          ev.guohao,
          rgba(playerColor(ev.colorIndex)),
          ev.cityName,
          getAudio().defer("haltLatch"),
        );
    },
    async bankruptCeremony(ev) {
      const { blotAtMs, coinsAtMs, settleMs, coinCount } = CEREMONY;
      const coinsTailMs = settleMs - coinsAtMs;
      const audio = getAudio();
      const playCoins = audio.defer("coinsBox", coinsTailMs);
      // 锣雨贴倒旗起拍，撒币另占一拍。交棒前渐出，卡顿恢复后收完余声。
      audio.play("bankrupt", settleMs);
      audio.play("rain", settleMs);
      shakeDesk();
      fallTokenFlag(ev.playerId);
      await delay(blotAtMs);
      useFxStore.getState().spawnInkBlot(ev.x, ev.y);
      await delay(coinsAtMs - blotAtMs);
      playCoins();
      useFxStore.getState().spawnCoinBurst(ev.x, ev.y, coinCount);
      await delay(coinsTailMs);
    },
    spawnJinnangLine(x1, y1, x2, y2) {
      useFxStore.getState().spawnJinnangLine(x1, y1, x2, y2);
    },
    revealPeek(ev) {
      useFxStore.getState().revealPeek(ev);
    },
    announceTileChange(ev: PropertyChangedEvent) {
      // 城池宣告(ADR-0015):经 store 下发 nonce,Tile 订阅重播(何时播归播放器)
      useFxStore
        .getState()
        .announceTileChange(ev.tileIndex, ev.levelChanged, ev.ownerChanged, ev.ownerColorIndex);
      // 易主流光(架构体检 B 批出底板):ownerChanged 一并下发流光件,fx 宿主渲染
      if (ev.ownerChanged) useFxStore.getState().pushOwnFlash(ev.tileIndex, ev.ownerColorIndex);
    },
    showBurningPulse(tileIndex, marks) {
      useFxStore.getState().showBurningPulse(tileIndex, marks);
    },
    hasLaunchedCash(cue) {
      return arrived.has(cue) || isCashInFlight(cue);
    },
    discardCashFlights(keep) {
      useFxStore.setState(({ cashFlies }) => ({
        cashFlies: cashFlies.filter(({ onArrival }) => {
          const cues = onArrival && flightCues.get(onArrival);
          if (cues === undefined) return false;
          const play = keep && cues.get(keep);
          cues.clear();
          if (keep === undefined || play === undefined) return false;
          cues.set(keep, play);
          return true;
        }),
      }));
    },
    waitForCashArrival(cue, signal, willLaunch) {
      if (arrived.has(cue) || signal.aborted) return undefined;
      if (!willLaunch && !isCashInFlight(cue)) return undefined;
      // 同一轮可能上一批已起飞。终局封场后，由当前演出接回这一声。
      const play = getAudio().defer(cue.event);
      return new Promise((resolve) => {
        const finish = () => {
          arrivalWaiters.delete(cue);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        arrivalWaiters.set(cue, { play, finish });
        signal.addEventListener("abort", finish, { once: true });
      });
    },
    cashFly(ev: CashFlyEvent) {
      let onArrival: (() => void) | undefined;
      if (ev.arrivalCues !== undefined) {
        const audio = getAudio();
        const cues = new Map(ev.arrivalCues.map((cue) => [cue, audio.defer(cue.event)] as const));
        onArrival = () => {
          for (const [cue, play] of cues) {
            if (arrived.has(cue)) continue;
            arrived.add(cue);
            const waiter = arrivalWaiters.get(cue);
            (waiter?.play ?? play)();
            waiter?.finish();
            if (cue.capitalRecruitment !== undefined) finishCapitalSupply(cue.capitalRecruitment);
          }
          cues.clear();
        };
        flightCues.set(onArrival, cues);
      }
      useFxStore.getState().spawnCashFly(ev.playerId, ev.amount, ev.x, ev.y, onArrival);
    },
  };
}

/** memorySink 录制的调用记录(op + 参数):测试断言的就是这个序列。 */
type FxSinkCall =
  | { op: "sound"; event: SoundEvent }
  | { op: "dice"; die: number }
  | { op: "marchBegin"; playerId: string; keyframes: MarchSegmentFrames[] }
  | { op: "march"; playerId: string; keyframes: MarchSegmentFrames[] }
  | { op: "floater"; x: number; y: number; amount: number; coins: boolean }
  | { op: "textFloater"; x: number; y: number; text: string; skill?: SkillFloatTone }
  | { op: "announceTurn"; guohao: string; colorIndex: number; round: number }
  | { op: "seal"; x: number; y: number; char: string; tone?: "gold"; sound?: SealSound }
  | { op: "landPulse"; x: number; y: number }
  | { op: "duelSigns"; sides: DuelSide[]; winnerSeat: number | null }
  | { op: "haltBanner"; guohao: string; colorIndex: number; cityName: string }
  | { op: "bankruptCeremony"; playerId: string; x: number; y: number }
  | { op: "jinnangLine"; x1: number; y1: number; x2: number; y2: number }
  | {
      op: "peekRevealed";
      viewerSeat: number;
      targetSeat: number;
      cardId: string;
      guohao: string;
      hand: string[];
    }
  | {
      op: "announceTile";
      tileIndex: number;
      level: number | null;
      ownerColorIndex: number | null;
      levelChanged: boolean;
      ownerChanged: boolean;
    }
  | ({ op: "cashFly" } & CashFlyEvent)
  | { op: "burningPulse"; tileIndex: number; marks: number };

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
    spawnTextFloater(x, y, text, skill) {
      calls.push({ op: "textFloater", x, y, text, ...(skill == null ? {} : { skill }) });
    },
    announceTurn(guohao, colorIndex, round) {
      calls.push({ op: "announceTurn", guohao, colorIndex, round });
    },
    stampSeal(x, y, char, tone, sound) {
      calls.push({
        op: "seal",
        x,
        y,
        char,
        ...(tone == null ? {} : { tone }),
        ...(sound === undefined ? {} : { sound }),
      });
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
        cardId: ev.cardId,
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
    showBurningPulse(tileIndex, marks) {
      calls.push({ op: "burningPulse", tileIndex, marks });
    },
    cashFly(ev: CashFlyEvent) {
      calls.push({ op: "cashFly", ...ev });
    },
  };
}
