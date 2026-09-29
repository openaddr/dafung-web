// 招贤纳士域(#326,ADR-0019 委托式拆分):名将三选一的候选生成(tryRecruitHero)与
// 选定(resolveHeroPick)。触发方是落格结算——己都城补给后与卧龙岗落格经壳上
// g.tryRecruitHero 消费(movement-flow.resolveLanding);候选池洗牌消耗引擎骰
// (setup-flow.shuffle 注入 dice.nextFloat),骰流顺序敏感,逐字保留。
// 独立 mini 机制自成模块的先例与机遇域同构:落格触发(maybeApplyEncounter)+ 玩家命令
// (resolveEncounterChoice)两段式,相位 AwaitingHeroPick、时机 HeroRecruited 归本域。
// GameEngine 侧保留同名公共方法薄委托(外部 importer 无感),authority.ts 招贤区段。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import { HERO_CAPACITY } from "./constants";
import { HEROES } from "./heroes";
import { shuffle } from "./setup-flow";

/** 招贤纳士:从剩余名将池随机抽 3 张(三选一)。满额/无货→直接 endTurn。
 *  #323 去私有化(ADR-0019 条款 3):落格结算 movement-flow.resolveLanding 经 g. 直调;
 *  testing.ts 白盒窄面照旧。#326 迁出壳内至此域模块。 */
export function tryRecruitHero(g: GameEngine, mover: Player): void {
  if (mover.heroes.length >= HERO_CAPACITY) {
    g.endTurn();
    return;
  }
  const available = HEROES.filter((h) => !g.recruitedHeroIds.has(h.id));
  if (available.length === 0) {
    g.endTurn();
    return;
  }
  g.offeredHeroes = shuffle(available, g.dice.nextFloat).slice(0, 3);
  g.turnPhase = "AwaitingHeroPick";
  g.logEvent(
    "setup",
    mover.guohao,
    `${mover.guohao} 招贤纳士:三选一`,
    `offerHeroes player=${mover.id} count=${g.offeredHeroes.length} heroes=${g.offeredHeroes.map((h) => h.id).join("|")}`,
  );
}

/** 玩家从招贤纳士候选中选一位(或跳过)。公开(供 UI/bot 调用)。 */
export function resolveHeroPick(g: GameEngine, index: number): void {
  if (!g.assertPhase("AwaitingHeroPick", "ResolveHeroPick")) return;
  const hero = g.offeredHeroes[index];
  if (hero) {
    g.activePlayer.heroes.push(hero);
    g.recruitedHeroIds.add(hero.id);
    g.logEvent(
      "setup",
      g.activePlayer.guohao,
      `${g.activePlayer.guohao} 招贤纳士,得「${hero.name}」:${hero.desc}`,
      `pickHero player=${g.activePlayer.id} hero=${hero.id}`,
    );
    g.dispatchMoment("HeroRecruited", { subject: g.activeIndex, heroId: hero.id }); // 时机·HeroRecruited:招贤成功(选定名将;tryRecruitHero 只出三选一候选)
  }
  g.offeredHeroes = [];
  g.endTurn();
}
