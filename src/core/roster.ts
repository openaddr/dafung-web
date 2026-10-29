// 麾下域(#785,ADR-0036):名将槽位 + 授技单点。玩家侧名将从内联整份 HeroDef 改为
// 麾下槽位 {heroId, skillIds, lastFired}——「同一名将不同玩家持不同技」从此可表达;
// 冷却账内嵌槽位(键=技 id、作用域限本槽),同名技跨玩家/跨槽互为独立实例,遣散整槽
// 弃、无孤儿键。三送将路(招贤纳士/机遇义士来投·以宝换贤/锦囊求贤令)收敛到同一
// 授技入麾下函数(本文件);skillIds 按池声明序存,派发确定性 = 座位序×槽位序×已授技序。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import type { HeroDef } from "./heroes";
import { activeSkillById } from "./skills";

/** 麾下槽位:一名诸侯持有的一名名将实例。skillIds=已授技,按池声明序存(本票授技=全池
 *  原序;授技掷子集是票 #787,落槽后终身不改——无补技通道);lastFired 键=技 id、作用域
 *  限本槽(实例天然独立)。纯数据,可序列化(无函数/无循环引用)。 */
export interface HeroSlot {
  heroId: string;
  skillIds: string[];
  lastFired: Record<string, number>;
}

/** 授技入麾下(三送将路唯一入槽口):建槽(本票授技=全池原序,不掷骰)+招贤池占位+
 *  HeroRecruited 时机(事件体 skillIds=本次授技,客户端折叠不得自行重掷)。调用方先写
 *  战报再入槽(三路既有 log→dispatch 序保持);授技结果落槽后终身不改。 */
export function grantHeroSlot(g: GameEngine, player: Player, hero: HeroDef): HeroSlot {
  const slot: HeroSlot = { heroId: hero.id, skillIds: [...hero.skillPool], lastFired: {} };
  player.heroes.push(slot);
  g.recruitedHeroIds.add(hero.id);
  g.dispatchMoment("HeroRecruited", { subject: g.players.indexOf(player), heroId: hero.id });
  return slot;
}

/** 按将 id 定位槽位(冷却记账/事件折叠的定位走槽):查无=数据 bug,炸出(零兜底)。 */
export function heroSlotOf(player: Player, heroId: string): HeroSlot {
  const slot = player.heroes.find((s) => s.heroId === heroId);
  if (slot == null) throw new Error(`麾下槽位:玩家 ${player.id} 无将 ${heroId}(数据 bug)`);
  return slot;
}

/** 首个「持有该技且冷却就绪」的槽(槽位序;同名技多槽时的发动定位单源,冷却账各槽各读):
 *  查无返回 null(命令与麾下不符/全槽冷却中,由调用方处置;冷却口径与 choices.ts
 *  skillCooldownLeft 同式:距上次发动 ≥ cooldown 轮)。 */
export function readySkillSlot(player: Player, skillId: string, round: number): HeroSlot | null {
  const cooldown = activeSkillById(skillId).cooldown;
  const last = (slot: HeroSlot) => slot.lastFired[skillId] ?? -Infinity;
  return (
    player.heroes.find((s) => s.skillIds.includes(skillId) && round - last(s) >= cooldown) ?? null
  );
}
