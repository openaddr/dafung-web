// 锦囊系统(#122):目录数据 + 牌库构建。纯数据 + 纯函数,单测直测。
// 设计定稿见 docs/explanation/锦囊设计.md;术语见 CONTEXT.md「锦囊与暗牌」。
// 红线:拿到即用、无需思考的牌不配当锦囊——每张牌必须在「用不用/对谁用/
// 这回合用哪张」上至少一问有真实权衡(设计拷问会定,2026-09-09)。
// id 用中文且自带因果(名字与效果互证),与机遇目录同口径。
// 牌面用语规范(2026-09-24 归一,与 docs/reference/rules/06-锦囊.md 同一口径):
//   目标句「指定一名/两名其他诸侯」「其余所有诸侯」;回指用「其」;时窗一律
//   「至你的下回合开始」;数额用阿拉伯数字(300 两);城池(非城防)、现金(非家资)、
//   名将(非武将);text 首段四字计名前缀仅入详情浮层,牌面笺脚渲染时剥离。

/** 锦囊标签(CONTEXT.md):功能类别,每回合每类限用一张;一张牌可有多枚,
 *  使用即同时占用其全部标签的本回合名额。 */
export type JinnangTag = "谋" | "攻" | "守" | "援";

/** 目标域:由牌面固定(CONTEXT.md 锦囊条)。two-others 仅连环计(二虎竞食)。 */
export type JinnangTargetDomain = "self" | "one" | "two-others" | "all-others";

/** 效果数据(T1 只携带不执行;执行在 T2 自身域/T3 指向他人/T4 拼点窥探逐票落地)。 */
export type JinnangEffect =
  | { kind: "jinnangShield" } // 免战金牌:他人的锦囊无法指定你,至你下回合开始
  | { kind: "grantHero"; fallbackCash: number } // 求贤令:招贤一枚,名将尽折现
  | { kind: "levyAll"; amount: number } // 横征暴敛:全体其他玩家各付(上限=现金,不清算)
  | { kind: "stealTreasure" } // 窃玉偷香:随机夺目标一张珍宝
  | { kind: "demolish" } // 火烧连营:随机降目标一座城 1 级,全 0 级则失去一座
  | { kind: "skipTurn" } // 缓兵之计:目标下回合被跳过
  | { kind: "peek" } // 军情密探:窥探目标手牌至使用者下回合开始
  | { kind: "duel"; winnerBankGain: number; loserPaysUser: number }; // 连环计:二虎竞食

export interface JinnangCardDef {
  id: string; // 中文,自带因果
  tags: JinnangTag[];
  targetDomain: JinnangTargetDomain;
  /** 牌库张数(v1 全 2 张,唯缓兵之计 1 张=全场唯一公开信息)。 */
  copies: number;
  text: string; // 牌面文案(与效果互证)
  effect: JinnangEffect;
}

/** 目录 v1(8 种):设计拷问会定稿,变更须过「无博弈不锦囊」红线评审。 */
export const JINNANG_CARDS: JinnangCardDef[] = [
  {
    id: "连环计", copies: 2, tags: ["谋"], targetDomain: "two-others",
    text: "二虎竞食:指定两名其他诸侯拼点,胜者得 300 两,败者向你赔 400 两;平局则此计作废。",
    effect: { kind: "duel", winnerBankGain: 300, loserPaysUser: 400 },
  },
  {
    id: "军情密探", copies: 2, tags: ["谋"], targetDomain: "one",
    text: "细作出探:指定一名其他诸侯,窥其锦囊至你的下回合开始。",
    effect: { kind: "peek" },
  },
  {
    id: "缓兵之计", copies: 1, tags: ["谋", "攻"], targetDomain: "one",
    text: "拖刀之计:指定一名其他诸侯,其下回合被跳过。",
    effect: { kind: "skipTurn" },
  },
  {
    id: "横征暴敛", copies: 2, tags: ["攻"], targetDomain: "all-others",
    text: "强征贡赋:其余所有诸侯各向你缴纳 200 两;现金不足者倾囊而付。",
    effect: { kind: "levyAll", amount: 200 },
  },
  {
    id: "窃玉偷香", copies: 2, tags: ["攻"], targetDomain: "one",
    text: "巧取豪夺:指定一名其他诸侯,随机夺其一件珍宝。",
    effect: { kind: "stealTreasure" },
  },
  {
    id: "火烧连营", copies: 2, tags: ["攻"], targetDomain: "one",
    text: "火烧营寨:指定一名其他诸侯,随机降其一座城池 1 级;其城池全为 0 级则随机失去一座。",
    effect: { kind: "demolish" },
  },
  {
    id: "免战金牌", copies: 2, tags: ["守"], targetDomain: "self",
    text: "免战旗张:至你的下回合开始,其他诸侯的锦囊无法指定你为目标。",
    effect: { kind: "jinnangShield" },
  },
  {
    id: "求贤令", copies: 2, tags: ["援"], targetDomain: "self",
    text: "张榜求贤:招揽一名名将来投;帐下已满或名将已尽则折现 300 两。",
    effect: { kind: "grantHero", fallbackCash: 300 },
  },
];

/** 起手发牌张数:进 Playing 前座位序各发。 */
export const JINNANG_STARTING_HAND = 1;

/** 牌库构成:目录 copies 展平(15 张)。 */
export const JINNANG_DECK_LIST: string[] = JINNANG_CARDS.flatMap((c) =>
  Array.from({ length: c.copies }, () => c.id),
);

/** 按 id 查牌面定义;未知 id 直接抛错(目录外牌不允许存在)。 */
export function jinnangCardOf(id: string): JinnangCardDef {
  const def = JINNANG_CARDS.find((c) => c.id === id);
  if (!def) throw new Error(`未知锦囊:${id}`);
  return def;
}

/** 开局洗牌(Fisher-Yates,骰子驱动):同 seed 同牌序,抽牌从牌堆顶(pop)出。 */
export function buildJinnangDeck(dice: { nextFloat(): number }): string[] {
  const deck = [...JINNANG_DECK_LIST];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(dice.nextFloat() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
