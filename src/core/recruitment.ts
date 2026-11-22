// 招贤纳士由落己都城或招贤城开启。一次机会可选将、求书或跳过。
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
  skillBookLearners,
} from "./roster";
import { shuffle } from "./dice";
import { SKILLS } from "./skills";

/** 招贤候选行(#787,ADR-0036 预掷明牌):候选将定义 + 生成时掷定的授技子集(按池序)。
 *  卡面亮预掷结果再选将——授技结果直接影响选将决策;resolveHeroPick 落定沿用此结果,
 *  不得重掷(卡面亮的=实际入麾下的)。纯数据,随快照走(决策窗校准快照下行)。 */
export interface HeroOffer {
  def: HeroDef;
  skillIds: string[];
}

export type HeroPick = { index: number } | { action: "seekBook" | "skip" };

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

/** 锦囊「求贤令」的位满分叉:
 *  麾下未满 → 授技入麾下单点(grantHeroSlot,战报归调用方);
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

/** 有空位时先洗剩余名将池,最多取三位并逐一预掷授技。无候选时仍进入求书或跳过。 */
export function tryRecruitHero(g: GameEngine, mover: Player): void {
  const available =
    mover.heroes.length < HERO_CAPACITY ? HEROES.filter((h) => !g.recruitedHeroIds.has(h.id)) : [];
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
    `${mover.guohao} 招贤纳士`,
    `offerHeroes player=${mover.id} count=${g.offeredHeroes.length} heroes=${g.offeredHeroes.map((h) => h.def.id).join("|")}`,
  );
}

/** 按技表顺序分池,共享技能只计一册。可学池有货时先各半选池,随后抽一册。 */
function seekSkillBook(g: GameEngine, mover: Player): void {
  const learnable: string[] = [];
  const others: string[] = [];
  for (const { id } of SKILLS) {
    const pool = skillBookLearners(mover, id).length > 0 ? learnable : others;
    pool.push(id);
  }
  const pool = learnable.length > 0 && g.dice.nextFloat() < 0.5 ? learnable : others;
  const skillId = pool[Math.floor(g.dice.nextFloat() * pool.length)]!;
  foldSkillBookIntoTreasures(
    g,
    mover,
    skillId,
    null,
    (bookName) => `${mover.guohao} 求得「${bookName}」`,
    "seekBook",
  );
}

/** 招贤机会只能结算一次。招贤城续行交易链,己都城结算后结束回合。 */
export function resolveHeroPick(g: GameEngine, pick: HeroPick): void {
  if (!g.assertPhase("AwaitingHeroPick", "ResolveHeroPick")) return;
  const mover = g.activePlayer;
  if ("action" in pick) {
    switch (pick.action) {
      case "seekBook":
        seekSkillBook(g, mover);
        break;
      case "skip":
        g.logEvent(
          "setup",
          mover.guohao,
          `${mover.guohao} 跳过招贤`,
          `skipHero player=${mover.id}`,
        );
        break;
      default:
        throw new Error("无效的招贤操作");
    }
  } else {
    const offer = Number.isInteger(pick.index) ? g.offeredHeroes[pick.index] : undefined;
    if (offer == null) throw new Error("无此招贤候选");
    g.logEvent(
      "setup",
      mover.guohao,
      // 浮字文案=已授技口径(#787):授预掷子集的技名串,不再拼接全池被动 desc
      `${mover.guohao} 招贤纳士,得「${offer.def.name}」,授${grantedNamesLine(offer.skillIds)}`,
      `pickHero player=${mover.id} hero=${offer.def.id} skills=${offer.skillIds.join("|")}`,
    );
    // 预掷沿用(#787 契约):候选行上的授技结果原样入槽,此处不重掷
    grantHeroSlot(g, mover, offer.def, offer.skillIds);
  }
  g.offeredHeroes = [];
  if (g.pendingCityEvent) {
    g.turnPhase = "Land";
    g.resolveLanding(); // 固定事件解毕续跑交易链(标记由 resolveLanding 消费即清)
    return;
  }
  g.endTurn();
}
