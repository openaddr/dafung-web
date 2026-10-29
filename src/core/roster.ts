// 麾下域(#785,ADR-0036):名将槽位 + 授技掷骰单点。玩家侧名将从内联整份 HeroDef 改为
// 麾下槽位 {heroId, skillIds, lastFired}——「同一名将不同玩家持不同技」从此可表达;
// 冷却账内嵌槽位(键=技 id、作用域限本槽),同名技跨玩家/跨槽互为独立实例,遣散整槽
// 弃、无孤儿键。三送将路(招贤纳士/机遇义士来投·以宝换贤/锦囊求贤令)收敛到同一
// 授技入麾下函数(本文件);skillIds 按池声明序存,派发确定性 = 座位序×槽位序×已授技序。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import type { HeroDef } from "./heroes";
import { shuffle } from "./dice";
import { activeSkillById, skillById } from "./skills";

/** 麾下槽位:一名诸侯持有的一名名将实例。skillIds=已授技(#787 授技掷骰的实掷子集,
 *  按池声明序存;落槽后终身不改——无补技通道);lastFired 键=技 id、作用域限本槽
 *  (实例天然独立)。纯数据,可序列化(无函数/无循环引用)。 */
export interface HeroSlot {
  heroId: string;
  skillIds: string[];
  lastFired: Record<string, number>;
}

/** 授技掷骰(#787,ADR-0036,三送将路同一公式唯一单源):先掷基数 k = 1+⌊rng×池大小⌋
 *  (1..池大小均匀),再对池 Fisher-Yates 洗牌(注入 rng,骰流序固定)取前 k 定「谁入麾下」
 *  ——「至少一技」天然成立,零保底;返回子集按池声明序重排(槽位 skillIds 池序契约,
 *  洗牌只定成员、池序定存储序)。掷骰只走调用方注入的 rng(引擎= g.dice.nextFloat,
 *  联机各端一致,严禁 Math.random)。 */
export function rollGrantedSkills(skillPool: string[], rng: () => number): string[] {
  const k = 1 + Math.floor(rng() * skillPool.length);
  const picked = new Set(shuffle(skillPool, rng).slice(0, k));
  return skillPool.filter((id) => picked.has(id));
}

/** 授技入麾下(三送将路唯一入槽口):建槽 + 招贤池占位 + HeroRecruited 时机(事件体
 *  skillIds=本次授技,客户端折叠不得自行重掷)。granted 必填:招贤路传候选行预掷结果
 *  (卡面亮的=实际入麾下的,#787 契约);机遇/锦囊盲盒路由 rollGrantedSkills 现掷
 *  (将身份落定一刻同掷,结果终身不改)。调用方先写战报再入槽(三路 log→dispatch 序
 *  保持);掷骰只走 g.dice.nextFloat。 */
export function grantHeroSlot(
  g: GameEngine,
  player: Player,
  hero: HeroDef,
  granted: string[],
): HeroSlot {
  const slot: HeroSlot = { heroId: hero.id, skillIds: [...granted], lastFired: {} };
  player.heroes.push(slot);
  g.recruitedHeroIds.add(hero.id);
  g.dispatchMoment("HeroRecruited", { subject: g.players.indexOf(player), heroId: hero.id });
  return slot;
}

/** 已授技名串(战报/浮字宣告口径,#787):授【技名】【技名】…——信息=实际习得哪些技,
 *  不再拼接全池被动 desc(#604 读口随全池授技退役)。 */
export function grantedNamesLine(skillIds: string[]): string {
  return skillIds.map((id) => `【${skillById(id).name}】`).join("");
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
