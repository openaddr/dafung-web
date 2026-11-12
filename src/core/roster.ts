// 麾下域(#785,ADR-0036):名将槽位 + 授技掷骰单点。玩家侧名将从内联整份 HeroDef 改为
// 麾下槽位 {heroId, skillIds, lastFired}——「同一名将不同玩家持不同技」从此可表达;
// 冷却账内嵌槽位(键=技 id、作用域限本槽),同名技跨玩家/跨槽互为独立实例,遣散整槽
// 弃、无孤儿键。三送将路(招贤纳士/机遇义士来投·以宝换贤/锦囊求贤令)收敛到同一
// 授技入麾下函数(本文件);skillIds 按池声明序存,派发确定性 = 座位序×槽位序×已授技序。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import type { HeroDef } from "./heroes";
import { heroById } from "./heroes";
import { shuffle } from "./dice";
import { skillById } from "./skills";
import { makeSkillBook } from "./treasures";

/** 麾下槽位:一名诸侯持有的一名名将实例。skillIds=已授技(#787 授技掷骰的实掷子集,
 *  按池声明序存;落槽后终身不改——无补技通道);lastFired 键=技 id、作用域限本槽
 *  (实例天然独立)。纯数据,可序列化(无函数/无循环引用)。 */
export interface HeroSlot {
  heroId: string;
  skillIds: string[];
  lastFired: Record<string, number>;
  /** 技能标记(#1377,槽位通用序列化字段):按技 id 计数的积攒容器(放逐攒怒用;
   *  遣散/换技整槽随弃,无孤儿键)。可选=构造点是否标记感知(授技单点 grantHeroSlot/
   *  种植件 armHero/快照恢复/事件折叠四路恒置空表);缺容器的槽写入标记当场炸(零兜底,
   *  addSkillMarks),读未启技=0 是计数器规范缺省(skillMarksOf)。快照非空才产键
   *  (snapshot.ts,空容器=规范缺省,对局摘要指纹零扰动;恢复与折叠重建容器)。 */
  marks?: Record<string, number>;
}

/** 授技衰减基数(#969,ADR-0046):每多一技,授得概率 ÷5。三技将 1 技 25/31(80.6%)、
 *  2 技 5/31(16.1%)、3 技 1/31(3.2%);二技将 5/6、1/6。池大小不再线性调期望,改调
 *  多技尾部(满池存在感)。 */
const SKILL_DECAY_BASE = 5;

/** 授技掷骰(#787,ADR-0036/ADR-0046,三送将路同一公式唯一单源):基数 k 服从几何衰减
 *  (P(k) ∝ SKILL_DECAY_BASE^(k-1),大概率一技、小概率两技、极小概率满池,#969)——整数
 *  权重 5^(池大小-k) 求和,单掷反变换落档定 k(「至少一技」天然成立,零保底);再对池
 *  Fisher-Yates 洗牌(注入 rng,骰流序固定)取前 k 定「谁入麾下」;返回子集按池声明序
 *  重排(槽位 skillIds 池序契约,洗牌只定成员、池序定存储序)。掷骰只走调用方注入的
 *  rng(引擎= g.dice.nextFloat,联机各端一致,严禁 Math.random)。 */
export function rollGrantedSkills(skillPool: string[], rng: () => number): string[] {
  const n = skillPool.length;
  const total = (SKILL_DECAY_BASE ** n - 1) / (SKILL_DECAY_BASE - 1); // Σ 5^(n-k),整数
  let rest = Math.floor(rng() * total);
  let k = 1;
  for (let w = SKILL_DECAY_BASE ** (n - 1); rest >= w && k < n; w /= SKILL_DECAY_BASE) {
    rest -= w;
    k += 1;
  }
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
  const slot: HeroSlot = { heroId: hero.id, skillIds: [...granted], lastFired: {}, marks: {} };
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

// ───────────────────────── 技能标记(#1377,「你可」形制的积攒容器)─────────────────────────
// 读写单点:计数器语义=未启技读 0(规范缺省,非数据缺失);容器缺席=构造点未初始化,
// 写入当场炸(零兜底——标记感知构造三路见 HeroSlot.marks 头注)。

/** 标记读口(单测/效果层同用):未启技=0。 */
export function skillMarksOf(slot: HeroSlot, skillId: string): number {
  return slot.marks?.[skillId] ?? 0;
}

/** 标记累加写口(效果层专用;返回累加后总额)。损失额为正值入账,增益不进此口
 *  (StaminaLoss 只派损失方向,timing.ts 口径)。 */
export function addSkillMarks(slot: HeroSlot, skillId: string, amount: number): number {
  if (slot.marks == null)
    throw new Error(`技能标记:槽位 ${slot.heroId} 无标记容器(构造点未初始化,数据 bug)`);
  slot.marks[skillId] = (slot.marks[skillId] ?? 0) + amount;
  return slot.marks[skillId];
}

/** 标记归零(#1377 放逐发动):覆写清零即超出部分舍弃(非累减),达成
 *  「发动后需再攒 60 才能再放」的节奏口径。 */
export function resetSkillMarks(slot: HeroSlot, skillId: string): void {
  if (slot.marks == null)
    throw new Error(`技能标记:槽位 ${slot.heroId} 无标记容器(构造点未初始化,数据 bug)`);
  slot.marks[skillId] = 0;
}

// ──────────────────────────── 技能书·学技(#1146)────────────────────────────
/** 可学者判定(#1146,用书/印书共用的「谁可习得此技」单源):麾下「池含此技且未习得」
 *  的槽位,按槽位序返回——bot 贪心取首、UI 三态(0 名禁用/1 名直学/多名弹窗)与引擎
 *  校验同读本口,防第二套判定漂移。参数取麾下最小结构(快照玩家行/引擎 Player 同构,
 *  客户端可直调)。技能二元有无:习得与否只看 skillIds 成员。 */
export function skillBookLearners(player: { heroes: HeroSlot[] }, skillId: string): HeroSlot[] {
  return player.heroes.filter((slot) => {
    const pool = heroById(slot.heroId).skillPool;
    return pool.includes(skillId) && !slot.skillIds.includes(skillId);
  });
}

/** 学技入槽(#1146,用书学技的落账单点):按名将池声明序把 skillId 并入槽内 skillIds
 *  (槽内序恒池序——与授技同款,招贤所得/书学所得在槽内不可分辨);lastFired 不落键
 *  =照新授技同款(就绪、无冷却负债)。校验:槽在、池含此技、未习得——违反=命令与
 *  麾下不符,当场抛错(零兜底;可学性判定单源 skillBookLearners,调用方先验)。 */
export function learnSkillInSlot(player: Player, heroId: string, skillId: string): HeroSlot {
  const slot = heroSlotOf(player, heroId);
  const pool = heroById(heroId).skillPool;
  if (!pool.includes(skillId))
    throw new Error(`学技入槽:名将 ${heroId} 池不含技 ${skillId}(命令与麾下不符,数据 bug)`);
  if (slot.skillIds.includes(skillId))
    throw new Error(`学技入槽:名将 ${heroId} 已习得 ${skillId}(重复习得,数据 bug)`);
  slot.skillIds = pool.filter((id) => id === skillId || slot.skillIds.includes(id));
  return slot;
}

/** 折书入位单环(#1146 位满印书/#1147 遣散折书共用的机制环,评审 S1 归一):印一册
 *  (makeSkillBook 单源)→ push 珍宝位 → 战报一行 → TreasureGained 时机派发——得宝系
 *  联动技(得陇望蜀族)照常击发,零特判。战报文案随语境(位满/遣散措辞各异)由调用方
 *  以 bookName 组装;audit kind 位满=`skillBook`、遣散=`dismissBook`。 */
export function foldSkillBookIntoTreasures(
  g: GameEngine,
  player: Player,
  skillId: string,
  heroId: string,
  logCopy: (bookName: string) => string,
  auditKind: "skillBook" | "dismissBook",
): void {
  const book = makeSkillBook(skillId);
  player.treasures.push(book);
  g.logEvent(
    "system",
    player.guohao,
    logCopy(book.name),
    `${auditKind} player=${player.id} hero=${heroId} skill=${skillId} treasure=${book.id}`,
  );
  g.dispatchMoment("TreasureGained", {
    subject: g.players.indexOf(player),
    treasureId: book.id,
  });
}
