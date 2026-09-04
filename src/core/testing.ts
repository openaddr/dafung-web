// 测试窄口(spec #107 C3):引擎白盒触达的唯一合法通道——仅 test/ 可 import,
// 生产代码(src/app、scripts)import 本文件 = 架构违规。
//
// 能力两件:
//  1. 相位摆位:把引擎摆到指定 turnPhase 的前置态(place/placeActive/forceTurnPhase/armDecision);
//  2. 内部步骤触达:测试实际在用的私有步骤清单(resolveLanding / resolveBranchCell /
//     tryRecruitHero / payOrLiquidate——grep test/ 统计口径,2026-08)。
// 方法全部显式签名,不放 any;对私有成员的窄化集中在本类构造器一处(全仓库测试面
// 因此不再出现散落的 as any 直写引擎内部)。dispatchMoment 是引擎 public 方法,测试
// 直调即可,无需经此口;timing.test.ts 的 dispatchMoment 间谍为类型化测试替身,保留原位。
import type { GameEngine } from "./game";
import type { BranchCell } from "./board";
import type { EncounterDef } from "./encounters";
import type { PendingLandKind, Player, TurnPhase } from "./types";

/** 引擎私有步骤的测试触达面(签名与 game.ts 私有方法同步;签名漂移在此编译期炸出)。 */
interface EngineTestInternals {
  resolveLanding(): void;
  resolveBranchCell(mover: Player, cell: BranchCell): void;
  tryRecruitHero(mover: Player): void;
  payOrLiquidate(
    mover: Player,
    creditor: Player | null,
    amount: number,
  ): "ok" | "liquidating" | "bankrupt";
  settleEncounter(
    mover: Player,
    atTile: number,
    def: EncounterDef,
  ): "settled" | "liquidating" | "bankrupt";
  enterEncounterPhase(
    mover: Player,
    atTile: number,
    def: EncounterDef,
  ): "deciding" | "settled" | "liquidating" | "bankrupt";

}

export class TestEngine {
  /** 被包引擎(公开只读引用,测试沿用原有断言习惯)。 */
  readonly engine: GameEngine;
  private readonly internals: EngineTestInternals;

  constructor(engine: GameEngine) {
    this.engine = engine;
    // 全仓库唯一允许的引擎内部窄化点(替代散落各测试的 as any 直写)
    this.internals = engine as unknown as EngineTestInternals;
  }

  // ──────────────────────────── 相位摆位 ────────────────────────────

  /** 直写回合相位(测试前置态;生产路径由引擎状态机推进)。 */
  forceTurnPhase(phase: TurnPhase): void {
    this.engine.turnPhase = phase;
  }

  /** 把座位 seat 的棋子直摆到主路 tile(测试前置态;生产路径由 rollAndMove 推进)。 */
  place(seat: number, tile: number): void {
    this.engine.players[seat].position = tile;
  }

  /** 把当前活跃玩家直摆到主路 tile(place 的活跃位速记)。 */
  placeActive(tile: number): void {
    this.engine.activePlayer.position = tile;
  }

  /** 决策摆位:置待决策落格载荷(pendingLand)并进 AwaitingDecision——等价于引擎
   *  resolveLanding 落在无主可购/己城可扩格后的相位态。C2 后决策消费读 pendingLand,
   *  不再直写 lastLandOutcome(表现态)。 */
  armDecision(kind: PendingLandKind, propertyId: string): void {
    this.engine.pendingLand = { kind, propertyId };
    this.engine.turnPhase = "AwaitingDecision";
  }

  // ──────────────────────────── 内部步骤触达 ────────────────────────────

  /** 触达私有落格结算(前置:活跃玩家已在目标格、turnPhase 可为 Land——land() 一并置)。 */
  resolveLanding(): void {
    this.internals.resolveLanding();
  }

  /** 落格前置对:置 Land 相位并触发私有落格结算(等价测试常用两连直写)。 */
  land(): void {
    this.engine.turnPhase = "Land";
    this.internals.resolveLanding();
  }

  /** 摆位 + 落格一步到位(测试最高频组合:摆活跃玩家到 tile 并结算落格)。 */
  landActiveAt(tile: number): void {
    this.placeActive(tile);
    this.land();
  }

  /** 触达私有辅路格结算(mover 须已在辅路 onBranch={step} 态)。 */
  resolveBranchCell(mover: Player, cell: BranchCell): void {
    this.internals.resolveBranchCell(mover, cell);
  }

  /** 触达私有招贤纳士(三选一候选生成)。 */
  tryRecruitHero(mover: Player): void {
    this.internals.tryRecruitHero(mover);
  }

  /** 对局日志扁平文本(机遇顺序断言用;#123)。 */
  logText(): string {
    return this.engine.log.map((l) => `${l.brief} ${l.detail}`).join("\n");
  }

  /** 触达机遇结算(指定具体事件,绕过触发/抽取随机;#123)。 */
  applyEncounter(
    mover: Player,
    atTile: number,
    def: EncounterDef,
  ): "settled" | "liquidating" | "bankrupt" {
    return this.internals.settleEncounter(mover, atTile, def);
  }

  /** 触达抉择机遇入相(指定具体事件,绕过触发/抽取随机;#124):等价引擎抽中 choices 型
   *  机遇后的进入逻辑——可用选项 ≤1 自动执行(回合收尾),≥2 进 AwaitingEncounter。
   *  mover=当前活跃玩家,atTile=其所在格。 */
  enterEncounter(def: EncounterDef): "deciding" | "settled" | "liquidating" | "bankrupt" {
    const mover = this.engine.activePlayer;
    return this.internals.enterEncounterPhase(mover, mover.position, def);
  }

  /** 触达私有付款或触发清算(破产清算路径的引擎入口)。 */
  payOrLiquidate(
    mover: Player,
    creditor: Player | null,
    amount: number,
  ): "ok" | "liquidating" | "bankrupt" {
    return this.internals.payOrLiquidate(mover, creditor, amount);
  }
}

/** 测试访问器工厂:包一个引擎作白盒触达(test/ 专用)。 */
export function testEngine(engine: GameEngine): TestEngine {
  return new TestEngine(engine);
}
