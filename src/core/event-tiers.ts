// 事件消费档位表(#430,ADR-0020 事件流):每个事件 kind 的消费档位登记——判定决策
// 从注释散文(net/event-fold.ts 文件头判定表、fx/event-extract.ts 尾注)升为机器可查
// 数据,折叠面与表现面两消费器对表穷尽(缺档位=编译期红);同表单源双消费器共享的
// 批上下文取数(宣布游标型 + 名将/主动技/机遇目录回查 + 座位契约校验,原 fold/extract
// 成对 helper 的单源化,错误文案不再分叉)。
//
// ── 消费档位词汇(#430 票面五档的坐标化:fold 面 × fx 面两格)──
//   fold 面(net/event-fold.ts 消费):
//     must-fold        精确折:折叠落账即精确,无已知漂移;
//     fold+calibration 折+校准双覆盖:折叠落账,已知漂移窗由快照校准纠正(#384 判定表
//                      「事件+校准」双覆盖档);
//     declarative      声明性无转移:宣告性事件,折叠面零状态转移(行为=忽略,理由登记);
//     calibration-only 校准兜底:折叠面刻意不折,转移由校准节点全量覆盖。
//   fx 面(fx/event-extract.ts 消费):presented 有表现 / silent 无表现。
//   票面五档映射:「must-fold 精确折」「折+校准双覆盖」「声明性无转移」= fold 面三档;
//   「无折叠纯表现」= calibration-only × presented;「双面全登记」= 每 kind 恒有两格
//   (fold+fx),这正是本表的存在意义。
//
// ── 穷尽性(本票的防遗漏机器)──
//   1. 表对 GameEventBody["kind"] 穷尽(satisfies 映射类型):词汇表新增 kind 未登记
//      档位 = 编译期红(写码那一刻,非运行时);
//   2. 派生集 FoldHandledKind / FxPresentedKind(从表按面推导):两消费器 switch 只
//      case 本面活跃 kind,default 分支守卫 `Exclude<Kind, 活跃集>`——漏 case 的活跃
//      kind 落入 default = 编译期红;线上未知 kind 不在联合内,运行时照旧忽略
//      (ADR-0020 既定口径,范围定义非吞错);
//   3. 折叠器不折清单与 server 侧校准集合的「同决策对账」(#431 下行装配票)以本表为
//      对账底册:calibration-only 与 fold+calibration 的漂移窗即校准集合的消费面。
import type { GameEngine } from "./authority";
import type { Player } from "./model";
import type { GameEvent, GameEventBody } from "./game-events";
import { HEROES, type ActiveSkillDef, type HeroDef } from "./heroes";
import { ENCOUNTERS, type EncounterDef } from "./encounters";

// ─────────────────────── 档位与条目型 ───────────────────────
/** 折叠面档位(net/event-fold.ts 对表消费)。 */
export type EventFoldTier = "must-fold" | "fold+calibration" | "declarative" | "calibration-only";

/** 表现面档位(fx/event-extract.ts 对表消费)。 */
export type EventFxFace = "presented" | "silent";

/** 单 kind 消费档位条目:fold/fx 两格 + 判据,词汇缺口显式声明(零消费面登记)。 */
export interface EventTier {
  /** 折叠面档位。 */
  readonly fold: EventFoldTier;
  /** 表现面档位。 */
  readonly fx: EventFxFace;
  /** 判据:该档位的决策理由(判定表的机器可查正文)。 */
  readonly why: string;
  /** 词汇缺口声明(#430 票项 4):已知占位/无消费面在此显式登记,不留散文注释。 */
  readonly declaredGaps?: readonly string[];
}

// ─────────────────────── per-kind 档位表(38 kind 全登记)───────────────────────
export const EVENT_TIERS = {
  // ── 回合/胜负族 ──
  gameStarted: {
    fold: "must-fold",
    fx: "silent",
    why: "开局批锚:phase=Playing+首动者 activeIndex/roundAnchor,折叠即精确",
  },
  setupCompleted: {
    fold: "calibration-only",
    fx: "silent",
    why: "Setup 期字段(draftOrder/offeredCapitals 等)不在事件面=校准兜底五项之五,开局全量覆盖",
  },
  turnEnded: {
    fold: "must-fold",
    fx: "silent",
    why: "回合收口:交涉窗口此时必已 resolution,清 treasureVisitor",
  },
  turnStarted: {
    fold: "fold+calibration",
    fx: "presented",
    why: "回合翻页+开账清场;锦囊卷轴挂起(AwaitingJinnang)不可知,水合纠正;表现=批末位 turnBanner",
  },
  roundStarted: { fold: "must-fold", fx: "silent", why: "轮次锚点主体(roundAnchor)" },
  roundEnded: { fold: "must-fold", fx: "silent", why: "轮次锚点主体(roundAnchor)" },
  gameOver: {
    fold: "must-fold",
    fx: "presented",
    why: "终局:isOver/winner/winReason/phase/turnPhase;表现=victory 音",
  },
  // ── 掷骰/行军族 ──
  diceRolled: {
    fold: "must-fold",
    fx: "presented",
    why: "lastRoll 落账+擂鼓加成消费(引擎 DieRolled 派发后取走);表现=骰子动画",
  },
  marchArrived: {
    fold: "must-fold",
    fx: "presented",
    why: "落位+落格推演镜像(相位/pendingLand/落格表现态/交涉到来),路径随事件走(#385);中伏格 skipTurns=1 标记侧",
  },
  capitalHalt: {
    fold: "must-fold",
    fx: "presented",
    why: "驻跸落位+OwnProperty 态;补给金额由相邻 cashChanged(reason=supply)回填",
  },
  // ── 城池族 ──
  capitalSelected: {
    fold: "fold+calibration",
    fx: "presented",
    why: "建城入册(占都/落位/Lv0 持有);建城扣费无 cashChanged,Setup 期现金不入折叠由开局校准覆盖(#386 注记)",
  },
  propertyBought: {
    fold: "must-fold",
    fx: "presented",
    why: "现金-价/委任状-常量/地产入册,主动支出随领域事件不产 cashChanged",
  },
  propertyUpgraded: {
    fold: "fold+calibration",
    fx: "presented",
    why: "持有等级对齐 newLevel;副本无持有按事件面补册(机遇「天赐城池」缺口级联),等级漂移水合纠正",
  },
  propertyRejected: {
    fold: "declarative",
    fx: "presented",
    why: "ADR-0013 自动按兵不动的宣告:零状态转移,相位由同批 turnStarted 收场;表现=按 reason 派生文案浮字",
  },
  exhaustionChoice: {
    fold: "fold+calibration",
    fx: "silent",
    why: "耗竭处置降级/失城(对象随事件点名可精确折);赐城缺口级联查无略过,水合纠正;表现面文案由相邻 staminaChanged(reason=exhaustion)升级携带,本 kind 不直接产演出",
  },
  assetTransferred: {
    fold: "fold+calibration",
    fx: "presented",
    why: "破产逐城易主(承让方入册保等级/无债主回无主);副本无持有时按事件面补册零级,等级漂移水合纠正",
  },
  // ── 金钱族 ──
  cashChanged: {
    fold: "must-fold",
    fx: "presented",
    why: "被动经济结算逐条累加(delta 带符号)+落格表现态相邻回填(supply 金额/tax/stock 破产标记)",
  },
  // ── 珍宝族 ──
  treasureGained: {
    fold: "must-fold",
    fx: "presented",
    why: "得宝入册(流水号实例 id 按静态表回溯);表现=treasure 音",
  },
  treasureSold: {
    fold: "fold+calibration",
    fx: "silent",
    why: "只做出册防双计(交割价随 treasureTraded、变卖所得随 assetLiquidated);窃玉缺口级联查无略过,水合纠正",
  },
  treasureTraded: {
    fold: "must-fold",
    fx: "presented",
    why: "escrow/visitor 收口+买卖双方按价动账(交易最终事实);托管置位半边无事件由校准覆盖",
  },
  treasureStolen: {
    fold: "calibration-only",
    fx: "presented",
    why: "窃玉偷香转移=校准兜底五项之二:双方珍宝列表由校准覆盖,事件只宣告不折;表现=窃得浮字",
  },
  // ── 名将族 ──
  heroRecruited: {
    fold: "must-fold",
    fx: "presented",
    why: "麾下入册+招贤池占位(recruitedHeroIds);表现=来投浮字",
  },
  playerBankrupt: {
    fold: "fold+calibration",
    fx: "presented",
    why: "出局善后(isBankrupt/清都城/释放名将/清手入弃堆);现金清零/债主收款/珍宝转债主=破产清算强制全量节点不折;表现=bankrupt 音",
  },
  skillFired: {
    fold: "must-fold",
    fx: "silent",
    why: "被动技冷却记账(heroLastFired 键=skillId);技参数不随事件,由 HEROES 表现查",
  },
  heroSkillActivated: {
    fold: "fold+calibration",
    fx: "presented",
    why: "主动技冷却+三面落账(warDrum 加成/patronage 委任状/relief 付费);demolish 随机降级目标不可知=校准兜底五项之一;表现=施展浮字",
  },
  // ── 锦囊族 ──
  jinnangDrawn: {
    fold: "must-fold",
    fx: "presented",
    why: "手牌数+count/牌库数-count(内容暗牌不折,ADR-0016);表现=获锦囊浮字",
  },
  jinnangAnnounced: {
    fold: "must-fold",
    fx: "presented",
    why: "出牌扣账(离手/手牌数-1/弃堆/标签名额)+窥探入册(军情密探);同批宣布=反应窗 targetSeats 回溯锚;表现=出牌线+浮字",
  },
  reactionOpened: {
    fold: "must-fold",
    fx: "silent",
    why: "置窗(view/seq/windowMs 派生)+ AwaitingReaction;表现面=卷轴/横幅 UI 直读副本 pendingReaction,不经提取器",
    declaredGaps: [
      "march 窗 payload:在途续走载荷无词汇,副本侧零值占位仅类型完备、零消费面(UI 读 view/answers;payload 唯一消费方=权威侧 room.ts 超时判据,不经折叠)——#430 票项 4 判定:不补词汇,表中声明",
    ],
  },
  reactionAnswered: {
    fold: "must-fold",
    fx: "presented",
    why: "应答入账+应答齐闭窗;行军窗闭窗点扣拦检牌(与引擎结算批序等效);表现=拦检出牌线",
  },
  reactionFailed: {
    fold: "declarative",
    fx: "presented",
    why: "拼点平/负宣告:零状态转移(拦检牌扣账已折于闭窗应答点,拼点参数仅文案);表现=事发现场浮字",
  },
  jinnangVoided: {
    fold: "must-fold",
    fx: "presented",
    why: "识破牌扣账(应答按座位配对,shareSeat 不参与折叠);表现=识破线+浮字",
  },
  jinnangInflicted: {
    fold: "must-fold",
    fx: "presented",
    why: "缓兵之计标记侧:目标 skipTurns+1;表现=中招浮字(实际跳过另有 turnSkipped)",
  },
  // ── 声望/体力/跳过族 ──
  reputationChanged: {
    fold: "must-fold",
    fx: "presented",
    why: "声望直加实际增减(delta=夹紧后值)+献计里程碑向上穿越重算",
  },
  staminaChanged: {
    fold: "must-fold",
    fx: "presented",
    why: "体力直加实际增减;reason=exhaustion 相邻 skipTurns+1(耗竭善后标记侧);表现读批内前置 exhaustionChoice 升级文案",
  },
  turnSkipped: {
    fold: "must-fold",
    fx: "presented",
    why: "跳过消费侧 skipTurns-1(endTurn 跳过环);表现=被跳过浮字",
  },
  // ── 机遇族 ──
  encounterTriggered: {
    fold: "must-fold",
    fx: "silent",
    why: "抉择型置 Noop+AwaitingEncounter(即时型不动落格表现态,与推演值一致);表现面=机遇卷轴 UI 直读副本态",
  },
  encounterChoice: {
    fold: "fold+calibration",
    fx: "presented",
    why: "选项结算点相位回 Land(续跑落格由同批后续事件/水合精修);选项效果 liquidating/exhausted 路挂起相位无专属事件=校准档;表现=选项文案浮字",
  },
  // ── 破产族 ──
  assetLiquidated: {
    fold: "must-fold",
    fx: "presented",
    why: "三变卖:现金+所得+变卖物出册;遣散名将释放回招贤池;表现=所得浮字(变卖城池另产回无主宣告)",
  },
} as const satisfies {
  readonly [K in GameEventBody["kind"]]: EventTier;
};

/** 事件 kind 全集(档位表的键域,消费器守卫与派生集共用)。 */
export type EventKind = GameEventBody["kind"];

/** 折叠面活跃 kind 集(从表推导):must-fold / fold+calibration 需要 switch case。 */
export type FoldHandledKind = {
  [K in EventKind]: (typeof EVENT_TIERS)[K]["fold"] extends "declarative" | "calibration-only"
    ? never
    : K;
}[EventKind];

/** 表现面活跃 kind 集(从表推导):fx=presented 需要 switch case。 */
export type FxPresentedKind = {
  [K in EventKind]: (typeof EVENT_TIERS)[K]["fx"] extends "presented" ? K : never;
}[EventKind];

// ─────────────────────── 双消费器共享批上下文(#430 票项 3)───────────────────────
/** 锦囊宣布游标:识破线/反应窗 targetSeats 回溯「最近一次宣布」——fold 批内锚
 *  (宣布与开窗同批)与 extract 跨批衔接(宣布批 → 应答批)共用同一形状,
 *  单源于此,fold/extract 各自实例化。 */
export interface AnnounceCursor {
  /** 宣布者座位。 */
  readonly userSeat: number;
  /** 所宣布的锦囊牌 id。 */
  readonly cardId: string;
  /** 受影响份清单(宣布时快照)。 */
  readonly targetSeats: number[];
}

/** 行动者座位契约校验(零兜底):座位型事件恒带有效 seat;null/越界=产出侧 bug,
 *  当场炸出。fold(折叠目标解析)与 extract(表现锚定)共用同一校验与文案。 */
export function eventSeat(engine: GameEngine, ev: GameEvent): number {
  if (ev.seat == null || ev.seat < 0 || ev.seat >= engine.players.length)
    throw new Error(`事件消费:${ev.kind} 无有效座位(seat=${ev.seat},产出侧契约违反)`);
  return ev.seat;
}

/** 目标座位解析(零兜底):事件携带的座位越界=契约违反,当场炸出(不静默写 undefined)。 */
export function eventSeatPlayer(engine: GameEngine, seat: number, label: string): Player {
  const p = engine.players[seat];
  if (p == null) throw new Error(`事件消费:${label} 目标座位越界 seat=${seat}(契约违反)`);
  return p;
}

/** 名将静态目录回查:heroId 查无=数据 bug,当场炸出(fold 入册/extract 文案共用)。 */
export function heroDefOf(heroId: string): HeroDef {
  const hero = HEROES.find((h) => h.id === heroId);
  if (hero == null) throw new Error(`事件消费:名将 ${heroId} 不在 HEROES 表(数据 bug)`);
  return hero;
}

/** 主动技静态回查(HEROES.active;skillId 同时是冷却键)。查无=数据 bug,炸出。 */
export function activeSkillDefOf(skillId: string): ActiveSkillDef {
  const skill = HEROES.flatMap((h) => (h.active ? [h.active] : [])).find((s) => s.id === skillId);
  if (skill == null) throw new Error(`事件消费:主动技 ${skillId} 不在 HEROES 表(数据 bug)`);
  return skill;
}

/** 机遇目录条目按 id 查:缺目录=数据 bug,炸出(fold 相位判定/extract 选项文案共用)。 */
export function encounterDefOfId(encounterId: string): EncounterDef {
  const def = ENCOUNTERS.find((c) => c.id === encounterId);
  if (def == null) throw new Error(`事件消费:机遇 ${encounterId} 不在 ENCOUNTERS 表(数据 bug)`);
  return def;
}
