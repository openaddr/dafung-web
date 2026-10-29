// 测试窄口(spec #107 C3):引擎白盒触达的唯一合法通道——仅 test/ 可 import,
// 生产代码(src/app、scripts)import 本文件 = 架构违规。
//
// 能力两件:
//  1. 相位摆位:把引擎摆到指定 turnPhase 的前置态(place/placeActive/forceTurnPhase/armDecision);
//  2. 内部步骤触达:测试实际在用的私有步骤清单(resolveLanding /
//     tryRecruitHero / payOrLiquidate——grep test/ 统计口径,2026-08)。
// 方法全部显式签名,不放 any;对私有成员的窄化集中在本类构造器一处(全仓库测试面
// 因此不再出现散落的 as any 直写引擎内部)。dispatchMoment 是引擎 public 方法,测试
// 直调即可,无需经此口;timing.test.ts 的 dispatchMoment 间谍为类型化测试替身,保留原位。
import type { GameEngine, TurnPhase } from "./authority";
import type { EncounterDef } from "./encounters";
import type { HeroDef } from "./heroes";
import { HEROES } from "./heroes";
import type { PendingLandKind } from "./movement-flow";
import type { Player } from "./model";

/** 引擎私有步骤的测试触达面(签名与 authority.ts 私有方法**人工对齐**)。实况:缝经
 *  构造器 `as unknown as` 转型,编译期不校验本接口与引擎私有签名的漂移——漂移在运行时
 *  以「not a function」炸出;对齐靠本接口逐项对照 authority.ts 私有方法清单(#459 已
 *  对齐两处,applyEncounter/enterEncounter 的返回联合)。 */
interface EngineTestInternals {
  resolveLanding(): void;
  tryRecruitHero(mover: Player): void;
  payOrLiquidate(
    mover: Player,
    creditor: Player | null,
    amount: number,
  ): "ok" | "liquidating" | "bankrupt";
  settleEncounter(
    mover: Player,
    def: EncounterDef,
  ): "settled" | "liquidating" | "bankrupt" | "exhausted";
  maybeApplyEncounter(
    mover: Player,
  ): "none" | "settled" | "deciding" | "exhausted" | "liquidating" | "bankrupt";
  enterEncounterPhase(
    mover: Player,
    def: EncounterDef,
  ): "deciding" | "liquidating" | "bankrupt" | "exhausted";
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

  /** 触达私有招贤纳士(三选一候选生成)。 */
  tryRecruitHero(mover: Player): void {
    this.internals.tryRecruitHero(mover);
  }

  /** 对局日志扁平文本(机遇顺序断言用;#123)。 */
  logText(): string {
    return this.engine.log.map((l) => `${l.brief} ${l.detail}`).join("\n");
  }

  /** 触达机遇触发+抽取全流程(验开关与必出抽取;#123,ADR-0035)。 */
  maybeApplyEncounter(
    mover: Player,
  ): "none" | "settled" | "deciding" | "exhausted" | "liquidating" | "bankrupt" {
    return this.internals.maybeApplyEncounter(mover);
  }

  /** 触达机遇结算(指定具体事件,绕过触发/抽取随机;#123)。返回联合与
   *  encounter-flow.settleEncounter 全量对齐(含 exhausted,#459)。 */
  applyEncounter(
    mover: Player,
    def: EncounterDef,
  ): "settled" | "liquidating" | "bankrupt" | "exhausted" {
    return this.internals.settleEncounter(mover, def);
  }

  /** 触达抉择机遇入相(指定具体事件,绕过触发/抽取随机;#124):等价引擎抽中 choices 型
   *  机遇后的进入逻辑——可用选项 ≤1 自动执行(回合收尾),≥2 进 AwaitingEncounter。
   *  mover=当前活跃玩家。返回联合与 encounter-flow.enterEncounterPhase
   *  全量对齐(恒不返回 settled,含 exhausted,#459)。 */
  enterEncounter(def: EncounterDef): "deciding" | "liquidating" | "bankrupt" | "exhausted" {
    const mover = this.engine.activePlayer;
    return this.internals.enterEncounterPhase(mover, def);
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

// ──────────────────────────── 麾下槽位布场工厂(#785,一个工厂全测试复用)────────────────────────────
// 合成名将登记清退(精确清退,不向同进程其他测试文件泄漏全局注册态;时机框架
// afterEach 先例同款)。armHero 对 id 不在 HEROES 的合成将登记进名将表并占用本局
// 招贤池(recruitedHeroIds,防漏入招贤候选扰动骰流/候选断言);real-hero 布场不占池、
// 与旧「p.heroes.push(HEROES[i])」骰流语义逐字同。
const armedTestHeroes: HeroDef[] = [];

/** 清退 armHero 登记过的合成名将(测试文件 afterEach 调;配对 armHero 使用)。 */
export function sweepTestHeroes(): void {
  while (armedTestHeroes.length > 0) {
    const hero = armedTestHeroes.pop()!;
    const idx = HEROES.indexOf(hero);
    if (idx < 0) throw new Error(`测试名将 ${hero.id} 不在名将表(状态机 bug)`);
    HEROES.splice(idx, 1);
  }
}

/** 麾下槽位布场:把名将以槽位入麾下——skillIds 显式给定(缺省=整池原序,即本票授技
 *  口径;授技掷骰=票 #787)。槽位形状单源 roster.HeroSlot。 */
export function armHero(e: GameEngine, p: Player, hero: HeroDef, skillIds?: string[]): void {
  if (!HEROES.some((h) => h.id === hero.id)) {
    HEROES.push(hero);
    armedTestHeroes.push(hero);
    e.recruitedHeroIds.add(hero.id); // 合成将不进招贤候选(骰流与候选断言不受扰)
  }
  p.heroes.push({ heroId: hero.id, skillIds: skillIds ?? [...hero.skillPool], lastFired: {} });
}
