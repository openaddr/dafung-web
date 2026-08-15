// 动画/音效编排器(阶段 6 核心):把「一次引擎推进」翻译成 骰子→行军→浮字→印章/横幅
// 的表现序列。时序对照旧 src/render/state.ts 的 doRoll/afterLand/onTurnAdvanced 链:
//
//   rollAndMove:  animateDice(lastRoll.die) → [若非驻跸] animateMove → spawnFloaters
//   halt/continue:animateMove(补走) → spawnFloaters
//   buy(成功):   stampSeal("据") + buy 音 → spawnFloaters
//   upgrade(成功):upgrade 音 → spawnFloaters
//   选路/招贤/交涉/清算:语义音效(treasure/bankrupt) → spawnFloaters
//   回合推进:    showTurnBanner(下家国号)
// 浮字坐标锚定:engine floaters 的 atTile / 辅路格 / 玩家位置(优先级同旧 spawnFloaters)。
import type { GameEngine } from "@core/game";
import type { Player } from "@core/types";
import type { TurnPhase } from "@core/types";
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import { getAudio } from "./audio";
import { diceApi } from "./DiceOverlay";
import { useFxStore } from "./fxStore";
import { animateMove, beginMarch } from "./useMarch";
import { delay } from "./timings";

/** 掷骰表现:3D 物理骰优先;WebGL 不可用 → 停顿模拟 + 落骰声(签面文字由 HandPanel 展示)。 */
export async function animateDice(die: number): Promise<void> {
  const audio = getAudio();
  audio.play("diceRoll");
  if (diceApi.available) {
    await diceApi.roll(die);
    audio.play("diceLand");
    return;
  }
  // fallback:旧版在此切换 7 次 #dice-face 文字;React 版签面在侧栏,直接等一段掷骰时长
  await delay(650);
  audio.play("diceLand");
}

/** 浮动金额:真正消费 engine.drainFloaters(),按旧优先级锚定逻辑坐标入 fxStore。 */
export function spawnFloaters(engine: GameEngine): void {
  const fs = engine.drainFloaters();
  const store = useFxStore.getState();
  let coinPlayed = false;
  for (const f of fs) {
    if (!coinPlayed && f.amount > 0) {
      getAudio().play("coin"); // 有收入 → 铜钱声(一次即可)
      coinPlayed = true;
    }
    const player = engine.players[f.playerIndex];
    if (!player) continue;
    const board = engine.board;
    const atPos = f.atTile != null ? board.positionOf(f.atTile) : null;
    // 玩家在辅路上时锚到辅路格(否则 atTile=起点 tile 会与棋子分离)——优先级同旧实现
    const onBranchPos =
      player.onBranch != null && board.branch
        ? board.branch.cells[player.onBranch.step]?.position ?? null
        : null;
    const tokenPos = board.positionOf(player.position);
    const x = onBranchPos?.x ?? atPos?.x ?? tokenPos.x;
    const y = onBranchPos?.y ?? atPos?.y ?? tokenPos.y;
    store.spawnFloater(x, y, f.amount, f.kind === "supply");
  }
}

/** 回合横幅:国号大字飞入(玩家色),配 whoosh。 */
export function showTurnBanner(player: Pick<Player, "guohao" | "colorIndex">): void {
  getAudio().play("banner");
  useFxStore.getState().showBanner(player.guohao, rgba(playerColor(player.colorIndex)));
}

/** 朱砂印章"啪"地盖在城池上(建都"筑"/据城"据")。 */
export function stampSeal(engine: GameEngine, tileIndex: number, char: string): void {
  const pos = engine.board.positionOf(tileIndex);
  getAudio().play("stamp");
  useFxStore.getState().stampSeal(pos.x, pos.y - 20, char);
}

/** 记住上次横幅的活跃座位:activeIndex 变化才重弹(同一回合多个子决策不重复打扰)。 */
let lastBannerIndex = -1;

/** 回合推进检测:对局中且活跃座位变化 → 弹下家横幅。每次引擎推进后调用。 */
export function maybeShowTurnBanner(engine: GameEngine): void {
  if (engine.phase !== "Playing") return;
  if (engine.activeIndex === lastBannerIndex) return;
  lastBannerIndex = engine.activeIndex;
  showTurnBanner(engine.activePlayer);
}

/** 重置横幅去重(重开局时调用,防止同座位开局横幅被吞)。 */
export function resetFxOrchestration(): void {
  lastBannerIndex = -1;
  useFxStore.getState().resetFx();
}

export { beginMarch, animateMove };

/**
 * 单机端「一次引擎推进」的表现编排(人类命令与 bot 步骤共用)。
 * @param prevPhase 推进前的 turnPhase(决定该步的语义:Roll/驻跸/选路/决策/…)
 * @param moverId   推进前的活跃玩家(行军棋子;命令后引擎可能已推进回合)
 * @param prePlayer 推进前的活跃玩家对象(破产清算后读 isBankrupt 播破产音)
 * @param cmdType   触发命令类型(人类路径传 cmd.type;交涉跳过传 "resolveTreasureOwner_skip")
 */
export async function playStepEffects(
  engine: GameEngine,
  prevPhase: TurnPhase,
  moverId: string,
  prePlayer?: Player,
  cmdType?: string,
): Promise<void> {
  const audio = getAudio();

  if (prevPhase === "Roll") {
    const die = engine.lastRoll?.die;
    if (die) await animateDice(die);
    // 驻跸抉择:令牌未动,行军等 halt/continue 命令后再补(对照旧 doRoll 分支)
    if (engine.turnPhase !== "AwaitingCapitalHalt") {
      await animateMove(engine, moverId);
    }
    spawnFloaters(engine);
    return;
  }

  if (prevPhase === "AwaitingCapitalHalt") {
    await animateMove(engine, moverId); // 补走余下路程
    spawnFloaters(engine);
    return;
  }

  if (prevPhase === "AwaitingDecision") {
    // 以引擎 lastTransaction 判成败;买/扩军的表现差异由命令类型区分(控制器传入)
    if (engine.lastTransaction?.status === "Ok") {
      if (cmdType === "upgradeProperty") {
        audio.play("upgrade");
      } else {
        // 默认按买城:印章"据" + buy 音(与旧 onDecision("buy") 一致)
        stampSeal(engine, engine.activePlayer.position, "据");
        audio.play("buy");
      }
    }
    spawnFloaters(engine);
    return;
  }

  if (prevPhase === "AwaitingTreasureOwner") {
    // 公道/坐地 → 访客得宝音;跳过(skip 命令)无声——旧 onTreasureOwner 的口径
    if (cmdType !== "resolveTreasureOwner_skip") audio.play("treasure");
    spawnFloaters(engine);
    return;
  }

  if (prevPhase === "AwaitingBankruptcySettle") {
    spawnFloaters(engine);
    // 变卖仍不足 → 破产(prePlayer 在 settleDebt 中被置 isBankrupt)
    if (prePlayer?.isBankrupt) audio.play("bankrupt");
    return;
  }

  // 其余(AwaitingBranch/AwaitingHeroPick/…):浮字即可
  spawnFloaters(engine);
}

/** 金额格式化(FxLayer 共用口径:+/− 前缀)。 */
export function formatFloater(amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}
