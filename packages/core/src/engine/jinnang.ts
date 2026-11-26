// 锦囊目录与牌库构建。牌面和效果共用数值。

/** 锦囊标签是供规则引用的功能类别，一张牌可有多枚。使用时机由目标域声明。 */
export type JinnangTag = "谋" | "攻" | "守" | "援" | "即时";

/** 目标域:由牌面固定(GLOSSARY.md 锦囊条)。two-others=两步目标段(语义见下
 *  TARGET_DOMAIN_STAGES 声明表——新 two-others 牌自动获得两步流,#1067);
 *  one-city(#1389)= 城指向单选:目标=任意一座城(tileIndex 提交,无距离限制;
 *  无主城/己城皆可选),候选谓词单源 choices.fireWallCenterTargets,识破按城拆份;
 *  reaction(#281)= 纯反应牌:无手动目标段,不经出牌阶段目标校验,只在反应窗打出。 */
export type JinnangTargetDomain =
  | "self"
  | "one"
  | "two-others"
  | "all-others"
  | "one-city"
  | "reaction";

/** 目标域 → 目标段流声明表(#1067 语义声明化单源):「两步目标段、第二步排除首目标」
 *  不再内联在 resolveJinnang/choices——两消费点按 targetDomain 查此表。
 *  stages=目标段步数(0=无目标段:self 自指/all-others 全体/reaction 唯反应,出牌即执行;
 *  1=单段数量区间;2=各选一位,段名 two-a→two-b);excludeFirstFromSecond=末段候选排除首段
 *  已定目标(两步流语义:两名目标互异)。 */
export const SINGLE_TARGET = { min: 1, max: 1 } as const;

type TargetDomainFlow =
  | { stages: 0; excludeFirstFromSecond: false }
  | {
      stages: 1;
      excludeFirstFromSecond: false;
      selection: { domain: "seat" | "city"; min: number; max: number };
    }
  | {
      stages: 2;
      excludeFirstFromSecond: true;
      selection: { domain: "seat" } & typeof SINGLE_TARGET;
    };

export const TARGET_DOMAIN_STAGES: Record<JinnangTargetDomain, TargetDomainFlow> = {
  self: { stages: 0, excludeFirstFromSecond: false },
  one: {
    stages: 1,
    excludeFirstFromSecond: false,
    selection: { domain: "seat", ...SINGLE_TARGET },
  },
  "two-others": {
    stages: 2,
    excludeFirstFromSecond: true,
    selection: { domain: "seat", ...SINGLE_TARGET },
  },
  "all-others": { stages: 0, excludeFirstFromSecond: false },
  "one-city": {
    stages: 1,
    excludeFirstFromSecond: false,
    selection: { domain: "city", ...SINGLE_TARGET },
  },
  reaction: { stages: 0, excludeFirstFromSecond: false },
};

/** 效果数据(T1 只携带不执行;执行在 T2 自身域/T3 指向他人/T4 拼点窥探逐票落地;
 *  #281 反应牌(counter/ambush)在反应窗结算,不经 executeJinnang 常规通道)。 */
export type JinnangEffect =
  | { kind: "counter" } // 识破诡计(反应):被公告锦囊的那一份对目标失效;识破亦可被识破(反识破链,ADR-0060)
  | { kind: "ambush" } // 半路杀出(反应):他人行军途经己城,城主打出与之拼点拦停
  | { kind: "grantHero"; fallbackCash: number } // 求贤令:招贤一枚,名将尽折现
  | { kind: "levyAll"; amount: number } // 横征暴敛:全体其他玩家各付(上限=现金,不清算)
  | { kind: "stealTreasure" } // 窃玉偷香:随机夺目标一张珍宝
  | { kind: "staminaDamage"; damage: number; range: number } // 袭扰:近距离对手损失体力
  | { kind: "fireWall"; damage: number } // 火烧连营的逐城伤害由 fireWallSplashCities 确定受击城
  | { kind: "skipTurn" } // 缓兵之计:目标下回合被跳过
  | { kind: "extraTurn" } // 挟天子以令诸侯:结束出牌阶段，本回合收尾后接续额外回合
  | { kind: "peek" } // 军情密探:即时窥探目标锦囊手牌一次(#575,窥探弹层 viewer-only 演出)
  | { kind: "duel"; winnerBankGain: number; loserPaysUser: number }; // 连环计:二虎竞食

interface JinnangCardDef {
  id: string; // 中文,自带因果
  tags: JinnangTag[];
  targetDomain: JinnangTargetDomain;
  /** 该牌在牌库中的张数。 */
  copies: number;
  text: string; // 详情用的完整牌面文案。
  effect: JinnangEffect;
}

const LIANHUAN_WINNER_CASH = 300;
const LIANHUAN_LOSER_CASH = 400;
const LEVY_CASH = 200;
const HERO_POOL_EMPTY_CASH = 300;
const FIRE_WALL_DAMAGE = 8;
export const FIRE_WALL_RANGE = 2;
const fireWallSteps = Array.from({ length: FIRE_WALL_RANGE }, (_, i) => i + 1).join("、");
const XIRAO_DAMAGE = 10;
const XIRAO_RANGE = 3;

/** 在库锦囊，按 copies 展开。 */
export const JINNANG_CARDS: JinnangCardDef[] = [
  {
    id: "连环计",
    copies: 2,
    tags: ["谋"],
    targetDomain: "two-others",
    text: `二虎竞食:指定两名其他诸侯拼点,胜者得 ${LIANHUAN_WINNER_CASH} 两,败者向你赔 ${LIANHUAN_LOSER_CASH} 两;平局则此计作废。`,
    effect: {
      kind: "duel",
      winnerBankGain: LIANHUAN_WINNER_CASH,
      loserPaysUser: LIANHUAN_LOSER_CASH,
    },
  },
  {
    id: "军情密探",
    copies: 2,
    tags: ["谋"],
    targetDomain: "one",
    text: "细作出探:指定一名其他诸侯,窥探其锦囊手牌。",
    effect: { kind: "peek" },
  },
  {
    id: "缓兵之计",
    copies: 1,
    tags: ["谋", "攻"],
    targetDomain: "one",
    text: "拖刀之计:指定一名其他诸侯,其下回合被跳过。",
    effect: { kind: "skipTurn" },
  },
  {
    id: "横征暴敛",
    copies: 2,
    tags: ["攻"],
    targetDomain: "all-others",
    text: `强征贡赋:其余所有诸侯各向你缴纳 ${LEVY_CASH} 两;现金不足者倾囊而付。`,
    effect: { kind: "levyAll", amount: LEVY_CASH },
  },
  {
    id: "窃玉偷香",
    copies: 2,
    tags: ["攻"],
    targetDomain: "one",
    text: "巧取豪夺:指定一名其他诸侯,随机夺其一件珍宝。",
    effect: { kind: "stealTreasure" },
  },
  {
    id: "火烧连营",
    copies: 2,
    tags: ["攻"],
    targetDomain: "one-city",
    text: `火烧营寨:指定任意一座城为火源，对火源及其前方第 ${fireWallSteps} 格上的有主城各造成 ${FIRE_WALL_DAMAGE} 点火焰伤害，己城也会受伤。实际扣防且未破防的城施加燃烧，若已燃烧则续火。`,
    effect: { kind: "fireWall", damage: FIRE_WALL_DAMAGE },
  },
  {
    id: "袭扰",
    copies: 2,
    tags: ["攻"],
    targetDomain: "one",
    text: `短兵袭扰:指定双向 ${XIRAO_RANGE} 格内一名未休整的其他诸侯，使其损失 ${XIRAO_DAMAGE} 点体力。`,
    effect: { kind: "staminaDamage", damage: XIRAO_DAMAGE, range: XIRAO_RANGE },
  },
  {
    id: "识破诡计",
    copies: 2,
    tags: ["即时"],
    targetDomain: "reaction",
    text: "他人锦囊指定任意目标时,可在反应窗打出:此计对那一份失效。识破亦可被识破。",
    effect: { kind: "counter" },
  },
  {
    id: "半路杀出",
    copies: 3,
    tags: ["即时"],
    targetDomain: "reaction",
    text: "他人行军途经你的城时,可在反应窗打出:与之拼点,胜则其止步于此城,平局此计作废。",
    effect: { kind: "ambush" },
  },
  {
    id: "求贤令",
    copies: 2,
    tags: ["援"],
    targetDomain: "self",
    text: `张榜求贤:随机招来一名名将。麾下满编时将其授技印成书，名将已尽时折现 ${HERO_POOL_EMPTY_CASH} 两。`,
    effect: { kind: "grantHero", fallbackCash: HERO_POOL_EMPTY_CASH },
  },
  {
    id: "挟天子以令诸侯",
    copies: 1,
    tags: ["谋"],
    targetDomain: "self",
    text: "奉诏行事:出牌阶段，对自己使用。此牌生效后，立即结束你的出牌阶段。本回合结算完毕后，你获得一个额外回合。",
    effect: { kind: "extraTurn" },
  },
];

/** 纯反应牌判定(#281 单源):reaction 域 = 只在反应窗打出,不经出牌阶段(反识破链环
 *  的公开宣布在 reaction-window 链环窗,#571 ADR-0060,不经出牌通道)。
 *  choices(出牌阶段灰置「唯反应」)、bot(反应决策)与引擎挂点共用此判定。 */
export function isReactionCard(def: JinnangCardDef): boolean {
  return def.targetDomain === "reaction";
}

/** 起手发牌张数:进 Playing 前座位序各发。 */
export const JINNANG_STARTING_HAND = 1;
export const JINNANG_TURN_DRAW = 1;

/** 牌库构成由锦囊目录的 copies 展平。 */
export const JINNANG_DECK_LIST: string[] = JINNANG_CARDS.flatMap((c) =>
  Array.from({ length: c.copies }, () => c.id),
);

/** 按 id 查牌面定义;未知 id 直接抛错(目录外牌不允许存在)。 */
export function jinnangCardOf(id: string): JinnangCardDef {
  const def = JINNANG_CARDS.find((c) => c.id === id);
  if (!def) throw new Error(`未知锦囊:${id}`);
  return def;
}

/** 骰序洗牌(Fisher-Yates,骰子驱动):同 seed 同序,开局牌库与耗尽洗回共用单源。 */
export function diceShuffle<T>(arr: T[], dice: { nextFloat(): number }): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(dice.nextFloat() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 开局洗牌:目录展平副本骰序打乱,抽牌从牌堆顶(pop)出。 */
export function buildJinnangDeck(dice: { nextFloat(): number }): string[] {
  return diceShuffle([...JINNANG_DECK_LIST], dice);
}
