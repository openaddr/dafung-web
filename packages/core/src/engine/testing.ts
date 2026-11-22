// 测试场景工具:仅 test/ 可 import,生产代码(src/app、scripts)不得引用。
// 负责相位摆位、落格组合与合成名将登记/清退;引擎步骤直接调用 GameEngine 公共方法。
import type { GameEngine, TurnPhase } from "./authority";
import type { HeroDef } from "./heroes";
import { HEROES } from "./heroes";
import type { PendingLandKind } from "./movement-flow";
import type { Player } from "./model";
import type { HeroOffer } from "./recruitment";

class TestEngine {
  /** 被包引擎(公开只读引用,测试沿用原有断言习惯)。 */
  readonly engine: GameEngine;

  constructor(engine: GameEngine) {
    this.engine = engine;
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

  // ──────────────────────────── 场景组合 ────────────────────────────

  /** 落格前置对:置 Land 相位并结算落格。 */
  land(): void {
    this.engine.turnPhase = "Land";
    this.engine.resolveLanding();
  }

  /** 摆位 + 落格一步到位(测试最高频组合:摆活跃玩家到 tile 并结算落格)。 */
  landActiveAt(tile: number): void {
    this.placeActive(tile);
    this.land();
  }

  /** 对局日志扁平文本。 */
  logText(): string {
    return this.engine.log.map((l) => `${l.brief} ${l.detail}`).join("\n");
  }
}

/** 测试场景工厂:组合引擎前置态与落格步骤(test/ 专用)。 */
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

/** 麾下槽位布场:把名将以槽位入麾下——skillIds 显式给定(缺省=整池原序:布场工厂
 *  不掷骰保测试确定性,真实对局授技=rollGrantedSkills 掷子集,#787)。槽位形状单源
 *  roster.HeroSlot。 */
export function armHero(e: GameEngine, p: Player, hero: HeroDef, skillIds?: string[]): void {
  if (!HEROES.some((h) => h.id === hero.id)) {
    HEROES.push(hero);
    armedTestHeroes.push(hero);
    e.recruitedHeroIds.add(hero.id); // 合成将不进招贤候选(骰流与候选断言不受扰)
  }
  p.heroes.push({ heroId: hero.id, skillIds: skillIds ?? [...hero.skillPool], lastFired: {} });
}

/** 招贤候选行布场(#787 候选行形状):直写 e.offeredHeroes 用——skillIds 显式给定
 *  (缺省=整池:种植者定预掷结果,引擎落定原样入槽不重掷)。 */
export function heroOffer(def: HeroDef, skillIds?: string[]): HeroOffer {
  return { def, skillIds: skillIds ?? [...def.skillPool] };
}
