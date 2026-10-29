// 招贤纳士域(#326,ADR-0019 委托式拆分):名将三选一的候选生成(tryRecruitHero)与
// 选定(resolveHeroPick)。触发方是落格结算——己都城补给后与卧龙岗落格经壳上
// g.tryRecruitHero 消费(movement-flow.resolveLanding);候选池洗牌消耗引擎骰
// (dice.shuffle 注入 dice.nextFloat),骰流顺序敏感,逐字保留。
// 独立 mini 机制自成模块的先例与机遇域同构:落格触发(maybeApplyEncounter)+ 玩家命令
// (resolveEncounterChoice)两段式,相位 AwaitingHeroPick、时机 HeroRecruited 归本域。
// GameEngine 侧保留同名公共方法薄委托(外部 importer 无感),authority.ts 招贤区段。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import { HERO_CAPACITY } from "./constants";
import type { HeroDef } from "./heroes";
import { HEROES } from "./heroes";
import { grantHeroSlot, grantedNamesLine, rollGrantedSkills } from "./roster";
import { shuffle } from "./dice";

/** 招贤候选行(#787,ADR-0036 预掷明牌):候选将定义 + 生成时掷定的授技子集(按池序)。
 *  卡面亮预掷结果再选将——授技结果直接影响选将决策;resolveHeroPick 落定沿用此结果,
 *  不得重掷(卡面亮的=实际入麾下的)。纯数据,随快照走(决策窗校准快照下行)。 */
export interface HeroOffer {
  def: HeroDef;
  skillIds: string[];
}

/** 招贤纳士:从剩余名将池随机抽 3 张(三选一),逐候选预掷授技明牌(#787)。满额/无货
 *  → 直接 endTurn。#323 去私有化(ADR-0019 条款 3):落格结算 movement-flow.resolveLanding
 *  经 g. 直调;testing.ts 白盒窄面照旧。#326 迁出壳内至此域模块。
 *  骰流契约:先整池洗牌定候选序(dice.shuffle),再按候选序逐将 rollGrantedSkills
 *  (基数 + 池内抽取)——顺序固定,同 seed 重放一致。 */
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
  g.offeredHeroes = shuffle(available, g.dice.nextFloat)
    .slice(0, 3)
    .map((def): HeroOffer => ({
      def,
      skillIds: rollGrantedSkills(def.skillPool, g.dice.nextFloat),
    }));
  g.turnPhase = "AwaitingHeroPick";
  g.logEvent(
    "setup",
    mover.guohao,
    `${mover.guohao} 招贤纳士:三选一`,
    `offerHeroes player=${mover.id} count=${g.offeredHeroes.length} heroes=${g.offeredHeroes.map((h) => h.def.id).join("|")}`,
  );
}

/** 玩家从招贤纳士候选中选一位(或跳过)。公开(供 UI/bot 调用)。 */
export function resolveHeroPick(g: GameEngine, index: number): void {
  if (!g.assertPhase("AwaitingHeroPick", "ResolveHeroPick")) return;
  const offer = g.offeredHeroes[index];
  if (offer) {
    g.logEvent(
      "setup",
      g.activePlayer.guohao,
      // 浮字文案=已授技口径(#787):授预掷子集的技名串,不再拼接全池被动 desc
      `${g.activePlayer.guohao} 招贤纳士,得「${offer.def.name}」,授${grantedNamesLine(offer.skillIds)}`,
      `pickHero player=${g.activePlayer.id} hero=${offer.def.id} skills=${offer.skillIds.join("|")}`,
    );
    // 预掷沿用(#787 契约):候选行上的授技结果原样入槽,此处不重掷
    grantHeroSlot(g, g.activePlayer, offer.def, offer.skillIds);
  }
  g.offeredHeroes = [];
  g.endTurn();
}
