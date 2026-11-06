// 招贤纳士域(#326,ADR-0019 委托式拆分):名将三选一的候选生成(tryRecruitHero)与
// 选定(resolveHeroPick)。触发方是落格结算——己都城补给后与招贤城固定事件(event:"hero",
// #824/#826,ADR-0037)经壳上 g.tryRecruitHero 消费;候选池洗牌消耗引擎骰
// (dice.shuffle 注入 dice.nextFloat),骰流顺序敏感,逐字保留。
// 独立 mini 机制自成模块的先例与机遇域同构:落格触发(maybeApplyEncounter)+ 玩家命令
// (resolveEncounterChoice)两段式,相位 AwaitingHeroPick、时机 HeroRecruited 归本域。
// GameEngine 侧保留同名公共方法薄委托(外部 importer 无感),authority.ts 招贤区段。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import { HERO_CAPACITY } from "./constants";
import type { HeroDef } from "./heroes";
import { HEROES } from "./heroes";
import {
  foldSkillBookIntoTreasures,
  grantHeroSlot,
  grantedNamesLine,
  rollGrantedSkills,
} from "./roster";
import { shuffle } from "./dice";

/** 招贤候选行(#787,ADR-0036 预掷明牌):候选将定义 + 生成时掷定的授技子集(按池序)。
 *  卡面亮预掷结果再选将——授技结果直接影响选将决策;resolveHeroPick 落定沿用此结果,
 *  不得重掷(卡面亮的=实际入麾下的)。纯数据,随快照走(决策窗校准快照下行)。 */
export interface HeroOffer {
  def: HeroDef;
  skillIds: string[];
}

/** 位满印书(#1146,spec #1144 拆票 B):该次预掷授技各印一册技能书按普通珍宝入位——
 *  不再得将、不占招贤池、零折现(位满分叉的账面位移:原先「满编折现」路由本路接替,
 *  「名将已尽」折现不变,两语义互斥)。战报逐册一行(书名携技名,audit 键 hero/skill/
 *  treasure);入位宣告走 TreasureGained 时机产 treasureGained 事件(书走珍宝实例现
 *  通路,fold/表现零特判)。机制环单源=roster.foldSkillBookIntoTreasures(评审 S1,
 *  与遣散折书共环)。调用方=grantHeroOrBooks 单喉。 */
function printSkillBooks(
  g: GameEngine,
  player: Player,
  hero: HeroDef,
  granted: string[],
  prefix: string,
): void {
  for (const skillId of granted) {
    foldSkillBookIntoTreasures(
      g,
      player,
      skillId,
      hero.id,
      (bookName) => `${player.guohao} ${prefix}麾下满编,「${hero.name}」授技化作「${bookName}」`,
      "skillBook",
    );
  }
}

/** 位满分叉单喉(#1146,四送将路唯一落点——招贤城/求贤令/义士来投/以宝换贤全走此喉):
 *  麾下未满 → 授技入麾下单点(grantHeroSlot,战报归调用方,三路渠道语境各自成文);
 *  麾下已满 → 该次预掷授技各印一册技能书按普通珍宝入位(printSkillBooks,战报喉内逐册
 *  自带)。预掷结果改印书,零新随机——掷骰只走调用方先掷定的 hero/granted。 */
export function grantHeroOrBooks(
  g: GameEngine,
  player: Player,
  hero: HeroDef,
  granted: string[],
  prefix: string,
): void {
  if (player.heroes.length < HERO_CAPACITY) {
    grantHeroSlot(g, player, hero, granted);
    return;
  }
  printSkillBooks(g, player, hero, granted, prefix);
}

/** 招贤纳士:从剩余名将池随机抽 3 张(三选一),逐候选预掷授技明牌(#787)。无货(名将
 *  已尽)→ 返回 "silent"(事件沉默,收尾归调用方:都城 endTurn,招贤城续交易链 #824)。
 *  位满(#1146)→ 同样返回 "silent"(不设候选),但不再空手:盲盒同式现掷(选将 1 掷 +
 *  授技 1 掷)经单喉印书,该次预掷授技各印一册按普通珍宝入位。
 *  #323 去私有化(ADR-0019 条款 3):落格结算 movement-flow.resolveLanding 经 g. 直调;
 *  testing.ts 白盒窄面照旧。#326 迁出壳内至此域模块。
 *  骰流契约:位满路先池空判定(零骰),再选将 1 掷 + 授技 1 掷(与盲盒三路同式,零新
 *  随机);候选路先整池洗牌定候选序(dice.shuffle),再按候选序逐将 rollGrantedSkills
 *  (基数 + 池内抽取)——顺序固定,同 seed 重放一致;池空沉默路不耗骰。 */
export function tryRecruitHero(g: GameEngine, mover: Player): "offered" | "silent" {
  const available = HEROES.filter((h) => !g.recruitedHeroIds.has(h.id));
  if (available.length === 0) {
    return "silent";
  }
  if (mover.heroes.length >= HERO_CAPACITY) {
    const hero = available[Math.floor(g.dice.nextFloat() * available.length)];
    const granted = rollGrantedSkills(hero.skillPool, g.dice.nextFloat);
    grantHeroOrBooks(g, mover, hero, granted, ""); // prefix 留空:招贤城无渠道语境词(事件沉默契约不破)
    return "silent";
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
  return "offered";
}

/** 玩家从招贤纳士候选中选一位(或跳过)。公开(供 UI/bot 调用)。
 *  招贤城固定事件(#824,ADR-0037):pendingCityEvent 挂起时解完续跑落格结算
 *  (直入交易链、不再触发固定事件),否则照旧收回合。 */
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
  if (g.pendingCityEvent) {
    g.turnPhase = "Land";
    g.resolveLanding(); // 固定事件解毕续跑交易链(标记由 resolveLanding 消费即清)
    return;
  }
  g.endTurn();
}
